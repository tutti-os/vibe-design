# Vibe Design Track 6 Auxiliary UI Migration Design

**Date:** 2026-06-01

## 1. References

This design is based on the user request to replicate the relevant Track 6 module behavior from `vibe-design` into `vibe-design` using Superpowers workflows.

Authority order for this migration:

1. user-provided Track 6 migration brief
2. repository and `AGENTS.md` constraints
3. `vibe-design` source implementation as behavior reference only

- Migration brief:
  - `/Users/chovy/Desktop/track-6-auxiliary-ui.md`
- Source implementation paths:
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/runtime/generation-preview.ts`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/runtime/todos.ts`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/GenerationPreviewStage.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/GenerationPreviewStage.module.css`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/DesignFilesPanel.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/LiveArtifactBadges.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/FileWorkspace.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/types.ts`
- Source tests used as behavior references:
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/runtime/generation-preview.test.ts`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/components/DesignFilesPanel.test.tsx`

## 2. User Constraints

The user explicitly constrained this migration as follows:

- The user-provided Track 6 brief is the normative migration scheme.
- The target implementation must follow that scheme's module boundaries, interface contracts, and behavior scope.
- `vibe-design` source code is a reference for logic, state flow, and interaction coverage, not a file-copy source of truth.
- Migrate Track 6 auxiliary UI behavior only.
- Do not implement the missing `FileWorkspace` shell in this pass.
- Migrate UI plus local interaction logic, not presentation only.
- Keep behavior aligned with `vibe-design`, but rebuild visuals and structure to fit `vibe-design`.
- Use `@tutti-os/ui-system` instead of preserving `vibe-design` local visual primitives.
- Add only the minimum local types and helpers needed so the migrated UI compiles and can be tested independently.
- Bring over only the minimum necessary tests:
  - `generation-preview` pure runtime coverage
  - core `DesignFilesPanel` behavior coverage

## 3. Migration Goal

Implement a self-contained Track 6 feature slice inside `vibe-design/web` that reproduces the source behavior for:

- generation preview state derivation
- generation progress stage presentation
- design files panel browsing and local interaction
- live artifact badge rendering

The output of this migration is intentionally not a complete workspace screen. It is a set of independently compilable and testable UI/runtime modules that the user will wire into a later workspace shell.

## 3.1 Scheme Compliance Rule

This spec follows the user-provided Track 6 brief as the governing design document.

That means:

- the migration target is specifically F4 `GenerationPreviewStage` plus F7 `DesignFilesPanel`
- the file layout and interfaces from the brief define what must exist
- the external integration boundary remains the parent workspace shell, not the migrated components
- fields, state meanings, and localStorage key semantics named in the brief are treated as contract

Where `vibe-design` differs from the brief, the brief wins.

## 4. Scope

### In Scope

- minimal local domain types required by Track 6
- TodoWrite parsing used by generation progress UI
- generation preview state derivation logic
- `GenerationPreviewStage` component
- `DesignFilesPanel` component
- `LiveArtifactBadges` component
- localStorage-backed design files panel view state
- core list interactions:
  - group mode switching
  - sorting
  - pagination
  - directory navigation
  - multi-select
  - batch delete callback dispatch
- focused tests for the above

### Out Of Scope

- `FileWorkspace`
- tab orchestration and preview-surface host integration
- analytics
- i18n infrastructure
- provider URL builders and server-backed file APIs
- upload transport, rename transport, delete transport implementation
- sketch document remote preview fetch flow
- design-system project variants and broader product-specific workspace rules

## 5. Required Behavioral Contract

The migration preserves the Track 6 internal behavior contract even though the outer shell is intentionally absent.

### 5.1 Generation Preview Contract

- A pure runtime function derives preview overlay state from:
  - `messages`
  - `streaming`
  - `activeTab`
  - `projectFiles`
  - `liveArtifacts`
  - optional `artifactHtml`
  - optional `conversationError`
- The derived state must preserve source-level behavior for:
  - preview-surface suppression when a previewable file is already visible
  - three-step generation progress derivation
  - generating, awaiting-input, stopped, and failed phases
  - TodoWrite-derived task progress
  - failed-run retry target selection

The user-provided Track 6 brief further constrains this contract:

- the public entrypoint remains `buildGenerationPreviewState(...)`
- the generated state is caller-owned render input for `GenerationPreviewStage`
- the generation preview module is not allowed to own workspace orchestration or API calls
- the implementation must preserve the three-step generation interpretation described by the brief even if internal helper names differ

### 5.2 Design Files Panel Contract

- `DesignFilesPanel` remains caller-owned for data and commands.
- The panel accepts `files`, `liveArtifacts`, and handler props from its parent.
- The panel owns only local interaction and local persistent view state.
- The localStorage key remains:
  - `od:design-files:view-state:v1:{projectId}`

This key is intentionally preserved for behavioral parity and easier source-target comparison during follow-up integration.

The user-provided Track 6 brief further constrains this contract:

- `DesignFilesPanel` must not fetch files directly
- all open, delete, upload, and refresh actions remain parent callbacks
- the panel owns view state only:
  - grouping
  - sorting
  - pagination
  - selection
  - directory navigation
  - localStorage persistence
- live artifact display remains a child-UI concern, not a data-loading concern

### 5.3 UI System Contract

- Visual implementation must use stable public imports from `@tutti-os/ui-system`.
- Source visual classes, local icons, and raw design tokens from `vibe-design` must not be copied as the target visual system.
- Caller-owned business state remains outside shared UI primitives.

## 6. Source To Target Mapping

| Source concept | Target concept |
| --- | --- |
| `AgentEvent` | `AgentEvent` |
| `ChatMessage` | `ChatMessage` |
| `ProjectFile` | `ProjectFile` |
| `LiveArtifactWorkspaceEntry` | `LiveArtifactWorkspaceEntry` |
| `buildGenerationPreviewState` | `buildGenerationPreviewState` |
| `GenerationPreviewModel` | `GenerationPreviewModel` |
| `DesignFilesPanel` | `DesignFilesPanel` |
| `LiveArtifactBadges` | `LiveArtifactBadges` |
| `latestTodosFromEvents` | `latestTodosFromEvents` |
| `TodoItem` | `TodoItem` |

No renaming is required for these internal feature concepts because they remain accurate in the target domain and are not tied to `vibe-design` branding.

## 6.1 Scheme-Derived External Interfaces

The following interfaces are treated as externally stable because the user asked that the implementation follow the provided scheme design.

### Generation Preview Inputs

```ts
buildGenerationPreviewState(input: {
  designSystemProject: boolean;
  messages: ChatMessage[];
  streaming: boolean;
  activeTab: string | null;
  projectFiles: ProjectFile[];
  liveArtifacts: LiveArtifactWorkspaceEntry[];
  artifactHtml?: string | null;
  conversationError?: string | null;
}): (GenerationPreviewModel & { retryTarget: ChatMessage | null }) | null
```

### Generation Preview Component Boundary

```ts
interface GenerationPreviewStageProps {
  model: GenerationPreviewModel;
  onRetry?: (() => void) | undefined;
}
```

### Design Files Panel Boundary

```ts
interface DesignFilesPanelProps {
  projectId: string;
  files: ProjectFile[];
  liveArtifacts: LiveArtifactWorkspaceEntry[];
  onRefreshFiles: () => Promise<void> | void;
  onOpenFile: (name: string) => void;
  onOpenLiveArtifact: (tabId: LiveArtifactWorkspaceEntry['tabId']) => void;
  onRenameFile: (from: string, to: string) => Promise<ProjectFile | null> | ProjectFile | null;
  onDeleteFile: (name: string) => void;
  onDeleteFiles: (names: string[]) => Promise<void> | void;
  onUpload: () => void;
  onUploadFiles: (files: File[]) => void;
  onPaste: () => void;
  onNewSketch: () => void;
  uploadError?: string | null;
}
```

These interfaces may be implemented with smaller internal helpers, but the public feature boundary should match the scheme unless a later approved spec revision changes it.

## 7. Target File Layout

The migrated Track 6 slice will live under `vibe-design/web/src` in a self-contained layout:

```text
/Users/chovy/Desktop/workspace/vibe-design/web/src/
  types.ts
  runtime/
    todos.ts
    generation-preview.ts
    generation-preview.test.ts
  components/
    GenerationPreviewStage.tsx
    GenerationPreviewStage.module.css
    LiveArtifactBadges.tsx
    DesignFilesPanel.tsx
    DesignFilesPanel.test.tsx
```

This keeps the migration independent from future shell work while matching the current `vibe-design/web` size and avoiding premature feature-folder ceremony.

## 8. Architecture

### 8.1 Minimal Local Domain Types

`web/src/types.ts` will define only the subset needed by Track 6.

Required minimum shapes:

- `AgentEvent`
  - `status`
  - `text`
  - `thinking`
  - `tool_use`
- `ChatMessage`
  - `id`
  - `role`
  - `content`
  - `runStatus`
  - `startedAt`
  - `createdAt`
  - `endedAt`
  - `events`
- `ProjectFile`
  - `name`
  - `path`
  - `size`
  - `mtime`
  - `kind`
  - `mime`
- `LiveArtifactWorkspaceEntry`
  - `tabId`
  - `artifactId`
  - `projectId`
  - `title`
  - `status`
  - `refreshStatus`
  - `preview`
  - `updatedAt`

The file must not import `vibe-design` contracts or copy unrelated product types.

### 8.2 Runtime: Todo Parsing

`runtime/todos.ts` exists only to support generation preview logic.

Responsibilities:

- detect TodoWrite-like tool names
- parse TodoWrite payloads into normalized `TodoItem[]`
- compute the latest todo plan from streamed events

This helper remains pure and framework-free.

### 8.3 Runtime: Generation Preview

`runtime/generation-preview.ts` is the behavior-critical module.

Responsibilities:

- detect whether the current workspace state already has a preview surface
- derive generation steps from streamed assistant events
- collapse runtime state into a render-ready model
- surface:
  - `phase`
  - `steps`
  - `progressPercent`
  - `activityLabel`
  - `detailLabel`
  - `todoProgress`
  - `retryTarget`

It remains a pure runtime projection layer with no React or DOM dependency.

This module is guided first by the Track 6 brief's F4 contract and second by the source runtime logic. The migration must preserve brief-defined meanings before preserving source implementation details.

### 8.4 GenerationPreviewStage

`GenerationPreviewStage.tsx` is presentation only.

Responsibilities:

- consume the derived generation preview model
- render stage title, progress bar, steps, and failure affordance
- map phase/status to UI-system-compatible surface styling

This component must not inspect raw messages or events directly.

### 8.5 LiveArtifactBadges

`LiveArtifactBadges.tsx` remains a small presentational helper.

Responsibilities:

- render status badges from `status` and `refreshStatus`
- expose a compact mode
- avoid domain side effects

### 8.6 DesignFilesPanel

`DesignFilesPanel.tsx` is the largest Track 6 component.

Responsibilities:

- render files and live artifacts from caller-owned props
- keep local view state:
  - group mode
  - sort key
  - sort direction
  - page size
  - file-kind filter
  - current directory
  - current selection
- persist stable view preferences to localStorage
- drive callbacks upward for:
  - open
  - rename
  - delete
  - batch delete
  - upload trigger
  - upload files
  - paste trigger
  - open live artifact

This component must not build URLs, call APIs, or own workspace tabs.

This boundary directly follows the Track 6 brief's statement that `DesignFilesPanel` is a child UI of the parent workspace shell and owns view state only.

## 9. Data Flow

### 9.1 Generation Preview

1. Parent shell provides `messages`, `projectFiles`, `liveArtifacts`, `activeTab`, and optional `artifactHtml`.
2. `buildGenerationPreviewState(...)` evaluates whether the workspace already has something previewable.
3. If preview already exists and the run is not failed, the overlay is suppressed.
4. Otherwise, the latest assistant message is inspected.
5. Events are scanned for:
   - status progression
   - text/thinking activity
   - TodoWrite progress
   - write-like tool targets
   - error/failure signals
6. The returned model is rendered by `GenerationPreviewStage`.

### 9.2 Design Files Panel

1. Parent shell passes a flat `files` list and `liveArtifacts`.
2. `DesignFilesPanel` derives:
   - visible directory rows
   - current directory file rows
   - filtered file rows
   - grouped sections
   - paginated rows
3. Local interactions mutate only local UI state.
4. Action buttons and double-click open actions call parent callbacks.
5. Persistent view preferences are written back to localStorage.

## 10. UI Design Direction

The target visual result should preserve information hierarchy and interaction flow from `vibe-design`, but not its local visual implementation.

### 10.1 What Will Be Preserved

- generation stage hierarchy:
  - mark/icon
  - title
  - live progress
  - step list
  - sub-status / todo count
- design files panel information density
- group and pagination affordances
- live artifact placement
- row-level selection and bulk actions

### 10.2 What Will Be Rewritten

- local CSS token usage
- raw palette choices
- source icon usage
- panel/button visual treatment
- source-specific class naming conventions where UI-system composition is more appropriate

### 10.3 UI System Mapping

Planned mapping to `@tutti-os/ui-system`:

- panel shells -> UI-system surface/card primitives where available
- actions -> UI-system button primitives
- status marks -> UI-system icon exports and token-backed status styling
- compact metadata pills -> token-backed local wrappers around UI-system surface primitives

If a perfect matching component is not available, the migration will compose simple semantic HTML with UI-system tokens rather than copying `vibe-design` primitives.

## 11. Testing Strategy

### 11.1 Runtime Tests

`generation-preview.test.ts` will cover:

- preview-surface detection
- step derivation from events
- generating-state derivation
- failed-state derivation
- awaiting-input derivation
- retry-target selection

These tests stay pure and do not depend on jsdom.

### 11.2 Component Tests

`DesignFilesPanel.test.tsx` will cover the minimum necessary behavior baseline:

- kind grouping
- modified-date grouping
- modified-date boundary behavior
- default pagination behavior
- page navigation behavior
- localStorage-backed view-state persistence
- multi-select and batch delete callback dispatch
- directory navigation

The goal is not full source-test parity. The goal is to lock the migrated behavioral contract without importing `vibe-design`-specific implementation details.

## 12. Implementation Boundaries

The migration must explicitly avoid these source dependencies:

- `useT` and source i18n dictionaries
- analytics tracking hooks
- provider registry helpers
- server-backed preview helpers
- `SketchPreview`
- `FileWorkspace`

Where source code depends on those systems, the target implementation must:

- remove the dependency if the behavior is not essential to Track 6
- replace it with caller-owned props if a callback boundary is sufficient
- keep the internal behavior pure and local if no external dependency is required

The migration must also avoid these scheme violations:

- no direct `FileWorkspace` recreation in this pass
- no expansion beyond F4 and F7 capability scope
- no protocol drift for the localStorage key or agreed component props
- no carrying over `vibe-design`-specific visual primitives as the target design system

## 13. Risks And Mitigations

### Risk 1: Hidden `vibe-design` Shell Coupling

The source components assume a larger workspace environment.

Mitigation:

- define a strict local type subset
- keep runtime helpers pure
- avoid importing any source shell-level modules

### Risk 2: Over-Migrating Source Product Details

The source `DesignFilesPanel` includes behaviors tied to broader product infrastructure.

Mitigation:

- migrate only behaviors already confirmed as in-scope
- drop analytics/i18n/provider concerns
- prefer caller-owned callbacks over inline integrations

### Risk 3: UI-System Drift From Source Hierarchy

Rebuilding visuals with `@tutti-os/ui-system` can accidentally change interaction clarity.

Mitigation:

- preserve source information hierarchy and action flow
- rewrite only the visual language and primitive selection
- keep tests focused on behavioral semantics, not source DOM shape

## 14. Success Criteria

This design is complete when the implementation can demonstrate:

- Track 6 runtime helpers compile independently inside `vibe-design/web`
- generation preview logic is covered by focused runtime tests
- design files panel supports the agreed local interaction subset
- visual implementation uses `@tutti-os/ui-system` conventions rather than copied source primitives
- no `FileWorkspace` shell is required for the migrated modules to compile and test
