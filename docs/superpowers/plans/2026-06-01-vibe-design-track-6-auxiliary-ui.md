# Vibe Design Track 6 Auxiliary UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Track 6 F4/F7 auxiliary UI slice from the user-provided scheme into `vibe-design/web` without adding the `FileWorkspace` shell.

**Architecture:** Add a self-contained Track 6 slice under `web/src`: minimal domain types, pure runtime projection helpers, generation progress UI, live artifact badges, and a design files panel that owns only local view state. Parent-owned workspace orchestration, APIs, analytics, and i18n remain outside this migration.

**Tech Stack:** TypeScript, React 19, Vitest, jsdom, Testing Library React, CSS modules, `@tutti-os/ui-system` public component and icon entrypoints.

---

## Reference Inputs

- Scheme spec: `/Users/chovy/Desktop/workspace/vibe-design/docs/superpowers/specs/2026-06-01-vibe-design-track-6-auxiliary-ui-design.md`
- User migration brief: `/Users/chovy/Desktop/track-6-auxiliary-ui.md`
- Source runtime reference: `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/runtime/generation-preview.ts`
- Source todo reference: `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/runtime/todos.ts`
- Source generation stage reference: `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/GenerationPreviewStage.tsx`
- Source files panel reference: `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/DesignFilesPanel.tsx`
- Source live badges reference: `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/components/LiveArtifactBadges.tsx`
- Source runtime tests: `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/runtime/generation-preview.test.ts`
- Source files panel tests: `/Users/chovy/Desktop/workspace/vibe-design/apps/web/tests/components/DesignFilesPanel.test.tsx`

## File Structure

- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/types.ts`
  Defines only Track 6 local domain shapes: `AgentEvent`, `ChatMessage`, `ProjectFile`, `LiveArtifactWorkspaceEntry`, and live artifact helpers.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/todos.ts`
  Pure TodoWrite parsing helper used by generation preview state derivation.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/generation-preview.ts`
  Pure projection from messages/files/live artifacts into `GenerationPreviewModel`.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/generation-preview.test.ts`
  Runtime behavior tests that do not require DOM.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/GenerationPreviewStage.tsx`
  UI-system-backed generation progress stage component.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/GenerationPreviewStage.module.css`
  Local layout CSS using UI-system variables and no source palette.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/GenerationPreviewStage.test.tsx`
  SSR-level render tests for phase/status output.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/LiveArtifactBadges.tsx`
  UI-system-backed live artifact badge component.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/DesignFilesPanel.tsx`
  Design files browser with local grouping, sorting, paging, directory navigation, selection, localStorage persistence, and parent callbacks.
- Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/DesignFilesPanel.test.tsx`
  Focused jsdom tests for core panel behavior.
- Modify `/Users/chovy/Desktop/workspace/vibe-design/web/package.json`
  Add DOM component test dependencies.
- Modify `/Users/chovy/Desktop/workspace/vibe-design/web/vitest.config.ts`
  Allow node runtime tests and jsdom component tests in the same package.
- Modify `/Users/chovy/Desktop/workspace/vibe-design/web/src/index.ts`
  Export Track 6 modules for the future workspace shell.

Do not import `@tutti-os/ui-system/styles.css` from `web/src/index.ts` in this migration. The current package exports raw TypeScript consumed by server-side tests; a global CSS side-effect import at the package root can break non-bundled SSR consumers. The future browser shell that renders these components must import `@tutti-os/ui-system/styles.css` once.

---

### Task 1: Component Test Harness

**Files:**
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/package.json`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/vitest.config.ts`

- [ ] **Step 1: Add the component test dependencies**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web add -D @testing-library/react jsdom
```

Expected: `web/package.json` gains `@testing-library/react` and `jsdom` in `devDependencies`, and `pnpm-lock.yaml` updates if needed.

- [ ] **Step 2: Update Vitest config for per-file environments**

Replace `/Users/chovy/Desktop/workspace/vibe-design/web/vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

Keep the default environment as `node`. Component test files will opt into jsdom with `// @vitest-environment jsdom`.

- [ ] **Step 3: Verify existing tests still run**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test
```

Expected: existing web tests pass.

- [ ] **Step 4: Commit test harness**

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
git add web/package.json pnpm-lock.yaml web/vitest.config.ts
git commit -m "test: add web component test harness"
```

---

### Task 2: Local Track 6 Types And Todo Runtime

**Files:**
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/types.ts`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/todos.ts`

- [ ] **Step 1: Create local domain types**

Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/types.ts`:

```ts
export type AgentEvent =
  | { kind: 'status'; label: string; detail?: string }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  runStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  startedAt?: number;
  createdAt?: number;
  endedAt?: number;
  events?: AgentEvent[];
}

export type ProjectFileKind =
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'text'
  | 'code'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'binary';

export interface ProjectFile {
  name: string;
  path?: string;
  type?: 'file' | 'directory';
  size: number;
  mtime: number;
  kind: ProjectFileKind;
  mime: string;
}

export type LiveArtifactStatus = 'active' | 'archived';
export type LiveArtifactRefreshStatus = 'idle' | 'running' | 'failed';
export type LiveArtifactTabId = `live:${string}`;

export interface LiveArtifactPreview {
  type: 'html' | 'image' | 'video' | 'audio' | 'data';
  entry?: string;
  url?: string;
  thumbnailUrl?: string;
}

export interface LiveArtifactWorkspaceEntry {
  kind: 'live-artifact';
  tabId: LiveArtifactTabId;
  artifactId: string;
  projectId: string;
  title: string;
  slug: string;
  status: LiveArtifactStatus;
  refreshStatus: LiveArtifactRefreshStatus;
  pinned: boolean;
  preview: LiveArtifactPreview;
  hasDocument: boolean;
  updatedAt: string;
  lastRefreshedAt?: string;
}

export function liveArtifactTabId(artifactId: string): LiveArtifactTabId {
  return `live:${artifactId}`;
}

export function isLiveArtifactTabId(tabId: string): tabId is LiveArtifactTabId {
  return tabId.startsWith('live:') && tabId.length > 'live:'.length;
}
```

- [ ] **Step 2: Create TodoWrite parser**

Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/todos.ts`:

```ts
import type { AgentEvent } from '../types';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'stopped';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

export function parseTodoWriteInput(input: unknown): TodoItem[] {
  if (!input || typeof input !== 'object') return [];
  const obj = input as { plan?: unknown; todos?: unknown };
  const rawItems = Array.isArray(obj.todos) ? obj.todos : Array.isArray(obj.plan) ? obj.plan : [];

  return rawItems
    .map((todo): TodoItem | null => {
      if (!todo || typeof todo !== 'object') return null;
      const record = todo as Record<string, unknown>;
      const content = typeof record.content === 'string' ? record.content : typeof record.step === 'string' ? record.step : '';
      if (!content) return null;
      const activeForm = typeof record.activeForm === 'string' ? record.activeForm : typeof record.active_form === 'string' ? record.active_form : undefined;
      return { content, status: normalizeTodoStatus(record.status), activeForm };
    })
    .filter((todo): todo is TodoItem => todo !== null);
}

export function latestTodosFromEvents(events: AgentEvent[] | undefined): TodoItem[] {
  if (!events) return [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind !== 'tool_use' || !isTodoWriteToolName(event.name)) continue;
    return parseTodoWriteInput(event.input);
  }
  return [];
}

export function isTodoWriteToolName(name: string): boolean {
  return name === 'TodoWrite' || name === 'todowrite' || name === 'todo_write' || name === 'update_plan';
}

function normalizeTodoStatus(status: unknown): TodoStatus {
  if (status === 'completed' || status === 'in_progress' || status === 'stopped') return status;
  if (status === 'cancelled' || status === 'canceled' || status === 'failed') return 'stopped';
  return 'pending';
}
```

- [ ] **Step 3: Run type-check**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web type-check
```

Expected: type-check passes.

- [ ] **Step 4: Commit local types and todo runtime**

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
git add web/src/types.ts web/src/runtime/todos.ts
git commit -m "feat: add track 6 local runtime types"
```

---

### Task 3: Generation Preview Runtime

**Files:**
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/generation-preview.test.ts`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/generation-preview.ts`

- [ ] **Step 1: Write the failing runtime test**

Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/generation-preview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildGenerationPreviewState,
  derivePrototypeGenerationSteps,
  workspaceHasPreviewSurface,
} from './generation-preview';
import type { AgentEvent, ChatMessage } from '../types';

describe('generation preview helpers', () => {
  it('detects when the workspace already has a preview surface', () => {
    expect(
      workspaceHasPreviewSurface({
        activeTab: 'index.html',
        projectFiles: [{ name: 'index.html', size: 1, mtime: 1, kind: 'html', mime: 'text/html' }],
        liveArtifacts: [],
      }),
    ).toBe(true);

    expect(
      workspaceHasPreviewSurface({
        activeTab: null,
        projectFiles: [],
        liveArtifacts: [],
        streamingArtifactHtml: '<html><body>hi</body></html>',
      }),
    ).toBe(true);
  });

  it('advances the three prototype steps from streamed events', () => {
    const events: AgentEvent[] = [
      { kind: 'status', label: 'thinking' },
      { kind: 'text', text: 'Planning the page.' },
      { kind: 'tool_use', id: '1', name: 'Write', input: { file_path: 'index.html' } },
    ];

    expect(
      derivePrototypeGenerationSteps({
        events,
        hasArtifactHtml: false,
        hasPreviewSurface: false,
        failed: false,
      }),
    ).toEqual([
      { id: 'understand', status: 'succeeded' },
      { id: 'generate', status: 'succeeded' },
      { id: 'prepare', status: 'running' },
    ]);
  });

  it('builds preview state for an active assistant run without an open preview tab', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'running',
      startedAt: Date.now() - 5_000,
      events: [{ kind: 'status', label: 'thinking' }],
    };

    const state = buildGenerationPreviewState({
      designSystemProject: false,
      messages: [{ id: 'u1', role: 'user', content: 'Build a landing page' }, assistant],
      streaming: true,
      activeTab: null,
      projectFiles: [],
      liveArtifacts: [],
    });

    expect(state).not.toBeNull();
    expect(state?.phase).toBe('generating');
    expect(state?.steps[0]?.status).toBe('succeeded');
    expect(state?.retryTarget).toBeNull();
  });

  it('derives a concrete sub-status and task count while generating', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'running',
      startedAt: Date.now(),
      events: [
        {
          kind: 'tool_use',
          id: 't1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Plan layout', status: 'completed' },
              { content: 'Write index.html', activeForm: 'Writing index.html', status: 'in_progress' },
              { content: 'Self-check', status: 'pending' },
            ],
          },
        },
      ],
    };

    const state = buildGenerationPreviewState({
      designSystemProject: false,
      messages: [assistant],
      streaming: true,
      activeTab: null,
      projectFiles: [],
      liveArtifacts: [],
    });

    expect(state?.detailLabel).toBe('Writing index.html');
    expect(state?.todoProgress).toEqual({ done: 2, total: 3 });
  });

  it('keeps a waiting surface when the agent is asking the user a question', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'A few quick questions:\\n<question-form id="discovery" title="Brief">{"questions":[]}</question-form>',
      runStatus: 'succeeded',
      startedAt: Date.now() - 4_000,
      events: [{ kind: 'text', text: '<question-form id="discovery">{"questions":[]}</question-form>' }],
    };

    const state = buildGenerationPreviewState({
      designSystemProject: false,
      messages: [assistant],
      streaming: false,
      activeTab: null,
      projectFiles: [],
      liveArtifacts: [],
    });

    expect(state?.phase).toBe('awaiting-input');
    expect(state?.retryTarget).toBeNull();
  });

  it('builds a failed state with a retry target', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'failed',
      startedAt: Date.now() - 8_000,
      events: [{ kind: 'text', text: 'Model request failed' }],
    };

    const state = buildGenerationPreviewState({
      designSystemProject: false,
      messages: [assistant],
      streaming: false,
      activeTab: null,
      projectFiles: [],
      liveArtifacts: [],
      conversationError: 'Network error',
    });

    expect(state?.phase).toBe('failed');
    expect(state?.failed).toBe(true);
    expect(state?.errorMessage).toBe('Network error');
    expect(state?.retryTarget).toBe(assistant);
  });
});
```

- [ ] **Step 2: Run the test to verify red**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test -- src/runtime/generation-preview.test.ts
```

Expected: FAIL with a missing `./generation-preview` module.

- [ ] **Step 3: Implement the runtime module**

Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/runtime/generation-preview.ts`.

Implementation requirements:

- Preserve the public function signatures from the spec.
- Port the source logic from `/Users/chovy/Desktop/workspace/vibe-design/apps/web/src/runtime/generation-preview.ts`.
- Replace source imports with:

```ts
import type { AgentEvent, ChatMessage, LiveArtifactWorkspaceEntry, ProjectFile } from '../types';
import { isLiveArtifactTabId } from '../types';
import { isTodoWriteToolName, latestTodosFromEvents, type TodoItem } from './todos';
```

- Export these exact types:

```ts
export type GenerationStepStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type GenerationPhase = 'generating' | 'awaiting-input' | 'stopped' | 'failed';

export interface GenerationPreviewStep {
  id: 'understand' | 'generate' | 'prepare';
  status: GenerationStepStatus;
}

export interface GenerationPreviewModel {
  startedAt: number;
  steps: GenerationPreviewStep[];
  phase: GenerationPhase;
  failed: boolean;
  errorMessage: string | null;
  progressPercent: number;
  activityLabel: string | null;
  detailLabel: string | null;
  todoProgress: { done: number; total: number } | null;
}
```

- Adapt `workspaceHasPreviewSurface` to accept `LiveArtifactWorkspaceEntry[]` and check `entry.tabId === activeTab`.
- Keep `QUESTION_FORM_RE`, write-like tool detection, progress scoring, activity truncation, and todo-progress counting behavior aligned with source.

- [ ] **Step 4: Run the runtime test to verify green**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test -- src/runtime/generation-preview.test.ts
```

Expected: all tests in `generation-preview.test.ts` pass.

- [ ] **Step 5: Run type-check**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web type-check
```

Expected: type-check passes.

- [ ] **Step 6: Commit generation preview runtime**

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
git add web/src/runtime/generation-preview.ts web/src/runtime/generation-preview.test.ts
git commit -m "feat: add generation preview runtime"
```

---

### Task 4: Generation Preview Stage Component

**Files:**
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/GenerationPreviewStage.test.tsx`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/GenerationPreviewStage.tsx`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/GenerationPreviewStage.module.css`

- [ ] **Step 1: Write the failing component test**

Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/GenerationPreviewStage.test.tsx`:

```tsx
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GenerationPreviewStage } from './GenerationPreviewStage';
import type { GenerationPreviewModel } from '../runtime/generation-preview';

function model(overrides: Partial<GenerationPreviewModel> = {}): GenerationPreviewModel {
  return {
    startedAt: 1,
    phase: 'generating',
    failed: false,
    errorMessage: null,
    progressPercent: 48,
    activityLabel: 'Sketching layout',
    detailLabel: 'Writing index.html',
    todoProgress: { done: 2, total: 3 },
    steps: [
      { id: 'understand', status: 'succeeded' },
      { id: 'generate', status: 'running' },
      { id: 'prepare', status: 'pending' },
    ],
    ...overrides,
  };
}

describe('GenerationPreviewStage', () => {
  it('renders generating state with progress and task count', () => {
    const html = renderToString(<GenerationPreviewStage model={model()} />);

    expect(html).toContain('Creating your design');
    expect(html).toContain('Writing index.html');
    expect(html).toContain('2/3');
    expect(html).toContain('aria-valuenow="48"');
  });

  it('renders failed state with retry button when retry is available', () => {
    const html = renderToString(
      <GenerationPreviewStage
        model={model({ phase: 'failed', failed: true, errorMessage: 'Network error', progressPercent: 72 })}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('Generation failed');
    expect(html).toContain('Network error');
    expect(html).toContain('Retry');
  });
});
```

- [ ] **Step 2: Run the component test to verify red**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test -- src/components/GenerationPreviewStage.test.tsx
```

Expected: FAIL with a missing `./GenerationPreviewStage` module.

- [ ] **Step 3: Implement `GenerationPreviewStage.tsx`**

Use stable UI-system imports:

```tsx
import { Button, Card, CardContent, Spinner } from '@tutti-os/ui-system/components';
import { CheckIcon, CloseIcon, LoadingIcon, ThinkingIcon } from '@tutti-os/ui-system/icons';
import type { GenerationPreviewModel } from '../runtime/generation-preview';
import styles from './GenerationPreviewStage.module.css';
```

Implementation requirements:

- Export `GenerationPreviewStageProps`.
- Render these phase titles exactly:
  - `Generating`: `Creating your design`
  - `failed`: `Generation failed`
  - `stopped`: `Generation stopped`
  - `awaiting-input`: `Waiting for your input`
- Render progressbar with `aria-valuenow={model.progressPercent}`.
- Render only non-pending steps.
- Render `detailLabel` and `todoProgress` when present.
- Render UI-system `Button` labeled `Retry` only when `model.phase === 'failed' && onRetry`.

- [ ] **Step 4: Implement `GenerationPreviewStage.module.css`**

Create CSS classes used by the component:

```css
.stage {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 32px;
}

.card {
  width: min(440px, 100%);
}

.body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}

.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--background);
}

.title {
  margin: 0;
  font-size: 20px;
  line-height: 1.25;
  font-weight: 600;
}

.lead {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 14px;
  line-height: 1.5;
}

.progress {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--muted);
}

.progressFill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width 300ms ease-out;
}

.steps {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 12px;
}

.substatus {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  color: var(--muted-foreground);
  font-size: 12px;
}

.substatusLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.substatusCount {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
```

If the package exposes different token variable names during implementation, inspect `@tutti-os/ui-system/styles.css` and adjust only variable names while keeping the same structure.

- [ ] **Step 5: Run component test and type-check**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test -- src/components/GenerationPreviewStage.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: component tests and type-check pass.

- [ ] **Step 6: Commit generation preview component**

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
git add web/src/components/GenerationPreviewStage.tsx web/src/components/GenerationPreviewStage.module.css web/src/components/GenerationPreviewStage.test.tsx
git commit -m "feat: add generation preview stage"
```

---

### Task 5: Live Artifact Badges

**Files:**
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/LiveArtifactBadges.tsx`

- [ ] **Step 1: Implement `LiveArtifactBadges.tsx`**

Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/LiveArtifactBadges.tsx`:

```tsx
import { Badge } from '@tutti-os/ui-system/components';
import type { LiveArtifactRefreshStatus, LiveArtifactStatus } from '../types';

interface LiveArtifactBadgesProps {
  status: LiveArtifactStatus;
  refreshStatus: LiveArtifactRefreshStatus;
  className?: string;
  compact?: boolean;
}

export function LiveArtifactBadges({
  status,
  refreshStatus,
  className,
  compact = false,
}: LiveArtifactBadgesProps) {
  const badges = [
    { key: 'live', label: 'Live' },
    refreshStatus === 'running' ? { key: 'refreshing', label: 'Refreshing' } : null,
    refreshStatus === 'failed' ? { key: 'refresh-failed', label: 'Refresh failed' } : null,
    status === 'archived' ? { key: 'archived', label: 'Archived' } : null,
  ].filter((badge): badge is { key: string; label: string } => Boolean(badge));

  return (
    <span className={className} data-compact={compact} aria-label="Live artifact status">
      {badges.map((badge) => (
        <Badge key={badge.key} variant={badge.key === 'live' ? 'default' : 'secondary'}>
          {badge.label}
        </Badge>
      ))}
    </span>
  );
}
```

If `Badge` does not support `variant="secondary"` in the installed package, inspect its props and replace with supported variants while keeping the labels and status conditions unchanged.

- [ ] **Step 2: Run type-check**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web type-check
```

Expected: type-check passes.

- [ ] **Step 3: Commit badges**

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
git add web/src/components/LiveArtifactBadges.tsx
git commit -m "feat: add live artifact badges"
```

---

### Task 6: Design Files Panel Core Behavior

**Files:**
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/DesignFilesPanel.test.tsx`
- Create: `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/DesignFilesPanel.tsx`

- [ ] **Step 1: Write the failing panel tests**

Create `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/DesignFilesPanel.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignFilesPanel } from './DesignFilesPanel';
import type { ProjectFile, ProjectFileKind } from '../types';

const lsStore = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    lsStore.set(key, value);
  },
  removeItem: (key: string) => {
    lsStore.delete(key);
  },
  clear: () => {
    lsStore.clear();
  },
});

function file(overrides: Partial<ProjectFile> & Pick<ProjectFile, 'name'>): ProjectFile {
  return {
    path: overrides.name,
    type: 'file',
    size: 1024,
    mtime: Date.now(),
    kind: 'html',
    mime: 'text/html',
    ...overrides,
  };
}

function extForKind(kind: ProjectFileKind): string {
  if (kind === 'html') return 'html';
  if (kind === 'image') return 'png';
  if (kind === 'sketch') return 'sketch.json';
  if (kind === 'text') return 'txt';
  if (kind === 'code') return 'ts';
  if (kind === 'pdf') return 'pdf';
  return 'bin';
}

function generateFiles(count: number): ProjectFile[] {
  const kinds: ProjectFileKind[] = ['html', 'image', 'sketch', 'text', 'code', 'pdf'];
  return Array.from({ length: count }, (_, index) => {
    const kind = kinds[index % kinds.length]!;
    return file({
      name: `file-${index + 1}.${extForKind(kind)}`,
      kind,
      size: 1024 * (index + 1),
      mtime: Date.now() - index * 60_000,
      mime: 'text/plain',
    });
  });
}

function renderPanel(files: ProjectFile[]) {
  const onOpenFile = vi.fn();
  const onDeleteFiles = vi.fn();
  const result = render(
    <DesignFilesPanel
      projectId="test-project"
      files={files}
      liveArtifacts={[]}
      onRefreshFiles={vi.fn()}
      onOpenFile={onOpenFile}
      onOpenLiveArtifact={vi.fn()}
      onRenameFile={vi.fn()}
      onDeleteFile={vi.fn()}
      onDeleteFiles={onDeleteFiles}
      onUpload={vi.fn()}
      onUploadFiles={vi.fn()}
      onPaste={vi.fn()}
      onNewSketch={vi.fn()}
    />,
  );
  return { ...result, onOpenFile, onDeleteFiles };
}

describe('DesignFilesPanel', () => {
  beforeEach(() => {
    lsStore.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('groups files by kind by default', () => {
    renderPanel([
      file({ name: 'page.html', kind: 'html', mime: 'text/html' }),
      file({ name: 'chart.png', kind: 'image', mime: 'image/png' }),
    ]);

    expect(screen.getByRole('group', { name: 'Group by' })).toBeTruthy();
    expect(screen.getByText('HTML')).toBeTruthy();
    expect(screen.getByText('Image')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-page.html')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-chart.png')).toBeTruthy();
  });

  it('groups files by modified date when selected', () => {
    const now = new Date(2026, 4, 9, 12).getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    renderPanel([
      file({ name: 'today.html', mtime: new Date(2026, 4, 9, 11).getTime() }),
      file({ name: 'yesterday.html', mtime: new Date(2026, 4, 8, 12).getTime() }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Modified' }));

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-today.html')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-yesterday.html')).toBeTruthy();
  });

  it('renders only the default page size for large file lists and navigates pages', () => {
    const { container } = renderPanel(generateFiles(45));

    expect(container.querySelectorAll('[data-testid^="design-file-row-"]').length).toBe(30);
    expect(screen.getByText('1-30 of 45')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(container.querySelectorAll('[data-testid^="design-file-row-"]').length).toBe(15);
    expect(screen.getByText('31-45 of 45')).toBeTruthy();
  });

  it('persists sort and page size preferences to localStorage', () => {
    const { container } = renderPanel(generateFiles(60));

    fireEvent.change(within(container).getByLabelText('Page size'), { target: { value: '60' } });
    fireEvent.change(within(container).getByLabelText('Sort by'), { target: { value: 'name' } });

    expect(lsStore.get('od:design-files:view-state:v1:test-project')).toContain('"pageSize":60');
    expect(lsStore.get('od:design-files:view-state:v1:test-project')).toContain('"sortKey":"name"');
  });

  it('passes selected file names to batch delete', () => {
    const { onDeleteFiles } = renderPanel(generateFiles(3));

    fireEvent.click(screen.getByLabelText('Select file-1.html'));
    fireEvent.click(screen.getByLabelText('Select file-2.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    expect(onDeleteFiles).toHaveBeenCalledWith(['file-1.html', 'file-2.png']);
  });

  it('navigates into folders and back to root', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'assets/icons/star.svg', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open folder assets' }));

    expect(screen.getByText('assets')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-assets/logo.png')).toBeTruthy();
    expect(screen.queryByTestId('design-file-row-top.html')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Root folder' }));

    expect(screen.getByTestId('design-file-row-top.html')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the panel test to verify red**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test -- src/components/DesignFilesPanel.test.tsx
```

Expected: FAIL with a missing `./DesignFilesPanel` module.

- [ ] **Step 3: Implement `DesignFilesPanel.tsx`**

Use stable UI-system imports:

```tsx
import { Badge, Button, Card, CardContent, Checkbox, Select } from '@tutti-os/ui-system/components';
import {
  DeleteIcon,
  DirectoryIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  ImageFileIcon,
  RefreshIcon,
  UploadIcon,
} from '@tutti-os/ui-system/icons';
```

Export this public props interface:

```ts
export interface DesignFilesPanelProps {
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

Implement these internal constants and types:

```ts
type DesignFilesGroupMode = 'kind' | 'modified';
type ModifiedSection = 'today' | 'yesterday' | 'previous7Days' | 'previous30Days' | 'older';
type SortKey = 'name' | 'kind' | 'mtime';
type SortDir = 'asc' | 'desc';

const VIEW_STATE_KEY_PREFIX = 'od:design-files:view-state:v1:';
const DEFAULT_SORT_KEY: SortKey = 'mtime';
const DEFAULT_SORT_DIR: SortDir = 'desc';
const DEFAULT_PAGE_SIZE: number | 'all' = 30;
const PAGE_SIZE_OPTIONS = [15, 30, 45, 60, 'all'] as const;
```

Implementation requirements:

- `readViewState(projectId)` and `writeViewState(projectId, state)` must guard `typeof window === 'undefined'`.
- Directory rows are derived from slash-separated file names.
- Root directory row labels use only the folder segment, not full paths.
- File row `data-testid` must be `design-file-row-${file.name}`.
- File selection controls must expose `aria-label="Select ${file.name}"`.
- Batch delete button must use accessible name `Delete selected`.
- Group mode controls must be inside `role="group"` with `aria-label="Group by"`.
- Page controls must expose accessible names `Previous page` and `Next page`.
- Page info text must use ASCII hyphen ranges, for example `1-30 of 45`.
- Parent callbacks are invoked but no API calls are made inside the component.
- Live artifact rows render after file sections and call `onOpenLiveArtifact(tabId)`.

Keep the first implementation focused on the tested behavior. Defer untested source details such as plugin folder actions, remote sketch preview fetches, hover menus, and analytics.

- [ ] **Step 4: Run panel tests to verify green**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test -- src/components/DesignFilesPanel.test.tsx
```

Expected: all tests in `DesignFilesPanel.test.tsx` pass.

- [ ] **Step 5: Run web type-check**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web type-check
```

Expected: type-check passes.

- [ ] **Step 6: Commit design files panel**

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
git add web/src/components/DesignFilesPanel.tsx web/src/components/DesignFilesPanel.test.tsx
git commit -m "feat: add design files panel"
```

---

### Task 7: Public Exports And Final Verification

**Files:**
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/index.ts`
- Modify: `/Users/chovy/Desktop/workspace/vibe-design/web/src/render-page.test.ts`

- [ ] **Step 1: Export Track 6 modules**

Append these exports to `/Users/chovy/Desktop/workspace/vibe-design/web/src/index.ts`:

```ts
export type {
  AgentEvent,
  ChatMessage,
  LiveArtifactPreview,
  LiveArtifactRefreshStatus,
  LiveArtifactStatus,
  LiveArtifactTabId,
  LiveArtifactWorkspaceEntry,
  ProjectFile,
  ProjectFileKind,
} from './types';
export { liveArtifactTabId, isLiveArtifactTabId } from './types';

export type {
  GenerationPhase,
  GenerationPreviewModel,
  GenerationPreviewStep,
  GenerationStepStatus,
} from './runtime/generation-preview';
export {
  buildGenerationPreviewState,
  derivePrototypeGenerationSteps,
  generationPreviewProgress,
  workspaceHasPreviewSurface,
} from './runtime/generation-preview';

export { GenerationPreviewStage, type GenerationPreviewStageProps } from './components/GenerationPreviewStage';
export { LiveArtifactBadges } from './components/LiveArtifactBadges';
export { DesignFilesPanel, type DesignFilesPanelProps } from './components/DesignFilesPanel';
```

- [ ] **Step 2: Keep existing SSR smoke test unchanged**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test -- src/render-page.test.ts
```

Expected: existing hello-world SSR test passes. If a CSS import breaks this test, remove package-root CSS side effects and keep CSS imports local to component modules only.

- [ ] **Step 3: Run all web tests**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web test
```

Expected: all web tests pass.

- [ ] **Step 4: Run web type-check**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm --filter @vibe-design/web type-check
```

Expected: type-check passes.

- [ ] **Step 5: Run full workspace checks**

Run:

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
pnpm test
pnpm type-check
```

Expected: all package tests and type-checks pass.

- [ ] **Step 6: Commit exports and verification-ready state**

```bash
cd /Users/chovy/Desktop/workspace/vibe-design
git add web/src/index.ts
git commit -m "feat: export track 6 auxiliary ui"
```

---

## Spec Coverage Review

- F4 generation preview runtime is covered by Tasks 2 and 3.
- F4 `GenerationPreviewStage` is covered by Task 4.
- F7 `DesignFilesPanel` is covered by Task 6.
- `LiveArtifactBadges` is covered by Task 5.
- Minimal local types are covered by Task 2.
- UI-system usage is covered by Tasks 4, 5, and 6.
- No `FileWorkspace` shell is created in any task.
- Parent-owned handlers remain callback props in Task 6.
- The localStorage key remains `od:design-files:view-state:v1:{projectId}` in Task 6.
- Focused tests are added before implementation in Tasks 3, 4, and 6.

## Final Reporting Requirements

When implementation is complete, report:

- referenced migration scheme and source paths
- source-to-target mapping
- unchanged scheme interfaces
- structures preserved from source and implementation details rewritten for `vibe-design`
- UI-system components/icons used
- whether `@tutti-os/ui-system/styles.css` was imported and where; if not imported, state that the future shell must import it once
- validation commands and exact results
- remaining risks, especially untested source-only behaviors intentionally left out of scope

