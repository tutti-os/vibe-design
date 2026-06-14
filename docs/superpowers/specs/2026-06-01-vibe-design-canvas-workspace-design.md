# Vibe Design Canvas Workspace Migration Design

**Date:** 2026-06-01

## 1. References

This design is based on the user-provided migration brief and the Track 5 canvas rendering plan:

- Migration brief: replicate the relevant module logic from `/Users/chovy/Desktop/workspace/vibe-design` into `/Users/chovy/Desktop/workspace/vibe-design`, using Superpowers workflows.
- Track plan: `/Users/chovy/Desktop/track-5-canvas-render.md`
- Source implementation paths:
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/FileWorkspace.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/FileViewer.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/ManualEditPanel.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/runtime/srcdoc.ts`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/edit-mode/bridge.ts`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/edit-mode/types.ts`
- Source tests used as behavior references:
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/components/FileWorkspace.test.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/components/FileViewer.test.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/components/ManualEditPanel.test.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/edit-mode/bridge.test.ts`

## 2. User Constraints

This design must follow both the Track 5 plan intent and the user's added constraints:

- Migrate the Track 5 core canvas rendering chain only.
- Do not build missing project shells or server orchestration first.
- Use `vibe-design` domain naming instead of carrying `vibe-design` naming into the target implementation.
- Do not migrate unrelated `vibe-design` product behavior.
- Keep the implementation minimal, structurally close to the source behavior, but rewritten so the code reads as native `vibe-design`.

## 3. Migration Goal

Implement a minimal but working Track 5 canvas workspace inside `vibe-design/web` that covers:

- file-tab workspace coordination
- HTML preview rendering with URL vs srcdoc mode switching
- iframe-injected canvas edit bridge
- host-side inspector panel for editable node selection and basic edits

The result should reproduce the source behavior pattern for the Track 5 chain while intentionally excluding broader `vibe-design` workspace product features.

## 4. Scope

### In Scope

- Workspace tab container for file tabs
- Fixed workspace root tab for file browsing
- File preview component with dual iframe strategy
- srcdoc builder that injects the canvas edit bridge and style
- iframe bridge script and message types
- host-side inspector panel
- pure helpers for tab state and HTML edit application
- focused tests proving the chain works end to end

### Out Of Scope

- `DesignSystemFlow`
- analytics, i18n, telemetry, page-view tracking
- daemon or API persistence for tabs state
- upload, rename, delete, paste, server-backed file writing
- live artifacts
- sketch editor
- comments, draw annotations, deck navigation, palette tweaks
- project-level launch UX beyond the minimal web app wiring required to render the migrated components

## 5. Required Behavioral Contract

The Track 5 plan defines the behavior shape to preserve:

- A workspace owns tab state and switches preview content by active tab.
- A preview can render either by direct URL load or by generated `srcdoc`.
- `srcdoc` mode is required when host-injected bridge behavior is active.
- The injected bridge discovers editable nodes, assigns stable ids, and emits host messages for hover, selection, target inventory, and text commit.
- The host inspector reflects the selected node and allows safe basic edits.

Because the user explicitly requested `vibe-design` naming, the implementation will preserve the behavior contract but rename the internal and iframe message protocol from `od-*` to `vd-*`.

This is an intentional divergence from the source naming, not from the behavior.

## 6. Source To Target Mapping

| Source concept | Target concept |
| --- | --- |
| `FileWorkspace` | `CanvasWorkspace` |
| `FileViewer` | `CanvasPreview` |
| `ManualEditPanel` | `CanvasInspectorPanel` |
| `OpenTabsState` | `WorkspaceTabsState` |
| `ProjectFile` | `WorkspaceFile` |
| `ManualEditTarget` | `EditableNode` |
| `buildSrcdoc` | `buildPreviewSrcdoc` |
| `buildManualEditBridge` | `buildCanvasEditBridge` |
| `od-edit-*` messages | `vd-edit-*` messages |
| `data-od-id` | `data-vd-id` |
| `data-od-source-path` | `data-vd-source-path` |

## 7. Target File Layout

The migrated code will live under:

```text
/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/
  CanvasWorkspace.tsx
  CanvasWorkspace.test.tsx
  CanvasPreview.tsx
  CanvasPreview.test.tsx
  CanvasInspectorPanel.tsx
  CanvasInspectorPanel.test.tsx
  canvas-workspace-types.ts
  canvas-workspace-tabs.ts
  runtime/
    build-preview-srcdoc.ts
    build-preview-srcdoc.test.ts
  canvas-edit/
    bridge.ts
    bridge.test.ts
    types.ts
    apply-html-edit.ts
```

This keeps the feature self-contained and avoids leaking Track 5 internals into unrelated folders while still matching the service and feature boundaries expected by `vibe-design/web`.

## 8. Architecture

### 8.1 CanvasWorkspace

`CanvasWorkspace` is the host-side coordinator.

Responsibilities:

- own `WorkspaceTabsState`
- render a fixed root tab plus dynamic file tabs
- open, activate, close, and reorder file tabs
- resolve the active `WorkspaceFile`
- pass preview state into `CanvasPreview`
- receive selection and edit events from `CanvasPreview`
- pass selected node state into `CanvasInspectorPanel`

It will not own server persistence or broader project workflows.

### 8.2 CanvasPreview

`CanvasPreview` is the rendering and bridge host.

Responsibilities:

- decide between `url` and `srcdoc` render mode
- maintain dual iframe refs
- generate `srcdoc` with bridge injection when edit mode is active
- listen for `vd-edit-*` postMessage traffic
- translate bridge messages into React state updates
- apply text edits back into the current HTML source using pure helpers

This component keeps document mutation logic outside the panel so UI editing remains a consumer of preview state rather than the owner of DOM rewriting.

### 8.3 CanvasInspectorPanel

`CanvasInspectorPanel` is a presentational editor surface using `@tutti-os/ui-system`.

Responsibilities:

- show hovered and selected node metadata
- expose text and a small set of style-edit controls
- normalize and validate draft values before emitting them
- provide save and cancel actions for the current draft

It will not know about iframe details, postMessage transport, or file/tab orchestration.

### 8.4 Runtime And Bridge

`buildPreviewSrcdoc` and `canvas-edit/bridge.ts` hold the iframe-side runtime behavior.

Responsibilities:

- ensure HTML fragments become full documents
- annotate missing stable source markers when needed
- inject bridge style and bridge script in the correct order
- discover editable nodes
- compute stable ids without depending on React or npm packages
- emit `vd-edit-targets`, `vd-edit-hover`, `vd-edit-select`, and `vd-edit-text-commit`

The bridge remains self-contained and dependency-free because it executes inside the iframe document.

## 9. Data Flow

1. `CanvasWorkspace` receives `files`, optional initial tabs, and optional starting HTML.
2. User opens a file tab or activates an existing tab.
3. `CanvasWorkspace` resolves the active file and renders `CanvasPreview`.
4. `CanvasPreview` decides render mode:
   - use `url` for normal preview
   - switch to `srcdoc` when canvas edit bridge behavior is enabled
5. In `srcdoc` mode, `buildPreviewSrcdoc` injects bridge script and style.
6. The iframe bridge scans editable nodes and posts `vd-edit-*` messages to the host.
7. `CanvasPreview` captures those messages and updates selected/hovered node state.
8. `CanvasWorkspace` passes node state into `CanvasInspectorPanel`.
9. User edits text or basic styles in the panel.
10. `CanvasPreview` applies the accepted edit to the HTML string and rebuilds the preview.

## 10. Types

The target feature will define a minimal local type system instead of importing `vibe-design` contracts.

### 10.1 Workspace Types

```ts
export type WorkspaceFileKind = 'html' | 'image' | 'text';

export interface WorkspaceFile {
  name: string;
  path: string;
  kind: WorkspaceFileKind;
  mime: string;
  contents?: string;
  url?: string;
}

export interface WorkspaceFileTab {
  kind: 'file';
  key: string;
  name: string;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceFileTab[];
  activeTabKey: string | null;
}
```

### 10.2 Canvas Edit Types

```ts
export interface EditableNodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditableNode {
  id: string;
  kind: 'text' | 'image' | 'link' | 'container';
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: EditableNodeRect;
  fields: Record<string, string>;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  isLayoutContainer: boolean;
  isHidden?: boolean;
  outerHtml?: string;
}
```

### 10.3 Host/Bridge Message Types

```ts
export type CanvasEditBridgeMessage =
  | { type: 'vd-edit-targets'; targets: EditableNode[] }
  | { type: 'vd-edit-hover'; target: EditableNode | null }
  | { type: 'vd-edit-select'; target: EditableNode | null }
  | { type: 'vd-edit-text-commit'; id: string; value: string }
  | { type: 'vd-edit-preview-style-applied'; id: string };

export type CanvasEditHostCommand =
  | { type: 'vd-edit-selected-target'; id: string | null }
  | { type: 'vd-edit-preview-style'; id: string; styles: Record<string, string> };
```

## 11. Protocol Decisions

The migration plan behavior is preserved, but naming is adapted to the target system:

- `vd-edit-targets`: iframe sends the current editable-node inventory
- `vd-edit-hover`: iframe sends the hovered node
- `vd-edit-select`: iframe sends the selected node
- `vd-edit-text-commit`: iframe sends text edits committed inside the preview
- `vd-edit-selected-target`: host tells the iframe which node should be highlighted as selected
- `vd-edit-preview-style`: host sends temporary inspector style patches for live preview
- `vd-edit-preview-style-applied`: iframe acknowledges that a temporary style preview was applied

Target DOM markers:

- `data-vd-id`
- `data-vd-source-path`
- `data-vd-runtime-id`

These names replace the `vibe-design` equivalents everywhere in the migrated feature.

## 12. What Will Be Reused vs Rewritten

### Reused Behavior Patterns

- tab state coordination logic
- dual-iframe render strategy
- `srcdoc` wrapping and injection order
- stable DOM-path based id generation
- hidden/layout node detection
- core bridge test scenarios

### Rewritten For Vibe Design

- all feature, type, component, function, and test naming
- all iframe message and DOM data-attribute naming
- host-side props and state boundaries
- UI rendering with `@tutti-os/ui-system`
- file model definitions
- HTML edit application helpers

### Explicitly Excluded

- source analytics and tracking hooks
- source registry/provider calls
- product-specific side panels and review flows
- non-Track-5 branches embedded in the source `FileViewer`

## 13. UI System Mapping

The source `ManualEditPanel` visual implementation will not be copied directly.

Target UI mapping:

- panel shell -> UI-system surface/card primitives
- actions -> UI-system buttons
- field groups -> UI-system input/select/form primitives where available
- icons -> UI-system icons only
- spacing/color/typography -> UI-system tokens and styles

If a needed inspector layout detail is not covered by an existing UI-system primitive, a small local wrapper style may be added, but only around composition and layout, not around a new local component system.

`@tutti-os/ui-system/styles.css` must be loaded once from the web app entry if it is not already loaded by the current shell path used for this feature.

## 14. Testing Strategy

The migrated feature will be validated with a focused test set that proves the Track 5 chain works without recreating the entire source test matrix.

### Bridge Tests

- stable id prefers `data-vd-id`
- DOM path generation ignores host-injected nodes
- source-path requirement is enforced
- hidden and layout container detection behaves correctly
- emitted `vd-edit-*` messages have the expected shape

### Srcdoc Builder Tests

- wraps fragments into full documents
- preserves full documents
- injects bridge style and script
- keeps `data-vd-source-path` annotation behavior intact

### CanvasPreview Tests

- URL mode renders the URL iframe
- edit mode switches to srcdoc iframe
- incoming bridge messages update host state
- text commit updates preview HTML

### CanvasWorkspace Tests

- open, activate, close, and reorder file tabs
- fixed root tab remains stable
- active tab resolves the correct file

### CanvasInspectorPanel Tests

- selected node title rendering
- draft update and normalization
- save and cancel callbacks
- basic invalid-style rejection

## 15. Risks And Mitigations

### Risk: Source `FileViewer` Is Much Broader Than Track 5

Mitigation:

- migrate only the branches required for file preview and manual edit bridge behavior
- keep tests aligned to the trimmed scope

### Risk: Naming Rewrite Accidentally Changes Behavior

Mitigation:

- preserve source control flow where behavior is subtle
- port the source bridge tests first and rename them to `vibe-design`

### Risk: UI-System Composition Does Not Match Source Panel Layout Exactly

Mitigation:

- preserve information hierarchy and edit flow
- allow minimal feature-local layout styles where token-backed composition alone is insufficient

## 16. Implementation Exit Criteria

This design is complete when:

- the Track 5 chain exists inside `vibe-design/web`
- migrated code uses `vibe-design` naming rather than `vibe-design` naming
- no unrelated `vibe-design` product behavior is pulled in
- tests cover the trimmed behavior contract
- `pnpm --filter @vibe-design/web test`
- `pnpm --filter @vibe-design/web type-check`

both pass after implementation.
