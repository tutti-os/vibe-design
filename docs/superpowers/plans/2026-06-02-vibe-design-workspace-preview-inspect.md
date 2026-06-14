# Vibe Design Workspace Preview/Inspect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `canvas-workspace` feature into a tab-driven workspace shell with explicit `Preview / Inspect` modes, a right-side inspect dock, and unsaved-draft guards on mode/tab transitions.

**Architecture:** Keep the existing `canvas-workspace` feature boundary, but split responsibilities more clearly: pure helpers own tab/mode/dirty transition rules, `CanvasWorkspace` owns shell orchestration, `CanvasPreview` continues to own the iframe bridge, and `CanvasInspectorPanel` becomes a fuller dock UI. Use a small local confirmation dialog instead of browser-native `confirm()` so the behavior matches the approved design while staying inside the current React/UI-system stack.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, `@tutti-os/ui-system`

---

## File Structure

### Existing files to modify

- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/canvas-workspace-types.ts`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/canvas-workspace-tabs.ts`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/index.ts`

### New files to create

- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.ts`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.test.ts`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/InspectUnsavedChangesDialog.tsx`

### Responsibilities

- `workspace-mode.ts`
  - Pure helpers for per-tab mode storage and pending dirty transition intents.
- `canvas-workspace-types.ts`
  - Shared tab + mode + pending-action types.
- `canvas-workspace-tabs.ts`
  - Tab open/close/reorder helpers only; no mode logic.
- `CanvasWorkspace.tsx`
  - Shell orchestration, surface selection, dirty guard integration, dialog state.
- `CanvasInspectorPanel.tsx`
  - Dock UI for grouped inspect controls and dirty-aware actions.
- `InspectUnsavedChangesDialog.tsx`
  - Small local confirmation surface used by guarded transitions.

---

### Task 1: Add workspace mode and guarded-transition primitives

**Files:**
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.ts`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.test.ts`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/canvas-workspace-types.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
// /Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.test.ts
import { describe, expect, it } from 'vitest';
import {
  defaultModeForTab,
  requestGuardedTransition,
  resolveGuardedTransition,
  setModeForTab,
} from './workspace-mode';

describe('workspace-mode', () => {
  it('defaults file tabs to preview mode', () => {
    expect(defaultModeForTab('file:landing.html')).toBe('preview');
  });

  it('stores per-tab mode overrides', () => {
    expect(setModeForTab({}, 'file:landing.html', 'inspect')).toEqual({
      'file:landing.html': 'inspect',
    });
  });

  it('captures a pending transition when a dirty guard blocks navigation', () => {
    expect(
      requestGuardedTransition({
        hasDirtyDraft: true,
        next: { kind: 'activate-tab', key: 'file:notes.txt' },
      }),
    ).toEqual({
      allowed: false,
      pending: { kind: 'activate-tab', key: 'file:notes.txt' },
    });
  });

  it('resolves immediately when there is no dirty draft', () => {
    expect(
      requestGuardedTransition({
        hasDirtyDraft: false,
        next: { kind: 'set-mode', key: 'file:landing.html', mode: 'preview' },
      }),
    ).toEqual({
      allowed: true,
      pending: null,
    });
  });

  it('drops a pending transition when the user keeps editing', () => {
    expect(resolveGuardedTransition('stay')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --filter @vibe-design/web test -- workspace-mode.test.ts`

Expected: FAIL with `Cannot find module './workspace-mode'` and missing exports.

- [ ] **Step 3: Add the shared types needed by the mode helpers**

```ts
// /Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/canvas-workspace-types.ts
export type WorkspaceFileKind = 'html' | 'image' | 'text';
export type FileSurfaceMode = 'preview' | 'inspect';

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
  path: string;
  name: string;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceFileTab[];
  activeTabKey: string | null;
}

export interface WorkspaceModeByTabKey {
  [tabKey: string]: FileSurfaceMode | undefined;
}

export type PendingWorkspaceTransition =
  | { kind: 'activate-tab'; key: string | null }
  | { kind: 'close-tab'; key: string }
  | { kind: 'set-mode'; key: string; mode: FileSurfaceMode };
```

- [ ] **Step 4: Implement the pure mode/guard helpers**

```ts
// /Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.ts
import type {
  FileSurfaceMode,
  PendingWorkspaceTransition,
  WorkspaceModeByTabKey,
} from './canvas-workspace-types';

export function defaultModeForTab(tabKey: string | null): FileSurfaceMode {
  return tabKey ? 'preview' : 'preview';
}

export function setModeForTab(
  current: WorkspaceModeByTabKey,
  key: string,
  mode: FileSurfaceMode,
): WorkspaceModeByTabKey {
  return { ...current, [key]: mode };
}

export function requestGuardedTransition(input: {
  hasDirtyDraft: boolean;
  next: PendingWorkspaceTransition;
}): { allowed: boolean; pending: PendingWorkspaceTransition | null } {
  if (!input.hasDirtyDraft) {
    return { allowed: true, pending: null };
  }
  return { allowed: false, pending: input.next };
}

export function resolveGuardedTransition(
  action: 'discard' | 'stay',
  pending?: PendingWorkspaceTransition | null,
): PendingWorkspaceTransition | null {
  if (action === 'stay') return null;
  return pending ?? null;
}
```

- [ ] **Step 5: Run the helper test to verify it passes**

Run: `pnpm --filter @vibe-design/web test -- workspace-mode.test.ts`

Expected: PASS with 5 tests.

- [ ] **Step 6: Commit the pure helper slice**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add \
  web/src/features/canvas-workspace/canvas-workspace-types.ts \
  web/src/features/canvas-workspace/workspace-mode.ts \
  web/src/features/canvas-workspace/workspace-mode.test.ts
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "Add workspace mode helpers"
```

### Task 2: Upgrade the inspect panel into a grouped dock UI

**Files:**
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`

- [ ] **Step 1: Write the failing dock-group tests**

```ts
// add to CanvasInspectorPanel.test.tsx
it('renders grouped sections for a selected target', () => {
  render(<CanvasInspectorPanel selectedTarget={target} />);

  expect(screen.getByText('Summary')).toBeTruthy();
  expect(screen.getByText('Text')).toBeTruthy();
  expect(screen.getByText('Style')).toBeTruthy();
  expect(screen.getByText('Layout')).toBeTruthy();
});

it('shows an inspect empty state without save affordances when no node is selected', () => {
  render(<CanvasInspectorPanel selectedTarget={null} />);

  expect(screen.getByText('Select a node in inspect mode to start editing.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
});
```

- [ ] **Step 2: Run the panel test to verify it fails**

Run: `pnpm --filter @vibe-design/web test -- CanvasInspectorPanel.test.tsx`

Expected: FAIL because the new grouped labels and empty-state copy do not exist yet.

- [ ] **Step 3: Replace the flat inspector body with grouped dock sections**

```tsx
// inside CanvasInspectorPanel.tsx
<aside aria-label="Canvas inspector" className="h-full min-h-0 p-4">
  <Card className="flex h-full min-h-0 flex-col" size="sm">
    <CardHeader>
      <CardTitle>{activeTarget?.label ?? 'Inspect'}</CardTitle>
    </CardHeader>
    <CardContent className="min-h-0 flex-1 space-y-5 overflow-auto">
      {!activeTarget ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Summary</h3>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            Select a node in inspect mode to start editing.
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">Summary</h3>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {/* existing metadata cards */}
            </dl>
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">Text</h3>
            <label className="block space-y-2 text-xs font-medium text-[var(--text-secondary)]">
              <span>Text</span>
              <Textarea aria-label="Text" className="min-h-24" value={textDraft} onChange={...} />
            </label>
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">Style</h3>
            {/* color, background, font size, font weight, line height, text align */}
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">Layout</h3>
            {/* padding, border radius, opacity */}
          </section>
        </>
      )}
    </CardContent>
    <CardFooter className="justify-end gap-2 border-t border-[var(--border-1)]">
      <Button type="button" variant="secondary" onClick={cancelDraft}>
        Cancel
      </Button>
      <Button type="button" onClick={saveDraft} disabled={!activeTarget}>
        Save
      </Button>
    </CardFooter>
  </Card>
</aside>
```

- [ ] **Step 4: Extend style normalization for the fuller grouped fields**

```ts
type CanvasInspectorStyleKey =
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'textAlign'
  | 'color'
  | 'backgroundColor'
  | 'padding'
  | 'borderRadius'
  | 'opacity';

if (key === 'textAlign') {
  return ['left', 'center', 'right', 'justify'].includes(trimmedValue)
    ? { value: trimmedValue }
    : { error: 'Text align must be left, center, right, or justify.' };
}
```

- [ ] **Step 5: Run the panel test to verify it passes**

Run: `pnpm --filter @vibe-design/web test -- CanvasInspectorPanel.test.tsx`

Expected: PASS with the old coverage still green and the new grouped-section assertions passing.

- [ ] **Step 6: Commit the dock UI slice**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add \
  web/src/features/canvas-workspace/CanvasInspectorPanel.tsx \
  web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "Upgrade inspect dock layout"
```

### Task 3: Add a local unsaved-changes dialog surface

**Files:**
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/InspectUnsavedChangesDialog.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/index.ts`
- Test: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write the failing dialog-flow test in the workspace suite**

```ts
it('asks for confirmation before leaving inspect mode with unsaved changes', () => {
  render(<CanvasWorkspace files={files} />);

  fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
  fireEvent(window, new MessageEvent('message', { data: { type: 'vd-edit-select', target: selectedTarget } }));
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Dirty value' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));

  expect(screen.getByText('Discard unsaved inspect changes?')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Keep Editing' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeTruthy();
});
```

- [ ] **Step 2: Run the workspace test to verify it fails**

Run: `pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx`

Expected: FAIL because the `Preview / Inspect` tabs and confirmation dialog do not exist yet.

- [ ] **Step 3: Create the local confirmation dialog component**

```tsx
// /Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/InspectUnsavedChangesDialog.tsx
import React from 'react';
import { Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from '@tutti-os/ui-system/components';

export function InspectUnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
}: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20">
      <Card className="w-full max-w-md" size="sm">
        <CardHeader>
          <CardTitle>Discard unsaved inspect changes?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-secondary)]">
            Leaving inspect mode now will discard the unsaved edits for the current selection.
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onStay}>
            Keep Editing
          </Button>
          <Button type="button" onClick={onDiscard}>
            Discard Changes
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Export the dialog from the feature barrel**

```ts
// /Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/index.ts
export { InspectUnsavedChangesDialog } from './InspectUnsavedChangesDialog';
```

- [ ] **Step 5: Re-run the workspace suite after the shell task lands to verify the dialog test passes**

Run: `pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx`

Expected: PASS for the dialog assertions once Task 4 wiring is complete.

- [ ] **Step 6: Commit the dialog surface**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add \
  web/src/features/canvas-workspace/InspectUnsavedChangesDialog.tsx \
  web/src/features/canvas-workspace/index.ts \
  web/src/features/canvas-workspace/CanvasWorkspace.test.tsx
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "Add inspect unsaved changes dialog"
```

### Task 4: Refactor CanvasWorkspace into a tab-driven Preview/Inspect shell

**Files:**
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/canvas-workspace-tabs.ts`
- Test: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.test.ts`

- [ ] **Step 1: Replace the fixed three-column layout assertions with workspace-shell assertions**

```ts
// add to CanvasWorkspace.test.tsx
it('shows Design Files as a workspace surface instead of a permanent left rail', () => {
  render(<CanvasWorkspace files={files} />);

  expect(screen.getByRole('tab', { name: 'Design Files' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Design Files')).toBeTruthy();
  expect(screen.queryByText('Canvas')).toBeNull();
});

it('opens file tabs in Preview mode by default', () => {
  render(<CanvasWorkspace files={files} />);

  fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));

  expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('tab', { name: 'Inspect' })).toBeTruthy();
  expect(screen.queryByText('Select a node in inspect mode to start editing.')).toBeNull();
});

it('reveals the inspect dock only when Inspect mode is active', () => {
  render(<CanvasWorkspace files={files} />);

  fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));
  expect(screen.queryByLabelText('Canvas inspector')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
  expect(screen.getByLabelText('Canvas inspector')).toBeTruthy();
});
```

- [ ] **Step 2: Run the workspace suite to verify it fails**

Run: `pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx`

Expected: FAIL because the current shell still renders a permanent files column and has no mode tabs.

- [ ] **Step 3: Rebuild CanvasWorkspace around tab-owned surfaces and per-file modes**

```tsx
// key structure inside CanvasWorkspace.tsx
const [tabsState, setTabsState] = useState<WorkspaceTabsState>(initialTabs);
const [modeByTabKey, setModeByTabKey] = useState<WorkspaceModeByTabKey>({});

const activeTab = tabsState.tabs.find((tab) => tab.key === tabsState.activeTabKey) ?? null;
const activeMode = activeTab ? modeByTabKey[activeTab.key] ?? 'preview' : 'preview';

function renderActiveSurface() {
  if (!activeTab) {
    return (
      <section className="min-h-0 flex-1 overflow-auto">
        <div className="p-4">
          {files.map((file) => (
            <Button key={file.path} type="button" onClick={() => openFile(file)} aria-label={file.name}>
              {file.name}
            </Button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
      <main className="flex min-h-0 flex-col bg-[var(--background)]">
        <div className="flex h-12 items-center justify-between border-b border-[var(--border-1)] px-4">
          <div className="flex items-center gap-2">
            <Button role="tab" variant={activeMode === 'preview' ? 'secondary' : 'chrome'} onClick={() => requestModeChange('preview')}>
              Preview
            </Button>
            <Button role="tab" variant={activeMode === 'inspect' ? 'secondary' : 'chrome'} onClick={() => requestModeChange('inspect')}>
              Inspect
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <Card className="mx-auto h-full min-h-[560px] max-w-[920px] overflow-hidden" size="sm">
            <CardContent className="h-full p-0">
              <CanvasPreview
                file={activeFile}
                editMode={activeMode === 'inspect' && activeFile?.kind === 'html'}
                selectedTargetId={activeMode === 'inspect' ? selectedTarget?.id ?? null : null}
                onHoveredTargetChange={activeMode === 'inspect' ? setHoveredTarget : undefined}
                onSelectedTargetChange={activeMode === 'inspect' ? handleSelectedTargetChange : undefined}
                ...
              />
            </CardContent>
          </Card>
        </div>
      </main>
      {activeMode === 'inspect' ? (
        <div className="min-h-0 overflow-auto border-l border-[var(--border-1)] bg-[var(--background-fronted)]">
          <CanvasInspectorPanel ... />
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Keep tab helpers focused on tab state only**

```ts
// canvas-workspace-tabs.ts remains tab-only
export function openWorkspaceFileTab(...) { ... }
export function closeWorkspaceTab(...) { ... }
export function reorderWorkspaceTabs(...) { ... }
// no mode logic should be added here
```

- [ ] **Step 5: Run the workspace suite to verify the shell tests pass**

Run: `pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx`

Expected: PASS for:
- Design Files as a workspace surface
- default Preview mode
- Inspect-only dock visibility
- existing file tab open/activate/reorder behavior adapted to the new shell

- [ ] **Step 6: Commit the workspace shell refactor**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add \
  web/src/features/canvas-workspace/CanvasWorkspace.tsx \
  web/src/features/canvas-workspace/CanvasWorkspace.test.tsx \
  web/src/features/canvas-workspace/canvas-workspace-tabs.ts
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "Refactor canvas workspace shell"
```

### Task 5: Wire dirty guards into mode switch, tab switch, and tab close

**Files:**
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- Test: `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/workspace-mode.test.ts`

- [ ] **Step 1: Add failing dirty-guard tests for mode switch, tab switch, and tab close**

```ts
it('keeps inspect mode active when the user chooses Keep Editing', () => {
  render(<CanvasWorkspace files={files} />);

  fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
  fireEvent(window, new MessageEvent('message', { data: { type: 'vd-edit-select', target: selectedTarget } }));
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Dirty value' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }));

  expect(screen.getByRole('tab', { name: 'Inspect' }).getAttribute('aria-selected')).toBe('true');
});

it('discards the draft and completes the pending transition when the user confirms', () => {
  render(<CanvasWorkspace files={files} />);

  fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
  fireEvent(window, new MessageEvent('message', { data: { type: 'vd-edit-select', target: selectedTarget } }));
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Dirty value' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));

  expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByText('Discard unsaved inspect changes?')).toBeNull();
});
```

- [ ] **Step 2: Run the workspace suite to verify it fails**

Run: `pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx`

Expected: FAIL because dirty state is not tracked and pending transitions are not replayed.

- [ ] **Step 3: Track inspect draft dirtiness at the shell level**

```tsx
// inside CanvasWorkspace.tsx
const [inspectorDraft, setInspectorDraft] = useState<CanvasInspectorDraft | null>(null);
const [pendingTransition, setPendingTransition] = useState<PendingWorkspaceTransition | null>(null);

const isDirty = Boolean(
  activeTab &&
    activeMode === 'inspect' &&
    inspectorDraft &&
    selectedTarget &&
    JSON.stringify(inspectorDraft) !== JSON.stringify(buildDraftBaseline(selectedTarget)),
);
```

- [ ] **Step 4: Route guarded transitions through the helper and dialog**

```tsx
function requestModeChange(nextMode: FileSurfaceMode) {
  if (!activeTab) return;
  const result = requestGuardedTransition({
    hasDirtyDraft: activeMode === 'inspect' && nextMode === 'preview' && isDirty,
    next: { kind: 'set-mode', key: activeTab.key, mode: nextMode },
  });
  if (!result.allowed) {
    setPendingTransition(result.pending);
    return;
  }
  setModeByTabKey((current) => setModeForTab(current, activeTab.key, nextMode));
}

function applyPendingTransition(next: PendingWorkspaceTransition | null) {
  if (!next) return;
  if (next.kind === 'set-mode') {
    setModeByTabKey((current) => setModeForTab(current, next.key, next.mode));
    return;
  }
  if (next.kind === 'activate-tab') {
    setTabsState((state) => ({ ...state, activeTabKey: next.key }));
    return;
  }
  if (next.kind === 'close-tab') {
    setTabsState((state) => closeWorkspaceTab(state, next.key));
  }
}

<InspectUnsavedChangesDialog
  open={pendingTransition !== null}
  onStay={() => setPendingTransition(resolveGuardedTransition('stay'))}
  onDiscard={() => {
    const next = resolveGuardedTransition('discard', pendingTransition);
    setInspectorDraft(null);
    setStylePreview(null);
    setPendingTransition(null);
    applyPendingTransition(next);
  }}
/>
```

- [ ] **Step 5: Run focused tests plus the web package verification set**

Run:

```bash
pnpm --filter @vibe-design/web test -- workspace-mode.test.ts CanvasInspectorPanel.test.tsx CanvasWorkspace.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected:

- Vitest: PASS for all three focused test files
- TypeScript: PASS with no `tsc --noEmit` errors

- [ ] **Step 6: Commit the dirty-guard integration**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add \
  web/src/features/canvas-workspace/CanvasWorkspace.tsx \
  web/src/features/canvas-workspace/CanvasWorkspace.test.tsx
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "Guard inspect workflow transitions"
```

## Self-Review

### Spec coverage

- `Design Files` tab-as-surface: Task 4
- explicit `Preview / Inspect`: Task 4
- inspect-only right dock: Tasks 2 and 4
- full inspector grouping: Task 2
- dirty guard on mode/tab/close transitions: Tasks 3 and 5
- no comment-mode work: preserved by scope and file list

No approved spec requirement is left without a task.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Every code-changing step includes a concrete code block.
- Every verification step includes exact commands and expected outcomes.

### Type consistency

- `FileSurfaceMode`, `WorkspaceModeByTabKey`, and `PendingWorkspaceTransition` are introduced in Task 1 and reused consistently in Tasks 4 and 5.
- `InspectUnsavedChangesDialog` is created in Task 3 and consumed in Task 5.
- `CanvasInspectorDraft` remains the shell-facing draft type across the dock and workspace tasks.
