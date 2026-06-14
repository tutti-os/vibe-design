# Vibe Design Workspace Preview/Inspect Workflow Design

**Date:** 2026-06-02

## 1. References

This design extends the existing `vibe-design` canvas workspace work and incorporates the user-approved first-phase workflow direction from the current discussion.

Authority order for this design:

1. user-approved workflow direction from this conversation
2. repository and `AGENTS.md` constraints
3. existing `vibe-design` Track 5/Track 6 design docs
4. `vibe-design` source implementation as workflow and interaction reference only

- Existing target design docs:
  - `/Users/chovy/Desktop/workspace/vibe-design/docs/superpowers/specs/2026-06-01-vibe-design-canvas-workspace-design.md`
  - `/Users/chovy/Desktop/workspace/vibe-design/docs/superpowers/specs/2026-06-01-vibe-design-track-6-auxiliary-ui-design.md`
- Current target implementation paths:
  - `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasPreview.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- `vibe-design` workflow reference paths:
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/FileWorkspace.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/FileViewer.tsx`
  - `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/ProjectView.tsx`

## 2. User Constraints

The user explicitly chose the following workflow direction during design review:

- borrow the broader `vibe-design` workspace workflow shape, not just the current right-panel visuals
- include:
  - `Preview` mode
  - `Inspect` mode
  - right-side dock panel shape
- do not include comment mode in this phase
- use an explicit top-level `Preview / Inspect` mode switch
- move `Design Files` into workspace tabs instead of keeping a permanent left sidebar
- use a right-side dock panel for inspect editing, not a floating panel
- use a dirty-state confirmation flow when leaving `Inspect` with unsaved changes
- use the fuller inspector surface rather than a minimal temporary editor

## 3. Goal

Upgrade the current Track 5 canvas workspace from a fixed three-column editor into a more general workspace shell that matches the first stage of the approved `vibe-design`-style workflow:

- `Design Files` becomes a workspace surface instead of a permanently mounted left rail
- opened files become workspace tabs
- each previewable file gets an explicit `Preview / Inspect` mode switch
- `Preview` prioritizes the canvas and hides the right dock
- `Inspect` enables node selection and reveals a docked inspector
- unsaved inspect drafts are protected by confirmation when the user leaves the editing context

This phase should create the architectural direction required for later workflow expansion without implementing the full `vibe-design` feature set.

## 4. Scope

### In Scope

- rework `CanvasWorkspace` into a workspace shell with tab-owned surfaces
- make `Design Files` a workspace tab/surface instead of a permanent sidebar
- add explicit `Preview / Inspect` mode state for opened previewable files
- show the current canvas preview in both modes
- show a right-side inspect dock only in `Inspect`
- upgrade the existing inspector into a fuller grouped dock:
  - summary
  - text
  - style
  - layout
- protect unsaved drafts when:
  - switching `Inspect -> Preview`
  - switching tabs
  - closing the active edited tab

### Out Of Scope

- comment mode
- preview annotation overlays
- floating inspector panels
- undo/redo history
- multi-node editing
- file upload/rename/delete behavior redesign
- server persistence for workspace tabs or inspect drafts
- broader `vibe-design` project shell parity

## 5. Required Behavioral Contract

### 5.1 Workspace Surface Contract

- `CanvasWorkspace` owns workspace tab state.
- `Design Files` is represented as a workspace surface rather than a permanently visible side panel.
- File tabs remain the unit of preview/edit context.
- A file tab may render different internal modes without becoming a different workspace tab.

### 5.2 Mode Contract

- Each previewable file surface supports:
  - `Preview`
  - `Inspect`
- `Preview` is the default mode when opening a file tab.
- `Preview` does not allow selection/edit gestures.
- `Inspect` enables hover/selection and reveals the inspect dock.
- Leaving `Inspect` with unsaved changes must not silently discard drafts.

### 5.3 Inspect Contract

- The inspect dock is host-owned UI, not iframe-owned UI.
- The preview bridge continues to own node discovery and selection events.
- The dock continues to edit one selected node at a time.
- The dock groups controls by editing intent instead of exposing a flat list of inputs.

## 6. First-Phase UX Model

### 6.1 Workspace Structure

The workspace shell has three conceptual layers:

1. top workspace tabs
2. file-surface mode switch inside the active previewable tab
3. context-sensitive right dock shown only for inspect mode

This produces the following visible behavior:

- `Design Files` appears as a workspace tab alongside opened files
- opening `landing.html` creates or activates a file tab
- inside `landing.html`, the user sees `Preview / Inspect`
- `Preview` shows the largest possible canvas
- `Inspect` keeps the same canvas but allocates width for a dock

### 6.2 Inspect Dock Structure

The dock contains:

- summary
  - selected node label
  - tag
  - node id or short selector
  - explicit exit action
- text
  - editable text field
- style
  - color
  - background color
  - font size
  - font weight
  - line height
  - text align
- layout
  - padding
  - border radius
  - opacity
- actions
  - `Cancel`
  - `Save`

### 6.3 Empty And Transition States

- In `Preview`, the dock is absent.
- In `Inspect` with no selection, the dock is visible and explains how to select a node.
- In `Inspect` with a selection, the dock shows the current editable draft.
- If the draft is dirty and the user attempts to leave inspect context, the UI must block that transition behind confirmation.

## 7. Architecture

### 7.1 WorkspaceShell

Introduce a stronger shell boundary inside the existing feature:

- owns workspace tabs
- decides which workspace surface is active
- routes dirty-guard decisions
- owns active file mode state

This can remain inside `CanvasWorkspace.tsx` initially or be extracted into a new local component if the file becomes too large.

### 7.2 WorkspaceSurface

The active tab resolves to one of two surface kinds:

- `design-files`
- `file-preview`

`design-files` renders the current file browser surface.

`file-preview` renders:

- mode switch
- preview canvas
- optional inspect dock

### 7.3 Preview Canvas

`CanvasPreview` stays responsible for:

- dual iframe rendering behavior
- bridge lifecycle
- target inventory
- hover and selection signals
- applying committed edits back into host HTML

It must not own:

- mode transitions
- dirty confirmation logic
- dock visibility rules

### 7.4 Inspect Dock

The existing `CanvasInspectorPanel` should evolve into a dock-oriented component with grouped sections and dirty-state awareness.

Responsibilities:

- render empty, selected, and dirty states
- collect draft edits
- normalize values
- emit preview-draft and save/cancel intents

It must not own:

- workspace tab routing
- confirmation modal state
- iframe bridge control

## 8. State Model

### 8.1 Workspace-Level State

```ts
type WorkspaceSurfaceKey = typeof DESIGN_FILES_TAB | string;
type FileSurfaceMode = 'preview' | 'inspect';
```

Workspace-owned state:

- `activeTabKey`
- `tabsState`
- per-file `modeByTabKey`
- pending navigation intent for dirty confirmation

### 8.2 Inspect-Level State

Per active preview file:

- `hoveredTarget`
- `selectedTarget`
- `draft`
- `draftBaseline`
- `isDirty`

The authoritative dirty state is host-derived by comparing the current draft against the active selected target baseline, not by trusting child component local flags.

### 8.3 Guarded Transitions

The following transitions require a dirty check:

- `inspect -> preview`
- active edited tab -> another tab
- close active edited tab

If `isDirty === false`, the transition proceeds immediately.

If `isDirty === true`, the user sees a confirmation surface with:

- continue editing
- discard changes

This is intentionally narrower than a generic browser-style three-way dialog. There is no save-as-part-of-navigation flow in phase one.

## 9. Source To Target Mapping

| Workflow reference | Target concept |
| --- | --- |
| `FileWorkspace` shell workflow | `CanvasWorkspace` shell workflow |
| `Design Files` workspace surface | `Design Files` workspace tab |
| file viewer mode switch | `Preview / Inspect` switch |
| inspect side dock behavior | right-side `CanvasInspectorPanel` dock |
| comment side dock lifecycle | future extension, intentionally excluded |

This is a workflow mapping, not a file-copy plan. The target code should continue using `vibe-design` naming and existing feature boundaries where possible.

## 10. Target File Impact

Primary expected changes:

```text
/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/
  CanvasWorkspace.tsx
  CanvasWorkspace.test.tsx
  CanvasInspectorPanel.tsx
  CanvasInspectorPanel.test.tsx
  canvas-workspace-types.ts
  canvas-workspace-tabs.ts
```

Possible new local helpers:

```text
/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/
  workspace-mode.ts
  workspace-dirty-guard.ts
```

These helper names are illustrative; the exact file split can stay smaller if clarity is preserved.

## 11. Interaction Flow

1. User opens the workspace and sees `Design Files` as the active workspace tab.
2. User opens `landing.html`.
3. The workspace activates the `landing.html` file tab in `Preview`.
4. The user switches to `Inspect`.
5. The shell enables inspect behavior and reveals the dock.
6. The user hovers and selects a node in the preview.
7. The dock populates editable controls for that node.
8. The user edits values.
9. If the user clicks `Save`, the host applies the change and clears dirty state.
10. If the user leaves inspect context while dirty, the shell blocks the transition and asks for confirmation.

## 12. Testing Strategy

### 12.1 Workspace Tests

`CanvasWorkspace.test.tsx` should cover:

- `Design Files` rendered as a workspace tab surface
- opening a file moves the user into a file tab rather than keeping a permanent left rail
- file tabs default to `Preview`
- switching to `Inspect` reveals the dock
- switching back to `Preview` hides the dock when clean
- dirty inspect changes trigger confirmation on:
  - mode switch
  - tab switch
  - tab close

### 12.2 Inspect Dock Tests

`CanvasInspectorPanel.test.tsx` should cover:

- empty inspect state
- grouped controls rendered for a selected target
- grouped fields emit preview/save payloads correctly
- cancel resets draft to baseline

### 12.3 Preview Tests

`CanvasPreview.test.tsx` should remain focused on bridge/rendering behavior, but one or two cases may be added if needed to prove selection state still works under explicit inspect mode gating.

## 13. Risks And Mitigations

- Risk: `CanvasWorkspace.tsx` becomes oversized while absorbing shell logic.
  - Mitigation: extract mode and dirty-guard helpers once the branching becomes hard to read.
- Risk: dirty detection drifts from the actual saved HTML state.
  - Mitigation: derive the baseline from the active selected target after every accepted save.
- Risk: hiding the permanent file rail makes file discovery worse if the `Design Files` tab is hard to reach.
  - Mitigation: keep `Design Files` as a first-class, always-available workspace tab.
- Risk: users may perceive `Inspect` as broken if no selection hint is visible.
  - Mitigation: provide a clear empty dock message and visible preview hover affordance.

## 14. Deliberate Non-Goals

This phase intentionally does not:

- recreate the full `vibe-design` comment workflow
- introduce floating edit panels
- persist inspect drafts across reloads
- redesign backend project storage or API contracts
- generalize the workspace shell beyond the current canvas-workspace feature boundary

Those remain follow-up work once the `Preview / Inspect` workflow is stable.
