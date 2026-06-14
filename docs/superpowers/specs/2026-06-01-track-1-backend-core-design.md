# Track 1 Backend Core Migration Design

## Sources Reviewed

- Migration plan: `/Users/zhengweibin/Desktop/workspace/od-replication-plan/track-1-backend-core.md`
- Source modules:
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/runs.ts`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/chat-routes.ts`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/project-routes.ts`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/server.ts`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/server-context.ts`
- Target modules:
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/server/src/main.ts`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/server/src/main.test.ts`

## Scope

Implement only Track 1 backend core capabilities inside `vibe-design/server`:

- D1: Express HTTP service, chat/run route entrypoints, project route entrypoints, SSE helper.
- D2: in-memory run lifecycle service with event buffering, SSE replay, cancellation, terminal waiters, and best-effort JSONL event logs.
- D7: route-level interactive tool-result protocol with a Track 2-ready `submitToolResultToRun` boundary.

Out of scope:

- Vibe Design SQLite schema, plugin pipeline, media/BYOK execution, Langfuse/PostHog integrations, agent runtime launch, design-system validation, and web UI migration.
- `@tutti-os/ui-system` is not installed or imported because this track does not touch rendering UI.

## Concept Mapping

| Source concept | Target concept |
| --- | --- |
| `apps/daemon/src/server.ts` | `server/src/server.ts` plus `server/src/main.ts` listener bootstrap |
| `createChatRunService` | `server/src/runs.ts` in-memory run service |
| `ChatRun`, `EventRecord` | `server/src/types/run.ts` |
| `registerChatRoutes` | `server/src/routes/chat-routes.ts` |
| `registerProjectRoutes` | `server/src/routes/project-routes.ts` |
| `ServerContext`, `RouteDeps` | `server/src/server-context.ts` |
| `createSseResponse` | `server/src/http/sse.ts` |
| Vibe Design project/file storage | Vibe Design lightweight filesystem-backed project store |
| daemon `submitToolResultToRun` | Track 2-ready chat boundary in `ServerContext.chat` |

## Protocols To Preserve

- `POST /api/runs` accepts `projectId`, optional `conversationId`, `prompt` or `message`, attachments fields, `agentId`, `clientType`, `toolBundle`, `mediaExecution`, plugin/skill/design ids, `assistantMessageId`, and `clientRequestId`. It returns HTTP 202 with `{ runId, conversationId, assistantMessageId }`.
- `POST /api/chat` creates a run and streams its SSE events on the same response.
- `GET /api/runs` returns `{ runs: RunStatusBody[] }` filtered by `projectId`, `conversationId`, or `status`; `status=active` means non-terminal runs.
- `GET /api/runs/:id`, `GET /api/runs/:id/events`, and `POST /api/runs/:id/cancel` keep Vibe Design status, SSE, and cancellation semantics.
- `POST /api/runs/:id/tool-result` accepts `{ toolUseId, content, isError? }` and maps errors to the plan's `404 NOT_FOUND`, `410 GONE`, and `400 BAD_REQUEST` cases.
- `POST /api/runs/:id/feedback` validates rating and allowlisted reason codes; without a telemetry sink it returns `202 { status: 'skipped_no_sink' }`.
- `PUT /api/projects/:id/tabs-state` accepts the exact `OpenTabsState` JSON shape from the plan and returns `{ ok: true }`.
- Project file routes remain flat under a project and reject unsafe project ids or file names.

## Architecture

`main.ts` remains the process bootstrap and calls `createServer()` from `server.ts`. `server.ts` builds one Express app, wires JSON parsing, minimal origin/local safety hooks, static SSR for `/` and `/index.html`, and registers run/project/skills route modules.

`runs.ts` owns the run registry. It preserves Vibe Design's state machine (`queued -> running -> succeeded|failed|canceled`), event ids, ring buffer, terminal replay guarantee, waiters, cancellation, shutdown, drop, and best-effort JSONL event logging. The implementation is strict TypeScript and target-shaped rather than copied from the source `@ts-nocheck` module.

`project-routes.ts` uses a small filesystem project store rooted at `.vibe/projects`. This is the minimum target-project semantic replacement for Vibe Design's DB-backed store. It is intentionally local to Track 1 and can later be swapped for a richer storage service without changing route contracts.

`chat-routes.ts` owns auxiliary run routes only. `POST /api/runs` and `POST /api/chat` stay in `server.ts` because the migration plan calls out Express registration order and future Track 2 start logic there.

## Test Strategy

Use Vitest at the HTTP boundary:

- Keep the existing SSR test passing.
- Add tests for `POST /api/runs`, run status lookup, event SSE replay, cancellation, feedback no-sink behavior, and tool-result error mapping.
- Add tests for project tabs-state and file CRUD.
- Add a direct run-service test for terminal SSE replay and event log best-effort behavior if HTTP tests do not cover the lifecycle precisely enough.

Validation commands:

- `pnpm --filter @vibe-design/server test`
- `pnpm --filter @vibe-design/server type-check`
- `pnpm test`
- `pnpm type-check`

## Cut Boundary

The implementation must not import any source module from `vibe-design`. It may copy route and payload semantics, but target code must use vibe-design naming, strict TypeScript types, and a small local server context. Any source module behavior outside the Track 1 plan is intentionally excluded.
