import { chmod, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startAgentRun as startAgentRunWithDependencies,
  type LocalAgentRuntime,
  type StartAgentRunInput,
} from './agent-launcher.js';
import { createAgentRegistry, type RuntimeAgentDef } from './agents.js';
import { createConversation, upsertConversationMessage } from './conversations.js';
import { createChatRunService } from './runs.js';
import { prepareProjectFilesFromDisk } from './project-file-preparation.js';
import {
  getProjectFilePreparationState,
  listProjectFilesFromStore,
  upsertProjectFileInStore,
  writeProjectToStore,
} from './sqlite-store.js';
import type { SseResponse } from './http/sse.js';

function createNoopSseResponse(): SseResponse {
  return {
    send: () => true,
    writeKeepAlive: () => true,
    cleanup: () => undefined,
    end: () => undefined,
  };
}

const claudeDef: RuntimeAgentDef = {
  id: 'claude',
  label: 'Claude Test',
  capabilities: ['agent-acp-kit'],
  models: [{ id: 'default', label: 'Default' }],
};

const codexDef: RuntimeAgentDef = {
  id: 'codex',
  label: 'Codex Test',
  capabilities: ['agent-acp-kit'],
  models: [{ id: 'default', label: 'Default' }],
};

type RuntimeInput = Parameters<LocalAgentRuntime['run']>[0];
const originalTuttiCli = process.env.TUTTI_CLI;
const originalTuttiAppId = process.env.TUTTI_APP_ID;
const originalTuttiWorkspaceRoot = process.env.TUTTI_WORKSPACE_ROOT;
const originalVibeWorkspaceRoot = process.env.VIBE_WORKSPACE_ROOT;

beforeEach(() => {
  delete process.env.TUTTI_CLI;
  delete process.env.TUTTI_APP_ID;
  delete process.env.TUTTI_WORKSPACE_ROOT;
  delete process.env.VIBE_WORKSPACE_ROOT;
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  restoreOptionalEnv('TUTTI_CLI', originalTuttiCli);
  restoreOptionalEnv('TUTTI_APP_ID', originalTuttiAppId);
  restoreOptionalEnv('TUTTI_WORKSPACE_ROOT', originalTuttiWorkspaceRoot);
  restoreOptionalEnv('VIBE_WORKSPACE_ROOT', originalVibeWorkspaceRoot);
});

function restoreOptionalEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function createRecordingRuntime(
  events: Array<{ type: string; [key: string]: unknown }> = [{ type: 'done', status: 'completed', exitCode: 0 }],
): LocalAgentRuntime & { inputs: RuntimeInput[]; canceledRunIds: string[] } {
  const inputs: RuntimeInput[] = [];
  const canceledRunIds: string[] = [];

  return {
    inputs,
    canceledRunIds,
    async cancel(runId) {
      canceledRunIds.push(runId);
    },
    async *run(input) {
      inputs.push(input);
      for (const event of events) {
        yield event as never;
      }
    },
  };
}

async function startAgentRun(input: StartAgentRunInput): Promise<void> {
  if (process.env.TUTTI_CLI?.trim()) {
    return startAgentRunWithDependencies(input);
  }
  const requestTargetId = typeof input.request.agentTargetId === 'string'
    ? input.request.agentTargetId.trim()
    : '';
  const agentTargetId = requestTargetId || input.run.agentTargetId || '';
  const requestProvider = typeof input.request.provider === 'string'
    ? input.request.provider.trim()
    : '';
  const providerId = requestProvider || input.run.provider || '';
  return startAgentRunWithDependencies({
    resolveAgentSkillBundle: async () => ({
      source: 'standalone',
      agentTargetId,
      providerId,
      skills: [],
      skillManifest: [],
    }),
    ...input,
  });
}

describe('startAgentRun', { timeout: 10_000 }, () => {
  it('reconciles project files before invoking an agent without a prior page load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-preparation-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const projectDir = join(projectsDir, 'project-1');
      const assetsDir = join(projectDir, 'assets');
      await Promise.all([
        mkdir(builtInSkillsRoot, { recursive: true }),
        mkdir(userSkillsRoot, { recursive: true }),
        mkdir(assetsDir, { recursive: true }),
      ]);
      writeProjectToStore(projectsDir, {
        id: 'project-1',
        designSystemId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tabsState: { tabs: [], activeTabKey: null },
        metadata: {},
      });
      const staleRoot = join(projectDir, 'index.html');
      const currentAsset = join(assetsDir, 'index.html');
      await writeFile(staleRoot, '<html>stale root</html>', 'utf8');
      await writeFile(currentAsset, '<html>current asset</html>', 'utf8');
      const now = Date.now() / 1000;
      await utimes(staleRoot, now - 60, now - 60);
      await utimes(currentAsset, now, now);

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: { projectId: 'project-1', prompt: 'Continue editing', agentId: 'codex' },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(runtime.inputs).toHaveLength(1);
      // assets/ is canonical. The legacy root copy remains untouched as a
      // compatibility/rollback fallback and is no longer synchronized back.
      await expect(readFile(staleRoot, 'utf8')).resolves.toBe('<html>stale root</html>');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs Codex through the ACP kit runtime and maps kit events into existing run events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime([
        { type: 'text_delta', text: '流程已打通。' },
        { type: 'tool_call', id: 'cmd-1', name: 'Bash', input: { command: 'ls -la' } },
        { type: 'tool_result', id: 'cmd-1', name: 'Bash', output: { output: 'total 8\n' }, status: 'completed' },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Reply and list files',
          agentId: 'codex',
          model: 'gpt-5-codex',
          reasoning: 'high',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('succeeded');
      expect(runtime.inputs).toHaveLength(1);
      expect(runtime.inputs[0]).toMatchObject({
        agentTargetId: 'local:codex',
        runId: run.id,
        provider: 'codex',
        cwd: join(projectsDir, 'project-1'),
        prompt: 'Reply and list files',
        model: 'gpt-5-codex',
        reasoning: 'high',
      });
      expect(typeof runtime.inputs[0]?.systemPrompt).toBe('string');
      expect(run.events.map((event) => event.event)).toEqual(['start', 'text_delta', 'tool_use', 'tool_result', 'end']);
      expect(run.events.find((event) => event.event === 'text_delta')?.data).toEqual({
        type: 'text_delta',
        delta: '流程已打通。',
      });
      expect(run.events.find((event) => event.event === 'tool_use')?.data).toEqual({
        type: 'tool_use',
        id: 'cmd-1',
        name: 'Bash',
        input: { command: 'ls -la' },
      });
      expect(run.events.find((event) => event.event === 'tool_result')?.data).toEqual({
        type: 'tool_result',
        toolUseId: 'cmd-1',
        content: 'total 8\n',
        isError: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses one standalone cwd and detect context for catalog, composer, skills, and runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-context-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const agentCwd = join(projectsDir, 'project-1');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({
        projectId: 'project-1',
        agentTargetId: 'team:writer',
        provider: 'codex',
      });
      const runtime = createRecordingRuntime();
      const skillInputs: unknown[] = [];

      await startAgentRunWithDependencies({
        run,
        runs,
        request: {
          projectId: 'project-1',
          agentTargetId: 'team:writer',
          provider: 'codex',
          prompt: 'Keep context aligned.',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
        resolveAgentSkillBundle: async (input) => {
          skillInputs.push(input);
          return {
            source: 'standalone',
            agentTargetId: 'team:writer',
            providerId: 'codex',
            skills: [],
            skillManifest: [],
          };
        },
      });

      expect(skillInputs).toEqual([expect.objectContaining({
        cwd: agentCwd,
        agentTargetId: 'team:writer',
        detectContext: { cwd: agentCwd },
      })]);
      expect(runtime.inputs[0]).toMatchObject({
        cwd: agentCwd,
        agentTargetId: 'team:writer',
        provider: 'codex',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps exact target B through skills, resume, and provider runtime when two targets share one provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const cliPath = join(root, 'tutti-cli.mjs');
      const workspaceCwd = join(root, 'workspace-context');
      const cliInvocationLog = join(root, 'tutti-cli-invocations.jsonl');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await mkdir(workspaceCwd, { recursive: true });
      await writeFile(cliPath, [
        '#!/usr/bin/env node',
        'import { appendFileSync } from "node:fs";',
        'const args = process.argv.slice(2);',
        `appendFileSync(${JSON.stringify(cliInvocationLog)}, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");`,
        'const config = { configurable: false, currentValue: "", defaultValue: "", options: [] };',
        'if (args.includes("list")) process.stdout.write(JSON.stringify({',
        '  schemaVersion: 1, defaultAgentTargetId: "team:a", agents: [',
        '    { id: "team:a", provider: "codex", name: "A", availability: { status: "available", reasonCode: "", detail: "" } },',
        '    { id: "team:b", provider: "codex", name: "B", availability: { status: "available", reasonCode: "", detail: "" } }',
        '  ]',
        '}));',
        'else if (args.includes("composer-options")) process.stdout.write(JSON.stringify({',
        '  schemaVersion: 2, agentTargetId: "team:b", providerId: "codex", effectiveSettings: {},',
        '  modelConfig: config, permissionConfig: { configurable: false, defaultValue: "", modes: [] },',
        '  reasoningConfig: config, speedConfig: config',
        '}));',
        'else process.stdout.write(JSON.stringify({',
        '  schemaVersion: 2, agentTargetId: "team:b", provider: "codex",',
        '  agentSessionId: args[args.indexOf("--agent-session-id") + 1],',
        '  recommendedSystemPrompt: { content: "Target B skill context." }, skills: []',
        '}));',
      ].join('\n'));
      await chmod(cliPath, 0o755);
      process.env.TUTTI_CLI = cliPath;
      process.env.TUTTI_WORKSPACE_ROOT = workspaceCwd;

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentTargetId: 'team:b', provider: 'codex' });
      run.providerSessionId = 'provider-session-b';
      run.resumeToken = 'resume-b';
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: { projectId: 'project-1', agentTargetId: 'team:b', provider: 'codex', prompt: 'Run B.' },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(runtime.inputs).toHaveLength(1);
      expect(runtime.inputs[0]).toMatchObject({
        agentTargetId: 'team:b',
        provider: 'codex',
        runtimeProvider: 'codex',
        resume: { mode: 'provider', providerSessionId: 'provider-session-b', resumeToken: 'resume-b' },
      });
      expect(runtime.inputs[0]?.systemPrompt).toContain('Target B skill context.');
      expect(run.events.find((event) => event.event === 'start')?.data).toMatchObject({
        agentTargetId: 'team:b',
        provider: 'codex',
      });
      const cliInvocations = (await readFile(cliInvocationLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { args: string[]; cwd: string });
      expect(cliInvocations.length).toBeGreaterThan(0);
      expect(cliInvocations.some((invocation) => invocation.args.includes('composer-options'))).toBe(false);
      const canonicalWorkspaceCwd = await realpath(workspaceCwd);
      expect(cliInvocations.map((invocation) => ({
        command: invocation.args.slice(1, 3).join(' '),
        cwd: invocation.cwd,
      }))).toEqual(cliInvocations.map((invocation) => ({
        command: invocation.args.slice(1, 3).join(' '),
        cwd: canonicalWorkspaceCwd,
      })));
      expect(runtime.inputs[0]?.cwd).toBe(join(projectsDir, 'project-1'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes a target-specific Tutti agent skill bundle into standalone ACP kit runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const cliPath = join(root, 'tutti-cli.mjs');
      const argsPath = join(root, 'tutti-cli-args.json');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await writeFile(cliPath, [
        '#!/usr/bin/env node',
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
        'if (process.argv.includes("list")) {',
        '  process.stdout.write(JSON.stringify({ schemaVersion: 1, defaultAgentTargetId: "local:codex", agents: [',
        '    { id: "local:codex", provider: "codex", name: "Codex", availability: { status: "available", reasonCode: "", detail: "" } }',
        '  ] }));',
        '  process.exit(0);',
        '}',
        'if (process.argv.includes("composer-options")) {',
        '  const config = { configurable: false, currentValue: "", defaultValue: "", options: [] };',
        '  process.stdout.write(JSON.stringify({ schemaVersion: 2, agentTargetId: "local:codex", providerId: "codex",',
        '    effectiveSettings: {}, modelConfig: config, permissionConfig: { configurable: false, defaultValue: "", modes: [] },',
        '    reasoningConfig: config, speedConfig: config }));',
        '  process.exit(0);',
        '}',
        'process.stdout.write(JSON.stringify({',
        '  schemaVersion: 2,',
        '  agentTargetId: "local:codex",',
        '  provider: "codex",',
        '  agentSessionId: process.argv[process.argv.indexOf("--agent-session-id") + 1],',
        '  recommendedSystemPrompt: { format: "text/markdown", content: "Use Tutti routing." },',
        '  skills: [{',
        '    skillId: "tutti/tutti-cli",',
        '    slug: "tutti-cli",',
        '    deliveryMode: "materialized-files",',
        '    content: "# Tutti CLI\\nUse the host CLI.",',
        '    materializedPath: "/tmp/should-be-ignored",',
        '    files: [{ path: "COMMANDS.md", content: "commands" }]',
        '  }]',
        '}));',
        '',
      ].join('\n'));
      await chmod(cliPath, 0o755);
      process.env.TUTTI_CLI = cliPath;

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Use Tutti context.',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(JSON.parse(await readFile(argsPath, 'utf8'))).toEqual([
        '--json',
        'agent',
        'tutti-cli-skill-bundle',
        '--agent-id',
        'local:codex',
        '--agent-session-id',
        run.id,
      ]);
      expect(runtime.inputs[0]?.systemPrompt).toContain('Use Tutti routing.');
      expect(runtime.inputs[0]?.systemPrompt?.trim().endsWith('Use Tutti routing.')).toBe(true);
      expect(runtime.inputs[0]?.env).toBeUndefined();
      expect(runtime.inputs[0]?.skillManifest).toEqual([
        {
          skillId: 'tutti/tutti-cli',
          slug: 'tutti-cli',
          deliveryMode: 'materialized-files',
          content: '# Tutti CLI\nUse the host CLI.',
          materializedPath: '/tmp/should-be-ignored',
          files: [{ path: 'COMMANDS.md', content: 'commands' }],
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes a dynamic Tutti agent skill bundle into non-managed ACP kit runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const cliPath = join(root, 'tutti-cli.mjs');
      const argsPath = join(root, 'tutti-cli-args.json');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await writeFile(cliPath, [
        '#!/usr/bin/env node',
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
        'if (process.argv.includes("list")) {',
        '  process.stdout.write(JSON.stringify({ schemaVersion: 1, defaultAgentTargetId: "local:codex", agents: [',
        '    { id: "local:codex", provider: "codex", name: "Codex", availability: { status: "available", reasonCode: "", detail: "" } }',
        '  ] }));',
        '  process.exit(0);',
        '}',
        'process.stdout.write(JSON.stringify({',
        '  schemaVersion: 2,',
        '  agentTargetId: "local:codex",',
        '  provider: "codex",',
        '  agentSessionId: process.argv[process.argv.indexOf("--agent-session-id") + 1],',
        '  recommendedSystemPrompt: { format: "text/markdown", content: "Use Tutti routing locally." },',
        '  skills: [{',
        '    skillId: "tutti/tutti-cli",',
        '    slug: "tutti-cli",',
        '    deliveryMode: "materialized-files",',
        '    content: "# Tutti CLI\\nUse the host CLI."',
        '  }]',
        '}));',
        '',
      ].join('\n'));
      await chmod(cliPath, 0o755);
      process.env.TUTTI_CLI = cliPath;

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Use local context.',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(JSON.parse(await readFile(argsPath, 'utf8'))).toEqual([
        '--json',
        'agent',
        'tutti-cli-skill-bundle',
        '--agent-id',
        'local:codex',
        '--agent-session-id',
        run.id,
      ]);
      expect(runtime.inputs[0]?.systemPrompt).toContain('Use Tutti routing locally.');
      expect(runtime.inputs[0]?.systemPrompt?.trim().endsWith('Use Tutti routing locally.')).toBe(true);
      expect(runtime.inputs[0]?.env).toBeUndefined();
      expect(runtime.inputs[0]?.skillManifest).toEqual([
        {
          skillId: 'tutti/tutti-cli',
          slug: 'tutti-cli',
          deliveryMode: 'materialized-files',
          content: '# Tutti CLI\nUse the host CLI.',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the configured Tutti CLI skill command fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const cliPath = join(root, 'tutti-cli.mjs');
      const callsPath = join(root, 'tutti-cli-calls.json');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await writeFile(cliPath, [
        '#!/usr/bin/env node',
        'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
        `const callsPath = ${JSON.stringify(callsPath)};`,
        'const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, "utf8")) : [];',
        'const args = process.argv.slice(2);',
        'calls.push(args);',
        'writeFileSync(callsPath, JSON.stringify(calls));',
        'if (args.includes("list")) {',
        '  process.stdout.write(JSON.stringify({ schemaVersion: 1, defaultAgentTargetId: "local:codex", agents: [',
        '    { id: "local:codex", provider: "codex", name: "Codex", availability: { status: "available", reasonCode: "", detail: "" } }',
        '  ] }));',
        '  process.exit(0);',
        '}',
        'process.stderr.write("unknown command: agent tutti-cli-skill-bundle\\n");',
        'process.exit(2);',
        '',
      ].join('\n'));
      await chmod(cliPath, 0o755);
      process.env.TUTTI_CLI = cliPath;

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await expect(startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Use @ group chat mention context.',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      })).rejects.toThrow('Tutti CLI request failed.');

      expect(JSON.parse(await readFile(callsPath, 'utf8'))).toEqual([
        ['--json', 'agent', 'list'],
        [
          '--json',
          'agent',
          'tutti-cli-skill-bundle',
          '--agent-id',
          'local:codex',
          '--agent-session-id',
          run.id,
        ],
      ]);
      expect(runtime.inputs).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs agents directly from the project workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    const previousDataDir = process.env.TUTTI_APP_DATA_DIR;
    try {
      const appDataDir = join(root, 'app-data');
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(appDataDir, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      process.env.TUTTI_APP_DATA_DIR = appDataDir;

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({
        projectId: 'project-1',
        agentId: 'codex',
      });
      const projectWorkspaceDir = join(projectsDir, 'project-1');
      const runtime = createRecordingRuntime([
        { type: 'status', message: `Working in ${projectWorkspaceDir}` },
        { type: 'text_delta', text: `Created ${projectWorkspaceDir}/assets/Hero.tsx` },
        {
          type: 'tool_call',
          id: 'write-1',
          name: 'write',
          input: { file_path: `${projectWorkspaceDir}/assets/Hero.tsx` },
        },
        {
          type: 'tool_result',
          id: 'write-1',
          output: { output: `Wrote ${projectWorkspaceDir}/assets/Hero.tsx` },
          status: 'completed',
        },
        { type: 'stderr', text: `debug cwd ${projectWorkspaceDir}` },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Build the project',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(runtime.inputs).toHaveLength(1);
      expect(runtime.inputs[0]).toMatchObject({
        cwd: projectWorkspaceDir,
      });
      expect(runtime.inputs[0]?.env).toBeUndefined();
      expect(JSON.stringify(run.events)).toContain(projectWorkspaceDir);
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.TUTTI_APP_DATA_DIR;
      } else {
        process.env.TUTTI_APP_DATA_DIR = previousDataDir;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes prior conversation messages as ACP history for follow-up runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      await createConversation(projectsDir, 'project-1', 'Main thread', 'conversation-1');
      await upsertConversationMessage(projectsDir, 'project-1', 'conversation-1', {
        id: 'user-1',
        role: 'user',
        content: '做一个科技品牌官网首页，强调安全可信。',
      });
      await upsertConversationMessage(projectsDir, 'project-1', 'conversation-1', {
        id: 'assistant-ask',
        role: 'assistant',
        content: '',
        runId: 'run-ask',
        runStatus: 'succeeded',
        events: [
          {
            type: 'tool_use',
            id: 'question-1',
            name: 'AskUserQuestion',
            input: {
              question: '选择视觉方向',
              options: [{ label: '稳重企业' }, { label: '未来科技' }],
            },
          },
        ],
      });
      await upsertConversationMessage(projectsDir, 'project-1', 'conversation-1', {
        id: 'user-current',
        role: 'user',
        content: '未来科技',
      });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        assistantMessageId: 'assistant-current',
        agentId: 'codex',
      });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          conversationId: 'conversation-1',
          prompt: '未来科技',
          agentId: 'codex',
          assistantMessageId: 'assistant-current',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(runtime.inputs[0]?.history).toEqual([
        { role: 'user', content: '做一个科技品牌官网首页，强调安全可信。' },
        {
          role: 'assistant',
          content: 'Asked the user: 选择视觉方向\nOptions: 稳重企业, 未来科技',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('materializes ACP file_write events into project design files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime: LocalAgentRuntime = {
        async cancel() {
          return undefined;
        },
        async *run(input) {
          await mkdir(input.cwd, { recursive: true });
          await writeFile(join(input.cwd, 'DESIGN.md'), '# Design Brief\n', 'utf8');
          yield { type: 'file_write', path: 'DESIGN.md' } as never;
          yield { type: 'done', status: 'completed', exitCode: 0 } as never;
        },
      };

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Generate DESIGN.md',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(listProjectFilesFromStore(projectsDir, 'project-1')).toMatchObject([
        {
          name: 'DESIGN.md',
          path: 'assets/DESIGN.md',
        },
      ]);
      await expect(readFile(join(projectsDir, 'project-1', 'assets', 'DESIGN.md'), 'utf8')).resolves.toBe(
        '# Design Brief\n',
      );
      expect(run.events.map((event) => event.event)).toEqual(['start', 'generated_file', 'end']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('materializes Claude Write tool calls that use the /workspace alias into project design files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'claude' });
      const runtime = createRecordingRuntime([
        {
          type: 'tool_call',
          id: 'write-design',
          name: 'Write',
          input: {
            file_path: '/workspace/DESIGN.md',
            content: '# Design Brief\n',
          },
        },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Generate DESIGN.md',
          agentId: 'claude',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef]),
        agentRuntime: runtime,
      });

      expect(listProjectFilesFromStore(projectsDir, 'project-1')).toMatchObject([
        {
          name: 'DESIGN.md',
          path: 'assets/DESIGN.md',
          mime: 'text/markdown',
        },
      ]);
      await expect(readFile(join(projectsDir, 'project-1', 'assets', 'DESIGN.md'), 'utf8')).resolves.toBe(
        '# Design Brief\n',
      );
      expect(run.events.map((event) => event.event)).toEqual(['start', 'generated_file', 'tool_use', 'end']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('materializes streamed vibe-file protocol blocks into project design files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'claude' });
      const runtime = createRecordingRuntime([
        { type: 'text_delta', text: 'Here is the design brief.\n<vibe-' },
        { type: 'text_delta', text: 'file path="DESIGN.md" mime="text/markdown"># Design Brief\nUse coral accents.' },
        { type: 'text_delta', text: '</vibe-file>\nReady.' },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Generate DESIGN.md',
          agentId: 'claude',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef]),
        agentRuntime: runtime,
      });

      expect(listProjectFilesFromStore(projectsDir, 'project-1')).toMatchObject([
        {
          name: 'DESIGN.md',
          path: 'assets/DESIGN.md',
          mime: 'text/markdown',
        },
      ]);
      await expect(readFile(join(projectsDir, 'project-1', 'assets', 'DESIGN.md'), 'utf8')).resolves.toBe(
        '# Design Brief\nUse coral accents.',
      );
      expect(run.events.map((event) => event.event)).toEqual([
        'start',
        'text_delta',
        'generated_file',
        'text_delta',
        'end',
      ]);
      expect(JSON.stringify(run.events)).not.toContain('<vibe-file');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('adds project workspace file-output guidance to the runtime system prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'claude' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Generate DESIGN.md',
          agentId: 'claude',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef]),
        agentRuntime: runtime,
      });

      const systemPrompt = runtime.inputs[0]?.systemPrompt ?? '';
      expect(systemPrompt).toContain('## CRITICAL: File delivery protocol');
      expect(systemPrompt).toContain(`Current project workspace: ${join(projectsDir, 'project-1')}`);
      expect(systemPrompt).toContain('<vibe-file path="DESIGN.md" mime="text/markdown">');
      expect(systemPrompt).toContain('Do NOT use subdirectories, `/workspace`, absolute paths, or `..`');
      expect(systemPrompt).toContain('emit a vibe-file block');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops provider streaming after an AskUserQuestion tool call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'claude' });
      const runtime = createRecordingRuntime([
        { type: 'text_delta', text: '先确认一个问题。' },
        {
          type: 'tool_call',
          id: 'question-1',
          name: 'AskUserQuestion',
          input: {
            question: '你想做哪种游戏？',
            options: [{ label: '2D' }, { label: '3D' }],
          },
        },
        { type: 'text_delta', text: '我先继续做。' },
        { type: 'tool_call', id: 'write-1', name: 'Write', input: { file_path: '/workspace/index.html' } },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: '制作一个游戏',
          agentId: 'claude',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('succeeded');
      expect(runtime.canceledRunIds).toEqual([run.id]);
      expect(run.events.map((event) => event.event)).toEqual(['start', 'text_delta', 'tool_use', 'end']);
      expect(run.events.find((event) => event.event === 'tool_use')?.data).toEqual({
        type: 'tool_use',
        id: 'question-1',
        name: 'AskUserQuestion',
        input: {
          question: '你想做哪种游戏？',
          options: [{ label: '2D' }, { label: '3D' }],
        },
      });
      expect(JSON.stringify(run.events)).not.toContain('我先继续做');
      expect(JSON.stringify(run.events)).not.toContain('write-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops provider streaming after a complete inline question form', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime([
        { type: 'text_delta', text: '先确认一个问题。\n\n<question-form id="q" title="确认">' },
        {
          type: 'text_delta',
          text: '<question type="select" id="kind" title="做哪种？" options="game:游戏|site:网站" /></question-form>',
        },
        { type: 'text_delta', text: '我继续写文件。' },
        { type: 'tool_call', id: 'write-1', name: 'Write', input: { file_path: '/workspace/index.html' } },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: '制作一个项目',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('succeeded');
      expect(runtime.canceledRunIds).toEqual([run.id]);
      expect(run.events.map((event) => event.event)).toEqual(['start', 'text_delta', 'text_delta', 'end']);
      expect(JSON.stringify(run.events)).toContain('</question-form>');
      expect(JSON.stringify(run.events)).not.toContain('我继续写文件');
      expect(JSON.stringify(run.events)).not.toContain('write-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves provider prose discovery asks without manufacturing a protocol error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime([
        { type: 'text_delta', text: '需要先确认几个会影响设计系统方向的决定：\n\n' },
        {
          type: 'text_delta',
          text:
            '1. 这个设计系统主要服务什么类型的产品？\n' +
            '- SaaS 工具：后台、协作工具、开发者产品\n' +
            '- 品牌官网：营销页、品牌展示、作品集\n\n' +
            '2. 视觉气质更接近哪种？\n' +
            '- 专业极简：清晰、克制、通用商业产品\n' +
            '- 大胆鲜明：强对比、有记忆点',
        },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: '制作一个设计系统',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('succeeded');
      expect(run.events.map((event) => event.event)).toEqual(['start', 'text_delta', 'text_delta', 'end']);
      expect(JSON.stringify(run.events)).toContain('需要先确认几个会影响设计系统方向的决定');
      expect(run.events.find((event) => event.event === 'error')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves provider host-support prose without manufacturing a protocol error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime([
        {
          type: 'text_delta',
          text: '我会按当前已注入的 `design-brief` 技能执行；现在缺少设计简报本身，需要先收集会影响输出的关键选择。',
        },
        { type: 'text_delta', text: '此运行需要支持 `AskUserQuestion` 的宿主界面来收集缺失选择。' },
        { type: 'done', status: 'completed', exitCode: 0 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Use the selected skill.',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('succeeded');
      expect(run.events.map((event) => event.event)).toEqual(['start', 'text_delta', 'text_delta', 'end']);
      expect(JSON.stringify(run.events)).toContain('AskUserQuestion');
      expect(run.events.find((event) => event.event === 'error')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when no exact agent target is attached to the run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: '你能看到图片内容吗',
          attachments: [
            {
              path: 'assets/reference.png',
              name: 'reference.png',
              kind: 'image',
              size: 128,
              mimeType: 'image/png',
            },
          ],
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef, codexDef]),
        agentRuntime: runtime,
      });

      expect(runtime.inputs).toEqual([]);
      expect(run.status).toBe('failed');
      expect(run.events.find((event) => event.event === 'error')?.data).toMatchObject({
        code: 'AGENT_UNAVAILABLE',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lets the runtime fail closed when the exact target becomes unavailable before launch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentTargetId: 'team:writer', provider: 'codex' });
      const runtime: LocalAgentRuntime = {
        async cancel() {},
        async *run(input) {
          expect(input.agentTargetId).toBe('team:writer');
          throw new Error('Writer went offline.');
        },
      };

      await startAgentRun({
        run,
        runs,
        request: { projectId: 'project-1', prompt: 'Write.', agentTargetId: 'team:writer', provider: 'codex' },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('failed');
      expect(run.events.find((event) => event.event === 'error')?.data).toMatchObject({
        code: 'AGENT_EXECUTION_FAILED',
        message: 'Writer went offline.',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not launch when cancellation wins while exact-target skill context is pending', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-cancel-preflight-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentTargetId: 'team:writer', provider: 'codex' });
      const runtime = createRecordingRuntime();
      const skillBundle = deferred<{
        source: 'standalone';
        agentTargetId: string;
        providerId: string;
        skills: [];
        skillManifest: [];
      }>();
      const skillLoadStarted = deferred<void>();
      const starting = startAgentRunWithDependencies({
        run,
        runs,
        request: { projectId: 'project-1', prompt: 'Write.', agentTargetId: 'team:writer', provider: 'codex' },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
        resolveAgentSkillBundle: () => {
          skillLoadStarted.resolve(undefined);
          return skillBundle.promise;
        },
      });

      await skillLoadStarted.promise;
      runs.cancel(run);
      skillBundle.resolve({
        source: 'standalone',
        agentTargetId: 'team:writer',
        providerId: 'codex',
        skills: [],
        skillManifest: [],
      });
      await starting;

      expect(run.status).toBe('canceled');
      expect(runtime.inputs).toEqual([]);
      expect(run.events.some((event) => event.event === 'start')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resumes a provider session without injecting prior conversation turns into the runtime prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      await upsertConversationMessage(projectsDir, 'project-1', 'conversation-1', {
        id: 'user-1',
        role: 'user',
        content: 'Build a clean landing page for developer teams.',
      });
      await upsertConversationMessage(projectsDir, 'project-1', 'conversation-1', {
        id: 'assistant-1',
        role: 'assistant',
        content: 'I will create a desktop web landing page with a clean professional tone.',
        runStatus: 'succeeded',
      });
      await upsertConversationMessage(projectsDir, 'project-1', 'conversation-1', {
        id: 'user-current',
        role: 'user',
        content: 'Go ahead and generate it.',
      });
      await upsertConversationMessage(projectsDir, 'project-1', 'conversation-1', {
        id: 'assistant-current',
        role: 'assistant',
        content: '',
        runStatus: 'queued',
      });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        assistantMessageId: 'assistant-current',
        agentId: 'codex',
      });
      run.providerSessionId = 'codex-session-1';
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          conversationId: 'conversation-1',
          prompt: 'Go ahead and generate it.',
          agentId: 'codex',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      const input = runtime.inputs[0];
      expect(input?.resume).toEqual({ mode: 'provider', providerSessionId: 'codex-session-1' });
      const prompt = input?.prompt ?? '';
      expect(prompt).not.toContain('# Prior conversation context');
      expect(prompt).not.toContain('Build a clean landing page for developer teams.');
      expect(prompt).not.toContain('I will create a desktop web landing page with a clean professional tone.');
      expect(prompt).not.toContain('# Current user request');
      expect(prompt).toContain('Go ahead and generate it.');
      expect(prompt.match(/Go ahead and generate it\./g)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists provider resume metadata from the terminal ACP event onto the run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', conversationId: 'conversation-1', agentId: 'claude' });
      const runtime = createRecordingRuntime([
        { type: 'done', status: 'completed', exitCode: 0, sessionId: 'claude-session-1', resumeToken: 'token-1' },
      ]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          conversationId: 'conversation-1',
          prompt: 'Continue',
          agentId: 'claude',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef]),
        agentRuntime: runtime,
      });

      expect(run.providerSessionId).toBe('claude-session-1');
      expect(run.resumeToken).toBe('token-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('injects the bound project design system into the runtime system prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const builtInDesignSystemsRoot = join(root, 'design-systems');
      const userDesignSystemsRoot = join(root, 'user-design-systems');
      const designSystemDir = join(builtInDesignSystemsRoot, 'atelier-zero');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await mkdir(designSystemDir, { recursive: true });
      await mkdir(userDesignSystemsRoot, { recursive: true });
      await writeFile(join(designSystemDir, 'DESIGN.md'), '# Atelier Zero\n\nUse warm paper, dark ink, and editorial spacing.', 'utf8');
      await writeFile(join(designSystemDir, 'USAGE.md'), 'Start from the Atelier Zero token contract before inventing new styles.', 'utf8');
      await writeFile(join(designSystemDir, 'tokens.css'), ':root { --vd-bg: #f7f0e8; --vd-ink: #111111; }', 'utf8');
      await writeFile(join(designSystemDir, 'components.html'), '<button class="az-button">Create</button>', 'utf8');
      await writeFile(
        join(designSystemDir, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 'vibe-design-system/v1',
          id: 'atelier-zero',
          name: 'Atelier Zero',
          category: 'Editorial',
          files: { design: 'DESIGN.md', tokens: 'tokens.css', components: 'components.html' },
          usage: 'USAGE.md',
          importMode: 'hybrid',
        }),
        'utf8',
      );

      writeProjectToStore(projectsDir, {
        id: 'project-1',
        designSystemId: 'atelier-zero',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tabsState: { tabs: [], activeTabKey: null },
        metadata: { prompt: 'Build a product page', projectKind: 'prototype' },
      });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: { projectId: 'project-1', prompt: 'Build a product page', agentId: 'codex' },
        paths: {
          projectsDir,
          userSkillsRoot,
          builtInSkillsRoot,
          builtInDesignSystemsRoot,
          userDesignSystemsRoot,
        },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      const systemPrompt = runtime.inputs[0]?.systemPrompt ?? '';
      expect(systemPrompt).toContain('## How to use this design system — Atelier Zero');
      expect(systemPrompt).toContain('Start from the Atelier Zero token contract');
      expect(systemPrompt).toContain('## Active design system — Atelier Zero');
      expect(systemPrompt).toContain('Use warm paper, dark ink, and editorial spacing.');
      expect(systemPrompt).toContain('## Active design system tokens — Atelier Zero');
      expect(systemPrompt).toContain('--vd-bg: #f7f0e8');
      expect(systemPrompt).toContain('## Reference component manifest — Atelier Zero');
      expect(systemPrompt).toContain('az-button');
      expect(systemPrompt).toContain('## Design system import mode — Atelier Zero');
      expect(systemPrompt).toContain('Start from normalized Prototype Design tokens');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('injects localized design system files into the runtime system prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const builtInDesignSystemsRoot = join(root, 'design-systems');
      const userDesignSystemsRoot = join(root, 'user-design-systems');
      const designSystemDir = join(builtInDesignSystemsRoot, 'atelier-zero');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await mkdir(designSystemDir, { recursive: true });
      await mkdir(userDesignSystemsRoot, { recursive: true });
      await writeFile(join(designSystemDir, 'DESIGN.md'), '# Atelier Zero\n\nUse warm paper and editorial spacing.', 'utf8');
      await writeFile(join(designSystemDir, 'USAGE.md'), 'Start from the Atelier Zero token contract.', 'utf8');
      await writeFile(join(designSystemDir, 'DESIGN.zh-CN.md'), '# 零号工作室\n\n使用温暖纸感和编辑式间距。', 'utf8');
      await writeFile(join(designSystemDir, 'USAGE.zh-CN.md'), '先遵循零号工作室的设计系统契约。', 'utf8');
      await writeFile(
        join(designSystemDir, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 'vibe-design-system/v1',
          id: 'atelier-zero',
          name: 'Atelier Zero',
          category: 'Editorial',
          files: { design: 'DESIGN.md' },
          usage: 'USAGE.md',
          i18n: {
            'zh-CN': {
              name: '零号工作室',
              category: '编辑设计',
              description: '温暖纸感、克制对比和编辑节奏。',
              files: { design: 'DESIGN.zh-CN.md' },
              usage: 'USAGE.zh-CN.md',
            },
          },
        }),
        'utf8',
      );

      writeProjectToStore(projectsDir, {
        id: 'project-1',
        designSystemId: 'atelier-zero',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tabsState: { tabs: [], activeTabKey: null },
        metadata: { prompt: 'Build a product page', projectKind: 'prototype' },
      });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: { projectId: 'project-1', prompt: '生成产品页', agentId: 'codex', locale: 'zh-CN' },
        paths: {
          projectsDir,
          userSkillsRoot,
          builtInSkillsRoot,
          builtInDesignSystemsRoot,
          userDesignSystemsRoot,
        },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      const systemPrompt = runtime.inputs[0]?.systemPrompt ?? '';
      expect(systemPrompt).toContain('## How to use this design system — 零号工作室');
      expect(systemPrompt).toContain('先遵循零号工作室的设计系统契约。');
      expect(systemPrompt).toContain('## Active design system — 零号工作室');
      expect(systemPrompt).toContain('使用温暖纸感和编辑式间距。');
      expect(systemPrompt).not.toContain('Use warm paper and editorial spacing.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes valid preview comments in the runtime prompt and omits inline screenshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Apply the attached comments',
          agentId: 'codex',
          commentAttachments: [
            {
              id: 'comment-1',
              order: 1,
              source: 'board-batch',
              selectionKind: 'element',
              filePath: 'index.html',
              targetId: 'hero-title',
              selector: '[data-vd-id="hero-title"]',
              label: 'Hero title',
              comment: 'Shorten this heading\nand keep the tone.',
              currentText: 'A very long hero heading',
              pagePosition: { x: 10.4, y: 20.5, width: 300.2, height: 88.8 },
              htmlHint: '<h1 data-vd-id="hero-title">A very long hero heading</h1>',
              style: { color: 'rgb(1, 2, 3)', fontSize: '48px' },
            },
            {
              id: 'visual-comment-1',
              order: 2,
              source: 'visual-mark',
              selectionKind: 'visual',
              filePath: 'index.html',
              targetId: 'visual-1',
              selector: 'visual-mark',
              label: 'Marked region',
              comment: 'Move this region.',
              currentText: '',
              pagePosition: { x: 12, y: 24, width: 160, height: 96 },
              htmlHint: '',
              screenshotPath: 'data:image/png;base64,abcdefghijklmnopqrstuvwxyz',
              markKind: 'click',
              intent: 'Move this region.',
            },
            { order: 3, filePath: 'index.html' },
          ],
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      const prompt = runtime.inputs[0]?.prompt ?? '';
      expect(prompt).toContain('# Attached preview comments');
      expect(prompt).toContain('targetKind=board-batch | selectionKind=element');
      expect(prompt).toContain('selector=[data-vd-id="hero-title"]');
      expect(prompt).toContain('position=x=10,y=21,width=300,height=89');
      expect(prompt).toContain('computedStyle=color: rgb(1, 2, 3); fontSize: 48px');
      expect(prompt).toContain('comment=Shorten this heading and keep the tone.');
      expect(prompt).toContain('targetKind=visual-mark | selectionKind=visual');
      expect(prompt).toContain('screenshot=(inline screenshot omitted)');
      expect(prompt).not.toContain('1. targetKind=');
      expect(prompt).not.toContain('2. targetKind=');
      expect(prompt).not.toContain('data:image');
      expect(prompt).not.toContain('abcdefghijklmnopqrstuvwxyz');
      expect(prompt).not.toContain('3. targetKind');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('composes the selected skill and locale into the Claude runtime system prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(join(builtInSkillsRoot, 'landing'), { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await writeFile(
        join(builtInSkillsRoot, 'landing', 'SKILL.md'),
        [
          '---',
          'name: landing',
          'description: Landing page skill',
          'triggers:',
          '  - landing',
          'od:',
          '  mode: prototype',
          '---',
          '# Skill workflow',
          'Use the selected landing workflow.',
        ].join('\n'),
        'utf8',
      );

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'claude' });
      const runtime = createRecordingRuntime([{ type: 'text_delta', text: 'Done.' }, { type: 'done', status: 'completed', exitCode: 0 }]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Build a polished landing page',
          agentId: 'claude',
          skillId: 'landing',
          locale: 'zh-CN',
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef]),
        agentRuntime: runtime,
      });

      expect(runtime.inputs[0]).toMatchObject({
        provider: 'claude',
        prompt: 'Build a polished landing page',
      });
      expect(runtime.inputs[0]?.systemPrompt).toContain('Use the selected landing workflow.');
      expect(runtime.inputs[0]?.systemPrompt).toContain('zh-CN');
      expect(run.status).toBe('succeeded');
      expect(run.events.map((event) => event.event)).toEqual(['start', 'text_delta', 'end']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not pass catalog install instructions from selected skills into the runtime system prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(join(builtInSkillsRoot, 'catalog-skill'), { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await writeFile(
        join(builtInSkillsRoot, 'catalog-skill', 'SKILL.md'),
        [
          '---',
          'name: catalog-skill',
          'description: Catalog skill',
          'triggers:',
          '  - catalog',
          'od:',
          '  mode: prototype',
          '---',
          '# Catalog Skill',
          '',
          'This catalogue entry advertises the skill in the workspace so the agent discovers it during planning.',
          'To run the full upstream workflow with its original assets, install the upstream bundle into your active agent skills directory.',
          '',
          '```bash',
          'open https://example.test/upstream-skill',
          '```',
          '',
          'Then ask the agent to invoke this skill by name (`catalog-skill`).',
        ].join('\n'),
        'utf8',
      );

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'claude' });
      const runtime = createRecordingRuntime([{ type: 'text_delta', text: 'Done.' }, { type: 'done', status: 'completed', exitCode: 0 }]);

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Use the selected skill.',
          agentId: 'claude',
          context: { skillIds: ['catalog-skill'] },
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([claudeDef]),
        agentRuntime: runtime,
      });

      const systemPrompt = runtime.inputs[0]?.systemPrompt ?? '';
      expect(systemPrompt).toContain('The active skill has already been injected into this system prompt.');
      expect(systemPrompt).not.toContain('install the upstream bundle');
      expect(systemPrompt).not.toContain('active agent skills directory');
      expect(systemPrompt).not.toContain('open https://example.test/upstream-skill');
      expect(systemPrompt).not.toContain('invoke this skill by name');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses selected run context skills and design files when no top-level skillId is provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(join(builtInSkillsRoot, 'dashboard'), { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });
      await writeFile(
        join(builtInSkillsRoot, 'dashboard', 'SKILL.md'),
        [
          '---',
          'name: dashboard',
          'description: Dashboard skill',
          'od:',
          '  mode: prototype',
          '---',
          '# Dashboard workflow',
          'Use the selected dashboard workflow.',
        ].join('\n'),
        'utf8',
      );
      upsertProjectFileInStore(projectsDir, 'project-1', {
        name: 'Hero.tsx',
        path: 'assets/Hero.tsx',
        size: 128,
        mime: 'text/tsx',
        kind: 'code',
      });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime();

      await startAgentRun({
        run,
        runs,
        request: {
          projectId: 'project-1',
          prompt: 'Improve the selected file using the selected skill.',
          agentId: 'codex',
          context: {
            skillIds: ['dashboard'],
            designFilePaths: ['assets/Hero.tsx'],
          },
        },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(runtime.inputs[0]?.systemPrompt).toContain('Use the selected dashboard workflow.');
      const prompt = runtime.inputs[0]?.prompt ?? '';
      expect(prompt).toContain('# Selected design files');
      expect(prompt).toContain('Hero.tsx');
      expect(prompt).toContain('assets/Hero.tsx');
      expect(prompt).toContain(join(projectsDir, 'project-1', 'assets/Hero.tsx'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails the run when the ACP kit runtime reports an error event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime([{ type: 'error', code: 'provider_missing', message: 'Codex is not available' }]);

      await startAgentRun({
        run,
        runs,
        request: { projectId: 'project-1', prompt: 'Build a page', agentId: 'codex' },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('failed');
      expect(run.errorCode).toBe('provider_missing');
      expect(run.error).toBe('Codex is not available');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces stderr as the agent error reason when the ACP kit runtime only reports failed completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-launcher-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      await mkdir(builtInSkillsRoot, { recursive: true });
      await mkdir(userSkillsRoot, { recursive: true });

      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId: 'project-1', agentId: 'codex' });
      const runtime = createRecordingRuntime([
        { type: 'stderr', text: 'Codex auth failed: missing OPENAI_API_KEY\n' },
        { type: 'done', status: 'failed', reason: 'error', exitCode: 1 },
      ]);

      await startAgentRun({
        run,
        runs,
        request: { projectId: 'project-1', prompt: 'Build a page', agentId: 'codex' },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('failed');
      expect(run.exitCode).toBe(1);
      expect(run.errorCode).toBe('AGENT_EXECUTION_FAILED');
      expect(run.error).toBe('Codex auth failed: missing OPENAI_API_KEY');
      expect(run.events.map((event) => event.event)).toEqual(['start', 'stderr', 'error', 'end']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a successful provider result when the terminal scan fails and recovers from the dirty marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-agent-scan-recovery-'));
    try {
      const builtInSkillsRoot = join(root, 'skills');
      const userSkillsRoot = join(root, 'user-skills');
      const projectsDir = join(root, 'projects');
      const projectId = 'project-1';
      const assetsPath = join(projectsDir, projectId, 'assets');
      await Promise.all([mkdir(builtInSkillsRoot, { recursive: true }), mkdir(userSkillsRoot, { recursive: true })]);
      writeProjectToStore(projectsDir, {
        id: projectId,
        designSystemId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tabsState: { tabs: [], activeTabKey: null },
        metadata: {},
      });
      const runs = createChatRunService({
        createSseResponse: createNoopSseResponse,
        createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
        runsLogDir: null,
      });
      const run = runs.create({ projectId, agentId: 'codex' });
      const runtime: LocalAgentRuntime = {
        async cancel() {},
        async *run() {
          await rm(assetsPath, { recursive: true, force: true });
          await writeFile(assetsPath, 'blocks directory creation', 'utf8');
          yield { type: 'done', status: 'completed', exitCode: 0 } as never;
        },
      };

      await startAgentRun({
        run,
        runs,
        request: { projectId, prompt: 'Finish successfully', agentId: 'codex' },
        paths: { projectsDir, userSkillsRoot, builtInSkillsRoot },
        registry: createAgentRegistry([codexDef]),
        agentRuntime: runtime,
      });

      expect(run.status).toBe('succeeded');
      expect(getProjectFilePreparationState(projectsDir, projectId)?.scanDirty).toBe(true);
      await rm(assetsPath, { force: true });
      await prepareProjectFilesFromDisk(projectsDir, projectId);
      expect(getProjectFilePreparationState(projectsDir, projectId)?.scanDirty).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
