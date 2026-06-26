import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  AgentDetection,
  AgentEvent,
  AgentRunParams,
  DetectContext,
  LaunchPlan,
  LocalAgentProviderPlugin,
  RawAgentStream,
  SkillMaterializationRecord,
} from '@tutti-os/agent-acp-kit';
import { resolveClaudeCommand } from './local-claude-command.js';
import { scrubNestedClaudeSessionEnv } from './nested-session-env.js';

const execFileAsync = promisify(execFile);

export interface VibeClaudeProviderOptions {
  claudeHome?: string;
  claudeSettingsPath?: string;
  userClaudeHome?: string;
  /**
   * Overrides how the macOS login Keychain credential is read. Returns the raw
   * credential JSON (the `claude` "Claude Code-credentials" secret) or null.
   * Mainly for tests; production reads the real Keychain via `security`.
   */
  readKeychainCredentials?: () => string | null;
}

const CLAUDE_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_MODEL',
] as const;
const CLAUDE_ACCOUNT_STATE_KEYS = ['oauthAccount', 'userID'] as const;

export function createVibeClaudeProvider(
  options: VibeClaudeProviderOptions = {},
): LocalAgentProviderPlugin<'local-agent', 'claude'> {
  // Clear any leaked nested-session marker up front so both detection
  // (`claude --version` / `auth status`) and runs spawn a clean `claude`.
  scrubNestedClaudeSessionEnv();
  const cleanupByRunId = new Map<string, string[]>();

  async function cleanupRun(runId: string): Promise<void> {
    const cleanupTargets = cleanupByRunId.get(runId) ?? [];
    cleanupByRunId.delete(runId);
    await Promise.all(cleanupTargets.map((target) => rm(target, { recursive: true, force: true })));
  }

  function registerCleanup(runId: string, targets: string[]): void {
    if (targets.length === 0) {
      return;
    }
    cleanupByRunId.set(runId, [...(cleanupByRunId.get(runId) ?? []), ...targets]);
  }

  return {
    id: 'claude',
    displayName: 'Claude Code',
    kind: 'local-agent',
    async detect(context) {
      return detectClaude(resolveClaudeHome(options), options, context);
    },
    capabilities() {
      return {
        cancel: true,
        nativeResume: true,
        streaming: true,
        toolGateway: true,
        maxConcurrentRuns: 1,
      };
    },
    async buildLaunchPlan(params) {
      return buildClaudeLaunchPlan(params, options, registerCleanup);
    },
    createAdapter() {
      let adapterRunId: string | undefined;
      return {
        buildLaunchPlan: async (params) => {
          adapterRunId = params.runId;
          try {
            return await buildClaudeLaunchPlan(params, options, registerCleanup);
          } catch (error) {
            await cleanupRun(params.runId);
            throw error;
          }
        },
        capabilities: () => ({
          cancel: true,
          nativeResume: true,
          streaming: true,
          toolGateway: true,
          maxConcurrentRuns: 1,
        }),
        parseEvents: async function* (stream) {
          try {
            yield* parseClaudeRawStream(stream);
          } finally {
            if (adapterRunId) {
              await cleanupRun(adapterRunId);
            }
          }
        },
      };
    },
    async *run() {
      throw new Error('Claude runs are handled by the local agent runtime transport adapter.');
    },
  };
}

export function parseVibeClaudeStreamEvent(item: unknown): AgentEvent[] {
  const record = readRecord(item);
  if (!record) {
    return [];
  }

  const type = readString(record.type);
  if (type === 'assistant') {
    return parseAssistantEvent(record);
  }

  if (type === 'thinking') {
    const text = readString(record.text);
    return text ? [{ type: 'thinking', text }] : [];
  }

  if (type === 'tool_use') {
    return [{
      type: 'tool_call',
      id: readString(record.id) ?? '',
      name: readString(record.name) ?? 'tool',
      input: record.input,
    }];
  }

  if (type === 'tool_result') {
    return [{
      type: 'tool_result',
      id: readString(record.id) ?? '',
      name: readString(record.name) ?? 'tool',
      output: record.output,
      status: 'completed',
    }];
  }

  if (type === 'result' && record.is_error === true) {
    return [{
      type: 'error',
      code: 'claude_error',
      message: readString(record.result) ?? 'Claude run failed',
    }];
  }

  if (type === 'error') {
    return [{
      type: 'error',
      code: 'claude_error',
      message: readString(record.message) ?? 'Claude run failed',
    }];
  }

  return [];
}

async function* parseClaudeRawStream(stream: RawAgentStream): AsyncIterable<AgentEvent> {
  let sessionId: string | undefined;

  for await (const item of stream) {
    const record = readRecord(item);
    if (record?.type === 'system' && record.subtype === 'init') {
      sessionId = readString(record.session_id) ?? readString(record.sessionId) ?? sessionId;
      continue;
    }

    if (record?.type === 'done') {
      yield {
        ...(record as Extract<AgentEvent, { type: 'done' }>),
        ...(sessionId && !record.sessionId ? { sessionId } : {}),
      };
      continue;
    }

    for (const event of parseVibeClaudeStreamEvent(item)) {
      yield event;
    }
  }
}

function parseAssistantEvent(record: Record<string, unknown>): AgentEvent[] {
  const directText = readString(record.text);
  if (directText) {
    return [{ type: 'text_delta', text: directText }];
  }

  const message = readRecord(record.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  const events: AgentEvent[] = [];
  for (const entry of content) {
    const contentRecord = readRecord(entry);
    if (!contentRecord) {
      continue;
    }

    if (contentRecord.type === 'text') {
      const text = readString(contentRecord.text);
      if (text) {
        events.push({ type: 'text_delta', text });
      }
      continue;
    }

    if (contentRecord.type === 'thinking') {
      const text = readString(contentRecord.thinking) ?? readString(contentRecord.text);
      if (text) {
        events.push({ type: 'thinking', text });
      }
      continue;
    }

    if (contentRecord.type === 'tool_use') {
      events.push({
        type: 'tool_call',
        id: readString(contentRecord.id) ?? '',
        name: readString(contentRecord.name) ?? 'tool',
        input: contentRecord.input,
      });
    }
  }

  return events;
}

async function buildClaudeLaunchPlan(
  params: AgentRunParams<'local-agent', 'claude'>,
  options: VibeClaudeProviderOptions,
  registerCleanup?: (runId: string, targets: string[]) => void,
): Promise<LaunchPlan> {
  // If this server was launched from within a Claude Code session, the
  // CLAUDECODE marker leaks into our env and would be inherited by the spawned
  // `claude`, making it abort as a "nested session". Strip it before spawning.
  scrubNestedClaudeSessionEnv();
  const materializedSkills = await materializeClaudeSkills(
    params.cwd,
    params.skillManifest ?? [],
    params.runId,
  );
  registerCleanup?.(
    params.runId,
    materializedSkills
      .filter((skill) => skill.deliveryMode === 'materialized-files')
      .map((skill) => skill.materializedPath)
      .filter((path): path is string => Boolean(path)),
  );

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--strict-mcp-config',
    '--setting-sources',
    'local',
  ];
  const model = normalizeClaudeModel(params.model);
  if (model && model !== 'default') {
    args.push('--model', model);
  }

  const resumeId = resolveProviderResumeId(params.resume);
  if (resumeId) {
    args.push('--resume', resumeId);
  }

  for (const dir of params.extraAllowedDirs ?? []) {
    if (dir) args.push('--add-dir', dir);
  }

  args.push('--permission-mode', 'default');
  const claudeHome = resolveClaudeHome(options);
  syncClaudeAuthFromUserHome(claudeHome, options);
  const env = mergeClaudeRunEnv(
    claudeProcessEnv(
      claudeHome,
      readClaudeSettingsEnv(resolveClaudeSettingsPath(options, claudeHome)),
    ),
    params.env,
  );
  return {
    args,
    command: resolveClaudeCommand(),
    cwd: params.cwd,
    ...(Object.keys(env).length > 0 ? { env } : {}),
    prompt: composePrompt(params, materializedSkills),
    promptInput: 'stdin',
    runId: params.runId,
    transport: 'jsonl',
  };
}

function mergeClaudeRunEnv(
  settingsEnv: Record<string, string>,
  explicitEnv: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...settingsEnv,
    ...(explicitEnv ?? {}),
  };
}

function resolveClaudeHome(options: VibeClaudeProviderOptions): string | undefined {
  const explicitHome = options.claudeHome?.trim() || process.env.VIBE_CLAUDE_HOME?.trim();
  if (explicitHome) {
    return explicitHome;
  }

  const tuttiDataDir = process.env.TUTTI_APP_DATA_DIR?.trim();
  return tuttiDataDir ? join(tuttiDataDir, 'claude-home') : undefined;
}

function resolveClaudeSettingsPath(
  options: VibeClaudeProviderOptions,
  claudeHome: string | undefined,
): string | undefined {
  if (options.claudeSettingsPath) {
    return options.claudeSettingsPath;
  }
  return claudeHome ? join(claudeHome, '.claude', 'settings.json') : undefined;
}

function claudeProcessEnv(
  claudeHome: string | undefined,
  extraEnv: Record<string, string>,
): Record<string, string> {
  return {
    ...(claudeHome ? { HOME: claudeHome } : {}),
    ...extraEnv,
  };
}

function readClaudeSettingsEnv(settingsPath = join(homedir(), '.claude', 'settings.json')): Record<string, string> {
  const settings = readJsonRecord(settingsPath);
  const env = readRecord(settings?.env);
  if (!env) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const key of CLAUDE_ENV_KEYS) {
    const value = readString(env[key]);
    if (value) {
      result[key] = value;
    }
  }
  return result;
}

function readJsonRecord(file: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

async function detectClaude(
  claudeHome: string | undefined,
  options: VibeClaudeProviderOptions,
  context?: DetectContext,
): Promise<AgentDetection> {
  const configDir = join(claudeHome ?? homedir(), '.claude');
  const command = resolveClaudeCommand();
  try {
    syncClaudeAuthFromUserHome(claudeHome, options);
    const env = mergeClaudeDetectEnv(context?.env, claudeHome);
    const execOptions = {
      ...(context?.cwd ? { cwd: context.cwd } : {}),
      ...(env ? { env } : {}),
    };
    const { stdout } = await execFileAsync(
      command,
      ['--version'],
      Object.keys(execOptions).length > 0 ? execOptions : undefined,
    );
    const authState = await detectClaudeAuthState(command, env, context?.cwd);
    return {
      authState,
      configDir,
      executablePath: command,
      skillsDir: join(configDir, 'skills'),
      supported: true,
      version: String(stdout).trim() || 'unknown',
    };
  } catch (error) {
    return {
      authState: 'missing',
      configDir,
      executablePath: command,
      skillsDir: join(configDir, 'skills'),
      supported: false,
      unsupportedReason: error instanceof Error ? error.message : 'Executable not found on PATH: claude',
      version: 'not-installed',
    };
  }
}

function mergeClaudeDetectEnv(
  contextEnv: Record<string, string | undefined> | undefined,
  claudeHome: string | undefined,
): NodeJS.ProcessEnv | undefined {
  if (!contextEnv && !claudeHome) {
    return undefined;
  }

  return {
    ...process.env,
    ...(contextEnv ?? {}),
    ...(claudeHome ? { HOME: claudeHome } : {}),
  };
}

function syncClaudeAuthFromUserHome(
  claudeHome: string | undefined,
  options: VibeClaudeProviderOptions,
): void {
  if (!claudeHome) {
    return;
  }

  const sourceHome = resolveUserClaudeHome(options);
  if (resolve(sourceHome) === resolve(claudeHome)) {
    return;
  }

  syncClaudeCredentialsFile(sourceHome, claudeHome, options);
  syncClaudeAccountState(sourceHome, claudeHome);
  syncClaudeSettingsEnv(sourceHome, claudeHome);
}

function resolveUserClaudeHome(options: VibeClaudeProviderOptions): string {
  return options.userClaudeHome?.trim() || homedir();
}

interface CredentialCandidate {
  text: string;
  /** OAuth `expiresAt` in epoch ms, or null when the credential never expires / is unparseable. */
  expiresAt: number | null;
}

/**
 * Seeds the app-local Claude home with the freshest available credential.
 *
 * The user-home `.credentials.json` file and the macOS login Keychain can
 * disagree: on macOS the CLI refreshes OAuth tokens into the Keychain and
 * leaves the file stale. We pick whichever source has the later `expiresAt`,
 * and only overwrite an existing app-local credential when the source is
 * strictly fresher — so we never clobber a token the app-local `claude` just
 * refreshed for itself, but we also never get stuck on an expired snapshot.
 */
function syncClaudeCredentialsFile(
  sourceHome: string,
  targetHome: string,
  options: VibeClaudeProviderOptions,
): void {
  const target = join(targetHome, '.claude', '.credentials.json');
  const candidate = resolveFreshestSourceCredential(sourceHome, options);
  if (!candidate) {
    return;
  }

  if (existsSync(target)) {
    const targetExpiry = parseCredentialCandidate(safeReadFile(target))?.expiresAt ?? null;
    if (!isCredentialFresher(candidate.expiresAt, targetExpiry)) {
      return;
    }
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, candidate.text, { mode: 0o600 });
  chmodSync(target, 0o600);
}

function resolveFreshestSourceCredential(
  sourceHome: string,
  options: VibeClaudeProviderOptions,
): CredentialCandidate | null {
  const candidates = [
    parseCredentialCandidate(safeReadFile(join(sourceHome, '.claude', '.credentials.json'))),
    parseCredentialCandidate(readSourceKeychainCredentials(sourceHome, options)),
  ].filter((candidate): candidate is CredentialCandidate => candidate !== null);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((best, candidate) =>
    isCredentialFresher(candidate.expiresAt, best.expiresAt) ? candidate : best,
  );
}

/**
 * Only the real login Keychain (`security`) is consulted, and only when syncing
 * from the actual user home — this keeps tests (which point at a temp user home)
 * from reaching into the developer's real Keychain. Tests inject
 * `options.readKeychainCredentials` to exercise the Keychain path explicitly.
 */
function readSourceKeychainCredentials(
  sourceHome: string,
  options: VibeClaudeProviderOptions,
): string | null {
  if (options.readKeychainCredentials) {
    return options.readKeychainCredentials();
  }
  if (resolve(sourceHome) !== resolve(homedir())) {
    return null;
  }
  return readKeychainClaudeCredentials();
}

function readKeychainClaudeCredentials(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  try {
    const stdout = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function parseCredentialCandidate(text: string | null): CredentialCandidate | null {
  if (!text) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const record = readRecord(parsed);
  if (!record) {
    return null;
  }
  const oauth = readRecord(record.claudeAiOauth);
  const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : null;
  return { text, expiresAt };
}

function isCredentialFresher(candidateExpiry: number | null, targetExpiry: number | null): boolean {
  if (candidateExpiry === null) {
    return false;
  }
  if (targetExpiry === null) {
    return true;
  }
  return candidateExpiry > targetExpiry;
}

function safeReadFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function syncClaudeAccountState(sourceHome: string, targetHome: string): void {
  const source = readJsonRecord(join(sourceHome, '.claude.json'));
  if (!source) {
    return;
  }

  const targetPath = join(targetHome, '.claude.json');
  const target = readJsonRecord(targetPath) ?? {};
  let changed = false;
  for (const key of CLAUDE_ACCOUNT_STATE_KEYS) {
    if (source[key] !== undefined && target[key] === undefined) {
      target[key] = source[key];
      changed = true;
    }
  }

  if (changed) {
    writeJsonRecord(targetPath, target);
  }
}

function syncClaudeSettingsEnv(sourceHome: string, targetHome: string): void {
  const sourceSettings = readJsonRecord(join(sourceHome, '.claude', 'settings.json'));
  const sourceEnv = readRecord(sourceSettings?.env);
  const envSources = [
    sourceEnv,
    process.env,
  ].filter((env): env is Record<string, unknown> => Boolean(env));
  if (envSources.length === 0) {
    return;
  }

  const targetPath = join(targetHome, '.claude', 'settings.json');
  const targetSettings = readJsonRecord(targetPath) ?? {};
  const targetEnv = readRecord(targetSettings.env) ?? {};
  let changed = false;
  for (const env of envSources) {
    for (const key of CLAUDE_ENV_KEYS) {
      const value = readString(env[key]);
      if (value && targetEnv[key] !== value) {
        targetEnv[key] = value;
        changed = true;
      }
    }
  }

  if (changed) {
    targetSettings.env = targetEnv;
    writeJsonRecord(targetPath, targetSettings);
  }
}

function writeJsonRecord(file: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function detectClaudeAuthState(
  command: string,
  env: NodeJS.ProcessEnv | undefined,
  cwd: string | undefined,
): Promise<AgentDetection['authState']> {
  try {
    const { stdout } = await execFileAsync(command, ['auth', 'status'], {
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
      maxBuffer: 128 * 1024,
      timeout: 5_000,
    });
    return parseClaudeAuthStatus(stdout);
  } catch (error) {
    const authState = parseClaudeAuthStatus(readExecErrorStdout(error));
    return authState === 'unknown' ? 'unknown' : authState;
  }
}

export function parseClaudeAuthStatus(stdout: string): AgentDetection['authState'] {
  try {
    const payload = JSON.parse(stdout) as unknown;
    const record = readRecord(payload);
    if (!record || typeof record.loggedIn !== 'boolean') {
      return 'unknown';
    }

    return record.loggedIn ? 'ok' : 'missing';
  } catch {
    return 'unknown';
  }
}

function readExecErrorStdout(error: unknown): string {
  const record = readRecord(error);
  const stdout = record?.stdout;
  if (typeof stdout === 'string') {
    return stdout;
  }
  if (stdout instanceof Buffer) {
    return stdout.toString('utf8');
  }
  return '';
}

async function materializeClaudeSkills(
  cwd: string,
  skills: SkillMaterializationRecord[],
  runId: string,
): Promise<SkillMaterializationRecord[]> {
  const runRoot = resolve(cwd);
  const skillRoot = resolve(
    runRoot,
    '.local-agent',
    'runs',
    safePathSegment(runId, 'run'),
    'skills',
  );
  const seenRoots = new Set<string>();
  const materialized: SkillMaterializationRecord[] = [];

  await mkdir(runRoot, { recursive: true });
  await rejectSymlink(runRoot);

  for (const skill of skills) {
    if (skill.deliveryMode !== 'materialized-files') {
      materialized.push(skill);
      continue;
    }

    const rootPath = resolve(skillRoot, safePathSegment(skill.slug, 'skill'));
    assertInside(skillRoot, rootPath);
    if (seenRoots.has(rootPath)) {
      throw new Error(`Duplicate skill materialization path: ${rootPath}`);
    }
    seenRoots.add(rootPath);

    await resetMaterializedSkillRoot(runRoot, rootPath);
    await writeMaterializedSkillFile(rootPath, 'SKILL.md', skill.content ?? `# ${skill.slug}\n`);
    for (const file of skill.files ?? []) {
      await writeMaterializedSkillFile(rootPath, file.path, file.content);
    }

    materialized.push({
      ...skill,
      materializedPath: rootPath,
    });
  }

  return materialized;
}

async function resetMaterializedSkillRoot(runRoot: string, rootPath: string): Promise<void> {
  assertInside(runRoot, rootPath);
  await ensureDirectoryNoSymlink(runRoot, dirname(rootPath));
  await rejectSymlink(rootPath);
  await rm(rootPath, { recursive: true, force: true });
  await mkdir(rootPath, { recursive: true });
}

async function writeMaterializedSkillFile(rootPath: string, path: string, content: string): Promise<void> {
  const filePath = resolve(rootPath, path);
  assertInside(rootPath, filePath);
  await ensureDirectoryNoSymlink(rootPath, dirname(filePath));
  await rejectSymlink(filePath);
  await writeFile(filePath, content, 'utf8');
}

async function ensureDirectoryNoSymlink(rootPath: string, targetDir: string): Promise<void> {
  assertInside(rootPath, targetDir);
  const relativePath = relative(rootPath, targetDir);
  if (!relativePath) {
    return;
  }

  let current = rootPath;
  for (const part of relativePath.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part);
    const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (entry?.isSymbolicLink()) {
      throw new Error(`Refusing to write through symlink: ${current}`);
    }
    if (entry && !entry.isDirectory()) {
      throw new Error(`Expected directory while materializing skill: ${current}`);
    }
    if (!entry) {
      await mkdir(current);
    }
  }
}

async function rejectSymlink(path: string): Promise<void> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (entry?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symlink: ${path}`);
  }
}

function assertInside(rootPath: string, targetPath: string): void {
  const relativePath = relative(resolve(rootPath), resolve(targetPath));
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }
  throw new Error(`Path escapes skill root: ${targetPath}`);
}

function safePathSegment(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function composePrompt(
  params: AgentRunParams<'local-agent', 'claude'>,
  skills: SkillMaterializationRecord[] = [],
): string {
  const history = (params.history ?? [])
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');

  return [
    params.systemPrompt?.trim(),
    materializedSkillPromptSection(skills),
    injectedSkillPromptSection(skills),
    history,
    'Current request:',
    params.prompt,
  ].filter(Boolean).join('\n\n');
}

function materializedSkillPromptSection(skills: SkillMaterializationRecord[]): string {
  const materializedSkills = skills.filter(
    (skill) => skill.deliveryMode === 'materialized-files' && skill.materializedPath,
  );
  if (materializedSkills.length === 0) {
    return '';
  }

  return [
    'Workspace skills are materialized under the current run directory. Read the referenced SKILL.md before following a skill.',
    ...materializedSkills.map((skill) => `- ${skill.slug}: ${skill.materializedPath}/SKILL.md`),
  ].join('\n');
}

function injectedSkillPromptSection(skills: SkillMaterializationRecord[]): string {
  const injectedSkills = skills.filter(
    (skill) => skill.deliveryMode === 'prompt-injection' || skill.deliveryMode === 'project-instructions',
  );
  if (injectedSkills.length === 0) {
    return '';
  }

  return [
    'Skills:',
    ...injectedSkills.map((skill) => {
      const base = `- ${skill.slug}${skill.materializedPath ? ` -> ${skill.materializedPath}` : ''}`;
      return skill.content?.trim() ? `${base}\n${skill.content.trim()}` : base;
    }),
  ].join('\n');
}

function normalizeClaudeModel(model: string | undefined): string | undefined {
  if (model?.startsWith('claude:')) {
    return model.slice('claude:'.length);
  }
  return model;
}

function resolveProviderResumeId(resume: AgentRunParams['resume']): string | undefined {
  if (!resume || resume.mode === 'fresh') {
    return undefined;
  }
  return (resume.providerSessionId ?? resume.resumeToken)?.trim() || undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
