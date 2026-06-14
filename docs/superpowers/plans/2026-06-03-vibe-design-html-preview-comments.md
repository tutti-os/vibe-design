# Vibe Design HTML Preview Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full HTML preview comment system for Vibe Design: element comments, saved comments, chat attachments, pod selection, free pins, visual marks, persistence, and run status updates.

**Architecture:** Add a native `vd-comment-*` bridge beside the existing `vd-edit-*` bridge, persist comments in SQLite through a dedicated route/service boundary, and carry comment attachments through chat messages into the agent prompt as structured context. Keep Comment mode separate from Inspect mode so preview comments never trigger contenteditable or inspector edits.

**Tech Stack:** React 19, TypeScript, Vitest, Express 5, better-sqlite3, `@tutti-os/infra/di`, `@tutti-os/ui-system`.

---

## File Structure

Create:

- `web/src/features/canvas-workspace/canvas-comment/canvas-comment-types.ts`
  Owns web-side comment target, saved comment, attachment, visual mark, and bridge message types.
- `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.ts`
  Pure helpers for snapshot normalization, attachment building, prompt-preview formatting, pod hit testing, and visual mark intent.
- `web/src/features/canvas-workspace/canvas-comment/bridge.ts`
  Builds the iframe comment bridge script and exports shared bridge constants.
- `web/src/features/canvas-workspace/canvas-comment/CanvasCommentOverlay.tsx`
  Renders active, hover, saved marker, pod stroke, and member overlays over the preview.
- `web/src/features/canvas-workspace/canvas-comment/CanvasCommentPopover.tsx`
  Renders note composition, target summary, queued pod notes, save, delete, and send actions.
- `web/src/features/canvas-workspace/canvas-comment/CanvasCommentPanel.tsx`
  Renders saved comments, selection state, status badges, edit/delete, and send selected.
- `web/src/features/canvas-workspace/canvas-comment/CanvasVisualCommentOverlay.tsx`
  Renders box/pen visual mark tools and emits screenshot annotation attachments.
- `web/src/services/preview-comments/preview-comment-types.ts`
  Service snapshot and API input/output types.
- `web/src/services/preview-comments/preview-comment-api.ts`
  Fetch client for preview comment routes.
- `web/src/services/preview-comments/preview-comment-service.interface.ts`
  DI token and service interface.
- `web/src/services/preview-comments/internal/preview-comment-service.ts`
  Store-owning preview comment service.
- `server/src/routes/comment-routes.ts`
  REST routes for preview comment CRUD and status patches.

Modify:

- `web/src/types.ts`
  Add `CanvasCommentAttachment` to `ChatMessage`.
- `web/src/services/chat-timeline/chat-timeline-types.ts`
  Add `commentAttachments` to user-message append inputs.
- `web/src/services/chat-timeline/internal/chat-timeline-service.ts`
  Store comment attachments in timeline messages.
- `web/src/services/chat-session/chat-session-types.ts`
  Add `commentAttachments` to `SendTurnInput`.
- `web/src/services/chat-session/internal/chat-session-service.ts`
  Upload files as before, pass comment attachments into messages and runs, patch statuses during run lifecycle.
- `web/src/services/run/run-types.ts`
  Add `commentAttachments` to `CreateRunInput`.
- `web/src/services/run/run-api.ts`
  Send comment attachments through `/api/runs`.
- `web/src/components/ChatComposer.tsx`
  Render staged comment chips and accept externally supplied comment attachments.
- `web/src/components/ChatPane.tsx`
  Display comment attachments in user messages and pass staged attachments into composer.
- `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
  Add `commentBridge` and `snapshotBridge` injection.
- `web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`
  Pass through comment and snapshot bridge options.
- `web/src/features/canvas-workspace/CanvasPreview.tsx`
  Listen for `vd-comment-*`, post comment commands, render overlay host, and prefer srcdoc for Comment mode.
- `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
  Add Comment mode, comment toolbar, popover, panel, saved markers, status actions, pod/free-pin/visual state.
- `web/src/features/canvas-workspace/canvas-workspace-types.ts`
  Add `comment` to `FileSurfaceMode`.
- `web/src/features/canvas-workspace/workspace-mode.ts`
  Support guarded transitions into and out of Comment mode.
- `web/src/ProjectEditorPage.tsx`
  Register comment service usage in project editor context and pass active project/conversation state to workspace/chat surfaces.
- `web/src/launch/vibe-design-flow.tsx`
  Register `IPreviewCommentService`.
- `server/src/sqlite-store.ts`
  Add `preview_comments`, `comment_attachments_json`, CRUD helpers, and message mapping.
- `server/src/server.ts`
  Register comment routes, persist user message comment attachments, and hydrate initial project messages with comment attachments.
- `server/src/agent-launcher.ts`
  Format attached preview comments into the composed agent prompt.
- `server/src/server-context.ts`
  Add comment route dependency types if route registration needs a typed context.

Test:

- `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.test.ts`
- `web/src/features/canvas-workspace/canvas-comment/bridge.test.ts`
- `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts`
- `web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts`
- `web/src/features/canvas-workspace/CanvasPreview.test.tsx`
- `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- `web/src/features/canvas-workspace/canvas-comment/CanvasVisualCommentOverlay.test.tsx`
- `web/src/services/preview-comments/internal/preview-comment-service.test.ts`
- `web/src/services/chat-session/internal/chat-session-service.test.ts`
- `web/src/services/chat-timeline/internal/chat-timeline-service.test.ts`
- `web/src/components/ChatPane.test.tsx`
- `server/src/sqlite-store.test.ts`
- `server/src/routes/comment-routes.test.ts`
- `server/src/agent-launcher.test.ts`
- `server/src/main.test.ts`

---

### Task 1: Shared Comment Types And Pure Attachment Helpers

**Files:**
- Create: `web/src/features/canvas-workspace/canvas-comment/canvas-comment-types.ts`
- Create: `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.ts`
- Test: `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.test.ts`
- Modify: `web/src/types.ts`
- Modify: `web/src/features/canvas-workspace/index.ts`

- [ ] **Step 1: Write failing tests for target normalization and attachment formatting**

Create `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildCanvasCommentAttachments,
  canvasCommentTargetFromSnapshot,
  commentToCanvasAttachment,
  messageContentWithCanvasCommentAttachments,
} from './comment-attachment-model';
import type { CanvasPreviewComment } from './canvas-comment-types';

describe('canvas comment attachment model', () => {
  it('normalizes iframe snapshots into bounded comment targets', () => {
    const target = canvasCommentTargetFromSnapshot({
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '[data-vd-id="hero-title"]',
      label: 'h1.hero',
      text: ` ${'Title '.repeat(80)} `,
      position: { x: 10.4, y: 20.5, width: 300.2, height: 88.8 },
      htmlHint: `<h1 data-vd-id="hero-title">${'x'.repeat(240)}</h1>`,
      style: { color: 'rgb(1, 2, 3)', fontSize: '16px' },
    });

    expect(target.text.length).toBeLessThanOrEqual(160);
    expect(target.htmlHint.length).toBeLessThanOrEqual(180);
    expect(target.position).toEqual({ x: 10, y: 21, width: 300, height: 89 });
    expect(target.selectionKind).toBe('element');
  });

  it('builds ordered board-batch attachments from draft notes', () => {
    const attachments = buildCanvasCommentAttachments({
      target: {
        filePath: 'index.html',
        targetId: 'hero-title',
        selector: '[data-vd-id="hero-title"]',
        label: 'h1.hero',
        text: 'Hero title',
        position: { x: 10, y: 20, width: 300, height: 88 },
        htmlHint: '<h1 data-vd-id="hero-title">',
        selectionKind: 'element',
      },
      notes: ['Shorten title', 'Increase contrast'],
    });

    expect(attachments).toMatchObject([
      { order: 1, targetId: 'hero-title', comment: 'Shorten title', source: 'board-batch' },
      { order: 2, targetId: 'hero-title', comment: 'Increase contrast', source: 'board-batch' },
    ]);
  });

  it('converts saved comments into prompt context without mutating message text', () => {
    const saved: CanvasPreviewComment = {
      id: 'comment-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '[data-vd-id="hero-title"]',
      label: 'h1.hero',
      text: 'Hero title',
      position: { x: 10, y: 20, width: 300, height: 88 },
      htmlHint: '<h1 data-vd-id="hero-title">',
      selectionKind: 'element',
      note: 'Make this more concise',
      status: 'open',
      createdAt: 1,
      updatedAt: 2,
    };

    const attachment = commentToCanvasAttachment(saved, 1);
    expect(attachment.source).toBe('saved-comment');
    expect(messageContentWithCanvasCommentAttachments('', [attachment])).toContain('<attached-preview-comments>');
    expect(messageContentWithCanvasCommentAttachments('', [attachment])).toContain('comment: Make this more concise');
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.test.ts
```

Expected: fail because the new files do not exist.

- [ ] **Step 3: Add shared types**

Create `web/src/features/canvas-workspace/canvas-comment/canvas-comment-types.ts`:

```ts
export type CanvasCommentSelectionKind = 'element' | 'pod' | 'visual';
export type CanvasCommentStatus = 'open' | 'attached' | 'applying' | 'needs_review' | 'resolved' | 'failed';
export type CanvasVisualMarkKind = 'click' | 'stroke' | 'click+stroke';
export type CanvasCommentTool = 'picker' | 'pod' | 'visual';

export interface CanvasCommentPoint {
  x: number;
  y: number;
}

export interface CanvasCommentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasCommentStyleSnapshot {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  textAlign?: string;
  fontFamily?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  borderRadius?: string;
}

export interface CanvasCommentMember {
  targetId: string;
  selector: string;
  label: string;
  text: string;
  position: CanvasCommentPosition;
  htmlHint: string;
  style?: CanvasCommentStyleSnapshot;
}

export interface CanvasCommentTargetSnapshot {
  filePath: string;
  targetId: string;
  selector: string;
  label: string;
  text: string;
  position: CanvasCommentPosition;
  hoverPoint?: CanvasCommentPoint;
  htmlHint: string;
  style?: CanvasCommentStyleSnapshot;
  selectionKind?: 'element' | 'pod';
  memberCount?: number;
  podMembers?: CanvasCommentMember[];
}

export interface CanvasCommentTarget {
  filePath: string;
  targetId: string;
  selector: string;
  label: string;
  text: string;
  position: CanvasCommentPosition;
  htmlHint: string;
  style?: CanvasCommentStyleSnapshot;
  selectionKind: 'element' | 'pod';
  memberCount?: number;
  podMembers?: CanvasCommentMember[];
}

export interface CanvasPreviewComment extends CanvasCommentTarget {
  id: string;
  projectId: string;
  conversationId: string;
  note: string;
  status: CanvasCommentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasCommentAttachment {
  id: string;
  order: number;
  filePath: string;
  targetId: string;
  selector: string;
  label: string;
  comment: string;
  currentText: string;
  pagePosition: CanvasCommentPosition;
  htmlHint: string;
  style?: CanvasCommentStyleSnapshot;
  selectionKind: CanvasCommentSelectionKind;
  memberCount?: number;
  podMembers?: CanvasCommentMember[];
  screenshotPath?: string;
  markKind?: CanvasVisualMarkKind;
  intent?: string;
  source: 'saved-comment' | 'board-batch' | 'visual-mark';
}
```

- [ ] **Step 4: Add pure helpers**

Create `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.ts`:

```ts
import type {
  CanvasCommentAttachment,
  CanvasCommentMember,
  CanvasCommentPosition,
  CanvasCommentStyleSnapshot,
  CanvasCommentTarget,
  CanvasCommentTargetSnapshot,
  CanvasPreviewComment,
  CanvasVisualMarkKind,
} from './canvas-comment-types';

export function canvasCommentTargetFromSnapshot(snapshot: CanvasCommentTargetSnapshot): CanvasCommentTarget {
  const podMembers = normalizeMembers(snapshot.podMembers);
  const selectionKind = snapshot.selectionKind === 'pod' ? 'pod' : 'element';
  return {
    filePath: snapshot.filePath,
    targetId: snapshot.targetId,
    selector: snapshot.selector,
    label: snapshot.label,
    text: trimContextText(snapshot.text),
    position: normalizePosition(snapshot.position),
    htmlHint: trimHtmlHint(snapshot.htmlHint),
    style: normalizeStyle(snapshot.style),
    selectionKind,
    ...(selectionKind === 'pod'
      ? {
          memberCount: podMembers.length || Math.max(0, Math.round(snapshot.memberCount ?? 0)),
          ...(podMembers.length > 0 ? { podMembers } : {}),
        }
      : {}),
  };
}

export function commentToCanvasAttachment(comment: CanvasPreviewComment, order: number): CanvasCommentAttachment {
  const podMembers = normalizeMembers(comment.podMembers);
  return {
    id: comment.id,
    order,
    filePath: comment.filePath,
    targetId: comment.targetId,
    selector: comment.selector,
    label: comment.label,
    comment: comment.note,
    currentText: trimContextText(comment.text),
    pagePosition: normalizePosition(comment.position),
    htmlHint: trimHtmlHint(comment.htmlHint),
    style: normalizeStyle(comment.style),
    selectionKind: comment.selectionKind,
    ...(comment.selectionKind === 'pod'
      ? {
          memberCount: podMembers.length || Math.max(0, Math.round(comment.memberCount ?? 0)),
          ...(podMembers.length > 0 ? { podMembers } : {}),
        }
      : {}),
    source: 'saved-comment',
  };
}

export function commentsToCanvasAttachments(comments: CanvasPreviewComment[]): CanvasCommentAttachment[] {
  return comments.map((comment, index) => commentToCanvasAttachment(comment, index + 1));
}

export function buildCanvasCommentAttachments(input: {
  target: CanvasCommentTarget;
  notes: string[];
}): CanvasCommentAttachment[] {
  const podMembers = normalizeMembers(input.target.podMembers);
  return input.notes
    .map((note) => note.trim())
    .filter(Boolean)
    .map((note, index) => ({
      id: `${input.target.targetId}-draft-${index + 1}`,
      order: index + 1,
      filePath: input.target.filePath,
      targetId: input.target.targetId,
      selector: input.target.selector,
      label: input.target.label,
      comment: note,
      currentText: trimContextText(input.target.text),
      pagePosition: normalizePosition(input.target.position),
      htmlHint: trimHtmlHint(input.target.htmlHint),
      style: normalizeStyle(input.target.style),
      selectionKind: input.target.selectionKind,
      ...(input.target.selectionKind === 'pod'
        ? {
            memberCount: podMembers.length || Math.max(0, Math.round(input.target.memberCount ?? 0)),
            ...(podMembers.length > 0 ? { podMembers } : {}),
          }
        : {}),
      source: 'board-batch',
    }));
}

export function messageContentWithCanvasCommentAttachments(
  content: string,
  commentAttachments: CanvasCommentAttachment[],
): string {
  if (commentAttachments.length === 0) return content;
  const visibleContent = content.trim() || '(No extra typed instruction.)';
  return `${visibleContent}${renderCanvasCommentAttachmentContext(commentAttachments)}`;
}

export function visualAnnotationIntent(markKind: CanvasVisualMarkKind): string {
  if (markKind === 'click') return 'The user clicked the marked preview region.';
  if (markKind === 'click+stroke') return 'The user clicked and drew red strokes over the marked preview region.';
  return 'The user drew red strokes over the marked preview region.';
}

function renderCanvasCommentAttachmentContext(commentAttachments: CanvasCommentAttachment[]): string {
  const lines = [
    '',
    '',
    '<attached-preview-comments>',
    'Scope: apply the user request to these preview targets by default. For visual marks, inspect the screenshot and modify the marked region first. Preserve unrelated areas.',
  ];
  for (const item of commentAttachments) {
    const position = normalizePosition(item.pagePosition);
    lines.push(
      '',
      `${item.order}. ${item.targetId}`,
      `targetKind: ${item.selectionKind}`,
      `file: ${item.filePath}`,
      `selector: ${item.selector || '(none)'}`,
      `label: ${item.label || '(unlabeled)'}`,
      `position: x${position.x} y${position.y} ${position.width}x${position.height}`,
      `currentText: ${trimContextText(item.currentText) || '(empty)'}`,
      `htmlHint: ${trimHtmlHint(item.htmlHint) || '(none)'}`,
      `computedStyle: ${formatStyle(item.style) || '(none)'}`,
      `comment: ${item.comment}`,
    );
    if (item.selectionKind === 'pod') {
      lines.push(`memberCount: ${item.memberCount ?? item.podMembers?.length ?? 0}`);
    }
    if (item.selectionKind === 'visual') {
      lines.push(`screenshot: ${item.screenshotPath || '(missing)'}`);
      lines.push(`markKind: ${item.markKind || 'stroke'}`);
      lines.push(`intent: ${item.intent || visualAnnotationIntent(item.markKind || 'stroke')}`);
    }
  }
  lines.push('</attached-preview-comments>');
  return lines.join('\n');
}

export function normalizePosition(position: Partial<CanvasCommentPosition> | undefined): CanvasCommentPosition {
  return {
    x: finiteRounded(position?.x),
    y: finiteRounded(position?.y),
    width: Math.max(1, finiteRounded(position?.width)),
    height: Math.max(1, finiteRounded(position?.height)),
  };
}

export function trimContextText(value: string | undefined): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export function trimHtmlHint(value: string | undefined): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function normalizeMembers(members: CanvasCommentMember[] | undefined): CanvasCommentMember[] {
  if (!Array.isArray(members)) return [];
  return members
    .filter((member) => member && member.targetId && member.selector)
    .slice(0, 30)
    .map((member) => ({
      targetId: member.targetId,
      selector: member.selector,
      label: member.label || member.targetId,
      text: trimContextText(member.text),
      position: normalizePosition(member.position),
      htmlHint: trimHtmlHint(member.htmlHint),
      style: normalizeStyle(member.style),
    }));
}

function normalizeStyle(style: CanvasCommentStyleSnapshot | undefined): CanvasCommentStyleSnapshot | undefined {
  if (!style) return undefined;
  const next: CanvasCommentStyleSnapshot = {};
  for (const key of Object.keys(style) as Array<keyof CanvasCommentStyleSnapshot>) {
    const value = style[key];
    if (typeof value === 'string' && value.trim()) next[key] = value.trim();
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function formatStyle(style: CanvasCommentStyleSnapshot | undefined): string {
  if (!style) return '';
  return Object.entries(style)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, ' ').trim()}`)
    .join('; ');
}

function finiteRounded(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}
```

- [ ] **Step 5: Extend `ChatMessage` type**

In `web/src/types.ts`, import and add the new property:

```ts
import type { CanvasCommentAttachment } from './features/canvas-workspace/canvas-comment/canvas-comment-types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turnStatus?: 'queued';
  runStatus?: RunStatus;
  startedAt?: number;
  createdAt?: number;
  endedAt?: number;
  events?: AgentEvent[];
  attachments?: ChatAttachment[];
  commentAttachments?: CanvasCommentAttachment[];
  producedFiles?: ProjectFile[];
  projectKind?: string;
  runId?: string;
}
```

- [ ] **Step 6: Export comment types**

In `web/src/features/canvas-workspace/index.ts`, add:

```ts
export type {
  CanvasCommentAttachment,
  CanvasCommentMember,
  CanvasCommentPoint,
  CanvasCommentPosition,
  CanvasCommentSelectionKind,
  CanvasCommentStatus,
  CanvasCommentStyleSnapshot,
  CanvasCommentTarget,
  CanvasCommentTargetSnapshot,
  CanvasCommentTool,
  CanvasPreviewComment,
  CanvasVisualMarkKind,
} from './canvas-comment/canvas-comment-types';
```

- [ ] **Step 7: Verify tests pass and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.test.ts
pnpm --filter @vibe-design/web type-check
```

Expected: both pass.

Commit:

```bash
git add web/src/types.ts web/src/features/canvas-workspace/index.ts web/src/features/canvas-workspace/canvas-comment
git commit -m "feat: add canvas comment attachment model"
```

---

### Task 2: Server Persistence And Comment Routes

**Files:**
- Modify: `server/src/sqlite-store.ts`
- Create: `server/src/routes/comment-routes.ts`
- Test: `server/src/sqlite-store.test.ts`
- Test: `server/src/routes/comment-routes.test.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/server-context.ts`

- [ ] **Step 1: Write SQLite tests for comment CRUD and message comment attachments**

Add tests to `server/src/sqlite-store.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConversationInStore,
  listPreviewCommentsFromStore,
  upsertMessageInStore,
  upsertPreviewCommentInStore,
} from './sqlite-store';

describe('preview comment store', () => {
  const dirs: string[] = [];

  afterEach(() => {
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  function projectsDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'vd-comments-'));
    dirs.push(dir);
    return dir;
  }

  it('upserts preview comments by project conversation file and target', () => {
    const dir = projectsDir();
    createConversationInStore(dir, 'project-1', 'conversation-1', 'Default');

    const first = upsertPreviewCommentInStore(dir, 'project-1', 'conversation-1', {
      target: {
        filePath: 'index.html',
        targetId: 'hero-title',
        selector: '[data-vd-id="hero-title"]',
        label: 'h1.hero',
        text: 'Hero',
        position: { x: 1, y: 2, width: 3, height: 4 },
        htmlHint: '<h1>',
        selectionKind: 'element',
      },
      note: 'First note',
    });
    const second = upsertPreviewCommentInStore(dir, 'project-1', 'conversation-1', {
      target: { ...first, note: undefined, status: undefined },
      note: 'Updated note',
    });

    expect(second.id).toBe(first.id);
    expect(second.note).toBe('Updated note');
    expect(listPreviewCommentsFromStore(dir, 'project-1', 'conversation-1')).toHaveLength(1);
  });

  it('persists comment attachments separately from file attachments', () => {
    const dir = projectsDir();
    createConversationInStore(dir, 'project-1', 'conversation-1', 'Default');

    const message = upsertMessageInStore(dir, 'project-1', 'conversation-1', {
      id: 'message-1',
      role: 'user',
      content: 'Apply this',
      attachments: [{ name: 'image.png' }],
      commentAttachments: [{ id: 'comment-1', order: 1, targetId: 'hero', comment: 'Fix this' }],
    });

    expect(message.attachments).toEqual([{ name: 'image.png' }]);
    expect(message.commentAttachments).toEqual([{ id: 'comment-1', order: 1, targetId: 'hero', comment: 'Fix this' }]);
  });
});
```

- [ ] **Step 2: Run SQLite tests and verify failure**

Run:

```bash
pnpm --filter @vibe-design/server test server/src/sqlite-store.test.ts
```

Expected: fail because comment store exports and `commentAttachments` do not exist.

- [ ] **Step 3: Add store schema and helpers**

In `server/src/sqlite-store.ts`, extend `StoredConversationMessage` and `UpsertMessageInput`:

```ts
export interface StoredConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: unknown[];
  commentAttachments: unknown[];
  events: unknown[];
  runId: string | null;
  runStatus: RunStatus | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface UpsertMessageInput {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  attachments?: unknown[];
  commentAttachments?: unknown[];
  events?: unknown[];
  runId?: string | null;
  runStatus?: RunStatus | null;
  startedAt?: number | null;
  endedAt?: number | null;
}
```

Add row fields:

```ts
interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments_json: string;
  comment_attachments_json: string;
  events_json: string;
  run_id: string | null;
  run_status: RunStatus | null;
  position: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}
```

Add comment interfaces:

```ts
export interface PreviewCommentStoreInput {
  target: {
    filePath: string;
    targetId: string;
    selector: string;
    label: string;
    text?: string;
    position: { x: number; y: number; width: number; height: number };
    htmlHint?: string;
    style?: Record<string, string>;
    selectionKind?: 'element' | 'pod' | 'visual';
    memberCount?: number;
    podMembers?: unknown[];
    screenshotPath?: string;
    markKind?: string;
  };
  note: string;
}
```

Inside `migrate`, after `CREATE TABLE IF NOT EXISTS messages`, add:

```ts
const messageColumns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
if (!messageColumns.some((column) => column.name === 'comment_attachments_json')) {
  db.exec(`ALTER TABLE messages ADD COLUMN comment_attachments_json TEXT NOT NULL DEFAULT '[]'`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS preview_comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    target_id TEXT NOT NULL,
    selector TEXT NOT NULL,
    label TEXT NOT NULL,
    text TEXT NOT NULL,
    position_json TEXT NOT NULL,
    html_hint TEXT NOT NULL,
    style_json TEXT,
    selection_kind TEXT NOT NULL,
    member_count INTEGER,
    pod_members_json TEXT,
    screenshot_path TEXT,
    mark_kind TEXT,
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, conversation_id, file_path, target_id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_preview_comments_conversation
    ON preview_comments(project_id, conversation_id, updated_at DESC);
`);
```

Update message selects/inserts to include `comment_attachments_json`, set `commentAttachments`, and parse in `messageFromRow`.

Add store functions:

```ts
export function listPreviewCommentsFromStore(projectsDir: string, projectId: string, conversationId: string) {
  const rows = getStore(projectsDir)
    .prepare(
      `SELECT id, project_id, conversation_id, file_path, target_id, selector, label, text,
        position_json, html_hint, style_json, selection_kind, member_count, pod_members_json,
        screenshot_path, mark_kind, note, status, created_at, updated_at
       FROM preview_comments
       WHERE project_id = ? AND conversation_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(projectId, conversationId) as Array<Record<string, unknown>>;
  return rows.map(previewCommentFromRow);
}

export function upsertPreviewCommentInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  input: PreviewCommentStoreInput,
) {
  const target = input.target;
  const note = normalizeRequiredText(input.note, 'comment note');
  const filePath = normalizeRequiredText(target.filePath, 'filePath');
  const targetId = normalizeRequiredText(target.targetId, 'targetId');
  const selector = normalizeRequiredText(target.selector, 'selector');
  const label = normalizeRequiredText(target.label, 'label');
  const position = normalizePosition(target.position);
  const now = Date.now();
  const db = getStore(projectsDir);
  const existing = db
    .prepare(
      `SELECT id, created_at FROM preview_comments
       WHERE project_id = ? AND conversation_id = ? AND file_path = ? AND target_id = ?`,
    )
    .get(projectId, conversationId, filePath, targetId) as { id: string; created_at: number } | undefined;
  const id = existing?.id ?? `comment-${cryptoRandomId()}`;
  const createdAt = existing?.created_at ?? now;
  db.prepare(
    `INSERT INTO preview_comments (
      id, project_id, conversation_id, file_path, target_id, selector, label, text,
      position_json, html_hint, style_json, selection_kind, member_count, pod_members_json,
      screenshot_path, mark_kind, note, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, conversation_id, file_path, target_id) DO UPDATE SET
      selector = excluded.selector,
      label = excluded.label,
      text = excluded.text,
      position_json = excluded.position_json,
      html_hint = excluded.html_hint,
      style_json = excluded.style_json,
      selection_kind = excluded.selection_kind,
      member_count = excluded.member_count,
      pod_members_json = excluded.pod_members_json,
      screenshot_path = excluded.screenshot_path,
      mark_kind = excluded.mark_kind,
      note = excluded.note,
      status = 'open',
      updated_at = excluded.updated_at`,
  ).run(
    id,
    projectId,
    conversationId,
    filePath,
    targetId,
    selector,
    label,
    compactText(target.text, 160),
    JSON.stringify(position),
    compactText(target.htmlHint, 180),
    target.style ? JSON.stringify(target.style) : null,
    target.selectionKind === 'pod' ? 'pod' : target.selectionKind === 'visual' ? 'visual' : 'element',
    typeof target.memberCount === 'number' ? Math.max(0, Math.round(target.memberCount)) : null,
    Array.isArray(target.podMembers) ? JSON.stringify(target.podMembers.slice(0, 30)) : null,
    typeof target.screenshotPath === 'string' ? target.screenshotPath.slice(0, 500) : null,
    typeof target.markKind === 'string' ? target.markKind.slice(0, 40) : null,
    note,
    'open',
    createdAt,
    now,
  );
  return listPreviewCommentsFromStore(projectsDir, projectId, conversationId).find((comment) => comment.id === id);
}
```

Also add `updatePreviewCommentStatusInStore` and `deletePreviewCommentFromStore` with the same project/conversation scoping.

- [ ] **Step 4: Write route tests**

Create `server/src/routes/comment-routes.test.ts` with an Express app using the registered route and a temp store. Cover:

```ts
it('creates lists patches and deletes preview comments', async () => {
  // POST valid body returns { comment }
  // GET returns one comment
  // PATCH status resolved returns resolved comment
  // DELETE returns { ok: true }
});

it('rejects empty notes and invalid statuses', async () => {
  // POST note '' returns 400
  // PATCH status 'bad' returns 400
});
```

Use the same request helper style as existing server route tests in this repo. If no helper exists, start the Express app on an ephemeral port and use `fetch`.

- [ ] **Step 5: Add route module and register it**

Create `server/src/routes/comment-routes.ts`:

```ts
import type { Express, Request, Response } from 'express';
import type { RouteDeps } from '../server-context.js';
import {
  deletePreviewCommentFromStore,
  listPreviewCommentsFromStore,
  updatePreviewCommentStatusInStore,
  upsertPreviewCommentInStore,
} from '../sqlite-store.js';
import { isSafeConversationId } from '../conversations.js';
import { isSafeProjectId } from './project-routes.js';

type CommentRouteDeps = RouteDeps<'http' | 'paths'>;
type CommentParams = { id: string; conversationId: string; commentId?: string };

export function registerCommentRoutes(app: Express, ctx: CommentRouteDeps): void {
  const { sendApiError } = ctx.http;

  app.get('/api/projects/:id/conversations/:conversationId/comments', (req: Request<CommentParams>, res: Response) => {
    if (!validParams(req.params)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
      return;
    }
    res.json({ comments: listPreviewCommentsFromStore(ctx.paths.projectsDir, req.params.id, req.params.conversationId) });
  });

  app.post('/api/projects/:id/conversations/:conversationId/comments', (req: Request<CommentParams>, res: Response) => {
    if (!validParams(req.params)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
      return;
    }
    try {
      const comment = upsertPreviewCommentInStore(ctx.paths.projectsDir, req.params.id, req.params.conversationId, req.body);
      res.json({ comment });
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : 'comment body is invalid');
    }
  });

  app.patch('/api/projects/:id/conversations/:conversationId/comments/:commentId', (req: Request<CommentParams>, res: Response) => {
    if (!validParams(req.params) || !req.params.commentId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
      return;
    }
    try {
      const comment = updatePreviewCommentStatusInStore(
        ctx.paths.projectsDir,
        req.params.id,
        req.params.conversationId,
        req.params.commentId,
        req.body?.status,
      );
      if (!comment) {
        sendApiError(res, 404, 'NOT_FOUND', 'comment not found');
        return;
      }
      res.json({ comment });
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : 'comment status is invalid');
    }
  });

  app.delete('/api/projects/:id/conversations/:conversationId/comments/:commentId', (req: Request<CommentParams>, res: Response) => {
    if (!validParams(req.params) || !req.params.commentId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
      return;
    }
    const ok = deletePreviewCommentFromStore(ctx.paths.projectsDir, req.params.id, req.params.conversationId, req.params.commentId);
    if (!ok) {
      sendApiError(res, 404, 'NOT_FOUND', 'comment not found');
      return;
    }
    res.json({ ok: true });
  });
}

function validParams(params: CommentParams): boolean {
  return isSafeProjectId(params.id) && isSafeConversationId(params.conversationId);
}
```

In `server/src/server.ts`, import and register:

```ts
import { registerCommentRoutes } from './routes/comment-routes.js';

registerCommentRoutes(app, ctx);
```

- [ ] **Step 6: Verify server tests and commit**

Run:

```bash
pnpm --filter @vibe-design/server test server/src/sqlite-store.test.ts server/src/routes/comment-routes.test.ts
pnpm --filter @vibe-design/server type-check
```

Expected: pass.

Commit:

```bash
git add server/src/sqlite-store.ts server/src/routes/comment-routes.ts server/src/routes/comment-routes.test.ts server/src/server.ts server/src/server-context.ts server/src/sqlite-store.test.ts
git commit -m "feat: persist preview comments"
```

---

### Task 3: Web Preview Comment Service

**Files:**
- Create: `web/src/services/preview-comments/preview-comment-types.ts`
- Create: `web/src/services/preview-comments/preview-comment-api.ts`
- Create: `web/src/services/preview-comments/preview-comment-service.interface.ts`
- Create: `web/src/services/preview-comments/internal/preview-comment-service.ts`
- Test: `web/src/services/preview-comments/internal/preview-comment-service.test.ts`
- Modify: `web/src/launch/vibe-design-flow.tsx`

- [ ] **Step 1: Write failing service tests**

Create `web/src/services/preview-comments/internal/preview-comment-service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { PreviewCommentService } from './preview-comment-service';
import type { PreviewCommentApi } from '../preview-comment-api';

describe('PreviewCommentService', () => {
  it('loads and exposes comments for the active conversation', async () => {
    const api: PreviewCommentApi = {
      list: vi.fn().mockResolvedValue([{ id: 'comment-1', targetId: 'hero', note: 'Fix hero' }]),
      upsert: vi.fn(),
      patchStatus: vi.fn(),
      delete: vi.fn(),
    };
    const service = new PreviewCommentService(api, 'project-1');

    await service.load('conversation-1');

    expect(api.list).toHaveBeenCalledWith('project-1', 'conversation-1');
    expect(service.getSnapshot().comments).toEqual([{ id: 'comment-1', targetId: 'hero', note: 'Fix hero' }]);
  });

  it('upserts then moves saved comment to the front of the store', async () => {
    const saved = { id: 'comment-2', targetId: 'cta', note: 'Fix CTA' };
    const api: PreviewCommentApi = {
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(saved),
      patchStatus: vi.fn(),
      delete: vi.fn(),
    };
    const service = new PreviewCommentService(api, 'project-1');

    const result = await service.upsert('conversation-1', { target: { targetId: 'cta' }, note: 'Fix CTA' });

    expect(result).toEqual(saved);
    expect(service.getSnapshot().comments[0]).toEqual(saved);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/services/preview-comments/internal/preview-comment-service.test.ts
```

Expected: fail because service files do not exist.

- [ ] **Step 3: Implement API and service**

Create `web/src/services/preview-comments/preview-comment-types.ts`:

```ts
import type { CanvasPreviewComment } from '../../features/canvas-workspace/canvas-comment/canvas-comment-types';

export interface PreviewCommentSnapshot {
  comments: CanvasPreviewComment[];
  loading: boolean;
  error: string | null;
}

export interface PreviewCommentUpsertInput {
  target: unknown;
  note: string;
}
```

Create `web/src/services/preview-comments/preview-comment-api.ts`:

```ts
import type { CanvasCommentStatus, CanvasPreviewComment } from '../../features/canvas-workspace/canvas-comment/canvas-comment-types';
import type { PreviewCommentUpsertInput } from './preview-comment-types';

export interface PreviewCommentApi {
  list(projectId: string, conversationId: string): Promise<CanvasPreviewComment[]>;
  upsert(projectId: string, conversationId: string, input: PreviewCommentUpsertInput): Promise<CanvasPreviewComment>;
  patchStatus(projectId: string, conversationId: string, commentId: string, status: CanvasCommentStatus): Promise<CanvasPreviewComment>;
  delete(projectId: string, conversationId: string, commentId: string): Promise<void>;
}

export class FetchPreviewCommentApi implements PreviewCommentApi {
  async list(projectId: string, conversationId: string): Promise<CanvasPreviewComment[]> {
    const response = await fetch(commentCollectionUrl(projectId, conversationId));
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readError(data, 'Could not load preview comments.'));
    return Array.isArray(data?.comments) ? data.comments : [];
  }

  async upsert(projectId: string, conversationId: string, input: PreviewCommentUpsertInput): Promise<CanvasPreviewComment> {
    const response = await fetch(commentCollectionUrl(projectId, conversationId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.comment) throw new Error(readError(data, 'Could not save preview comment.'));
    return data.comment;
  }

  async patchStatus(projectId: string, conversationId: string, commentId: string, status: CanvasCommentStatus): Promise<CanvasPreviewComment> {
    const response = await fetch(`${commentCollectionUrl(projectId, conversationId)}/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.comment) throw new Error(readError(data, 'Could not update preview comment.'));
    return data.comment;
  }

  async delete(projectId: string, conversationId: string, commentId: string): Promise<void> {
    const response = await fetch(`${commentCollectionUrl(projectId, conversationId)}/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Could not delete preview comment.');
  }
}

function commentCollectionUrl(projectId: string, conversationId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments`;
}

function readError(data: unknown, fallback: string): string {
  return data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : fallback;
}
```

Create service interface and implementation with `subscribe`, `getSnapshot`, `load`, `upsert`, `patchStatus`, and `delete`.

- [ ] **Step 4: Register DI service**

In `web/src/launch/vibe-design-flow.tsx`, import:

```ts
import { FetchPreviewCommentApi } from '../services/preview-comments/preview-comment-api';
import { PreviewCommentService } from '../services/preview-comments/internal/preview-comment-service';
import { IPreviewCommentService, type IPreviewCommentService as IPreviewCommentServiceContract } from '../services/preview-comments/preview-comment-service.interface';
```

Extend options:

```ts
previewCommentService?: IPreviewCommentServiceContract;
```

Initialize and register:

```ts
const previewCommentService =
  this.options.previewCommentService ?? new PreviewCommentService(new FetchPreviewCommentApi(), projectId ?? 'default');

serviceCollection.set(IPreviewCommentService, previewCommentService);
```

- [ ] **Step 5: Verify service tests and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/services/preview-comments/internal/preview-comment-service.test.ts
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/services/preview-comments web/src/launch/vibe-design-flow.tsx
git commit -m "feat: add preview comment service"
```

---

### Task 4: Comment Bridge Injection And Runtime Tests

**Files:**
- Create: `web/src/features/canvas-workspace/canvas-comment/bridge.ts`
- Test: `web/src/features/canvas-workspace/canvas-comment/bridge.test.ts`
- Modify: `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- Modify: `web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`
- Test: `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts`
- Test: `web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts`

- [ ] **Step 1: Write bridge injection tests**

Add to `build-preview-srcdoc.test.ts`:

```ts
it('injects the comment bridge when commentBridge is enabled', () => {
  const srcdoc = buildPreviewSrcdoc('<main><h1>Hello</h1></main>', {
    editBridge: false,
    commentBridge: true,
    sizeBridge: false,
  });

  expect(srcdoc).toContain('data-vd-comment-bridge');
  expect(srcdoc).toContain('vd-comment-mode');
  expect(srcdoc).not.toContain('data-vd-edit-bridge');
});
```

Create `canvas-comment/bridge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCanvasCommentBridge } from './bridge';

describe('buildCanvasCommentBridge', () => {
  it('contains picker pod and active target protocol handlers', () => {
    const bridge = buildCanvasCommentBridge(false);
    expect(bridge).toContain('vd-comment-mode');
    expect(bridge).toContain('vd-comment-select');
    expect(bridge).toContain('vd-comment-pod-select');
    expect(bridge).toContain('vd-comment-active-target-update');
  });
});
```

- [ ] **Step 2: Run failing runtime tests**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts web/src/features/canvas-workspace/canvas-comment/bridge.test.ts
```

Expected: fail because bridge is not implemented.

- [ ] **Step 3: Implement bridge builder**

Create `web/src/features/canvas-workspace/canvas-comment/bridge.ts` with constants:

```ts
export const CANVAS_COMMENT_BRIDGE_ATTR = 'data-vd-comment-bridge';
export const CANVAS_COMMENT_TARGET_SELECTOR = '[data-vd-id],[data-vd-source-path],[data-vd-runtime-id]';

export function buildCanvasCommentBridge(enabled: boolean): string {
  return `<script ${CANVAS_COMMENT_BRIDGE_ATTR}>(() => {
  const targetSelector = '${CANVAS_COMMENT_TARGET_SELECTOR}';
  const excludedSelector = 'script,style,meta,link,title,head,noscript,template';
  let commentEnabled = ${JSON.stringify(enabled)};
  let mode = 'picker';
  let activeTargetId = null;
  let activeSelector = null;
  let hoveredId = null;
  let drawing = false;
  let stroke = [];
  let targetsTimer = null;

  function post(message) { window.parent.postMessage(message, '*'); }
  function stableIdForElement(element) {
    return element.getAttribute('data-vd-id')
      || element.getAttribute('data-vd-source-path')
      || element.getAttribute('data-vd-runtime-id')
      || element.getAttribute('id')
      || '';
  }
  function selectorForElement(element) {
    const id = stableIdForElement(element);
    if (element.getAttribute('data-vd-id')) return '[data-vd-id="' + cssEscape(id) + '"]';
    if (element.getAttribute('data-vd-source-path')) return '[data-vd-source-path="' + cssEscape(id) + '"]';
    if (element.getAttribute('data-vd-runtime-id')) return '[data-vd-runtime-id="' + cssEscape(id) + '"]';
    if (element.id) return '#' + cssEscape(element.id);
    return null;
  }
  function cssEscape(value) { return String(value).replace(/"/g, '\\\\"').replace(/\\\\/g, '\\\\\\\\'); }
  function visible(element) {
    if (!element || element.matches(excludedSelector)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
  }
  function styleSnapshot(element) {
    const style = window.getComputedStyle(element);
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
      fontFamily: style.fontFamily,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      borderRadius: style.borderTopLeftRadius
    };
  }
  function targetFrom(element, point) {
    if (!visible(element)) return null;
    const id = stableIdForElement(element);
    const selector = selectorForElement(element);
    if (!id || !selector) return null;
    const rect = element.getBoundingClientRect();
    const className = typeof element.className === 'string' && element.className.trim()
      ? '.' + element.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    const htmlHint = (element.outerHTML || '').replace(/\\s+/g, ' ').match(/^<[^>]+>/);
    return {
      targetId: id,
      selector,
      label: element.localName.toLowerCase() + className,
      text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      htmlHint: (htmlHint ? htmlHint[0] : '').slice(0, 180),
      style: styleSnapshot(element),
      ...(point ? { hoverPoint: { x: Math.round(point.x), y: Math.round(point.y) } } : {})
    };
  }
  function closestTarget(event) {
    const start = event.target instanceof Element ? event.target : null;
    if (!start) return null;
    let node = start;
    while (node && node !== document.documentElement) {
      if (node.matches(targetSelector) && visible(node)) return node;
      node = node.parentElement;
    }
    return null;
  }
  function allTargets() {
    return Array.from(document.querySelectorAll(targetSelector)).slice(0, 5000).map((element) => targetFrom(element)).filter(Boolean);
  }
  function scheduleTargets() {
    if (!commentEnabled) return;
    if (targetsTimer) window.clearTimeout(targetsTimer);
    targetsTimer = window.setTimeout(() => post({ type: 'vd-comment-targets', targets: allTargets() }), 80);
  }
  function relativePoint(event) { return { x: Math.round(event.clientX), y: Math.round(event.clientY) }; }
  function postStroke(type) { post({ type, points: stroke.slice() }); }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.type) return;
    if (data.type === 'vd-comment-mode') {
      commentEnabled = !!data.enabled;
      mode = data.mode === 'pod' ? 'pod' : 'picker';
      document.documentElement.toggleAttribute('data-vd-comment-mode', commentEnabled);
      document.documentElement.setAttribute('data-vd-comment-mode-kind', mode);
      if (commentEnabled) scheduleTargets();
      if (!commentEnabled || mode !== 'pod') {
        drawing = false;
        stroke = [];
        post({ type: 'vd-comment-pod-clear' });
      }
    }
    if (data.type === 'vd-comment-active-target') {
      activeTargetId = typeof data.targetId === 'string' ? data.targetId : null;
      activeSelector = typeof data.selector === 'string' ? data.selector : null;
      const element = activeSelector ? document.querySelector(activeSelector) : null;
      const payload = element ? targetFrom(element) : null;
      if (payload) post({ type: 'vd-comment-active-target-update', target: payload });
    }
  });

  document.addEventListener('mouseover', (event) => {
    if (!commentEnabled || mode !== 'picker') return;
    const element = closestTarget(event);
    const payload = element ? targetFrom(element) : null;
    if (!payload || payload.targetId === hoveredId) return;
    hoveredId = payload.targetId;
    post({ type: 'vd-comment-hover', target: payload });
  }, true);

  document.addEventListener('mouseout', () => {
    if (!commentEnabled || mode !== 'picker') return;
    hoveredId = null;
    post({ type: 'vd-comment-leave' });
  }, true);

  document.addEventListener('click', (event) => {
    if (!commentEnabled || mode !== 'picker') return;
    const element = closestTarget(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = targetFrom(element, { x: event.clientX, y: event.clientY });
    if (payload) post({ type: 'vd-comment-select', target: payload });
  }, true);

  document.addEventListener('pointerdown', (event) => {
    if (!commentEnabled || mode !== 'pod' || event.button !== 0) return;
    drawing = true;
    stroke = [relativePoint(event)];
    event.preventDefault();
    event.stopPropagation();
    postStroke('vd-comment-pod-stroke');
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!drawing || mode !== 'pod') return;
    stroke.push(relativePoint(event));
    event.preventDefault();
    event.stopPropagation();
    postStroke('vd-comment-pod-stroke');
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (!drawing || mode !== 'pod') return;
    drawing = false;
    event.preventDefault();
    event.stopPropagation();
    postStroke('vd-comment-pod-select');
  }, true);

  new MutationObserver(scheduleTargets).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  window.addEventListener('resize', scheduleTargets);
  if (commentEnabled) scheduleTargets();
})();</script>`;
}
```

- [ ] **Step 4: Integrate into srcdoc builders**

In `build-preview-srcdoc.ts`:

```ts
import { buildCanvasCommentBridge } from '../canvas-comment/bridge';

export interface BuildPreviewSrcdocOptions {
  editBridge: boolean;
  commentBridge?: boolean;
  snapshotBridge?: boolean;
  sizeBridge?: boolean;
}
```

Inject after size bridge and before edit bridge:

```ts
if (options.commentBridge) {
  documentHtml = injectBeforeBodyEnd(documentHtml, buildCanvasCommentBridge(true));
}
```

In `build-design-runtime-srcdoc.ts`, extend options and pass `commentBridge` and `snapshotBridge` to `buildPreviewSrcdoc`.

- [ ] **Step 5: Verify runtime tests and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/canvas-comment/bridge.test.ts web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/features/canvas-workspace/canvas-comment/bridge.ts web/src/features/canvas-workspace/canvas-comment/bridge.test.ts web/src/features/canvas-workspace/runtime
git commit -m "feat: add canvas comment bridge"
```

---

### Task 5: CanvasPreview Comment Message Handling

**Files:**
- Modify: `web/src/features/canvas-workspace/CanvasPreview.tsx`
- Test: `web/src/features/canvas-workspace/CanvasPreview.test.tsx`

- [ ] **Step 1: Write failing CanvasPreview tests**

Add tests:

```ts
it('posts vd-comment-mode when comment mode is active', () => {
  const file = { name: 'index.html', path: 'index.html', kind: 'html' as const, mime: 'text/html', contents: '<main data-vd-id="hero">Hero</main>' };
  const { container } = render(<CanvasPreview file={file} commentMode commentTool="picker" />);
  const iframe = container.querySelector<HTMLIFrameElement>('[data-testid="canvas-preview-srcdoc"]');
  const postMessage = vi.fn();
  Object.defineProperty(iframe?.contentWindow ?? {}, 'postMessage', { value: postMessage });

  fireEvent.load(iframe!);

  expect(postMessage).toHaveBeenCalledWith({ type: 'vd-comment-mode', enabled: true, mode: 'picker' }, '*');
});

it('forwards vd-comment-select from the active iframe', () => {
  const onCommentSelect = vi.fn();
  const file = { name: 'index.html', path: 'index.html', kind: 'html' as const, mime: 'text/html', contents: '<main data-vd-id="hero">Hero</main>' };
  const { container } = render(<CanvasPreview file={file} commentMode onCommentSelect={onCommentSelect} />);
  const iframe = container.querySelector<HTMLIFrameElement>('[data-testid="canvas-preview-srcdoc"]');

  window.dispatchEvent(new MessageEvent('message', {
    source: iframe?.contentWindow ?? null,
    data: {
      type: 'vd-comment-select',
      target: {
        targetId: 'hero',
        selector: '[data-vd-id="hero"]',
        label: 'main',
        text: 'Hero',
        position: { x: 1, y: 2, width: 3, height: 4 },
        htmlHint: '<main>',
      },
    },
  }));

  expect(onCommentSelect).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'hero', filePath: 'index.html' }));
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/CanvasPreview.test.tsx
```

Expected: fail because props and message handling are not implemented.

- [ ] **Step 3: Add props and message union**

In `CanvasPreview.tsx`, extend imports and props:

```ts
import type {
  CanvasCommentPoint,
  CanvasCommentTargetSnapshot,
  CanvasCommentTool,
} from './canvas-comment/canvas-comment-types';

export interface CanvasPreviewProps {
  file: WorkspaceFile;
  files?: WorkspaceFile[];
  editMode?: boolean;
  commentMode?: boolean;
  commentTool?: Exclude<CanvasCommentTool, 'visual'>;
  activeCommentTargetId?: string | null;
  onCommentTargetsChange?: (targets: CanvasCommentTargetSnapshot[]) => void;
  onCommentHoverChange?: (target: CanvasCommentTargetSnapshot | null) => void;
  onCommentSelect?: (target: CanvasCommentTargetSnapshot) => void;
  onCommentPodStroke?: (points: CanvasCommentPoint[]) => void;
  onCommentPodSelect?: (points: CanvasCommentPoint[]) => void;
}
```

Extend `CanvasPreviewHostMessage` with `vd-comment-*` messages.

- [ ] **Step 4: Force srcdoc when comment mode is active**

Change:

```ts
const showUrlFrame = isHtmlPreview && !editMode && Boolean(file.url);
```

to:

```ts
const showUrlFrame = isHtmlPreview && !editMode && !commentMode && Boolean(file.url);
```

Pass `commentBridge: commentMode` and `snapshotBridge: commentMode` into `buildDesignRuntimeSrcdoc`.

- [ ] **Step 5: Post and handle comment messages**

Add a replay command:

```ts
function replayCommentCommands() {
  postCommentCommand(srcdocFrameRef.current, isHtmlPreview && commentMode, {
    type: 'vd-comment-mode',
    enabled: Boolean(commentMode),
    mode: commentTool === 'pod' ? 'pod' : 'picker',
  });
}
```

In the `message` effect, before edit-only gating:

```ts
if (message.type === 'vd-comment-targets') {
  onCommentTargetsChange?.(message.targets.map((target) => ({ ...target, filePath: file.path })));
  return;
}
if (message.type === 'vd-comment-hover') {
  onCommentHoverChange?.({ ...message.target, filePath: file.path });
  return;
}
if (message.type === 'vd-comment-leave') {
  onCommentHoverChange?.(null);
  return;
}
if (message.type === 'vd-comment-select') {
  onCommentSelect?.({ ...message.target, filePath: file.path });
  return;
}
if (message.type === 'vd-comment-pod-stroke') {
  onCommentPodStroke?.(message.points);
  return;
}
if (message.type === 'vd-comment-pod-select') {
  onCommentPodSelect?.(message.points);
  return;
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/CanvasPreview.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/features/canvas-workspace/CanvasPreview.tsx web/src/features/canvas-workspace/CanvasPreview.test.tsx
git commit -m "feat: wire comment bridge into canvas preview"
```

---

### Task 6: Comment Mode UI, Overlay, Popover, Saved Markers

**Files:**
- Create: `web/src/features/canvas-workspace/canvas-comment/CanvasCommentOverlay.tsx`
- Create: `web/src/features/canvas-workspace/canvas-comment/CanvasCommentPopover.tsx`
- Create: `web/src/features/canvas-workspace/canvas-comment/CanvasCommentPanel.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `web/src/features/canvas-workspace/canvas-workspace-types.ts`
- Modify: `web/src/features/canvas-workspace/workspace-mode.ts`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write failing workspace tests**

Add tests:

```ts
it('shows Comment mode for HTML files and opens a comment popover on selection', () => {
  const file = { name: 'index.html', path: 'index.html', kind: 'html' as const, mime: 'text/html', contents: '<main data-vd-id="hero">Hero</main>' };
  const { getByRole, getByTestId } = render(<CanvasWorkspace files={[file]} initialTabs={{ tabs: [{ kind: 'file', key: 'file:index.html', name: 'index.html', path: 'index.html' }], activeTabKey: 'file:index.html' }} />);

  fireEvent.click(getByRole('tab', { name: 'Comment' }));
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'vd-comment-select',
      target: {
        targetId: 'hero',
        selector: '[data-vd-id="hero"]',
        label: 'main',
        text: 'Hero',
        position: { x: 10, y: 20, width: 100, height: 40 },
        htmlHint: '<main>',
      },
    },
  }));

  expect(getByTestId('canvas-comment-popover')).toBeTruthy();
});
```

- [ ] **Step 2: Add `comment` file mode**

Update `canvas-workspace-types.ts`:

```ts
export type FileSurfaceMode = 'preview' | 'inspect' | 'comment';
```

Update `workspace-mode.ts` so `comment` is accepted and guarded the same way as preview when leaving inspect with dirty state.

- [ ] **Step 3: Implement overlay and popover**

`CanvasCommentOverlay.tsx` should export:

```ts
export function CanvasCommentOverlay(props: {
  activeTarget: CanvasCommentTargetSnapshot | null;
  hoveredTarget: CanvasCommentTargetSnapshot | null;
  savedComments: CanvasPreviewComment[];
  scale: number;
  onOpenSavedComment(comment: CanvasPreviewComment): void;
}) {
  // Render absolutely positioned boxes from target.position.
}
```

`CanvasCommentPopover.tsx` should export:

```ts
export function CanvasCommentPopover(props: {
  target: CanvasCommentTargetSnapshot;
  draft: string;
  saving: boolean;
  onDraftChange(value: string): void;
  onClose(): void;
  onSave(): void;
  onSend(): void;
}) {
  // Use @tutti-os/ui-system Button, Card, Badge, Textarea if available.
}
```

`CanvasCommentPanel.tsx` should render saved comments and expose `onSendSelected`, `onDelete`, `onEdit`, and `onStatusChange`.

- [ ] **Step 4: Integrate in CanvasWorkspace**

Add state in `CanvasWorkspace`:

```ts
const [activeCommentTarget, setActiveCommentTarget] = useState<CanvasCommentTargetSnapshot | null>(null);
const [hoveredCommentTarget, setHoveredCommentTarget] = useState<CanvasCommentTargetSnapshot | null>(null);
const [liveCommentTargets, setLiveCommentTargets] = useState<CanvasCommentTargetSnapshot[]>([]);
const [commentDraft, setCommentDraft] = useState('');
const [commentTool, setCommentTool] = useState<CanvasCommentTool>('picker');
```

Add mode tab:

```tsx
<Button
  type="button"
  role="tab"
  aria-selected={activeMode === 'comment'}
  className="h-8 rounded-md px-3"
  size="sm"
  variant={activeMode === 'comment' ? 'secondary' : 'chrome'}
  onClick={() => setActiveFileMode('comment')}
>
  Comment
</Button>
```

Pass comment props to `CanvasPreview` only when `activeMode === 'comment'`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/CanvasWorkspace.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/features/canvas-workspace
git commit -m "feat: add canvas comment mode UI"
```

---

### Task 7: Save/Delete/Patch Comments Through The Web Service

**Files:**
- Modify: `web/src/ProjectEditorPage.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `web/src/services/preview-comments/internal/preview-comment-service.ts`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- Test: `web/src/VibeDesignApp.test.tsx`

- [ ] **Step 1: Write failing tests for save and delete**

Add `CanvasWorkspace` tests asserting:

```ts
it('saves the active comment target through onSavePreviewComment', async () => {
  const onSavePreviewComment = vi.fn().mockResolvedValue({
    id: 'comment-1',
    targetId: 'hero',
    note: 'Fix hero',
    status: 'open',
  });
  // Render workspace in comment mode, dispatch select, type draft, click Comment.
  expect(onSavePreviewComment).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'hero' }), 'Fix hero');
});
```

- [ ] **Step 2: Extend CanvasWorkspace props**

Add props:

```ts
previewComments?: CanvasPreviewComment[];
onLoadPreviewComments?: () => void | Promise<void>;
onSavePreviewComment?: (target: CanvasCommentTarget, note: string) => Promise<CanvasPreviewComment | null>;
onDeletePreviewComment?: (commentId: string) => Promise<void>;
onPatchPreviewCommentStatus?: (commentId: string, status: CanvasCommentStatus) => Promise<void>;
```

Use `canvasCommentTargetFromSnapshot(activeCommentTarget)` before saving.

- [ ] **Step 3: Wire ProjectEditorPage to service**

In `ProjectEditorPage`, consume `IPreviewCommentService`, subscribe to its snapshot, call `load(activeConversationId)` when the active conversation changes, and pass comment callbacks into `CanvasWorkspace`.

- [ ] **Step 4: Verify save/delete tests and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/CanvasWorkspace.test.tsx web/src/VibeDesignApp.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/ProjectEditorPage.tsx web/src/features/canvas-workspace/CanvasWorkspace.tsx web/src/services/preview-comments
git commit -m "feat: wire saved preview comments"
```

---

### Task 8: Chat Attachments And Agent Prompt Formatting

**Files:**
- Modify: `web/src/services/chat-timeline/chat-timeline-types.ts`
- Modify: `web/src/services/chat-timeline/internal/chat-timeline-service.ts`
- Modify: `web/src/services/chat-session/chat-session-types.ts`
- Modify: `web/src/services/chat-session/internal/chat-session-service.ts`
- Modify: `web/src/services/run/run-types.ts`
- Modify: `web/src/services/run/run-api.ts`
- Modify: `web/src/components/ChatPane.tsx`
- Modify: `web/src/components/ChatComposer.tsx`
- Modify: `server/src/server.ts`
- Modify: `server/src/agent-launcher.ts`
- Test: `web/src/services/chat-session/internal/chat-session-service.test.ts`
- Test: `web/src/services/chat-timeline/internal/chat-timeline-service.test.ts`
- Test: `web/src/components/ChatPane.test.tsx`
- Test: `server/src/agent-launcher.test.ts`

- [ ] **Step 1: Write failing chat session tests**

In `chat-session-service.test.ts`:

```ts
it('passes comment attachments into user messages and run creation', async () => {
  const commentAttachments = [{ id: 'comment-1', order: 1, targetId: 'hero', comment: 'Fix hero' }];
  await service.sendTurn({ draft: 'Apply comment', files: [], commentAttachments });

  expect(timeline.appendUserMessage).toHaveBeenCalledWith(expect.objectContaining({ commentAttachments }));
  expect(run.createRun).toHaveBeenCalledWith(expect.objectContaining({ commentAttachments }));
});
```

In `agent-launcher.test.ts`, add:

```ts
it('formats attached preview comments into the agent prompt', async () => {
  const prompt = buildComposedPromptForTest({
    prompt: 'Apply comment',
    commentAttachments: [{
      id: 'comment-1',
      order: 1,
      filePath: 'index.html',
      targetId: 'hero',
      selector: '[data-vd-id="hero"]',
      label: 'main',
      comment: 'Fix hero',
      currentText: 'Hero',
      pagePosition: { x: 1, y: 2, width: 3, height: 4 },
      htmlHint: '<main>',
      selectionKind: 'element',
      source: 'saved-comment',
    }],
  });

  expect(prompt).toContain('# Attached preview comments');
  expect(prompt).toContain('targetKind=element');
  expect(prompt).toContain('comment=Fix hero');
});
```

- [ ] **Step 2: Extend web chat/run types**

Add `commentAttachments?: CanvasCommentAttachment[]` to:

- `AppendUserMessageInput`
- `SendTurnInput`
- `PreparedTurn`
- `CreateRunInput`

Ensure `ChatTimelineService.appendUserMessage` copies the array onto the created message.

- [ ] **Step 3: Pass attachments through session/run**

In `ChatSessionService.prepareTurn`:

```ts
const commentAttachments = input.commentAttachments ?? [];

const userMessage = this.dependencies.timeline.appendUserMessage({
  content: input.draft,
  attachments,
  ...(commentAttachments.length > 0 ? { commentAttachments } : {}),
});
```

In `startTurn`, include:

```ts
...(turn.commentAttachments.length > 0 ? { commentAttachments: turn.commentAttachments } : {}),
```

- [ ] **Step 4: Persist and hydrate comment attachments on server**

In `server.ts` `persistRunMessages`, read `commentAttachments` and pass them to `upsertConversationMessage`.

In `messageForClient`, include:

```ts
commentAttachments: Array.isArray(message.commentAttachments)
  ? message.commentAttachments as ProjectEditorInitialData['messages'][number]['commentAttachments']
  : [],
```

- [ ] **Step 5: Add agent prompt formatter**

In `server/src/agent-launcher.ts`, add:

```ts
function formatPreviewCommentSection(value: unknown): string[] {
  const attachments = readPreviewCommentAttachments(value);
  if (attachments.length === 0) return [];
  return [
    '',
    '# Attached preview comments',
    '',
    'Scope: apply the user request to these preview targets by default. For visual marks, inspect the screenshot and modify the marked region first. Preserve unrelated areas.',
    '',
    ...attachments.flatMap((item) => [
      `${item.order}. ${item.targetId}`,
      `targetKind=${item.selectionKind}`,
      `file=${item.filePath}`,
      `selector=${item.selector || '(none)'}`,
      `label=${item.label || '(unlabeled)'}`,
      `position=${formatCommentPosition(item.pagePosition)}`,
      `currentText=${compactPromptField(item.currentText) || '(empty)'}`,
      `htmlHint=${compactPromptField(item.htmlHint) || '(none)'}`,
      `computedStyle=${formatCommentStyle(item.style) || '(none)'}`,
      `comment=${compactPromptField(item.comment)}`,
      '',
    ]),
  ];
}
```

Add `...formatPreviewCommentSection(request.commentAttachments)` beside `formatAttachedFilesSection`.

- [ ] **Step 6: Render comment chips in chat**

In `ChatPane.tsx`, for user messages with `commentAttachments`, render compact chips: target kind, label/target id, and file path. In `ChatComposer.tsx`, render staged comment chips when passed from workspace send actions.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/services/chat-session/internal/chat-session-service.test.ts web/src/services/chat-timeline/internal/chat-timeline-service.test.ts web/src/components/ChatPane.test.tsx
pnpm --filter @vibe-design/server test server/src/agent-launcher.test.ts
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/server type-check
```

Expected: pass.

Commit:

```bash
git add web/src/services web/src/components server/src/server.ts server/src/agent-launcher.ts server/src/agent-launcher.test.ts
git commit -m "feat: send preview comments to agents"
```

---

### Task 9: Send Draft And Saved Comments From Workspace

**Files:**
- Modify: `web/src/ProjectEditorPage.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `web/src/features/canvas-workspace/canvas-comment/CanvasCommentPanel.tsx`
- Modify: `web/src/features/canvas-workspace/canvas-comment/CanvasCommentPopover.tsx`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- Test: `web/src/ProjectEditorPage.tsx`

- [ ] **Step 1: Write failing tests for Send to chat**

Add a `CanvasWorkspace` test:

```ts
it('sends a draft comment attachment to chat', async () => {
  const onSendCommentAttachments = vi.fn().mockResolvedValue(undefined);
  // Select target, type note, click Send to chat.
  expect(onSendCommentAttachments).toHaveBeenCalledWith([
    expect.objectContaining({ targetId: 'hero', comment: 'Fix hero', source: 'board-batch' }),
  ]);
});
```

- [ ] **Step 2: Add workspace send callback**

Add prop:

```ts
onSendCommentAttachments?: (attachments: CanvasCommentAttachment[]) => Promise<void>;
```

Implement popover send:

```ts
const attachments = buildCanvasCommentAttachments({
  target: canvasCommentTargetFromSnapshot(activeCommentTarget),
  notes: [commentDraft],
});
await onSendCommentAttachments?.(attachments);
```

Implement panel send selected:

```ts
await onSendCommentAttachments?.(commentsToCanvasAttachments(selectedComments));
```

- [ ] **Step 3: Wire ProjectEditorPage to chat session**

In `ProjectEditorPage`, create:

```ts
const handleSendCommentAttachments = React.useCallback(
  (commentAttachments: CanvasCommentAttachment[]) =>
    session.sendTurn({ draft: '', files: [], commentAttachments }),
  [session],
);
```

Pass to `CanvasWorkspace`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/CanvasWorkspace.test.tsx web/src/VibeDesignApp.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/ProjectEditorPage.tsx web/src/features/canvas-workspace
git commit -m "feat: send canvas comments from workspace"
```

---

### Task 10: Pod Selection And Free Pin

**Files:**
- Modify: `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.ts`
- Modify: `web/src/features/canvas-workspace/canvas-comment/bridge.ts`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `web/src/features/canvas-workspace/canvas-comment/CanvasCommentOverlay.tsx`
- Test: `web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.test.ts`
- Test: `web/src/features/canvas-workspace/canvas-comment/bridge.test.ts`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write pod hit testing tests**

Add tests:

```ts
it('builds a pod target from stroke-intersected live targets', () => {
  const pod = buildCanvasPodTarget({
    filePath: 'index.html',
    strokePoints: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }],
    liveTargets: [
      snapshot('hero', { x: 20, y: 20, width: 80, height: 40 }),
      snapshot('cta', { x: 60, y: 80, width: 80, height: 40 }),
    ],
    now: 123,
  });

  expect(pod).toMatchObject({ targetId: 'pod-123', selectionKind: 'pod', memberCount: 2 });
});
```

- [ ] **Step 2: Implement `buildCanvasPodTarget`**

Add pure helpers for:

- `pathIntersectsRect`
- `pointInPolygon`
- `rectContains`
- `pruneContainerSelections`
- `buildCanvasPodTarget`

Use viewport coordinates, matching bridge `clientX/clientY` points.

- [ ] **Step 3: Add free pin bridge behavior**

In comment bridge click handler, if no target is found and mode is picker:

```js
const pinId = 'pin-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
post({
  type: 'vd-comment-select',
  target: {
    targetId: pinId,
    selector: '[data-vd-pin="' + pinId + '"]',
    label: 'pin',
    text: '',
    position: { x: event.clientX - 12, y: event.clientY - 12, width: 24, height: 24 },
    hoverPoint: { x: event.clientX, y: event.clientY },
    htmlHint: '',
    style: null
  }
});
```

Skip this branch if the click target is `A`, `BUTTON`, `INPUT`, `TEXTAREA`, `SELECT`, `LABEL`, or contenteditable.

- [ ] **Step 4: Integrate pod tool in workspace**

When `CanvasPreview` emits `onCommentPodSelect`, call `buildCanvasPodTarget` with `liveCommentTargets`, set it as active target, clear stroke points, and open the popover. Render pod members in popover and overlay.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/canvas-comment/comment-attachment-model.test.ts web/src/features/canvas-workspace/canvas-comment/bridge.test.ts web/src/features/canvas-workspace/CanvasWorkspace.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/features/canvas-workspace
git commit -m "feat: support pod and pin comments"
```

---

### Task 11: Visual Screenshot Annotation

**Files:**
- Create: `web/src/features/canvas-workspace/canvas-comment/CanvasVisualCommentOverlay.tsx`
- Modify: `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- Modify: `web/src/features/canvas-workspace/CanvasPreview.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `web/src/services/preview-comments/internal/preview-comment-service.ts`
- Test: `web/src/features/canvas-workspace/canvas-comment/CanvasVisualCommentOverlay.test.tsx`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write failing visual overlay tests**

Create `CanvasVisualCommentOverlay.test.tsx`:

```ts
it('emits a visual mark attachment for a boxed region', async () => {
  const onSend = vi.fn();
  const { getByLabelText } = render(<CanvasVisualCommentOverlay active filePath="index.html" onSend={onSend} requestScreenshot={async () => ({ dataUrl: 'data:image/png;base64,abc', width: 100, height: 80 })} uploadScreenshot={async () => 'assets/comment-shot.png'} />);

  fireEvent.pointerDown(getByLabelText('Visual annotation canvas'), { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(getByLabelText('Visual annotation canvas'), { clientX: 60, clientY: 50 });
  fireEvent.pointerUp(getByLabelText('Visual annotation canvas'), { clientX: 60, clientY: 50 });
  fireEvent.change(getByLabelText('Visual comment note'), { target: { value: 'Fix this area' } });
  fireEvent.click(getByLabelText('Send visual comment'));

  expect(onSend).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ selectionKind: 'visual', screenshotPath: 'assets/comment-shot.png', comment: 'Fix this area' }),
  ]));
});
```

- [ ] **Step 2: Add snapshot bridge**

Inject a small `vd-preview-snapshot` bridge when `snapshotBridge` is true. The bridge listens for `{ type: 'vd-preview-snapshot', id }` and replies with `{ type: 'vd-preview-snapshot-result', id, dataUrl, width, height }`. Use Reference Design's SVG `foreignObject` approach, bounded to current viewport.

- [ ] **Step 3: Implement visual overlay**

`CanvasVisualCommentOverlay` should support:

- box tool
- pen tool
- undo
- redo
- clear
- note input
- queue/send callback

It should request screenshot, upload the composited image through existing project/public asset APIs, and build `CanvasCommentAttachment` with `source: 'visual-mark'`.

- [ ] **Step 4: Wire visual mode into workspace**

When comment tool is visual, render `CanvasVisualCommentOverlay` over `CanvasPreview`. Disable iframe pointer handling while visual overlay is active.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @vibe-design/web test web/src/features/canvas-workspace/canvas-comment/CanvasVisualCommentOverlay.test.tsx web/src/features/canvas-workspace/CanvasWorkspace.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: pass.

Commit:

```bash
git add web/src/features/canvas-workspace
git commit -m "feat: add visual preview annotations"
```

---

### Task 12: Comment Status Lifecycle And Full Validation

**Files:**
- Modify: `web/src/services/chat-session/internal/chat-session-service.ts`
- Modify: `web/src/services/preview-comments/internal/preview-comment-service.ts`
- Modify: `web/src/features/canvas-workspace/canvas-comment/CanvasCommentPanel.tsx`
- Test: `web/src/services/chat-session/internal/chat-session-service.test.ts`
- Test: `web/src/services/preview-comments/internal/preview-comment-service.test.ts`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write failing lifecycle tests**

Add to chat session tests:

```ts
it('patches saved comment statuses while a run applies them', async () => {
  const commentAttachments = [{ id: 'comment-1', source: 'saved-comment', order: 1, targetId: 'hero', comment: 'Fix hero' }];
  await service.sendTurn({ draft: '', files: [], commentAttachments });

  expect(previewComments.patchStatus).toHaveBeenCalledWith('comment-1', 'attached');
  // Simulate run start and success through stream handlers.
  expect(previewComments.patchStatus).toHaveBeenCalledWith('comment-1', 'applying');
  expect(previewComments.patchStatus).toHaveBeenCalledWith('comment-1', 'needs_review');
});
```

- [ ] **Step 2: Inject preview comment service into ChatSessionService**

Extend dependencies:

```ts
previewComments?: IPreviewCommentService;
```

Before run creation, patch saved comment attachments:

```ts
await this.patchSavedCommentStatuses(turn.commentAttachments, 'attached');
```

After run start:

```ts
void this.patchSavedCommentStatuses(turn.commentAttachments, 'applying');
```

On run end:

```ts
const nextStatus = status === 'succeeded' ? 'needs_review' : 'failed';
void this.patchSavedCommentStatuses(runCommentAttachments, nextStatus);
```

Store run comment attachments in a `Map<runId, CanvasCommentAttachment[]>`.

- [ ] **Step 3: Add manual resolve action**

In `CanvasCommentPanel`, add a resolve button for comments not already resolved:

```tsx
<Button type="button" size="sm" variant="chrome" onClick={() => onStatusChange(comment.id, 'resolved')}>
  Resolve
</Button>
```

- [ ] **Step 4: Run full validation**

Run:

```bash
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/server test
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/server type-check
```

Expected: all pass.

- [ ] **Step 5: Commit final lifecycle work**

Commit:

```bash
git add web/src/services web/src/features/canvas-workspace
git commit -m "feat: track preview comment status lifecycle"
```

---

## Final Verification

After all tasks are complete, run:

```bash
git status --short
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/server test
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/server type-check
```

Expected:

- `git status --short` only shows intentional uncommitted changes, or is clean after final commit.
- Web tests pass.
- Server tests pass.
- Web type-check passes.
- Server type-check passes.

Manual smoke:

1. Start the app.
2. Open an HTML project file.
3. Switch to `Comment`.
4. Hover and click an element.
5. Save a comment.
6. Confirm saved marker and side panel row appear.
7. Send the saved comment to chat.
8. Confirm the user message shows a comment chip.
9. Confirm the agent prompt includes `# Attached preview comments`.
10. Draw a pod around two elements and send a note.
11. Drop a free pin on inert whitespace and save it.
12. Create a visual mark and send it to chat.
