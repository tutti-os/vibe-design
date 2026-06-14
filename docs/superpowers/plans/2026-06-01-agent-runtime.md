# Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Track 2 server runtime foundation for Claude stream-json parsing, role-marker protection, Codex MCP install helpers, runtime descriptors, registry lookup, and launcher JSONL helpers.

**Architecture:** Implement independently testable server modules under `server/src` because Track 1 run storage and Track 3 prompt/skill modules are not present yet. Keep Vibe Design protocol behavior while using Vibe Design scoped types and smaller runtime descriptors.

**Tech Stack:** TypeScript ESM, Node.js `child_process`, Vitest, existing pnpm workspace scripts.

---

## File Structure

- Create: `server/src/role-marker-guard.ts`
  - Owns fabricated Markdown role-marker detection and bounded cross-chunk state.
- Create: `server/src/claude-stream.ts`
  - Parses Claude Code JSONL stdout into Track 2 event payloads.
- Create: `server/src/codex-cli.ts`
  - Wraps `codex mcp get/add/remove` through an injectable runner.
- Create: `server/src/agents.ts`
  - Defines `RuntimeAgentDef`, `AgentRegistry`, model helpers, and registry factory.
- Create: `server/src/runtimes/claude.ts`
  - Defines the Claude runtime descriptor and args builder.
- Create: `server/src/runtimes/codex.ts`
  - Defines the Codex runtime descriptor and args builder.
- Create: `server/src/runtimes/gemini.ts`
  - Defines the Gemini runtime descriptor and args builder.
- Create: `server/src/runtimes/index.ts`
  - Exports all runtime descriptors and the default registry.
- Create: `server/src/agent-launcher.ts`
  - Exposes JSONL helper functions and a Claude stream wiring helper that future Track 1 code can call.
- Create tests beside modules:
  - `server/src/role-marker-guard.test.ts`
  - `server/src/claude-stream.test.ts`
  - `server/src/codex-cli.test.ts`
  - `server/src/agents.test.ts`
  - `server/src/agent-launcher.test.ts`

## Task 1: Role Marker Guard

**Files:**
- Create: `server/src/role-marker-guard.ts`
- Create: `server/src/role-marker-guard.test.ts`

- [ ] **Step 1: Write failing regex and guard tests**

Add `server/src/role-marker-guard.test.ts` with tests for:

```ts
import { describe, expect, it } from 'vitest';
import { createRoleMarkerGuard, FABRICATED_ROLE_MARKER_RE } from './role-marker-guard.js';

describe('FABRICATED_ROLE_MARKER_RE', () => {
  it('matches lower-case markdown role markers', () => {
    expect(FABRICATED_ROLE_MARKER_RE.test('## user\nfabricated')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('text\n## assistant\nfabricated')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('text\n## system\nfabricated')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('text\n## assist\nfabricated')).toBe(true);
  });

  it('does not match legitimate headings or chat-style labels', () => {
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\n## User Guide\nbody')).toBe(false);
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\n## users guide\nbody')).toBe(false);
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\nUser: bob@example.com')).toBe(false);
  });
});

describe('createRoleMarkerGuard', () => {
  it('passes safe chunks and detects a marker split across chunks', () => {
    const guard = createRoleMarkerGuard('msg-1');
    expect(guard.feedText('Safe text\n')).toBe('Safe text\n');
    expect(guard.contaminated).toBe(false);
    expect(guard.feedText('## user\nfabricated')).toBe('');
    expect(guard.contaminated).toBe(true);
    expect(guard.warningEvent()).toEqual({
      type: 'fabricated_role_marker',
      marker: '## user',
      messageId: 'msg-1',
    });
  });

  it('withholds a complete marker suffix until the next character confirms it', () => {
    const guard = createRoleMarkerGuard('msg-2');
    expect(guard.feedText('OK\n## user')).toBe('OK');
    expect(guard.contaminated).toBe(false);
    expect(guard.feedText('land')).toBe('\n## userland');
    expect(guard.contaminated).toBe(false);
  });

  it('drops all future text after contamination', () => {
    const guard = createRoleMarkerGuard('msg-3');
    expect(guard.feedText('OK\n## assistant\nbad')).toBe('OK');
    expect(guard.feedText(' later')).toBe('');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @vibe-design/server test -- role-marker-guard.test.ts
```

Expected: FAIL because `server/src/role-marker-guard.ts` does not exist.

- [ ] **Step 3: Implement the guard**

Create `server/src/role-marker-guard.ts` with:

```ts
export const FABRICATED_ROLE_MARKER_RE =
  /(?:^|\n)[ \t]*##[ \t]+(?:user|assistant|assist|system)(?=[^a-z])/;

const NEWLINE_ANCHORED_ROLE_MARKER_RE =
  /\n[ \t]*##[ \t]+(?:user|assistant|assist|system)(?=[^a-z])/;

const FIRST_CHUNK_PENDING_MARKER_TAIL_RE =
  /(?:^|\n)[ \t]*##[ \t]+(?:user|assistant|assist|system)$/;

const NEWLINE_ANCHORED_PENDING_MARKER_TAIL_RE =
  /\n[ \t]*##[ \t]+(?:user|assistant|assist|system)$/;

const TAIL_BUFFER_SIZE = 64;

export interface RoleMarkerGuard {
  feedText(text: string): string;
  readonly contaminated: boolean;
  warningEvent(): { type: 'fabricated_role_marker'; marker: string; messageId: string } | null;
}

export function createRoleMarkerGuard(messageId: string): RoleMarkerGuard {
  let tail = '';
  let pending = '';
  let firstChunk = true;
  let contaminated = false;
  let markerText: string | null = null;

  return {
    get contaminated() {
      return contaminated;
    },

    feedText(text: string): string {
      if (contaminated || text.length === 0) return '';

      const buffer = tail + pending + text;
      const matchRe = firstChunk ? FABRICATED_ROLE_MARKER_RE : NEWLINE_ANCHORED_ROLE_MARKER_RE;
      const pendingRe = firstChunk
        ? FIRST_CHUNK_PENDING_MARKER_TAIL_RE
        : NEWLINE_ANCHORED_PENDING_MARKER_TAIL_RE;

      const match = matchRe.exec(buffer);
      if (match) {
        contaminated = true;
        markerText = match[0].trim();
        pending = '';
        const alreadyEmitted = tail.length;
        const markerStart = match.index;
        return markerStart <= alreadyEmitted ? '' : buffer.slice(alreadyEmitted, markerStart);
      }

      const pendingMatch = pendingRe.exec(buffer);
      const alreadyEmitted = tail.length;
      const pendingStart = pendingMatch ? Math.max(pendingMatch.index, alreadyEmitted) : buffer.length;
      const safeToEmit = buffer.slice(alreadyEmitted, pendingStart);
      pending = buffer.slice(pendingStart);

      const fullEmitted = tail + safeToEmit;
      const willSlice = fullEmitted.length > TAIL_BUFFER_SIZE;
      tail = willSlice ? fullEmitted.slice(fullEmitted.length - TAIL_BUFFER_SIZE) : fullEmitted;
      if (willSlice) firstChunk = false;

      return safeToEmit;
    },

    warningEvent() {
      if (!contaminated || !markerText) return null;
      return { type: 'fabricated_role_marker', marker: markerText, messageId };
    },
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @vibe-design/server test -- role-marker-guard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/src/role-marker-guard.ts server/src/role-marker-guard.test.ts
git commit -m "feat: add role marker guard"
```

## Task 2: Claude Stream Parser

**Files:**
- Create: `server/src/claude-stream.ts`
- Create: `server/src/claude-stream.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add `server/src/claude-stream.test.ts` covering:

```ts
import { describe, expect, it } from 'vitest';
import { createClaudeStreamHandler, type AgentEvent } from './claude-stream.js';

function collect() {
  const events: AgentEvent[] = [];
  return { events, handler: createClaudeStreamHandler((event) => events.push(event)) };
}

function jsonl(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

describe('createClaudeStreamHandler', () => {
  it('maps system, text, thinking, tool, user result, usage, and raw events', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'system', subtype: 'init', model: 'sonnet', session_id: 's1' }));
    handler.feed(jsonl({ type: 'system', subtype: 'status', status: 'thinking' }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' }, ttft_ms: 12 } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool-1', name: 'AskUserQuestion' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"question":"Ready?"}' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_stop', index: 2 } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-1', name: 'AskUserQuestion', input: {} }] } }));
    handler.feed(jsonl({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'Yes' }], is_error: false }] } }));
    handler.feed(jsonl({ type: 'result', usage: { input_tokens: 1 }, total_cost_usd: 0.01, duration_ms: 20, stop_reason: 'tool_use' }));
    handler.feed('not json\n');

    expect(events.map((event) => event.type)).toEqual([
      'status',
      'status',
      'status',
      'thinking_start',
      'thinking_delta',
      'text_delta',
      'tool_use',
      'turn_end',
      'tool_result',
      'usage',
      'raw',
    ]);
    expect(events.find((event) => event.type === 'tool_use')).toMatchObject({
      id: 'tool-1',
      name: 'AskUserQuestion',
      input: { question: 'Ready?' },
    });
  });

  it('emits assistant wrapper text when no stream delta arrived', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-old', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Final text' }] } }));
    expect(events).toEqual([
      { type: 'text_delta', delta: 'Final text' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('guards text deltas but not thinking deltas', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-guard' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Consider\\n## user\\ninside thinking' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'OK\\n## user\\nbad' } } }));
    expect(events.some((event) => event.type === 'fabricated_role_marker')).toBe(true);
    expect(events.filter((event) => event.type === 'thinking_delta').map((event) => event.delta).join('')).toContain('## user');
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.delta).join('')).toBe('OK');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @vibe-design/server test -- claude-stream.test.ts
```

Expected: FAIL because `server/src/claude-stream.ts` does not exist.

- [ ] **Step 3: Implement parser types and JSONL feed loop**

Create `server/src/claude-stream.ts` with exported `AgentEvent`, `createClaudeStreamHandler`, `feed`, and `flush`. Use local `isRecord`, `BlockState`, `stringifyToolResult`, `blocks`, `streamedToolUseIds`, `textStreamed`, `thinkingStreamed`, and `roleGuards`.

Implementation requirements:

```ts
export type AgentEvent =
  | { type: 'status'; label: string; model?: unknown; sessionId?: unknown; ttftMs?: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'tool_use'; id: unknown; name: unknown; input: unknown }
  | { type: 'tool_result'; toolUseId: unknown; content: string; isError: boolean }
  | { type: 'usage'; usage: unknown; costUsd: unknown; durationMs: unknown; stopReason: unknown }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'raw'; line: string }
  | { type: 'fabricated_role_marker'; marker: string; messageId: string };
```

Use `createRoleMarkerGuard` only in the `text_delta` path. For `thinking_delta`, emit directly.

- [ ] **Step 4: Implement stream event handling**

Handle these `stream_event.event.type` values:

```ts
message_start
content_block_start
content_block_delta
content_block_stop
```

Behavior:

- `message_start`: reset `currentMessageId`, streamed flags, and emit `status streaming` when `ttft_ms` is numeric.
- `content_block_start`: store tool-use block state and emit `thinking_start` for thinking blocks.
- `content_block_delta`: emit safe text, emit thinking, or accumulate `input_json_delta`.
- `content_block_stop`: parse accumulated tool-use input and emit one `tool_use`; add its id to `streamedToolUseIds`.

- [ ] **Step 5: Implement object handling**

Handle:

- `system/init` to `status initializing`
- `system/status` to `status`
- `assistant` content fallback and `turn_end` after content processing
- `user` tool-result replay
- `result` usage summary

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @vibe-design/server test -- claude-stream.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/src/claude-stream.ts server/src/claude-stream.test.ts
git commit -m "feat: add claude stream parser"
```

## Task 3: Codex MCP CLI Helper

**Files:**
- Create: `server/src/codex-cli.ts`
- Create: `server/src/codex-cli.test.ts`

- [ ] **Step 1: Write failing Codex CLI tests**

Add `server/src/codex-cli.test.ts` with tests for runner injection:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  installCodexMcp,
  probeCodexInstall,
  setCodexRunner,
  uninstallCodexMcp,
  type CodexRunner,
} from './codex-cli.js';

type RecordedCall = { args: string[]; env?: Record<string, string> };

function makeRunner(result: (call: RecordedCall) => Promise<{ exitCode: number; stdout: string; stderr: string }>): CodexRunner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(args, opts) {
      const call = opts?.env ? { args, env: opts.env } : { args };
      calls.push(call);
      return result(call);
    },
  };
}

afterEach(() => setCodexRunner(null));

describe('probeCodexInstall', () => {
  it('reports missing binary on ENOENT', async () => {
    const runner = makeRunner(async () => {
      const err = new Error('spawn codex ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    setCodexRunner(runner);
    await expect(probeCodexInstall('vibe-design')).resolves.toEqual({ available: false, installed: false });
    expect(runner.calls[0]?.args).toEqual(['mcp', 'get', 'vibe-design']);
  });

  it('reports installed from exit code zero', async () => {
    const runner = makeRunner(async () => ({ exitCode: 0, stdout: 'vibe-design', stderr: '' }));
    setCodexRunner(runner);
    await expect(probeCodexInstall('vibe-design')).resolves.toEqual({ available: true, installed: true });
  });
});

describe('installCodexMcp and uninstallCodexMcp', () => {
  it('builds codex mcp add argv with env before command separator', async () => {
    const runner = makeRunner(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    setCodexRunner(runner);
    await installCodexMcp({
      name: 'vibe-design',
      command: '/usr/bin/node',
      args: ['/app/cli.js', 'mcp'],
      env: { VIBE_DATA_DIR: '/tmp/vibe' },
    });
    expect(runner.calls[0]?.args).toEqual([
      'mcp',
      'add',
      'vibe-design',
      '--env',
      'VIBE_DATA_DIR=/tmp/vibe',
      '--',
      '/usr/bin/node',
      '/app/cli.js',
      'mcp',
    ]);
  });

  it('throws with stderr detail on install failure', async () => {
    const runner = makeRunner(async () => ({ exitCode: 1, stdout: '', stderr: 'already exists' }));
    setCodexRunner(runner);
    await expect(installCodexMcp({ name: 'vibe-design', command: 'node', args: ['cli.js'], env: {} })).rejects.toThrow('already exists');
  });

  it('builds codex mcp remove argv', async () => {
    const runner = makeRunner(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    setCodexRunner(runner);
    await uninstallCodexMcp('vibe-design');
    expect(runner.calls[0]?.args).toEqual(['mcp', 'remove', 'vibe-design']);
  });
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm --filter @vibe-design/server test -- codex-cli.test.ts
```

Expected: FAIL because `server/src/codex-cli.ts` does not exist.

- [ ] **Step 3: Implement `codex-cli.ts`**

Create the helper with:

```ts
import { spawn } from 'node:child_process';

export interface CodexRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CodexRunner {
  run(args: string[], opts?: { env?: Record<string, string> }): Promise<CodexRunnerResult>;
}

export interface CodexInstallStatus {
  available: boolean;
  installed: boolean;
}

export interface CodexInstallSpec {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}
```

Implement `defaultCodexRunner`, `setCodexRunner`, `probeCodexInstall`, `installCodexMcp`, `uninstallCodexMcp`, and `failureDetail` following the protocol in the spec.

- [ ] **Step 4: Run focused test and verify GREEN**

Run:

```bash
pnpm --filter @vibe-design/server test -- codex-cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add server/src/codex-cli.ts server/src/codex-cli.test.ts
git commit -m "feat: add codex mcp cli helper"
```

## Task 4: Runtime Descriptors And Registry

**Files:**
- Create: `server/src/agents.ts`
- Create: `server/src/runtimes/claude.ts`
- Create: `server/src/runtimes/codex.ts`
- Create: `server/src/runtimes/gemini.ts`
- Create: `server/src/runtimes/index.ts`
- Create: `server/src/agents.test.ts`

- [ ] **Step 1: Write failing registry and descriptor tests**

Add `server/src/agents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createAgentRegistry } from './agents.js';
import { claudeAgentDef } from './runtimes/claude.js';
import { codexAgentDef } from './runtimes/codex.js';
import { geminiAgentDef } from './runtimes/gemini.js';

describe('runtime descriptors', () => {
  it('builds Claude stream-json args with model and allowed dirs', () => {
    const args = claudeAgentDef.buildArgs?.({ model: 'sonnet', extraAllowedDirs: ['/tmp/skills'] });
    expect(args).toEqual([
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--include-partial-messages',
      '--model',
      'sonnet',
      '--add-dir',
      '/tmp/skills',
    ]);
    expect(claudeAgentDef.promptInputFormat).toBe('stream-json');
  });

  it('builds Codex text-mode args without embedding prompt text', () => {
    const args = codexAgentDef.buildArgs?.({ model: 'gpt-5-codex', cwd: '/tmp/project', extraAllowedDirs: ['/tmp/assets'] });
    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '-c',
      'default_permissions=":workspace"',
      '-C',
      '/tmp/project',
      '--add-dir',
      '/tmp/assets',
      '--model',
      'gpt-5-codex',
    ]);
    expect(codexAgentDef.promptInputFormat).toBe('text');
  });

  it('builds Gemini text-mode stream args and env', () => {
    expect(geminiAgentDef.buildArgs?.({ model: 'gemini-2.5-pro' })).toEqual([
      '--output-format',
      'stream-json',
      '--yolo',
      '--model',
      'gemini-2.5-pro',
    ]);
    expect(geminiAgentDef.env?.({})).toEqual({ GEMINI_CLI_TRUST_WORKSPACE: 'true' });
  });
});

describe('createAgentRegistry', () => {
  it('lists and looks up agent definitions', () => {
    const registry = createAgentRegistry([claudeAgentDef, codexAgentDef, geminiAgentDef]);
    expect(registry.listAgentDefs().map((agent) => agent.id)).toEqual(['claude', 'codex', 'gemini']);
    expect(registry.getAgentDef('codex')?.label).toBe('Codex CLI');
    expect(registry.getAgentDef('missing')).toBeNull();
  });

  it('sanitizes known, custom, and empty models', () => {
    const registry = createAgentRegistry([codexAgentDef]);
    expect(registry.isKnownModel('codex', 'gpt-5-codex')).toBe(true);
    expect(registry.sanitizeCustomModel('codex', '  gpt-5-codex  ')).toBe('gpt-5-codex');
    expect(registry.sanitizeCustomModel('codex', '')).toBe('default');
  });

  it('throws on duplicate ids', () => {
    expect(() => createAgentRegistry([claudeAgentDef, { ...claudeAgentDef }])).toThrow(/Duplicate agent definition id: claude/);
  });

  it('reports connection test results from executable probe injection', async () => {
    const registry = createAgentRegistry([claudeAgentDef], async (agent) => ({
      ok: agent.runtimeExecutable === 'claude',
      latencyMs: 2,
    }));
    await expect(registry.testAgentConnection('claude')).resolves.toEqual({ ok: true, latencyMs: 2 });
    await expect(registry.testAgentConnection('missing')).resolves.toMatchObject({ ok: false, error: 'Unknown agent: missing' });
  });
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm --filter @vibe-design/server test -- agents.test.ts
```

Expected: FAIL because registry and runtime descriptor files do not exist.

- [ ] **Step 3: Implement `agents.ts` interfaces and registry**

Create `server/src/agents.ts` with:

```ts
export interface ModelSummary {
  id: string;
  label: string;
}

export interface RuntimeBuildContext {
  model?: string | null;
  reasoning?: string | null;
  cwd?: string;
  extraAllowedDirs?: string[];
}

export interface EnvContext {
  env?: NodeJS.ProcessEnv;
}

export interface RuntimeAgentDef {
  id: string;
  label: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  promptInputFormat: 'text' | 'stream-json';
  capabilities: string[];
  models: ModelSummary[];
  buildArgs?: (ctx: RuntimeBuildContext) => string[];
  env?: (ctx: EnvContext) => Record<string, string>;
}
```

Implement `createAgentRegistry(defs, probe?)`, duplicate-id validation, `getAgentDef`, `listAgentDefs`, `isKnownModel`, `sanitizeCustomModel`, `listProviderModels`, and `testAgentConnection`.

- [ ] **Step 4: Implement runtime descriptors**

Create descriptors:

`server/src/runtimes/claude.ts`

```ts
export const claudeAgentDef = {
  id: 'claude',
  label: 'Claude Code',
  runtimeExecutable: 'claude',
  runtimeArgs: [],
  promptInputFormat: 'stream-json',
  capabilities: ['stream-json', 'tool-use', 'partial-messages'],
  models: [
    { id: 'default', label: 'Default' },
    { id: 'sonnet', label: 'Sonnet (alias)' },
    { id: 'opus', label: 'Opus (alias)' },
    { id: 'haiku', label: 'Haiku (alias)' },
  ],
  buildArgs(ctx) {
    const args = ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--include-partial-messages'];
    if (ctx.model && ctx.model !== 'default') args.push('--model', ctx.model);
    for (const dir of ctx.extraAllowedDirs ?? []) {
      if (dir) args.push('--add-dir', dir);
    }
    return args;
  },
} satisfies RuntimeAgentDef;
```

`server/src/runtimes/codex.ts` must build Codex `exec --json` args and support `cwd`, `extraAllowedDirs`, `model`, and `reasoning` config.

`server/src/runtimes/gemini.ts` must build `--output-format stream-json --yolo` args and return `GEMINI_CLI_TRUST_WORKSPACE`.

`server/src/runtimes/index.ts` must export descriptors and `AGENT_DEFS`.

- [ ] **Step 5: Run focused test and verify GREEN**

Run:

```bash
pnpm --filter @vibe-design/server test -- agents.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add server/src/agents.ts server/src/runtimes/claude.ts server/src/runtimes/codex.ts server/src/runtimes/gemini.ts server/src/runtimes/index.ts server/src/agents.test.ts
git commit -m "feat: add agent runtime registry"
```

## Task 5: Agent Launcher JSONL Helpers

**Files:**
- Create: `server/src/agent-launcher.ts`
- Create: `server/src/agent-launcher.test.ts`

- [ ] **Step 1: Write failing launcher helper tests**

Add `server/src/agent-launcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildClaudeToolResultMessage,
  buildInitialClaudeUserMessage,
  wireClaudeStream,
  type MinimalRun,
  type MinimalRunEmitter,
} from './agent-launcher.js';

describe('Claude JSONL helpers', () => {
  it('builds initial stream-json user message', () => {
    expect(JSON.parse(buildInitialClaudeUserMessage('Hello'))).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    });
  });

  it('builds tool_result stream-json user message', () => {
    expect(JSON.parse(buildClaudeToolResultMessage('tool-1', 'Yes'))).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Yes' }] },
    });
  });
});

describe('wireClaudeStream', () => {
  it('emits event.type as the SSE event name and tracks AskUserQuestion ids', () => {
    const emitted: Array<{ event: string; data: unknown }> = [];
    const run: MinimalRun = { pendingHostAnswers: new Set(), stdinOpen: true };
    const runs: MinimalRunEmitter = { emit: (_run, event, data) => emitted.push({ event, data }) };
    const handler = wireClaudeStream(run, runs);
    handler.feed(`${JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } })}\n`);
    handler.feed(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'AskUserQuestion' } } })}\n`);
    handler.feed(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"question":"Ready?"}' } } })}\n`);
    handler.feed(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })}\n`);

    expect(emitted[0]?.event).toBe('tool_use');
    expect(run.pendingHostAnswers.has('tool-1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm --filter @vibe-design/server test -- agent-launcher.test.ts
```

Expected: FAIL because `server/src/agent-launcher.ts` does not exist.

- [ ] **Step 3: Implement launcher helpers**

Create `server/src/agent-launcher.ts` with:

```ts
import { createClaudeStreamHandler, type AgentEvent } from './claude-stream.js';

export interface MinimalRun {
  pendingHostAnswers?: Set<string>;
  stdinOpen?: boolean;
  stdin?: { end(): void };
}

export interface MinimalRunEmitter {
  emit(run: MinimalRun, event: string, data: AgentEvent): void;
}

export function buildInitialClaudeUserMessage(prompt: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  });
}

export function buildClaudeToolResultMessage(toolUseId: string, content: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
  });
}
```

Implement `wireClaudeStream(run, runs)` so it creates `createClaudeStreamHandler`, emits each event with `runs.emit(run, event.type, event)`, and adds `AskUserQuestion` tool ids to `run.pendingHostAnswers`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run:

```bash
pnpm --filter @vibe-design/server test -- agent-launcher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add server/src/agent-launcher.ts server/src/agent-launcher.test.ts
git commit -m "feat: add agent launcher jsonl helpers"
```

## Task 6: Full Validation

**Files:**
- Modify only if validation exposes a real defect in files created by Tasks 1-5.

- [ ] **Step 1: Run all server tests**

Run:

```bash
pnpm --filter @vibe-design/server test
```

Expected: PASS for the existing SSR test and all new runtime tests.

- [ ] **Step 2: Run server type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: PASS.

- [ ] **Step 3: Run workspace status check**

Run:

```bash
git status --short
```

Expected: only unrelated pre-existing untracked files may remain. Runtime source and test files should be committed.

- [ ] **Step 4: Final handoff summary**

Report:

- Implemented Track 2 D3 Claude parser and role marker guard.
- Implemented Track 2 D4 Codex MCP helper and Agent registry.
- Kept Track 1 and Track 3 integration as dependency-injected launcher helpers because those modules are absent in the current target project.
- Validation command outputs.
- Remaining risks: real Claude/Codex/Gemini binaries are not exercised by unit tests; full `runs.emit` and SSE integration waits for Track 1.
