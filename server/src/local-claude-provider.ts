import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  AgentDetection,
  AgentEvent,
  AgentRunParams,
  LaunchPlan,
  LocalAgentProviderPlugin,
  RawAgentStream,
} from '@tutti-os/agent-acp-kit';
import { resolveClaudeCommand } from './local-claude-command.js';
import { scrubNestedClaudeSessionEnv } from './nested-session-env.js';

const execFileAsync = promisify(execFile);

export interface VibeClaudeProviderOptions {
  claudeSettingsPath?: string;
}

const CLAUDE_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_MODEL',
] as const;

export function createVibeClaudeProvider(
  options: VibeClaudeProviderOptions = {},
): LocalAgentProviderPlugin<'local-agent', 'claude'> {
  // Clear any leaked nested-session marker up front so both detection
  // (`claude --version` / `auth status`) and runs spawn a clean `claude`.
  scrubNestedClaudeSessionEnv();

  return {
    id: 'claude',
    displayName: 'Claude Code',
    kind: 'local-agent',
    async detect() {
      return detectClaude();
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
      return buildClaudeLaunchPlan(params, options);
    },
    createAdapter() {
      return {
        buildLaunchPlan: async (params) => buildClaudeLaunchPlan(params, options),
        capabilities: () => ({
          cancel: true,
          nativeResume: true,
          streaming: true,
          toolGateway: true,
          maxConcurrentRuns: 1,
        }),
        parseEvents: parseClaudeRawStream,
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

function buildClaudeLaunchPlan(
  params: AgentRunParams<'local-agent', 'claude'>,
  options: VibeClaudeProviderOptions,
): LaunchPlan {
  // If this server was launched from within a Claude Code session, the
  // CLAUDECODE marker leaks into our env and would be inherited by the spawned
  // `claude`, making it abort as a "nested session". Strip it before spawning.
  scrubNestedClaudeSessionEnv();

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
  const env = mergeClaudeRunEnv(readClaudeSettingsEnv(options.claudeSettingsPath), params.env);
  return {
    args,
    command: resolveClaudeCommand(),
    cwd: params.cwd,
    ...(Object.keys(env).length > 0 ? { env } : {}),
    prompt: composePrompt(params),
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

async function detectClaude(): Promise<AgentDetection> {
  const configDir = join(homedir(), '.claude');
  const command = resolveClaudeCommand();
  try {
    const { stdout } = await execFileAsync(command, ['--version']);
    const authState = await detectClaudeAuthState(command);
    return {
      authState,
      configDir,
      executablePath: command,
      skillsDir: join(configDir, 'skills'),
      supported: true,
      version: stdout.trim() || 'unknown',
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

async function detectClaudeAuthState(command: string): Promise<AgentDetection['authState']> {
  try {
    const { stdout } = await execFileAsync(command, ['auth', 'status'], {
      maxBuffer: 128 * 1024,
      timeout: 5_000,
    });
    return parseClaudeAuthStatus(stdout);
  } catch {
    return 'unknown';
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

function composePrompt(params: AgentRunParams<'local-agent', 'claude'>): string {
  const history = (params.history ?? [])
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');

  return [
    params.systemPrompt?.trim(),
    history,
    'Current request:',
    params.prompt,
  ].filter(Boolean).join('\n\n');
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
