# Vibe Design Chat UI Migration Design

**Date:** 2026-06-01

**References**
- Migration scope: [/Users/chovy/Desktop/track-4-chat-ui.md](/Users/chovy/Desktop/track-4-chat-ui.md)
- Source implementation: `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/components/ChatPane.tsx`, `ChatComposer.tsx`, `AssistantMessage.tsx`, `ToolCard.tsx`
- Source runtime logic: `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/runtime/todos.ts`, `file-ops.ts`
- Target constraints: [/Users/chovy/Desktop/team-shell/vibe-design/web/AGENTS.md](/Users/chovy/Desktop/team-shell/vibe-design/web/AGENTS.md)

## Migration-Scheme Compliance

This document follows the user-provided migration scheme rather than a generic feature-design process.

The controlling requirements for this migration are:

- understand the migration plan first, then identify source capability, state flow, and protocol boundaries
- reuse source behavior where it is the right reference, but do not mechanically copy source code
- keep migration-plan protocol semantics unchanged where the plan defines them
- rewrite naming, structure, UI composition, and service boundaries in `vibe-design` semantics
- use `@tutti-os/ui-system` as the target render-layer system
- do not extend the feature beyond the approved migration scope

## Goal

Migrate the Track 4 chat-panel capability from `vibe-design` into `vibe-design/web`, but implement it in `vibe-design` semantics:

- UI uses `@tutti-os/ui-system`
- UI only talks to service contracts
- services also collaborate only through explicit interfaces
- mature source behavior is preserved where it exists as pure logic

This is a semantic migration. The target should read like native `vibe-design` code that follows the migration plan and target architecture, not like an `vibe-design` rename pass.

## User-Confirmed Scope

Included:
- F1/F2/F3 chat surface from Track 4
- `ChatPane`, `ChatComposer`, `AssistantMessage`, `ToolCard`
- `/search` command
- context picker for `skills` and `design files`
- file import/upload entry and staged attachments
- SSE-backed assistant event streaming
- SSE reconnect with `Last-Event-ID` cursor replay
- pinned todo card
- assistant message block rendering

Excluded:
- analytics
- feedback telemetry
- plugin panel and plugin apply flow
- connectors, MCP, working-directory context
- unrelated `vibe-design` home/project features

## Migration Inputs

### Migration plan

- [/Users/chovy/Desktop/track-4-chat-ui.md](/Users/chovy/Desktop/track-4-chat-ui.md)

### Source modules in scope

- `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/components/ChatPane.tsx`
- `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/components/ChatComposer.tsx`
- `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/components/AssistantMessage.tsx`
- `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/components/ToolCard.tsx`
- `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/runtime/todos.ts`
- `/Users/chovy/Desktop/team-shell/vibe-design/apps/web/src/runtime/file-ops.ts`

### Target module roots

- `/Users/chovy/Desktop/team-shell/vibe-design/web/src`
- `/Users/chovy/Desktop/team-shell/vibe-design/web/src/launch`
- `/Users/chovy/Desktop/team-shell/vibe-design/web/src/services`

## Approaches Considered

### 1. Thin wrapper around source components

Copy source components almost directly and add adapters around them.

Pros:
- fastest path to visible UI

Cons:
- pulls `vibe-design` coupling into `vibe-design`
- violates the desired service-contract boundary
- increases long-term cleanup cost

### 2. Full clean-room rewrite

Rebuild the whole feature from the Track 4 doc and source behavior notes.

Pros:
- cleanest target architecture

Cons:
- highest drift risk versus proven source behavior
- slower to validate

### 3. Chosen: semantic migration with shared pure logic

Rebuild UI and services in `vibe-design` structure, but migrate proven source logic where it is naturally pure and reusable.

Pros:
- preserves mature behavior for event parsing, todo/file-op projection, block construction, and `/search`
- keeps target naming, DI, contracts, and UI-system usage clean

Cons:
- requires stricter boundary work up front

## Reuse And Rewrite Boundaries

### Structures intentionally reused

- source decomposition into chat container, composer, assistant-message rendering, and tool-card surfaces
- source request/data/state flow for a single chat turn
- source pure-logic behavior for SSE parsing, `/search`, todo extraction, file-op extraction, and assistant block construction
- source loading, streaming, and terminal-state handling patterns where they fit target architecture

### Structures intentionally rewritten

- component implementation details
- service layout and orchestration
- naming of target-owned types, services, methods, props, and tests
- UI composition and styling through `@tutti-os/ui-system`
- source-local analytics, plugin, MCP, connector, and working-directory branches

### Structures preserved only at protocol level

- run/event semantics from Track 4
- accepted tool and event shapes required by the chat feature
- send-time context semantics for approved scope
- `POST /api/runs` includes the current `projectId`
- `GET /api/runs/:id/events` is the streaming endpoint; reconnect resumes from the last normalized `eventId`
- `POST /api/runs/:id/cancel` stops an active run
- `POST /api/runs/:id/tool-result` submits live `AskUserQuestion` answers
- project design files are listed and uploaded through `/api/projects/:projectId/files`
- historical `AskUserQuestion` answers start a new chat turn rather than writing to a terminal run

## Source-To-Target Concept Mapping

| Source concept | Target concept |
| --- | --- |
| `ChatComposer` inline plugin/context system | `ContextPickerService` with only `skills` and `design files` |
| direct component-side protocol branching | `ChatSessionService` orchestration |
| daemon/provider run protocol helpers | `RunService` |
| assistant event list on message | `ChatTimelineService` managed message timeline |
| file/project lookup in UI | `DesignFileService` / `ProjectService` |
| source-local CSS surfaces | UI System primitives + minimal target-local layout styles |

### Naming adaptation rules

- source business wording that is specific to `vibe-design` must be replaced with `vibe-design` naming where protocol compatibility does not require the original term
- `skills` and `design files` remain stable names because they are part of the approved target vocabulary
- Track 4 protocol nouns such as `run`, `events`, and `TodoWrite` remain stable where they define interoperability, but surrounding implementation names should follow `vibe-design` service semantics

## Protocols That Must Remain Unchanged

The following protocol semantics come from the migration plan and must remain stable:

- the run lifecycle remains based on the Track 4 create-run plus stream-events flow
- assistant streaming remains modeled as a sequence of normalized agent events
- `TodoWrite` remains the special todo-producing tool event
- `/search` retains the research-first expansion behavior
- assistant messages continue to support block construction for text, thinking, grouped tools, file operations, question prompts, and todo snapshots

The target implementation may hide these protocols behind services, but must not weaken or redefine their external behavior.

## Architecture

### Service boundaries

- `ChatSessionService`
  - orchestrates a single user turn
  - composes prompt, attachments, and structured context
  - coordinates `RunService`, `DesignFileService`, `ContextPickerService`, `ChatTimelineService`

- `ChatTimelineService`
  - owns timeline state
  - stores `messages`, active run metadata, and derived streaming state
  - applies agent events to the active assistant message
  - derives pinned todo snapshot

- `RunService`
  - creates runs
  - connects and parses the SSE event stream
  - stops runs
  - submits live tool answers

- `ContextPickerService`
  - searches `skills` and `design files`
  - owns staged context selections
  - returns structured send-time context
  - provides mention results and selected-chip state

- `DesignFileService`
  - lists design files
  - uploads user-selected files
  - returns normalized attachment records

- `ProjectContextService`
  - provides the current project identity needed by the chat feature
  - stays intentionally narrow; file CRUD and workspace data remain behind their own service adapters

### Service collaboration rule

No service may directly reach into another service implementation or local store. Service-to-service collaboration must happen through interface contracts registered in the DI container.

### UI boundary

Components render service-provided state and call service commands. They do not:

- construct API URLs
- parse SSE payloads
- own cross-service orchestration
- normalize transport payloads

## UI-System Mapping

The target UI must use `@tutti-os/ui-system` public entrypoints only.

Planned mapping:

- chat shell and panel layout -> UI-system layout primitives and token-backed container styling
- composer input, send/stop, and import affordances -> UI-system input and button primitives
- mention popover, tabs, and selected chips -> UI-system overlay, tab, and chip/tag primitives where available
- assistant blocks, tool cards, and todo card -> UI-system card/surface composition with target-local content renderers
- icons -> `@tutti-os/ui-system/icons`

No `vibe-design` local class naming, raw color palette, local icon implementation, or deep import pattern should survive the migration.

### Stylesheet rule

`@tutti-os/ui-system/styles.css` must be loaded once from the web entry or shell when the chat UI lands. The implementation plan must include this step explicitly.

## Planned File Structure

```text
web/src/
  services/
    chat-session/
      chat-session-service.interface.ts
      chat-session-types.ts
      internal/chat-session-service.ts
    chat-timeline/
      chat-timeline-service.interface.ts
      chat-timeline-types.ts
      internal/chat-timeline-service.ts
      internal/message-blocks.ts
    run/
      run-service.interface.ts
      run-types.ts
      run-api.ts
      internal/run-service.ts
      internal/sse-parser.ts
    context-picker/
      context-picker-service.interface.ts
      context-picker-types.ts
      context-picker-api.ts
      internal/context-picker-service.ts
      internal/mention-query.ts
    design-files/
      design-file-service.interface.ts
      design-file-types.ts
      design-file-api.ts
      internal/design-file-service.ts
    project-context/
      project-context-service.interface.ts
      project-context-service.ts
  components/
    ChatPane.tsx
    ChatComposer.tsx
    AssistantMessage.tsx
    ToolCard.tsx
  runtime/
    todos.ts
    file-ops.ts
    tool-renderers.ts
  types.ts
  VibeDesignApp.tsx
  launch/vibe-design-flow.tsx
```

## Key Contracts

### `IRunService`

- `createRun(input): Promise<{ runId: string }>`
- `streamRun(runId, handlers): IDisposable`
- `stopRun(runId): Promise<void>`
- `submitToolResult(runId, toolUseId, content): Promise<void>`

### `IContextPickerService`

- `search(query, scope): Promise<ContextSearchResult>`
- `selectSkill(skillId): Promise<void>`
- `selectDesignFile(fileId): Promise<void>`
- `removeSelection(kind, id): void`
- `buildRunContext(): RunContextSelection | undefined`
- `getSnapshot(): ContextPickerSnapshot`

### `IDesignFileService`

- `listFiles(): Promise<ProjectFile[]>`
- `uploadFiles(files: File[]): Promise<ChatAttachment[]>`

### `IProjectContextService`

- `getProjectId(): string`

### `IChatTimelineService`

- `getSnapshot(): ChatTimelineSnapshot`
- `appendUserMessage(input): ChatMessage`
- `startAssistantRun(input): ChatMessage`
- `applyAgentEvent(runId, event): void`
- `finishRun(runId, result): void`

### `IChatSessionService`

- `sendTurn(input): Promise<void>`
- `stopActiveRun(): Promise<void>`
- `answerToolQuestion(toolUseId, content): Promise<void>`

## Source Capability Inventory

The source modules provide more capability than the approved target scope. The migration includes only these approved capabilities:

- timeline rendering for user and assistant messages
- assistant streaming event consumption
- `/search` command expansion
- staged file import and upload
- mention-based context picking for `skills` and `design files`
- assistant block rendering and pinned todo projection

The migration must not bring over these source-only or out-of-scope capabilities:

- plugin application and plugin management surfaces
- analytics, feedback capture, and reporting flows
- connectors, MCP, or working-directory context selection
- unrelated home, project, and settings workflows

## Request / Data / State Flow

### Send flow

1. `ChatComposer` collects draft, staged attachments, and selected context.
2. `ContextPickerService` contributes structured context for `skills` and `design files`.
3. `ChatSessionService.sendTurn()` normalizes the request:
   - handles slash commands
   - uploads staged files via `DesignFileService`
   - appends the user message to `ChatTimelineService`
4. `RunService.createRun()` starts the run.
5. `ChatTimelineService.startAssistantRun()` creates the assistant placeholder.
6. `RunService.streamRun()` emits normalized `AgentEvent` objects.
7. `ChatSessionService` forwards events into `ChatTimelineService.applyAgentEvent()`.
8. `ChatTimelineService` updates the active assistant message and derived pinned todo state.
9. On terminal event, `ChatTimelineService.finishRun()` finalizes status and timestamps.

### `/search` handling

`/search` is normalized in `ChatSessionService`, not in the component. The visible draft remains user-facing UI input, while the actual run prompt becomes the research-first instruction payload.

### Mention/context handling

- `@` search only supports `skills` and `design files`
- visible `@token` insertion is UI feedback, not the protocol of record
- send-time protocol uses structured context generated by `ContextPickerService`

## Assistant Message Rendering

Assistant messages keep raw event history, then derive render blocks through pure transformation functions.

Planned block kinds:

- `text`
- `thinking`
- `tool-group`
- `file-ops`
- `ask-user-question`
- `todo-write`

`TodoWrite` remains special: the latest relevant snapshot is also projected into the pinned todo slot above the composer.

## Source-Plan Alignment Notes

This design intentionally uses the source implementation as a behavioral reference, but the migration plan remains the controlling document for scope and contract stability.

That means:

- source structure is a reference for decomposition and state flow
- source naming is not authoritative for target-owned code
- the migration plan is authoritative for capability boundaries
- target service boundaries are authoritative for implementation expression inside `vibe-design`

## Reused Source Logic

The migration may directly adapt the source behavior of:

- SSE line parsing
- run-event to `AgentEvent` translation
- `/search` expansion rules
- latest todo extraction and pinned todo projection
- file-operation derivation
- assistant event-to-block construction

These will be renamed and reorganized to match `vibe-design` service boundaries.

## Required Rewrites

The migration must not directly copy:

- source component structure wholesale
- source visual styles, class names, icons, or CSS values
- source analytics and telemetry hooks
- source plugin/MCP/connector context systems
- source project/home orchestration

UI should be rebuilt with `@tutti-os/ui-system` public imports only, plus minimal local layout code where the UI system has no exact surface.

## Testing Strategy

### Pure logic tests

- SSE parser
- event translation
- `/search` expansion
- todo parsing / pinned todo projection
- file-op derivation
- message block construction

### Service tests

- `ChatSessionService.sendTurn()` orchestration
- `RunService.streamRun()` handler emission
- `ContextPickerService` selection and snapshot updates
- `DesignFileService.uploadFiles()` normalization and failure handling

### Component tests

- `ChatComposer` mention picker for `skills` and `design files`
- `ChatComposer` staged attachments and `/search` send behavior
- `ChatPane` streaming state and pinned todo slot
- `AssistantMessage` block rendering paths

## Risks And Constraints

- `vibe-design` behavior is broader than the approved target scope, so careful extraction is required to avoid accidental feature carry-over.
- `vibe-design` currently has only a minimal SSR shell, so service registration and app composition will be new work rather than incremental edits.
- Track 4 references `/api/runs*` contracts. Final implementation must preserve external protocol semantics while still hiding transport inside services.

## Non-Goals

- redesigning the chat feature
- broadening context picker sources beyond `skills` and `design files`
- recreating plugin workflows
- introducing new infrastructure unrelated to the chat panel feature
