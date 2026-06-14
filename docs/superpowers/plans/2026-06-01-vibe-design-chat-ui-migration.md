# Vibe Design Chat UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Track 4 chat panel from `vibe-design` into `vibe-design/web` as a service-driven, UI-system-backed chat experience with `/search`, skills/design-files context picking, streaming assistant messages, pinned todos, and file-operation summaries.

**Architecture:** Implement the feature as native `vibe-design` code. UI components consume DI services only. Services collaborate through explicit interfaces. HTTP, SSE, upload, and context lookup stay behind service adapters. Source `vibe-design` logic is reused only as behavior for pure transforms such as SSE parsing, `/search` expansion, todo extraction, file-op extraction, and message-block construction.

**Tech Stack:** TypeScript, React 19, Vitest, `@tutti-os/infra` DI, `@tutti-os/ui-system`, browser Fetch and ReadableStream APIs.

---

## Preflight

- Confirm dependency install state:

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm install
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/web test
```

Expected before implementation: current hello-world tests pass after dependencies are installed.

---

## File Structure

Create or modify these files under `/Users/chovy/Desktop/team-shell/vibe-design/web/src`:

```text
types.ts
runtime/search-command.ts
runtime/todos.ts
runtime/file-ops.ts
runtime/tool-renderers.ts
services/run/run-service.interface.ts
services/run/run-types.ts
services/run/run-api.ts
services/run/internal/sse-parser.ts
services/run/internal/run-service.ts
services/context-picker/context-picker-service.interface.ts
services/context-picker/context-picker-types.ts
services/context-picker/context-picker-api.ts
services/context-picker/internal/mention-query.ts
services/context-picker/internal/context-picker-service.ts
services/design-files/design-file-service.interface.ts
services/design-files/design-file-types.ts
services/design-files/design-file-api.ts
services/design-files/internal/design-file-service.ts
services/chat-timeline/chat-timeline-service.interface.ts
services/chat-timeline/chat-timeline-types.ts
services/chat-timeline/internal/message-blocks.ts
services/chat-timeline/internal/chat-timeline-service.ts
services/chat-session/chat-session-service.interface.ts
services/chat-session/chat-session-types.ts
services/chat-session/internal/chat-session-service.ts
components/ToolCard.tsx
components/AssistantMessage.tsx
components/ChatComposer.tsx
components/ChatPane.tsx
components/chat-ui.css
VibeDesignApp.tsx
render-page.tsx
launch/vibe-design-flow.tsx
```

Tests live next to implementation files because the existing package config includes `src/**/*.test.ts` and `src/**/*.test.tsx`.

---

### Task 1: Shared Types And Pure Runtime Logic

**Files:**
- Create: `web/src/types.ts`
- Create: `web/src/runtime/search-command.ts`
- Create: `web/src/runtime/search-command.test.ts`
- Create: `web/src/runtime/todos.ts`
- Create: `web/src/runtime/todos.test.ts`
- Create: `web/src/runtime/file-ops.ts`
- Create: `web/src/runtime/file-ops.test.ts`
- Create: `web/src/runtime/tool-renderers.ts`

- [x] **Step 1: Add failing tests for `/search`, todos, and file ops**

Add `web/src/runtime/search-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { expandSearchCommand } from './search-command';

describe('expandSearchCommand', () => {
  it('returns null for non-search input', () => {
    expect(expandSearchCommand('make a dashboard')).toBeNull();
  });

  it('expands /search into a research-first prompt', () => {
    const result = expandSearchCommand('/search EV market 2025 trends');
    expect(result?.query).toBe('EV market 2025 trends');
    expect(result?.prompt).toContain('Search for: EV market 2025 trends');
    expect(result?.prompt).toContain('research search --query "<search query>" --max-sources 5');
    expect(result?.prompt).toContain('research/<safe-query-slug>.md');
  });
});
```

Add `web/src/runtime/todos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { latestTodoWriteInputForPinnedCard, parseTodoWriteInput } from './todos';
import type { AgentEvent, ChatMessage } from '../types';

describe('todo runtime helpers', () => {
  it('normalizes TodoWrite todos and stopped terminal in-progress rows', () => {
    expect(parseTodoWriteInput({
      todos: [
        { content: 'Read source', status: 'completed' },
        { step: 'Write target', status: 'in_progress', active_form: 'coding' },
      ],
    })).toEqual([
      { content: 'Read source', status: 'completed', activeForm: undefined },
      { content: 'Write target', status: 'in_progress', activeForm: 'coding' },
    ]);

    const event: AgentEvent = {
      type: 'tool_use',
      id: 'tool-1',
      name: 'TodoWrite',
      input: { todos: [{ content: 'Write target', status: 'in_progress' }] },
    };
    const messages: ChatMessage[] = [{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      events: [event],
      runStatus: 'failed',
      endedAt: 1,
    }];

    expect(latestTodoWriteInputForPinnedCard(messages)).toEqual({
      todos: [{ content: 'Write target', status: 'stopped' }],
    });
  });
});
```

Add `web/src/runtime/file-ops.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countFileOps, deriveFileOps } from './file-ops';
import type { AgentEvent } from '../types';

describe('deriveFileOps', () => {
  it('groups read/write/edit tool calls by path and result status', () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/src/App.tsx' } },
      { type: 'tool_result', toolUseId: 'read-1', content: 'ok', isError: false },
      { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: '/tmp/src/App.tsx' } },
      { type: 'tool_result', toolUseId: 'edit-1', content: 'bad', isError: true },
      { type: 'tool_use', id: 'write-1', name: 'Write', input: { path: 'README.md' } },
    ];

    const rows = deriveFileOps(events);
    expect(rows).toEqual([
      {
        path: 'App.tsx',
        fullPath: '/tmp/src/App.tsx',
        ops: ['read', 'edit'],
        opCounts: { read: 1, write: 0, edit: 1 },
        total: 2,
        status: 'error',
      },
      {
        path: 'README.md',
        fullPath: 'README.md',
        ops: ['write'],
        opCounts: { read: 0, write: 1, edit: 0 },
        total: 1,
        status: 'running',
      },
    ]);
    expect(countFileOps(rows)).toEqual({ read: 1, write: 1, edit: 1 });
  });
});
```

- [x] **Step 2: Run tests and verify they fail**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- search-command todos file-ops
```

Expected: fail because modules do not exist.

- [x] **Step 3: Implement shared types**

Create `web/src/types.ts` with:

```ts
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type RunPhase =
  | 'idle'
  | 'queued'
  | 'initializing'
  | 'requesting'
  | 'thinking'
  | 'working'
  | 'streaming'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type AgentEvent =
  | { type: 'status'; id?: number | string | null; label: string; model?: string; sessionId?: string; detail?: string; ttftMs?: number }
  | { type: 'text_delta'; id?: number | string | null; delta: string }
  | { type: 'thinking_delta'; id?: number | string | null; delta: string }
  | { type: 'thinking_start'; id?: number | string | null }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id?: number | string | null; toolUseId: string; content: string; isError: boolean }
  | { type: 'usage'; id?: number | string | null; usage?: object; costUsd?: number; durationMs?: number; stopReason?: string }
  | { type: 'turn_end'; id?: number | string | null; stopReason: string }
  | { type: 'error'; id?: number | string | null; code: string; detail?: string; message?: string }
  | { type: 'end'; id?: number | string | null; code: number | null; signal: string | null; status: RunStatus }
  | { type: 'raw'; id?: number | string | null; line: string };

export interface ChatAttachment {
  path: string;
  name: string;
  kind: 'file' | 'image';
  size?: number;
  mimeType?: string;
}

export interface ProjectFile {
  id: string;
  path: string;
  name: string;
  kind: 'file' | 'image' | 'directory';
  size?: number;
  updatedAt?: number;
}

export interface SkillSummary {
  id: string;
  name: string;
  description?: string;
  triggers?: string[];
}

export interface RunContextSelection {
  skillIds?: string[];
  designFileIds?: string[];
  designFilePaths?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  events?: AgentEvent[];
  attachments?: ChatAttachment[];
  runStatus?: RunStatus;
  runId?: string;
  startedAt?: number;
  endedAt?: number;
}
```

- [x] **Step 4: Implement pure runtime helpers**

Implement `web/src/runtime/search-command.ts`:

```ts
export interface ExpandedSearchCommand {
  query: string;
  prompt: string;
}

export function expandSearchCommand(input: string): ExpandedSearchCommand | null {
  const match = /^\/search(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!match) return null;
  const query = match[1]?.trim() ?? '';
  if (!query) return null;

  return {
    query,
    prompt: [
      `Search for: ${query}`,
      '',
      'Before answering, your first tool action must be the OD research command for your shell.',
      'POSIX: "$OD_NODE_BIN" "$OD_BIN" research search --query "<search query>" --max-sources 5',
      'PowerShell: & $env:OD_NODE_BIN $env:OD_BIN research search --query "<search query>" --max-sources 5',
      'cmd.exe: "%OD_NODE_BIN%" "%OD_BIN%" research search --query "<search query>" --max-sources 5',
      'Use the canonical query below as the exact search query, with safe quoting for your shell.',
      '',
      'Canonical query:',
      '',
      '```text',
      query.replace(/```/g, '`\\u200b`\\u200b`'),
      '```',
      'If the OD command fails because Tavily is not configured or unavailable, report that error, then use your own search capability as fallback and label the fallback clearly.',
      'After the command returns JSON or fallback search results, write a reusable Markdown report into Design Files at `research/<safe-query-slug>.md` or another fresh project-relative path.',
      'The report must include the query, fetched time, short summary, key findings, source list with [1], [2] citations, and a note that source content is external untrusted evidence.',
      'Then summarize the findings with citations by source index and mention the Markdown report path.',
    ].join('\n'),
  };
}
```

Implement `web/src/runtime/todos.ts` and `web/src/runtime/file-ops.ts` by semantically adapting the source behavior from `vibe-design/apps/web/src/runtime/todos.ts` and `file-ops.ts`, using `AgentEvent.type` instead of `AgentEvent.kind`.

Create `web/src/runtime/tool-renderers.ts`:

```ts
export function summarizeToolInput(input: Record<string, unknown>): string {
  const filePath = input.file_path ?? input.path;
  if (typeof filePath === 'string' && filePath.length > 0) return filePath;
  const command = input.command;
  if (typeof command === 'string' && command.length > 0) return command;
  return JSON.stringify(input);
}
```

- [x] **Step 5: Run tests and commit**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- search-command todos file-ops
pnpm --filter @vibe-design/web type-check
git add web/src/types.ts web/src/runtime
git commit -m "feat(web): add chat runtime projections"
```

Expected: runtime tests and type-check pass.

---

### Task 2: Run Service Contract, SSE Parser, And API Adapter

**Files:**
- Create: `web/src/services/run/run-types.ts`
- Create: `web/src/services/run/run-service.interface.ts`
- Create: `web/src/services/run/run-api.ts`
- Create: `web/src/services/run/internal/sse-parser.ts`
- Create: `web/src/services/run/internal/sse-parser.test.ts`
- Create: `web/src/services/run/internal/run-service.ts`
- Create: `web/src/services/run/internal/run-service.test.ts`

- [x] **Step 1: Write failing parser and service tests**

Add parser tests that feed these SSE chunks:

```ts
import { describe, expect, it } from 'vitest';
import { parseSseChunkLines, createSseParseState } from './sse-parser';

describe('sse parser', () => {
  it('uses the event field as AgentEvent.type and preserves id', () => {
    const state = createSseParseState();
    const events = parseSseChunkLines(state, 'id: 7\nevent: text_delta\ndata: {"type":"wrong","delta":"Hi"}\n\n');
    expect(events).toEqual([{ type: 'text_delta', id: 7, delta: 'Hi' }]);
  });

  it('returns raw events for malformed JSON', () => {
    const state = createSseParseState();
    const events = parseSseChunkLines(state, 'event: text_delta\ndata: nope\n\n');
    expect(events).toEqual([{ type: 'raw', id: null, line: 'nope' }]);
  });
});
```

Add run service test with a fake API:

```ts
import { describe, expect, it, vi } from 'vitest';
import { RunService } from './run-service';

describe('RunService', () => {
  it('delegates run creation and stream lifecycle through the API contract', async () => {
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => ({ dispose: vi.fn() })),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const service = new RunService(api);
    await expect(service.createRun({ prompt: 'hello' })).resolves.toEqual({ runId: 'run-1' });
    expect(api.createRun).toHaveBeenCalledWith({ prompt: 'hello' });
  });
});
```

- [x] **Step 2: Run tests and verify they fail**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- sse-parser run-service
```

Expected: fail because run service files do not exist.

- [x] **Step 3: Implement run contracts and parser**

Define `run-types.ts` with request/handler types:

```ts
import type { AgentEvent, ChatAttachment, RunContextSelection, RunStatus } from '../../types';

export interface CreateRunInput {
  prompt: string;
  attachments?: ChatAttachment[];
  context?: RunContextSelection;
}

export interface CreateRunResult {
  runId: string;
}

export interface IDisposable {
  dispose(): void;
}

export interface RunStreamHandlers {
  onEvent(event: AgentEvent): void;
  onEnd(status: RunStatus): void;
  onError(error: Error): void;
}

export interface RunApi {
  createRun(input: CreateRunInput): Promise<CreateRunResult>;
  streamRun(runId: string, handlers: RunStreamHandlers, lastEventId?: number | null): IDisposable;
  stopRun(runId: string): Promise<void>;
  submitToolResult(runId: string, toolUseId: string, content: string): Promise<void>;
}
```

Define `run-service.interface.ts` using `createDecorator` and implement `RunService` as a thin contract wrapper around `RunApi`.

Implement `sse-parser.ts` with stateful parsing of `id:`, `event:`, and `data:` lines. Normalize parsed payloads into `AgentEvent` with `{ ...payload, type: currentEvent, id }`, matching the migration plan.

- [x] **Step 4: Implement fetch-backed run API**

Implement `run-api.ts` with:

```ts
export class FetchRunApi implements RunApi {
  async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.runId !== 'string') {
      throw new Error(data?.message ?? 'Could not create run.');
    }
    return { runId: data.runId };
  }

  streamRun(runId: string, handlers: RunStreamHandlers, lastEventId: number | null = null): IDisposable {
    const controller = new AbortController();
    void streamRunWithFetch(runId, handlers, lastEventId, controller.signal);
    return { dispose: () => controller.abort() };
  }

  async stopRun(runId: string): Promise<void> {
    await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
  }

  async submitToolResult(runId: string, toolUseId: string, content: string): Promise<void> {
    await fetch(`/api/runs/${encodeURIComponent(runId)}/tool-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolUseId, content }),
    });
  }
}
```

Use `ReadableStreamDefaultReader` and the SSE parser for `streamRunWithFetch`.

- [x] **Step 5: Run tests and commit**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- sse-parser run-service
pnpm --filter @vibe-design/web type-check
git add web/src/services/run
git commit -m "feat(web): add run service contract"
```

Expected: parser and service tests pass.

---

### Task 3: Context Picker And Design File Services

**Files:**
- Create: `web/src/services/context-picker/context-picker-types.ts`
- Create: `web/src/services/context-picker/context-picker-service.interface.ts`
- Create: `web/src/services/context-picker/context-picker-api.ts`
- Create: `web/src/services/context-picker/internal/mention-query.ts`
- Create: `web/src/services/context-picker/internal/mention-query.test.ts`
- Create: `web/src/services/context-picker/internal/context-picker-service.ts`
- Create: `web/src/services/context-picker/internal/context-picker-service.test.ts`
- Create: `web/src/services/design-files/design-file-types.ts`
- Create: `web/src/services/design-files/design-file-service.interface.ts`
- Create: `web/src/services/design-files/design-file-api.ts`
- Create: `web/src/services/design-files/internal/design-file-service.ts`
- Create: `web/src/services/design-files/internal/design-file-service.test.ts`

- [x] **Step 1: Write failing context and design-file tests**

Test result filtering and staged context:

```ts
import { describe, expect, it } from 'vitest';
import { filterMentionResults } from './mention-query';

describe('filterMentionResults', () => {
  it('filters skills and design files by query', () => {
    const results = filterMentionResults('hero', {
      skills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      designFiles: [{ id: 'file-1', path: 'src/Hero.tsx', name: 'Hero.tsx', kind: 'file' }],
    });
    expect(results.map((result) => result.id)).toEqual(['skill:skill-1', 'design-file:file-1']);
  });
});
```

Test service selection:

```ts
import { describe, expect, it } from 'vitest';
import { ContextPickerService } from './context-picker-service';

describe('ContextPickerService', () => {
  it('builds structured run context from selected skills and files', async () => {
    const service = new ContextPickerService({
      listSkills: async () => [{ id: 'skill-1', name: 'Hero Builder' }],
      listDesignFiles: async () => [{ id: 'file-1', path: 'src/Hero.tsx', name: 'Hero.tsx', kind: 'file' }],
    });
    await service.selectSkill('skill-1');
    await service.selectDesignFile('file-1');
    expect(service.buildRunContext()).toEqual({
      skillIds: ['skill-1'],
      designFileIds: ['file-1'],
      designFilePaths: ['src/Hero.tsx'],
    });
  });
});
```

- [x] **Step 2: Run tests and verify they fail**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- mention-query context-picker-service design-file-service
```

Expected: fail because services do not exist.

- [x] **Step 3: Implement context picker contracts**

Define `ContextPickerSnapshot`, `ContextSearchResult`, `ContextSearchResultItem`, `ContextPickerApi`, and `IContextPickerService`. Implement `ContextPickerService` with private selected arrays and API-backed list methods. Do not include plugins, MCP, connectors, or working directories.

The public snapshot shape should be:

```ts
export interface ContextPickerSnapshot {
  selectedSkills: SkillSummary[];
  selectedDesignFiles: ProjectFile[];
}

export type ContextSearchResultItem =
  | { id: string; kind: 'skill'; label: string; value: string; description?: string }
  | { id: string; kind: 'design-file'; label: string; value: string; path: string };
```

`IContextPickerService` must include `selectResult(item)`. Dispatch `skill` results to `selectSkill(item.value)` and `design-file` results to `selectDesignFile(item.value)`.

- [x] **Step 4: Implement design file service**

Define `DesignFileApi`:

```ts
export interface DesignFileApi {
  listFiles(): Promise<ProjectFile[]>;
  uploadFiles(files: File[]): Promise<ChatAttachment[]>;
}
```

Implement `FetchDesignFileApi` with `/api/design-files` and `/api/design-files/upload`. Keep transport mapping inside this API file.

- [x] **Step 5: Run tests and commit**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- mention-query context-picker-service design-file-service
pnpm --filter @vibe-design/web type-check
git add web/src/services/context-picker web/src/services/design-files
git commit -m "feat(web): add chat context services"
```

Expected: context and design-file service tests pass.

---

### Task 4: Chat Timeline Service And Message Blocks

**Files:**
- Create: `web/src/services/chat-timeline/chat-timeline-types.ts`
- Create: `web/src/services/chat-timeline/chat-timeline-service.interface.ts`
- Create: `web/src/services/chat-timeline/internal/message-blocks.ts`
- Create: `web/src/services/chat-timeline/internal/message-blocks.test.ts`
- Create: `web/src/services/chat-timeline/internal/chat-timeline-service.ts`
- Create: `web/src/services/chat-timeline/internal/chat-timeline-service.test.ts`

- [x] **Step 1: Write failing block and timeline tests**

Add block tests:

```ts
import { describe, expect, it } from 'vitest';
import { buildMessageBlocks } from './message-blocks';
import type { AgentEvent } from '../../../types';

describe('buildMessageBlocks', () => {
  it('groups text, thinking, tool calls, questions, and todos', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world' },
      { type: 'thinking_delta', delta: 'Checking' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'src/App.tsx' } },
      { type: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false },
      { type: 'tool_use', id: 'tool-2', name: 'AskUserQuestion', input: { question: 'Pick one', options: ['A', 'B'] } },
      { type: 'tool_use', id: 'tool-3', name: 'TodoWrite', input: { todos: [{ content: 'Done', status: 'completed' }] } },
    ];

    expect(buildMessageBlocks(events).map((block) => block.kind)).toEqual([
      'text',
      'thinking',
      'tool-group',
      'ask-user-question',
      'todo-write',
    ]);
  });
});
```

Add timeline tests:

```ts
import { describe, expect, it } from 'vitest';
import { ChatTimelineService } from './chat-timeline-service';

describe('ChatTimelineService', () => {
  it('appends user and assistant messages, then applies stream events', () => {
    const timeline = new ChatTimelineService();
    timeline.appendUserMessage({ content: 'Build it', attachments: [] });
    timeline.startAssistantRun({ runId: 'run-1' });
    timeline.applyAgentEvent('run-1', { type: 'text_delta', delta: 'Working' });
    timeline.finishRun('run-1', { status: 'succeeded' });

    const snapshot = timeline.getSnapshot();
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1]?.content).toBe('Working');
    expect(snapshot.messages[1]?.runStatus).toBe('succeeded');
  });
});
```

- [x] **Step 2: Run tests and verify they fail**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- message-blocks chat-timeline-service
```

Expected: fail because timeline files do not exist.

- [x] **Step 3: Implement message block types and builder**

Define:

```ts
export type MessageBlock =
  | { kind: 'text'; content: string; markdown: boolean }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool-group'; calls: ToolCall[]; results: ToolResult[] }
  | { kind: 'file-ops'; ops: FileOpEntry[] }
  | { kind: 'ask-user-question'; toolUseId: string; input: AskUserQuestionInput }
  | { kind: 'todo-write'; input: unknown };
```

Build blocks from `AgentEvent[]` using the Track 4 algorithm, with explicit special handling for `TodoWrite` and `AskUserQuestion`.

- [x] **Step 4: Implement timeline service**

Expose snapshots through:

```ts
export interface ChatTimelineSnapshot {
  messages: ChatMessage[];
  activeRunId: string | null;
  phase: RunPhase;
  pinnedTodoInput: unknown | null;
}
```

Use immutable array replacement for state updates. Generate message ids with a small deterministic counter inside the service.

- [x] **Step 5: Run tests and commit**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- message-blocks chat-timeline-service
pnpm --filter @vibe-design/web type-check
git add web/src/services/chat-timeline
git commit -m "feat(web): add chat timeline service"
```

Expected: timeline tests pass.

---

### Task 5: Chat Session Orchestration

**Files:**
- Create: `web/src/services/chat-session/chat-session-types.ts`
- Create: `web/src/services/chat-session/chat-session-service.interface.ts`
- Create: `web/src/services/chat-session/internal/chat-session-service.ts`
- Create: `web/src/services/chat-session/internal/chat-session-service.test.ts`

- [x] **Step 1: Write failing orchestration tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ChatSessionService } from './chat-session-service';

describe('ChatSessionService', () => {
  it('expands /search before creating a run and starts streaming', async () => {
    const timeline = {
      appendUserMessage: vi.fn(),
      startAssistantRun: vi.fn(),
      applyAgentEvent: vi.fn(),
      finishRun: vi.fn(),
      getSnapshot: vi.fn(),
    };
    const run = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => ({ dispose: vi.fn() })),
      stopRun: vi.fn(),
      submitToolResult: vi.fn(),
    };
    const context = {
      buildRunContext: vi.fn(() => ({ skillIds: ['skill-1'] })),
      getSnapshot: vi.fn(() => ({ selectedSkills: [], selectedDesignFiles: [] })),
    };
    const files = { uploadFiles: vi.fn(async () => []) };

    const service = new ChatSessionService({ timeline, run, context, files });
    await service.sendTurn({ draft: '/search EV trends', files: [] });

    expect(run.createRun.mock.calls[0]?.[0].prompt).toContain('Search for: EV trends');
    expect(run.createRun.mock.calls[0]?.[0].context).toEqual({ skillIds: ['skill-1'] });
    expect(run.streamRun).toHaveBeenCalledWith('run-1', expect.any(Object));
  });
});
```

- [x] **Step 2: Run tests and verify they fail**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- chat-session-service
```

Expected: fail because session service does not exist.

- [x] **Step 3: Implement `IChatSessionService` and orchestration**

Implement:

```ts
export interface SendTurnInput {
  draft: string;
  files: File[];
}
```

`sendTurn()` must:

1. expand `/search` when applicable
2. upload staged files through `IDesignFileService`
3. append user message through `IChatTimelineService`
4. build structured context through `IContextPickerService`
5. create run through `IRunService`
6. start assistant placeholder through `IChatTimelineService`
7. stream events and forward them into timeline

Keep service collaboration interface-only. Do not import concrete internal service classes in this file.

- [x] **Step 4: Run tests and commit**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- chat-session-service
pnpm --filter @vibe-design/web type-check
git add web/src/services/chat-session
git commit -m "feat(web): add chat session orchestration"
```

Expected: session service tests pass.

---

### Task 6: UI Components With UI System Boundaries

**Files:**
- Create: `web/src/components/ToolCard.tsx`
- Create: `web/src/components/AssistantMessage.tsx`
- Create: `web/src/components/ChatComposer.tsx`
- Create: `web/src/components/ChatPane.tsx`
- Create: `web/src/components/chat-ui.css`
- Create: `web/src/components/AssistantMessage.test.tsx`
- Create: `web/src/components/ChatComposer.test.tsx`
- Create: `web/src/components/ChatPane.test.tsx`

- [x] **Step 1: Write failing component tests**

Use jsdom per test file:

```ts
// @vitest-environment jsdom
```

Test `ChatComposer`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

describe('ChatComposer', () => {
  it('selects skills and design files from @ search and sends draft text', async () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({
            items: [
              { id: 'skill:skill-1', kind: 'skill', label: 'Hero Builder', value: 'skill-1' },
              { id: 'design-file:file-1', kind: 'design-file', label: 'Hero.tsx', value: 'file-1', path: 'src/Hero.tsx' },
            ],
          }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '@hero' } });
    await waitFor(() => expect(screen.getByText('Hero Builder')).toBeTruthy());
    fireEvent.click(screen.getByText('Hero Builder'));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Build a hero' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(onSend).toHaveBeenCalledWith({ draft: 'Build a hero', files: [] });
  });
});
```

Test `AssistantMessage` renders text and tool cards. Test `ChatPane` renders messages and pinned todo.

- [x] **Step 2: Run tests and verify they fail**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- ChatComposer AssistantMessage ChatPane
```

Expected: fail because components do not exist.

- [x] **Step 3: Implement `ToolCard` and `AssistantMessage`**

`ToolCard` renders:

- tool summary grouped by name
- done/running/error status
- todo card list
- ask-user-question card with option buttons

`AssistantMessage` receives:

```ts
interface AssistantMessageProps {
  message: ChatMessage;
  blocks: MessageBlock[];
  streaming: boolean;
  onAnswerToolQuestion?: (toolUseId: string, content: string) => void;
}
```

Render text, thinking, tool-group, file-ops, ask-user-question, and todo-write blocks. Use UI-system primitives and icons through public imports only.

- [x] **Step 4: Implement `ChatComposer`**

`ChatComposer` props:

```ts
interface ChatComposerProps {
  streaming: boolean;
  context: {
    search(query: string): Promise<{ items: ContextSearchResultItem[] }>;
    selectResult(item: ContextSearchResultItem): void | Promise<void>;
    snapshot: ContextPickerSnapshot;
  };
  onSend(input: { draft: string; files: File[] }): void;
  onStop(): void;
}
```

Behavior:

- textarea with `aria-label="Message"`
- file input for imports
- `@` query opens mention results for skills/design files only
- selected chips render above the composer
- send is allowed when draft or staged files exist
- stop button renders while streaming

- [x] **Step 5: Implement `ChatPane`**

`ChatPane` props:

```ts
interface ChatPaneProps {
  snapshot: ChatTimelineSnapshot;
  contextSnapshot: ContextPickerSnapshot;
  contextSearch(query: string): Promise<{ items: ContextSearchResultItem[] }>;
  contextSelect(item: ContextSearchResultItem): void | Promise<void>;
  onSend(input: { draft: string; files: File[] }): void | Promise<void>;
  onStop(): void | Promise<void>;
  onAnswerToolQuestion(toolUseId: string, content: string): void | Promise<void>;
}
```

Render history, assistant messages, pinned todo slot, and composer.

- [x] **Step 6: Run tests and commit**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- ChatComposer AssistantMessage ChatPane
pnpm --filter @vibe-design/web type-check
git add web/src/components
git commit -m "feat(web): add chat panel components"
```

Expected: component tests pass.

---

### Task 7: App Integration, DI Registration, And SSR Styling

**Files:**
- Modify: `web/src/VibeDesignApp.tsx`
- Modify: `web/src/launch/vibe-design-flow.tsx`
- Modify: `web/src/render-page.tsx`
- Modify: `web/src/render-page.test.ts`
- Modify: `web/src/index.ts`

- [x] **Step 1: Write failing SSR integration test**

Update `web/src/render-page.test.ts` to assert:

```ts
expect(html).toContain('vibe-design-chat-ui');
expect(html).toContain('@tutti-os/ui-system/styles.css');
```

Keep the existing hello-world assertion only if the hello service remains rendered outside the chat shell. Otherwise replace it with chat-shell assertions.

- [x] **Step 2: Run test and verify it fails**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- render-page
```

Expected: fail because chat app and stylesheet link are not wired.

- [x] **Step 3: Register services in launch flow**

Modify `VibeDesignFlowOptions` to accept optional service overrides for tests:

```ts
export interface VibeDesignFlowOptions {
  runService?: IRunServiceContract;
  contextPickerService?: IContextPickerServiceContract;
  designFileService?: IDesignFileServiceContract;
  chatTimelineService?: IChatTimelineServiceContract;
  chatSessionService?: IChatSessionServiceContract;
}
```

Register default concrete implementations in `VibeDesignFlow.init()`. Defaults should compose through interfaces. Do not instantiate cross-domain services inside components.

- [x] **Step 4: Render chat shell from `VibeDesignApp`**

Replace hello-only rendering with a chat workbench:

```tsx
export function VibeDesignApp() {
  const timeline = useService(IChatTimelineService);
  const session = useService(IChatSessionService);
  const context = useService(IContextPickerService);
  const snapshot = timeline.getSnapshot();
  const contextSnapshot = context.getSnapshot();

  return (
    <main className="vibe-design-chat-ui">
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={contextSnapshot}
        contextSearch={(query) => context.search(query, 'all')}
        contextSelect={(item) => context.selectResult(item)}
        onSend={(input) => void session.sendTurn(input)}
        onStop={() => void session.stopActiveRun()}
        onAnswerToolQuestion={(toolUseId, content) => void session.answerToolQuestion(toolUseId, content)}
      />
    </main>
  );
}
```

- [x] **Step 5: Load UI-system stylesheet**

Modify `render-page.tsx` to include:

```html
<link rel="stylesheet" href="/assets/@tutti-os/ui-system/styles.css">
```

If the server cannot serve that path yet, still include the SSR link now and cover actual asset serving in the server track.

- [x] **Step 6: Run tests and commit**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- render-page
pnpm --filter @vibe-design/web type-check
git add web/src/VibeDesignApp.tsx web/src/launch/vibe-design-flow.tsx web/src/render-page.tsx web/src/render-page.test.ts web/src/index.ts
git commit -m "feat(web): wire chat services into app shell"
```

Expected: SSR test and type-check pass.

---

### Task 8: Full Web Validation And Migration Boundary Audit

**Files:**
- Modify if needed: files touched by Tasks 1-7

- [x] **Step 1: Run full web validation**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/web type-check
```

Expected: all web tests and type-check pass.

- [x] **Step 2: Audit forbidden imports and source leakage**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
rg -n "@vibe-design|vibe-design|analytics|feedback|Plugin|MCP|connector|working[- ]directory" web/src
rg -n "@tutti-os/ui-system/src|@tutti-os/ui-system/.+/" web/src
rg -n "#[0-9a-fA-F]{3,8}|rgb\\(|rgba\\(|linear-gradient" web/src/components
```

Expected:
- no source package imports
- no analytics or feedback implementation
- no plugin/MCP/connector/working-directory feature branches
- no UI-system deep imports
- no copied raw visual palette from `vibe-design`

- [x] **Step 3: Run migration behavior spot checks**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test -- search-command sse-parser message-blocks chat-session-service ChatComposer ChatPane AssistantMessage
```

Expected: focused migration behavior checks pass.

- [x] **Step 4: Commit any audit fixes**

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
git status --short
git add web/src
git commit -m "fix(web): close chat migration validation gaps"
```

Skip this commit if there are no changes after validation.

---

## Implementation Notes

- Keep all `@tutti-os/ui-system` imports on public entrypoints only:
  - `@tutti-os/ui-system`
  - `@tutti-os/ui-system/components`
  - `@tutti-os/ui-system/icons`
  - `@tutti-os/ui-system/styles.css`
  - `@tutti-os/ui-system/utils`
- Do not implement analytics, feedback telemetry, plugin picker, connectors, MCP, or working-directory selection.
- Keep `/search` prompt expansion behavior compatible with the source `vibe-design` implementation.
- Keep Track 4 run/event semantics behind `IRunService`; components must not call `/api/runs*` directly.
- Keep service-to-service collaboration interface-only. Concrete service classes should only be assembled in `launch/vibe-design-flow.tsx`.

## Final Verification

Run:

```bash
cd /Users/chovy/Desktop/team-shell/vibe-design
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/web type-check
git status --short
```

Expected:
- all tests pass
- type-check passes
- only intended implementation files are modified
