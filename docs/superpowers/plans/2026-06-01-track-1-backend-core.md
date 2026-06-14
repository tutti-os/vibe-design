# Track 1 Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Track 1 backend core in `vibe-design/server`: Express HTTP entry, Run registry, SSE stream, auxiliary chat routes, and project tabs/file routes.

**Architecture:** Keep `main.ts` as a thin listener bootstrap and move request handling to `server.ts`. Add typed route modules and a strict TypeScript run service. Use filesystem-backed project state under a runtime directory as the target-project replacement for Vibe Design's daemon DB layer.

**Tech Stack:** TypeScript, Express 5, Node filesystem APIs, Vitest HTTP-boundary tests, native `fetch`.

---

## Scope Guard

Implement only the Track 1 surface from `/Users/zhengweibin/Desktop/workspace/od-replication-plan/track-1-backend-core.md`.

Do not import from `/Users/zhengweibin/Desktop/workspace/vibe-design`.

Do not implement Track 2 agent runtime launch. The temporary run starter may emit deterministic placeholder events so D1/D2 contracts can be tested, but it must remain behind a `startChatRun` dependency boundary that Track 2 can replace.

Do not implement Track 3 skills behavior. Add only a `/api/skills` placeholder route if route registration needs it.

Do not touch `web/` UI or install `@tutti-os/ui-system`; this backend track has no rendering-layer UI.

## File Structure

Create or modify these files only:

- `server/package.json`: add Express runtime dependency and Express types.
- `server/src/main.test.ts`: HTTP-boundary tests for SSR regression plus Track 1 routes.
- `server/src/types/run.ts`: run, event, status, SSE client, and service interfaces.
- `server/src/http/sse.ts`: SSE response writer and error-payload helper.
- `server/src/runs.ts`: in-memory run service.
- `server/src/server-context.ts`: small dependency context shared by route modules.
- `server/src/routes/chat-routes.ts`: auxiliary `/api/runs/*` routes.
- `server/src/routes/project-routes.ts`: `/api/projects/:id`, tabs-state, and file CRUD routes.
- `server/src/routes/skills-routes.ts`: `/api/skills` placeholder.
- `server/src/server.ts`: Express app factory, primary `/api/runs` and `/api/chat`, SSR fallback.
- `server/src/main.ts`: listener bootstrap that re-exports `createServer`.

No other source files should be touched unless a test exposes a direct compile dependency.

---

### Task 1: Add Red HTTP Tests And Express Dependency

**Files:**
- Modify: `server/package.json`
- Modify: `server/src/main.test.ts`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm --filter @vibe-design/server add express
pnpm --filter @vibe-design/server add -D @types/express
```

Expected package changes:

```json
{
  "dependencies": {
    "@vibe-design/web": "workspace:*",
    "express": "^5.2.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.6"
  }
}
```

- [ ] **Step 2: Extend test setup**

In `server/src/main.test.ts`, add temporary runtime-dir cleanup:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
```

Add:

```ts
let runtimeDir: string | undefined;

async function createRuntimeDir(): Promise<string> {
  runtimeDir = await mkdtemp(path.join(tmpdir(), 'vibe-design-server-'));
  return runtimeDir;
}
```

Extend `afterEach` after server close:

```ts
if (runtimeDir) {
  await rm(runtimeDir, { recursive: true, force: true });
  runtimeDir = undefined;
}
```

- [ ] **Step 3: Add run-route red test**

Append this test inside `describe('createServer', ...)`:

```ts
it('creates runs and exposes status, cancellation, feedback, and SSE replay routes', async () => {
  const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

  const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      prompt: 'Build a small page',
      agentId: 'claude',
      assistantMessageId: 'assistant-1',
    }),
  });

  expect(createResponse.status).toBe(202);
  const created = await createResponse.json() as {
    runId: string;
    conversationId: string | null;
    assistantMessageId: string | null;
  };
  expect(created.runId).toMatch(/[0-9a-f-]{36}/);
  expect(created.conversationId).toBe('conversation-1');
  expect(created.assistantMessageId).toBe('assistant-1');

  const statusResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}`);
  expect(statusResponse.status).toBe(200);
  expect(await statusResponse.json()).toMatchObject({
    id: created.runId,
    projectId: 'project-1',
    agentId: 'claude',
  });

  const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/events`);
  expect(eventsResponse.status).toBe(200);
  expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream');
  const eventsText = await eventsResponse.text();
  expect(eventsText).toContain('event: status');
  expect(eventsText).toContain('event: end');

  const cancelResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/cancel`, {
    method: 'POST',
  });
  expect(cancelResponse.status).toBe(200);
  expect(await cancelResponse.json()).toEqual({ ok: true });

  const feedbackResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rating: 'positive',
      reasonCodes: ['matched_request', 'unknown_reason', 'matched_request'],
    }),
  });
  expect(feedbackResponse.status).toBe(202);
  expect(await feedbackResponse.json()).toEqual({ status: 'skipped_no_sink' });

  const toolResultResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/tool-result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'A' }),
  });
  expect(toolResultResponse.status).toBe(400);
  expect(await toolResultResponse.json()).toMatchObject({
    error: { code: 'BAD_REQUEST' },
  });
});
```

- [ ] **Step 4: Add project-route red test**

Append:

```ts
it('persists project tabs-state and supports flat project file CRUD', async () => {
  const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));
  const baseUrl = `http://127.0.0.1:${port}/api/projects/project-1`;

  const tabsState = {
    tabs: [
      { kind: 'file', name: 'index.html', key: 'file:index.html' },
      { kind: 'live-artifact', id: 'artifact-1', label: 'Preview', key: 'live:artifact-1' },
    ],
    activeTabKey: 'file:index.html',
  };
  const tabsResponse = await fetch(`${baseUrl}/tabs-state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tabsState),
  });
  expect(tabsResponse.status).toBe(200);
  expect(await tabsResponse.json()).toEqual({ ok: true });

  const projectResponse = await fetch(baseUrl);
  expect(projectResponse.status).toBe(200);
  expect(await projectResponse.json()).toMatchObject({
    project: {
      id: 'project-1',
      tabsState,
    },
  });

  const createFileResponse = await fetch(`${baseUrl}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'index.html', content: '<main>Track 1</main>' }),
  });
  expect(createFileResponse.status).toBe(200);
  expect(await createFileResponse.json()).toMatchObject({
    file: { name: 'index.html', kind: 'html' },
  });

  const listResponse = await fetch(`${baseUrl}/files`);
  expect(listResponse.status).toBe(200);
  expect(await listResponse.json()).toMatchObject({
    files: [{ name: 'index.html', kind: 'html' }],
  });

  const rawResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('index.html')}`);
  expect(rawResponse.status).toBe(200);
  expect(await rawResponse.text()).toBe('<main>Track 1</main>');

  const renameResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('index.html')}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'home.html' }),
  });
  expect(renameResponse.status).toBe(200);
  expect(await renameResponse.json()).toMatchObject({
    file: { name: 'home.html', kind: 'html' },
  });

  const deleteResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('home.html')}`, {
    method: 'DELETE',
  });
  expect(deleteResponse.status).toBe(200);
  expect(await deleteResponse.json()).toEqual({ ok: true });
});
```

- [ ] **Step 5: Verify red**

Run:

```bash
pnpm --filter @vibe-design/server test -- src/main.test.ts
```

Expected: existing SSR test passes; new tests fail with `404` for `/api/runs` and `/api/projects/:id/tabs-state`.

---

### Task 2: Add Run Types

**Files:**
- Create: `server/src/types/run.ts`

- [ ] **Step 1: Create run type definitions**

Create `server/src/types/run.ts`:

```ts
import type { ChildProcess } from 'node:child_process';
import type { Request, Response } from 'express';

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'canceled']);

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface SseClient {
  send(event: string, data: unknown, id?: string | number | null): boolean;
  end(): void;
  cleanup(): void;
}

export interface EventRecord {
  id: number;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface ChatRun {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  assistantMessageId: string | null;
  clientRequestId: string | null;
  agentId: string | null;
  appliedPluginSnapshotId: string | null;
  pluginId: string | null;
  mediaExecution: unknown;
  toolBundle: unknown;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  events: EventRecord[];
  nextEventId: number;
  clients: Set<SseClient>;
  waiters: Set<(body: RunStatusBody) => void>;
  child: ChildProcess | null;
  acpSession: { abort?: () => void | Promise<void> } | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  errorCode: string | null;
  cancelRequested: boolean;
  eventsLogPath: string | null;
  eventsLogStream: NodeJS.WritableStream | null;
  pendingHostAnswers: Set<string>;
  stdinOpen: boolean;
}

export interface ChatRunCreateMeta {
  projectId?: unknown;
  conversationId?: unknown;
  assistantMessageId?: unknown;
  clientRequestId?: unknown;
  agentId?: unknown;
  appliedPluginSnapshotId?: unknown;
  pluginId?: unknown;
  mediaExecution?: unknown;
  toolBundle?: unknown;
}

export interface RunStatusBody {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  assistantMessageId: string | null;
  agentId: string | null;
  appliedPluginSnapshotId: string | null;
  pluginId: string | null;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  errorCode: string | null;
  eventsLogPath: string | null;
  mediaExecution: unknown;
  toolBundle: unknown;
}

export interface ChatRunService {
  create(meta?: ChatRunCreateMeta): ChatRun;
  start(run: ChatRun, starter: (run: ChatRun) => Promise<void> | void): ChatRun;
  get(id: string): ChatRun | null;
  list(filter?: { projectId?: unknown; conversationId?: unknown; status?: unknown }): ChatRun[];
  stream(run: ChatRun, req: Request, res: Response): void;
  cancel(run: ChatRun): void;
  shutdownActive(options?: { graceMs?: number }): Promise<void>;
  wait(run: ChatRun): Promise<RunStatusBody>;
  emit(run: ChatRun, event: string, data: unknown): EventRecord;
  finish(run: ChatRun, status: RunStatus, code?: number | null, signal?: string | null): void;
  fail(run: ChatRun, code: string, message: string, init?: Record<string, unknown>): void;
  drop(run: ChatRun | null | undefined): void;
  statusBody(run: ChatRun): RunStatusBody;
  isTerminal(status: unknown): boolean;
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: pass or fail only because future files referenced by tests are not created yet. Fix type-only issues in this file before continuing.

---

### Task 3: Add SSE Helpers

**Files:**
- Create: `server/src/http/sse.ts`

- [ ] **Step 1: Implement SSE response helper**

Create `server/src/http/sse.ts`:

```ts
import type { Response } from 'express';

export interface SseResponseOptions {
  keepAliveIntervalMs?: number;
}

export interface SseResponse {
  send(event: string, data: unknown, id?: string | number | null): boolean;
  writeKeepAlive(): boolean;
  cleanup(): void;
  end(): void;
}

export function createSseResponse(
  res: Response,
  { keepAliveIntervalMs = 0 }: SseResponseOptions = {},
): SseResponse {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const canWrite = () => !res.destroyed && !res.writableEnded;
  let heartbeat: NodeJS.Timeout | null = null;

  const writeKeepAlive = () => {
    if (!canWrite()) return false;
    res.write(': keepalive\n\n');
    return true;
  };

  const cleanup = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  if (keepAliveIntervalMs > 0) {
    heartbeat = setInterval(writeKeepAlive, keepAliveIntervalMs);
    heartbeat.unref?.();
  }

  res.on('close', cleanup);
  res.on('finish', cleanup);

  return {
    send(event, data, id = null) {
      if (!canWrite()) return false;
      const idLine = id !== null && id !== undefined ? `id: ${id}\n` : '';
      res.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    },
    writeKeepAlive,
    cleanup,
    end() {
      cleanup();
      if (canWrite()) res.end();
    },
  };
}

export function createSseErrorPayload(
  code: string,
  message: string,
  init: Record<string, unknown> = {},
) {
  return {
    code,
    message,
    ...init,
  };
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: no type errors from `sse.ts`.

---

### Task 4: Add Run Service

**Files:**
- Create: `server/src/runs.ts`

- [ ] **Step 1: Implement the service factory**

Create `server/src/runs.ts` using these required behaviors:

- `create()` normalizes string metadata to non-empty strings or `null`.
- `emit()` assigns monotonic event ids, updates `updatedAt`, stores at most `maxEvents`, writes JSONL best-effort when `runsLogDir` is configured, and broadcasts to `run.clients`.
- `stream()` reads `Last-Event-ID` or `?after=`, replays events with id greater than the cursor, and for terminal runs sends the last event if no replay was sent before ending.
- `finish()` emits `end`, closes SSE clients, resolves waiters, closes log stream, and schedules TTL cleanup.
- `cancel()` marks `cancelRequested`, tries `acpSession.abort()`, tries `child.kill('SIGTERM')`, and calls `finish(..., 'canceled')` when there is no child to wait for.
- `drop()` removes an active run without emitting `end`, sets status to `canceled`, and resolves waiters.

Implementation skeleton:

```ts
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import type {
  ChatRun,
  ChatRunCreateMeta,
  ChatRunService,
  EventRecord,
  RunStatus,
  RunStatusBody,
} from './types/run.js';
import { TERMINAL_RUN_STATUSES } from './types/run.js';
import type { SseResponse } from './http/sse.js';

export interface CreateChatRunServiceOptions {
  createSseResponse: (res: Response) => SseResponse;
  createSseErrorPayload: (code: string, message: string, init?: Record<string, unknown>) => unknown;
  maxEvents?: number;
  ttlMs?: number;
  shutdownGraceMs?: number;
  runsLogDir?: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractErrorDetails(data: unknown): { error: string | null; errorCode: string | null } {
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const nested = payload.error && typeof payload.error === 'object'
    ? payload.error as Record<string, unknown>
    : {};
  return {
    error: readString(nested.message) ?? readString(payload.message),
    errorCode: readString(nested.code) ?? readString(payload.code),
  };
}

export function createChatRunService(options: CreateChatRunServiceOptions): ChatRunService {
  const {
    createSseResponse,
    createSseErrorPayload,
    maxEvents = 2_000,
    ttlMs = 30 * 60 * 1000,
    shutdownGraceMs = 3_000,
    runsLogDir = null,
  } = options;
  const runs = new Map<string, ChatRun>();

  // Implement create/get/list/statusBody/start/emit/stream/finish/fail/cancel/
  // shutdownActive/wait/drop/isTerminal in this closure. Each method must use
  // the behaviors listed in this task and return through the ChatRunService
  // interface at the end of the factory.
  return {
    create,
    start,
    get,
    list,
    stream,
    cancel,
    shutdownActive,
    wait,
    emit,
    finish,
    fail,
    drop,
    statusBody,
    isTerminal,
  };
}
```

- [ ] **Step 2: Preserve source semantics, not source code**

While filling in the skeleton, use target names and strict TypeScript. Do not copy the Vibe Design `@ts-nocheck` implementation verbatim.

- [ ] **Step 3: Focused type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: run-service types compile.

---

### Task 5: Add Server Context

**Files:**
- Create: `server/src/server-context.ts`

- [ ] **Step 1: Define route dependency context**

Create:

```ts
import type { Response } from 'express';
import type { ChatRunService } from './types/run.js';
import type { SseResponse } from './http/sse.js';

export interface HttpDeps {
  createSseResponse: (res: Response) => SseResponse;
  createSseErrorPayload: (code: string, message: string, init?: Record<string, unknown>) => unknown;
  sendApiError: (
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) => void;
}

export interface PathDeps {
  runtimeDir: string;
  projectsDir: string;
  runsLogDir: string;
}

export interface SubmitToolResultResult {
  ok: boolean;
  reason?: 'not_found' | 'run_terminal' | 'stdin_closed' | 'stdin_text_mode' | 'bad_tool_use_id' | 'write_failed';
  error?: string;
}

export interface ServerContext {
  design: {
    runs: ChatRunService;
  };
  http: HttpDeps;
  paths: PathDeps;
  chat: {
    submitToolResultToRun: (
      runId: string,
      toolUseId: string,
      content: string,
      isError?: boolean,
    ) => SubmitToolResultResult;
  };
  telemetry?: {
    reportFeedback?: (input: {
      runId: string;
      rating: 'positive' | 'negative';
      reasonCodes: string[];
      hasCustomReason: boolean;
      customReason: string;
      scoreMetadata?: Record<string, unknown>;
    }) => Promise<{ status: 'accepted' | 'skipped_consent' | 'skipped_no_sink' }>;
  };
}

export type RouteDeps<K extends keyof ServerContext> = Pick<ServerContext, K>;
```

- [ ] **Step 2: Type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: context types compile.

---

### Task 6: Add Chat Routes

**Files:**
- Create: `server/src/routes/chat-routes.ts`

- [ ] **Step 1: Implement auxiliary run routes**

Create `registerChatRoutes(app, ctx)` with:

- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events`
- `POST /api/runs/:id/cancel`
- `POST /api/runs/:id/tool-result`
- `POST /api/runs/:id/feedback`

Use this allowlist:

```ts
const FEEDBACK_REASON_ALLOWLIST = new Set([
  'matched_request',
  'strong_visual',
  'useful_structure',
  'easy_to_continue',
  'followed_design_system',
  'missed_request',
  'weak_visual',
  'incomplete_output',
  'hard_to_use',
  'missed_design_system',
  'other',
]);
```

Error mapping for `tool-result`:

```ts
if (reason === 'not_found') return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
if (reason === 'run_terminal' || reason === 'stdin_closed') {
  return sendApiError(res, 410, 'GONE', `run is no longer accepting tool results (${reason})`);
}
if (reason === 'stdin_text_mode') {
  return sendApiError(res, 400, 'BAD_REQUEST', 'run does not support interactive tool results');
}
if (reason === 'bad_tool_use_id') {
  return sendApiError(res, 400, 'BAD_REQUEST', 'toolUseId is invalid');
}
return sendApiError(res, 500, 'INTERNAL', `tool result write failed: ${reason}`);
```

- [ ] **Step 2: Keep primary route ownership out of this file**

Do not register `POST /api/runs` or `POST /api/chat` here. They belong in `server.ts`.

- [ ] **Step 3: Type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: route types compile.

---

### Task 7: Add Project Routes

**Files:**
- Create: `server/src/routes/project-routes.ts`

- [ ] **Step 1: Implement safety helpers**

Add:

```ts
function isSafeProjectId(id: unknown): id is string {
  return typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 128 &&
    !/^\.+$/.test(id) &&
    /^[A-Za-z0-9._-]+$/.test(id);
}

function isSafeFileName(name: unknown): name is string {
  return typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    path.basename(name) === name &&
    !/^\.+$/.test(name);
}
```

- [ ] **Step 2: Implement filesystem layout**

Use:

```text
<runtimeDir>/
  projects/
    <projectId>/
      project.json
      files/
        <fileName>
```

`project.json` shape:

```ts
interface StoredProject {
  id: string;
  createdAt: number;
  updatedAt: number;
  tabsState: {
    tabs: Array<Record<string, unknown>>;
    activeTabKey: string | null;
  };
  metadata: Record<string, unknown>;
}
```

- [ ] **Step 3: Implement endpoints**

Register:

- `GET /api/projects/:id`: return `{ project, resolvedDir }`; create a default project record if missing.
- `PUT /api/projects/:id/tabs-state`: validate `tabs` array and `activeTabKey`; persist and return `{ ok: true }`.
- `GET /api/projects/:id/files`: return `{ files }` with `name`, `size`, `mtime`, and `kind`.
- `POST /api/projects/:id/files`: accept JSON `{ name, content, encoding? }`; write file and return `{ file }`.
- `GET /api/projects/:id/files/:name`: return raw file bytes with a content type based on extension.
- `DELETE /api/projects/:id/files/:name`: delete and return `{ ok: true }`.
- `PUT /api/projects/:id/files/:name`: accept `{ name }`, rename, return `{ file }`.

File `kind` mapping:

```ts
function fileKind(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.js' || ext === '.mjs' || ext === '.ts' || ext === '.tsx') return 'code';
  if (ext === '.json') return 'json';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp' || ext === '.svg') return 'image';
  return 'file';
}
```

- [ ] **Step 4: Type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: project routes compile.

---

### Task 8: Add Skills Placeholder Route

**Files:**
- Create: `server/src/routes/skills-routes.ts`

- [ ] **Step 1: Add placeholder registrar**

Create:

```ts
import type { Express } from 'express';
import type { ServerContext } from '../server-context.js';

export function registerSkillsRoutes(app: Express, _ctx: ServerContext) {
  app.get('/api/skills', (_req, res) => {
    res.json({ skills: [] });
  });
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: placeholder route compiles.

---

### Task 9: Add Express App Factory

**Files:**
- Create: `server/src/server.ts`

- [ ] **Step 1: Create app options and HTTP error helper**

`server.ts` should export:

```ts
export interface CreateServerOptions {
  runtimeDir?: string;
}
```

Use:

```ts
function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}
```

- [ ] **Step 2: Create `ServerContext`**

Build:

```ts
const runtimeDir = options.runtimeDir ?? path.join(process.cwd(), '.vibe');
const projectsDir = path.join(runtimeDir, 'projects');
const runsLogDir = path.join(runtimeDir, 'runs');
const runs = createChatRunService({
  createSseResponse,
  createSseErrorPayload,
  runsLogDir,
});
```

- [ ] **Step 3: Implement Track 2-ready tool-result boundary**

Add a local `submitToolResultToRun` implementation in `server.ts`:

- return `not_found` when run is absent.
- return `run_terminal` when run status is terminal.
- return `bad_tool_use_id` when `toolUseId` is empty or not in `pendingHostAnswers`.
- return `stdin_closed` when a child exists but stdin is unavailable.
- return `stdin_text_mode` when `run.stdinOpen` is false.
- when a child stdin is available, write the JSONL `tool_result`, remove from `pendingHostAnswers`, and return `{ ok: true }`.

This is allowed even before Track 2 because it is the protocol boundary; tests only depend on validation behavior.

- [ ] **Step 4: Register primary run routes**

In `server.ts`, before `registerChatRoutes`, register:

```ts
app.post('/api/runs', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  if (!isSafeProjectId(body.projectId)) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required and must be path-safe');
  }
  const run = runs.create({
    projectId: body.projectId,
    conversationId: body.conversationId,
    assistantMessageId: body.assistantMessageId,
    clientRequestId: body.clientRequestId,
    agentId: body.agentId ?? 'claude',
    appliedPluginSnapshotId: body.appliedPluginSnapshotId,
    pluginId: body.pluginId,
    mediaExecution: body.mediaExecution,
    toolBundle: body.toolBundle,
  });
  res.status(202).json({
    runId: run.id,
    conversationId: run.conversationId,
    assistantMessageId: run.assistantMessageId,
  });
  runs.start(run, startTrackOneRun);
});

app.post('/api/chat', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const run = runs.create({
    projectId: body.projectId,
    conversationId: body.conversationId,
    assistantMessageId: body.assistantMessageId,
    clientRequestId: body.clientRequestId,
    agentId: body.agentId ?? 'claude',
    appliedPluginSnapshotId: body.appliedPluginSnapshotId,
    pluginId: body.pluginId,
    mediaExecution: body.mediaExecution,
    toolBundle: body.toolBundle,
  });
  runs.stream(run, req, res);
  runs.start(run, startTrackOneRun);
});
```

Track 1 deterministic runner:

```ts
async function startTrackOneRun(run: ChatRun) {
  if (runs.isTerminal(run.status)) return;
  run.status = 'running';
  run.updatedAt = Date.now();
  runs.emit(run, 'status', { label: 'running', detail: 'Track 1 run service ready' });
  runs.finish(run, 'succeeded', 0, null);
}
```

This keeps D2 observable without pretending Track 2 exists.

- [ ] **Step 5: Register route modules and SSR fallback**

Order:

```ts
app.use(express.json({ limit: '50mb' }));
app.post('/api/runs', createRunHandler);
app.post('/api/chat', createChatStreamHandler);
registerChatRoutes(app, ctx);
registerProjectRoutes(app, ctx);
registerSkillsRoutes(app, ctx);
app.get(['/', '/index.html'], (_req, res) => {
  res.type('html').send(renderPage());
});
app.use((_req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});
```

- [ ] **Step 6: Type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: app factory compiles.

---

### Task 10: Update Main Bootstrap

**Files:**
- Modify: `server/src/main.ts`

- [ ] **Step 1: Replace bare HTTP handler with app factory export**

`main.ts` should:

- import `createServer` from `./server.js`
- export `createServer`
- keep `resolvePort`
- call `createServer().listen(...)` in the CLI entrypoint

Target shape:

```ts
import { createServer } from './server.js';

const DEFAULT_PORT = 3000;

function resolvePort(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export { createServer };

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = resolvePort(process.env.PORT);
  createServer().listen(port, () => {
    console.log(JSON.stringify({ prefix: 'vibe-design-server', message: 'listening', port }));
  });
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @vibe-design/server test -- src/main.test.ts
```

Expected: SSR test and new Track 1 HTTP tests pass.

---

### Task 11: Full Validation

**Files:**
- All touched Track 1 files.

- [ ] **Step 1: Run server tests**

Run:

```bash
pnpm --filter @vibe-design/server test
```

Expected: all server tests pass. If unrelated pre-existing tests fail, capture exact failure and do not claim full pass.

- [ ] **Step 2: Run server type-check**

Run:

```bash
pnpm --filter @vibe-design/server type-check
```

Expected: exit 0.

- [ ] **Step 3: Run workspace checks**

Run:

```bash
pnpm test
pnpm type-check
```

Expected: exit 0. If failures are outside Track 1, report them with file names and commands.

- [ ] **Step 4: Check formatting hazards**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Confirm cut boundary**

Run:

```bash
rg -n "vibe-design|@vibe-design|apps/daemon" server/src
```

Expected: no imports or source-coupled references. Test strings or comments should be inspected manually and removed if they imply a runtime dependency.

---

## Final Handoff Checklist

Report:

- Spec referenced: `docs/superpowers/specs/2026-06-01-track-1-backend-core-design.md`.
- Plan executed: `docs/superpowers/plans/2026-06-01-track-1-backend-core.md`.
- Implemented D1/D2/D7 Track 1 backend surfaces.
- Strictly preserved `/api/runs`, `/api/chat`, `/api/runs/:id/events`, `/api/runs/:id/tool-result`, `/api/runs/:id/feedback`, `/api/projects/:id/tabs-state`, and file CRUD route contracts.
- Did not implement Track 2 real agent launch, Track 3 skills, media, plugin pipeline, telemetry sink, or UI.
- Validation commands and exact results.
- Remaining risks: placeholder runner is not a real agent runtime; filesystem project store is a Track 1 minimal store; tool-result live stdin path requires Track 2 child-process integration.
