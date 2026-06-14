# Vibe Design Preview Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full Vibe Design preview annotation workflow: persistent element/pod annotations, visual screenshot marks, annotation dock UI, and chat-run attachment context.

**Architecture:** Add a backend `preview_annotations` persistence/API layer first, then a web DI service that owns annotation state. Extend the existing `CanvasPreview` srcdoc bridge with additive `vd-*` annotation and snapshot messages, then add `Mark` mode UI and wire annotation attachments through chat/run creation without changing existing file attachment behavior.

**Tech Stack:** TypeScript, React 19, Vitest, Express 5, better-sqlite3, `@tutti-os/infra/di`, `@tutti-os/ui-system`, iframe `postMessage`, canvas 2D.

---

## File Structure

Backend:

- Modify `server/src/sqlite-store.ts`: add annotation table migration and CRUD helpers.
- Create `server/src/routes/annotation-routes.ts`: expose annotation REST endpoints.
- Modify `server/src/server-context.ts`: expose annotation route dependencies if needed.
- Modify `server/src/server.ts`: register annotation routes, persist `annotationAttachments`, and append annotation context to run requests.
- Create/modify tests in `server/src/preview-annotations.test.ts` and `server/src/main.test.ts`.

Web service and contracts:

- Modify `web/src/types.ts`: add `PreviewAnnotation*` and `ChatAnnotationAttachment` types.
- Modify `web/src/services/run/run-types.ts`: add `annotationAttachments` to `CreateRunInput`.
- Create `web/src/services/preview-annotations/preview-annotation-types.ts`.
- Create `web/src/services/preview-annotations/preview-annotation-api.ts`.
- Create `web/src/services/preview-annotations/preview-annotation-service.interface.ts`.
- Create `web/src/services/preview-annotations/internal/preview-annotation-service.ts`.
- Create `web/src/services/preview-annotations/internal/preview-annotation-service.test.ts`.
- Modify `web/src/launch/vibe-design-flow.tsx`: register annotation service.

Runtime:

- Create `web/src/features/canvas-workspace/annotations/annotation-model.ts`.
- Create `web/src/features/canvas-workspace/annotations/preview-snapshot.ts`.
- Modify `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`: add annotation/snapshot bridges.
- Modify `web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`: pass bridge options through.
- Add tests in `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts`.

UI:

- Modify `web/src/features/canvas-workspace/canvas-workspace-types.ts`: add `mark` mode.
- Modify `web/src/features/canvas-workspace/workspace-mode.ts`: mode defaults and guarded transitions.
- Create `web/src/features/canvas-workspace/annotations/CanvasAnnotationOverlay.tsx`.
- Create `web/src/features/canvas-workspace/annotations/AnnotationDock.tsx`.
- Create `web/src/features/canvas-workspace/annotations/AnnotationComposerPopover.tsx`.
- Modify `web/src/features/canvas-workspace/CanvasPreview.tsx`: expose active iframe snapshot/annotation bridge hooks and render overlay.
- Modify `web/src/features/canvas-workspace/CanvasWorkspace.tsx`: add Mark mode, dock, service wiring, and send/save flows.
- Add tests in `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx` and `CanvasPreview.test.tsx`.

Chat:

- Modify `web/src/services/chat-session/chat-session-types.ts`: extend `SendTurnInput`.
- Modify `web/src/services/chat-session/internal/chat-session-service.ts`: pass annotation attachments to timeline and run API.
- Modify `web/src/services/chat-timeline/chat-timeline-types.ts`: include annotation attachments on user messages.
- Modify `web/src/services/chat-timeline/internal/chat-timeline-service.ts`: clone/store annotation attachments.
- Modify `web/src/components/ChatPane.tsx` / `AssistantMessage.tsx` only if needed to display annotation chips/cards.
- Add tests in `web/src/services/chat-session/internal/chat-session-service.test.ts` and `web/src/components/ChatPane.test.tsx`.

---

### Task 1: Backend Annotation Persistence

**Files:**
- Modify: `server/src/sqlite-store.ts`
- Test: `server/src/preview-annotations.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `server/src/preview-annotations.test.ts` with:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConversationInStore,
  deletePreviewAnnotationFromStore,
  getStore,
  listPreviewAnnotationsFromStore,
  upsertPreviewAnnotationInStore,
  updatePreviewAnnotationStatusInStore,
  writeProjectToStore,
} from './sqlite-store';

let dirs: string[] = [];

function makeProjectsDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vd-annotations-'));
  dirs.push(dir);
  return path.join(dir, 'projects');
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function seed(projectsDir: string) {
  getStore(projectsDir);
  writeProjectToStore(projectsDir, {
    id: 'project-1',
    designSystemId: null,
    createdAt: 1,
    updatedAt: 1,
    tabsState: { tabs: [], activeTabKey: null },
    metadata: {},
  });
  createConversationInStore(projectsDir, 'project-1', 'conversation-1', 'Conversation');
}

describe('preview annotations store', () => {
  it('upserts and lists an element annotation', () => {
    const projectsDir = makeProjectsDir();
    seed(projectsDir);

    const saved = upsertPreviewAnnotationInStore(projectsDir, 'project-1', 'conversation-1', {
      target: {
        filePath: 'index.html',
        elementId: 'path-0',
        selector: '[data-vd-source-path="path-0"]',
        label: 'section.hero',
        text: 'Hero title',
        position: { x: 10, y: 20, width: 300, height: 120 },
        htmlHint: '<section data-vd-source-path="path-0">',
        style: { color: 'rgb(10, 20, 30)' },
        selectionKind: 'element',
      },
      note: 'Make this stronger',
    });

    expect(saved.note).toBe('Make this stronger');
    expect(saved.status).toBe('open');
    expect(saved.position).toEqual({ x: 10, y: 20, width: 300, height: 120 });
    expect(listPreviewAnnotationsFromStore(projectsDir, 'project-1', 'conversation-1')).toHaveLength(1);
  });

  it('updates status and deletes annotation', () => {
    const projectsDir = makeProjectsDir();
    seed(projectsDir);
    const saved = upsertPreviewAnnotationInStore(projectsDir, 'project-1', 'conversation-1', {
      target: {
        filePath: 'index.html',
        elementId: 'path-0',
        selector: '[data-vd-source-path="path-0"]',
        label: 'section.hero',
        text: '',
        position: { x: 0, y: 0, width: 1, height: 1 },
        htmlHint: '',
        selectionKind: 'element',
      },
      note: 'Fix it',
    });

    expect(updatePreviewAnnotationStatusInStore(projectsDir, 'project-1', 'conversation-1', saved.id, 'resolved')?.status).toBe('resolved');
    expect(deletePreviewAnnotationFromStore(projectsDir, 'project-1', 'conversation-1', saved.id)).toBe(true);
    expect(listPreviewAnnotationsFromStore(projectsDir, 'project-1', 'conversation-1')).toEqual([]);
  });

  it('rejects invalid status and empty note', () => {
    const projectsDir = makeProjectsDir();
    seed(projectsDir);

    expect(() =>
      upsertPreviewAnnotationInStore(projectsDir, 'project-1', 'conversation-1', {
        target: {
          filePath: 'index.html',
          elementId: 'path-0',
          selector: '[data-vd-source-path="path-0"]',
          label: 'section.hero',
          text: '',
          position: { x: 0, y: 0, width: 1, height: 1 },
          htmlHint: '',
          selectionKind: 'element',
        },
        note: '   ',
      }),
    ).toThrow('annotation note required');
    expect(() =>
      updatePreviewAnnotationStatusInStore(projectsDir, 'project-1', 'conversation-1', 'missing', 'closed'),
    ).toThrow('invalid annotation status');
  });
});
```

- [ ] **Step 2: Run failing store tests**

Run:

```bash
pnpm --filter @vibe-design/server test -- preview-annotations.test.ts
```

Expected: FAIL because `listPreviewAnnotationsFromStore`, `upsertPreviewAnnotationInStore`, `updatePreviewAnnotationStatusInStore`, and `deletePreviewAnnotationFromStore` are not exported.

- [ ] **Step 3: Implement store migration and helpers**

In `server/src/sqlite-store.ts`, add exported types near existing conversation types:

```ts
export type PreviewAnnotationStatus = 'open' | 'attached' | 'applying' | 'needs_review' | 'resolved' | 'failed';
export type PreviewAnnotationSelectionKind = 'element' | 'pod';

export interface PreviewAnnotationPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewAnnotationTargetMember {
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewAnnotationPosition;
  htmlHint: string;
  style?: Record<string, string>;
}

export interface PreviewAnnotationTarget {
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewAnnotationPosition;
  htmlHint: string;
  style?: Record<string, string>;
  selectionKind?: PreviewAnnotationSelectionKind;
  memberCount?: number;
  podMembers?: PreviewAnnotationTargetMember[];
}

export interface StoredPreviewAnnotation {
  id: string;
  projectId: string;
  conversationId: string;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewAnnotationPosition;
  htmlHint: string;
  style?: Record<string, string>;
  selectionKind: PreviewAnnotationSelectionKind;
  memberCount?: number;
  podMembers?: PreviewAnnotationTargetMember[];
  note: string;
  status: PreviewAnnotationStatus;
  createdAt: number;
  updatedAt: number;
}
```

Add to `migrate(db)`:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS preview_annotations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      element_id TEXT NOT NULL,
      selector TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      position_json TEXT NOT NULL,
      html_hint TEXT NOT NULL,
      style_json TEXT,
      selection_kind TEXT NOT NULL,
      member_count INTEGER,
      pod_members_json TEXT,
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, conversation_id, file_path, element_id)
    );
    CREATE INDEX IF NOT EXISTS idx_preview_annotations_conversation
      ON preview_annotations(project_id, conversation_id, updated_at DESC);
  `);
```

Add helpers near conversation helpers:

```ts
const PREVIEW_ANNOTATION_STATUSES = new Set<PreviewAnnotationStatus>([
  'open',
  'attached',
  'applying',
  'needs_review',
  'resolved',
  'failed',
]);

export function listPreviewAnnotationsFromStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
): StoredPreviewAnnotation[] {
  return (getStore(projectsDir)
    .prepare(
      `SELECT id, project_id AS projectId, conversation_id AS conversationId,
              file_path AS filePath, element_id AS elementId, selector, label,
              text, position_json AS positionJson, html_hint AS htmlHint,
              style_json AS styleJson, selection_kind AS selectionKind,
              member_count AS memberCount, pod_members_json AS podMembersJson,
              note, status, created_at AS createdAt, updated_at AS updatedAt
         FROM preview_annotations
        WHERE project_id = ? AND conversation_id = ?
        ORDER BY updated_at DESC`,
    )
    .all(projectId, conversationId) as AnnotationRow[])
    .map(normalizePreviewAnnotationRow);
}

export function upsertPreviewAnnotationInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  input: { target?: Partial<PreviewAnnotationTarget>; note?: unknown },
): StoredPreviewAnnotation {
  const target = input.target ?? {};
  const note = cleanAnnotationNote(input.note);
  const filePath = cleanRequiredAnnotationString(target.filePath, 'filePath', 500);
  const elementId = cleanRequiredAnnotationString(target.elementId, 'elementId', 500);
  const selector = cleanRequiredAnnotationString(target.selector, 'selector', 500);
  const label = cleanRequiredAnnotationString(target.label, 'label', 120);
  const text = cleanAnnotationString(target.text, 160);
  const htmlHint = cleanAnnotationString(target.htmlHint, 180);
  const position = normalizeAnnotationPosition(target.position);
  const selectionKind: PreviewAnnotationSelectionKind = target.selectionKind === 'pod' ? 'pod' : 'element';
  const podMembers = selectionKind === 'pod' ? normalizeAnnotationMembers(target.podMembers) : [];
  const style = normalizeAnnotationStyle(target.style);
  const memberCount = selectionKind === 'pod'
    ? (podMembers.length > 0 ? podMembers.length : Math.max(0, Math.round(Number(target.memberCount) || 0)))
    : undefined;
  const now = Date.now();
  const existing = getStore(projectsDir)
    .prepare(
      `SELECT id, created_at AS createdAt
         FROM preview_annotations
        WHERE project_id = ? AND conversation_id = ? AND file_path = ? AND element_id = ?`,
    )
    .get(projectId, conversationId, filePath, elementId) as { id: string; createdAt: number } | undefined;
  const id = existing?.id ?? `annotation-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = existing?.createdAt ?? now;

  getStore(projectsDir)
    .prepare(
      `INSERT INTO preview_annotations
         (id, project_id, conversation_id, file_path, element_id, selector, label, text,
          position_json, html_hint, style_json, selection_kind, member_count, pod_members_json,
          note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, conversation_id, file_path, element_id) DO UPDATE SET
         selector = excluded.selector,
         label = excluded.label,
         text = excluded.text,
         position_json = excluded.position_json,
         html_hint = excluded.html_hint,
         style_json = excluded.style_json,
         selection_kind = excluded.selection_kind,
         member_count = excluded.member_count,
         pod_members_json = excluded.pod_members_json,
         note = excluded.note,
         status = 'open',
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      projectId,
      conversationId,
      filePath,
      elementId,
      selector,
      label,
      text,
      JSON.stringify(position),
      htmlHint,
      style ? JSON.stringify(style) : null,
      selectionKind,
      memberCount ?? null,
      podMembers.length > 0 ? JSON.stringify(podMembers) : null,
      note,
      'open',
      createdAt,
      now,
    );

  const saved = getPreviewAnnotationFromStore(projectsDir, projectId, conversationId, id);
  if (!saved) throw new Error('annotation write failed');
  return saved;
}
```

Also add `updatePreviewAnnotationStatusInStore`, `deletePreviewAnnotationFromStore`, `getPreviewAnnotationFromStore`, `AnnotationRow`, and the normalization helpers used above. Keep helper names exactly as referenced in the tests.

- [ ] **Step 4: Run store tests**

Run:

```bash
pnpm --filter @vibe-design/server test -- preview-annotations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit backend store**

```bash
git add server/src/sqlite-store.ts server/src/preview-annotations.test.ts
git commit -m "feat: persist preview annotations"
```

---

### Task 2: Backend Annotation Routes And Run Context

**Files:**
- Create: `server/src/routes/annotation-routes.ts`
- Modify: `server/src/server.ts`
- Test: `server/src/main.test.ts`

- [ ] **Step 1: Write failing route tests**

Append to `server/src/main.test.ts`:

```ts
it('creates, lists, patches, and deletes preview annotations', async () => {
  const app = createServer({ runtimeDir: runtimeDirForTest() });
  const address = await listenForTest(app);
  const base = `http://127.0.0.1:${address.port}`;
  await fetch(`${base}/api/projects/project-1/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'index.html', content: '<html><body>Hello</body></html>' }),
  });
  const conversation = await (await fetch(`${base}/api/projects/project-1/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Annotations' }),
  })).json() as { conversation: { id: string } };

  const create = await fetch(`${base}/api/projects/project-1/conversations/${conversation.conversation.id}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: {
        filePath: 'index.html',
        elementId: 'path-0',
        selector: '[data-vd-source-path="path-0"]',
        label: 'body',
        text: 'Hello',
        position: { x: 0, y: 0, width: 100, height: 20 },
        htmlHint: '<body>',
        selectionKind: 'element',
      },
      note: 'Improve this',
    }),
  });
  expect(create.status).toBe(200);
  const created = await create.json() as { annotation: { id: string; note: string } };
  expect(created.annotation.note).toBe('Improve this');

  const list = await (await fetch(`${base}/api/projects/project-1/conversations/${conversation.conversation.id}/annotations`)).json() as { annotations: unknown[] };
  expect(list.annotations).toHaveLength(1);

  const patched = await fetch(`${base}/api/projects/project-1/conversations/${conversation.conversation.id}/annotations/${created.annotation.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' }),
  });
  expect(patched.status).toBe(200);

  const deleted = await fetch(`${base}/api/projects/project-1/conversations/${conversation.conversation.id}/annotations/${created.annotation.id}`, {
    method: 'DELETE',
  });
  expect(deleted.status).toBe(200);
  app.close();
});
```

- [ ] **Step 2: Run failing route test**

Run:

```bash
pnpm --filter @vibe-design/server test -- main.test.ts
```

Expected: FAIL with `404` for `/annotations`.

- [ ] **Step 3: Add annotation routes**

Create `server/src/routes/annotation-routes.ts`:

```ts
import type { Express, Request, Response } from 'express';
import type { RouteDeps } from '../server-context.js';
import {
  deletePreviewAnnotationFromStore,
  getProjectFromStore,
  listConversationsFromStore,
  listPreviewAnnotationsFromStore,
  updatePreviewAnnotationStatusInStore,
  upsertPreviewAnnotationInStore,
} from '../sqlite-store.js';

type AnnotationRouteDeps = RouteDeps<'http' | 'paths'>;

export function registerAnnotationRoutes(app: Express, ctx: AnnotationRouteDeps): void {
  const { sendApiError } = ctx.http;

  app.get('/api/projects/:projectId/conversations/:conversationId/annotations', (req, res) => {
    if (!assertConversation(ctx, req, res)) return;
    res.json({
      annotations: listPreviewAnnotationsFromStore(ctx.paths.projectsDir, req.params.projectId, req.params.conversationId),
    });
  });

  app.post('/api/projects/:projectId/conversations/:conversationId/annotations', (req, res) => {
    if (!assertConversation(ctx, req, res)) return;
    try {
      const annotation = upsertPreviewAnnotationInStore(
        ctx.paths.projectsDir,
        req.params.projectId,
        req.params.conversationId,
        req.body ?? {},
      );
      res.json({ annotation });
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : String(error));
    }
  });

  app.patch('/api/projects/:projectId/conversations/:conversationId/annotations/:annotationId', (req, res) => {
    if (!assertConversation(ctx, req, res)) return;
    try {
      const annotation = updatePreviewAnnotationStatusInStore(
        ctx.paths.projectsDir,
        req.params.projectId,
        req.params.conversationId,
        req.params.annotationId,
        typeof req.body?.status === 'string' ? req.body.status : '',
      );
      if (!annotation) {
        sendApiError(res, 404, 'NOT_FOUND', 'annotation not found');
        return;
      }
      res.json({ annotation });
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : String(error));
    }
  });

  app.delete('/api/projects/:projectId/conversations/:conversationId/annotations/:annotationId', (req, res) => {
    if (!assertConversation(ctx, req, res)) return;
    const ok = deletePreviewAnnotationFromStore(
      ctx.paths.projectsDir,
      req.params.projectId,
      req.params.conversationId,
      req.params.annotationId,
    );
    if (!ok) {
      sendApiError(res, 404, 'NOT_FOUND', 'annotation not found');
      return;
    }
    res.json({ ok: true });
  });
}

function assertConversation(
  ctx: AnnotationRouteDeps,
  req: Request<{ projectId: string; conversationId: string }>,
  res: Response,
): boolean {
  const project = getProjectFromStore(ctx.paths.projectsDir, req.params.projectId);
  if (!project) {
    ctx.http.sendApiError(res, 404, 'NOT_FOUND', 'project not found');
    return false;
  }
  const conversation = listConversationsFromStore(ctx.paths.projectsDir, req.params.projectId)
    .find((item) => item.id === req.params.conversationId);
  if (!conversation) {
    ctx.http.sendApiError(res, 404, 'NOT_FOUND', 'conversation not found');
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Register routes and annotation prompt context**

Modify `server/src/server.ts` imports:

```ts
import { registerAnnotationRoutes } from './routes/annotation-routes.js';
```

Register before project routes:

```ts
  registerAnnotationRoutes(app, ctx);
```

Add near `readAttachments`:

```ts
function readAnnotationAttachments(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

function promptWithAnnotationContext(prompt: string, annotations: unknown[]): string {
  if (annotations.length === 0) return prompt;
  const lines = [
    prompt,
    '',
    '<attached-preview-annotations>',
    'Scope: apply the user request to the attached preview target by default. For visual marks, inspect the screenshot and modify the marked region first. Preserve unrelated elements.',
  ];
  annotations.forEach((annotation, index) => {
    const item = annotation as Record<string, unknown>;
    lines.push(
      '',
      `${index + 1}. ${String(item.elementId ?? 'annotation')}`,
      `targetKind: ${String(item.selectionKind ?? 'element')}`,
      `file: ${String(item.filePath ?? '')}`,
      `selector: ${String(item.selector ?? '')}`,
      `label: ${String(item.label ?? '')}`,
      `comment: ${String(item.comment ?? '')}`,
      `currentText: ${String(item.currentText ?? '')}`,
      `htmlHint: ${String(item.htmlHint ?? '')}`,
    );
    if (item.screenshotPath) lines.push(`screenshot: ${String(item.screenshotPath)}`);
    if (item.markKind) lines.push(`markKind: ${String(item.markKind)}`);
    if (item.intent) lines.push(`intent: ${String(item.intent)}`);
  });
  lines.push('</attached-preview-annotations>');
  return lines.join('\n');
}
```

In `startRunFromRequest`, wrap the prompt only for the runner request:

```ts
  function startRunFromRequest(run: ChatRun, request: Record<string, unknown>): Promise<void> | void {
    const runner = options.startAgentRun ?? startAgentRun;
    const prompt = readPrompt(request);
    const annotationAttachments = readAnnotationAttachments(request.annotationAttachments);
    const requestForAgent = prompt && annotationAttachments.length > 0
      ? { ...request, prompt: promptWithAnnotationContext(prompt, annotationAttachments) }
      : request;
    return runner({
      run,
      runs,
      request: requestForAgent,
      paths: {
        projectsDir,
        userSkillsRoot: ctx.paths.userSkillsRoot,
        builtInSkillsRoot: ctx.paths.builtInSkillsRoot,
      },
    });
  }
```

In `persistRunMessages`, persist annotation attachments with normal attachments:

```ts
      const attachments = readAttachments(body.attachments);
      const annotationAttachments = readAnnotationAttachments(body.annotationAttachments);
      await upsertConversationMessage(ctx.paths.projectsDir, run.projectId, run.conversationId, {
        id: createUserMessageId(),
        role: 'user',
        content: prompt,
        ...(attachments.length > 0 || annotationAttachments.length > 0
          ? { attachments: [...attachments, ...annotationAttachments.map((item) => ({ kind: 'annotation', ...item }))] }
          : {}),
      });
```

- [ ] **Step 5: Run server tests**

Run:

```bash
pnpm --filter @vibe-design/server test
pnpm --filter @vibe-design/server type-check
```

Expected: PASS.

- [ ] **Step 6: Commit backend routes**

```bash
git add server/src/server.ts server/src/routes/annotation-routes.ts server/src/main.test.ts
git commit -m "feat: expose preview annotation api"
```

---

### Task 3: Web Annotation Types And Service

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/launch/vibe-design-flow.tsx`
- Create: `web/src/services/preview-annotations/preview-annotation-types.ts`
- Create: `web/src/services/preview-annotations/preview-annotation-api.ts`
- Create: `web/src/services/preview-annotations/preview-annotation-service.interface.ts`
- Create: `web/src/services/preview-annotations/internal/preview-annotation-service.ts`
- Test: `web/src/services/preview-annotations/internal/preview-annotation-service.test.ts`

- [ ] **Step 1: Write failing service test**

Create `web/src/services/preview-annotations/internal/preview-annotation-service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { PreviewAnnotationService } from './preview-annotation-service';
import type { PreviewAnnotationApi } from '../preview-annotation-api';

function makeApi(): PreviewAnnotationApi {
  return {
    listAnnotations: vi.fn(async () => []),
    upsertAnnotation: vi.fn(async (_conversationId, input) => ({
      id: 'annotation-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      filePath: input.target.filePath,
      elementId: input.target.elementId,
      selector: input.target.selector,
      label: input.target.label,
      text: input.target.text,
      position: input.target.position,
      htmlHint: input.target.htmlHint,
      selectionKind: input.target.selectionKind ?? 'element',
      note: input.note,
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    })),
    patchAnnotationStatus: vi.fn(async (_conversationId, id, status) => ({
      id,
      projectId: 'project-1',
      conversationId: 'conversation-1',
      filePath: 'index.html',
      elementId: 'path-0',
      selector: '[data-vd-source-path="path-0"]',
      label: 'Hero',
      text: '',
      position: { x: 0, y: 0, width: 1, height: 1 },
      htmlHint: '',
      selectionKind: 'element',
      note: 'Note',
      status,
      createdAt: 1,
      updatedAt: 2,
    })),
    deleteAnnotation: vi.fn(async () => true),
  };
}

describe('PreviewAnnotationService', () => {
  it('loads, upserts, patches, and deletes annotations', async () => {
    const api = makeApi();
    const service = new PreviewAnnotationService(api);
    const listener = vi.fn();
    service.subscribe(listener);

    await service.load('conversation-1');
    expect(service.getSnapshot().annotations).toEqual([]);

    const saved = await service.save('conversation-1', {
      target: {
        filePath: 'index.html',
        elementId: 'path-0',
        selector: '[data-vd-source-path="path-0"]',
        label: 'Hero',
        text: 'Hero',
        position: { x: 10, y: 20, width: 300, height: 120 },
        htmlHint: '<section>',
        selectionKind: 'element',
      },
      note: 'Tighten copy',
    });
    expect(saved.note).toBe('Tighten copy');
    expect(service.getSnapshot().annotations).toHaveLength(1);

    await service.patchStatus('conversation-1', saved.id, 'resolved');
    expect(service.getSnapshot().annotations[0]?.status).toBe('resolved');

    await service.delete('conversation-1', saved.id);
    expect(service.getSnapshot().annotations).toEqual([]);
    expect(listener).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing service test**

Run:

```bash
pnpm --filter @vibe-design/web test -- preview-annotation-service.test.ts
```

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Add shared web types**

Append to `web/src/types.ts`:

```ts
export type PreviewAnnotationStatus = 'open' | 'attached' | 'applying' | 'needs_review' | 'resolved' | 'failed';
export type PreviewAnnotationSelectionKind = 'element' | 'pod';
export type PreviewAnnotationMarkKind = 'click' | 'stroke' | 'click+stroke';
export type ChatAnnotationSelectionKind = PreviewAnnotationSelectionKind | 'visual';

export interface PreviewAnnotationPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewAnnotationTargetMember {
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewAnnotationPosition;
  htmlHint: string;
  style?: Record<string, string>;
}

export interface PreviewAnnotationTarget {
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewAnnotationPosition;
  htmlHint: string;
  style?: Record<string, string>;
  selectionKind?: PreviewAnnotationSelectionKind;
  memberCount?: number;
  podMembers?: PreviewAnnotationTargetMember[];
}

export interface PreviewAnnotation {
  id: string;
  projectId: string;
  conversationId: string;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewAnnotationPosition;
  htmlHint: string;
  style?: Record<string, string>;
  selectionKind: PreviewAnnotationSelectionKind;
  memberCount?: number;
  podMembers?: PreviewAnnotationTargetMember[];
  note: string;
  status: PreviewAnnotationStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ChatAnnotationAttachment {
  id: string;
  order: number;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  comment: string;
  currentText: string;
  pagePosition: PreviewAnnotationPosition;
  htmlHint: string;
  style?: Record<string, string>;
  selectionKind: ChatAnnotationSelectionKind;
  memberCount?: number;
  podMembers?: PreviewAnnotationTargetMember[];
  screenshotPath?: string;
  markKind?: PreviewAnnotationMarkKind;
  intent?: string;
  source: 'saved-annotation' | 'annotation-batch';
}
```

- [ ] **Step 4: Implement API and service**

Create `web/src/services/preview-annotations/preview-annotation-types.ts`:

```ts
import type { PreviewAnnotation, PreviewAnnotationStatus, PreviewAnnotationTarget } from '../../types';

export interface PreviewAnnotationSnapshot {
  annotations: PreviewAnnotation[];
  loading: boolean;
  error: string | null;
}

export interface PreviewAnnotationUpsertInput {
  target: PreviewAnnotationTarget;
  note: string;
}

export type { PreviewAnnotation, PreviewAnnotationStatus, PreviewAnnotationTarget };
```

Create `web/src/services/preview-annotations/preview-annotation-api.ts` with `FetchPreviewAnnotationApi` using the four routes from the spec and a `readPreviewAnnotation` guard.

Create `web/src/services/preview-annotations/preview-annotation-service.interface.ts`:

```ts
import { createDecorator } from '@tutti-os/infra/di';
import type { PreviewAnnotation, PreviewAnnotationSnapshot, PreviewAnnotationStatus, PreviewAnnotationUpsertInput } from './preview-annotation-types';

export interface IPreviewAnnotationService {
  readonly _serviceBrand: undefined;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PreviewAnnotationSnapshot;
  load(conversationId: string | null): Promise<void>;
  save(conversationId: string, input: PreviewAnnotationUpsertInput): Promise<PreviewAnnotation>;
  patchStatus(conversationId: string, annotationId: string, status: PreviewAnnotationStatus): Promise<PreviewAnnotation | null>;
  delete(conversationId: string, annotationId: string): Promise<boolean>;
}

export const IPreviewAnnotationService = createDecorator<IPreviewAnnotationService>('previewAnnotationService');
```

Create `web/src/services/preview-annotations/internal/preview-annotation-service.ts` implementing the interface with immutable snapshot updates.

- [ ] **Step 5: Register service**

Modify `web/src/launch/vibe-design-flow.tsx`:

```ts
import { FetchPreviewAnnotationApi } from '../services/preview-annotations/preview-annotation-api';
import { IPreviewAnnotationService, type IPreviewAnnotationService as IPreviewAnnotationServiceContract } from '../services/preview-annotations/preview-annotation-service.interface';
import { PreviewAnnotationService } from '../services/preview-annotations/internal/preview-annotation-service';
```

Add to `VibeDesignFlowOptions`:

```ts
  previewAnnotationService?: IPreviewAnnotationServiceContract;
```

Create and register:

```ts
    const previewAnnotationService =
      this.options.previewAnnotationService ?? new PreviewAnnotationService(new FetchPreviewAnnotationApi(projectId));
...
    serviceCollection.set(IPreviewAnnotationService, previewAnnotationService);
```

- [ ] **Step 6: Run service tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- preview-annotation-service.test.ts
pnpm --filter @vibe-design/web type-check
```

Expected: PASS.

- [ ] **Step 7: Commit web service**

```bash
git add web/src/types.ts web/src/launch/vibe-design-flow.tsx web/src/services/preview-annotations
git commit -m "feat: add preview annotation service"
```

---

### Task 4: Runtime Annotation And Snapshot Bridges

**Files:**
- Modify: `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- Modify: `web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`
- Create: `web/src/features/canvas-workspace/annotations/preview-snapshot.ts`
- Test: `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Add to `build-preview-srcdoc.test.ts`:

```ts
it('injects annotation and snapshot bridges when requested', () => {
  const srcdoc = buildPreviewSrcdoc('<section>Hello</section>', {
    editBridge: false,
    sizeBridge: true,
    annotationBridge: true,
    snapshotBridge: true,
  });

  expect(srcdoc).toContain('data-vd-annotation-bridge');
  expect(srcdoc).toContain("type: 'vd-annotation-targets'");
  expect(srcdoc).toContain("type: 'vd-annotation-target'");
  expect(srcdoc).toContain('data-vd-preview-snapshot-bridge');
  expect(srcdoc).toContain("type: 'vd-preview-snapshot-result'");
});

it('does not inject annotation bridge by default', () => {
  const srcdoc = buildPreviewSrcdoc('<section>Hello</section>', { editBridge: false });
  expect(srcdoc).not.toContain('data-vd-annotation-bridge');
  expect(srcdoc).not.toContain('data-vd-preview-snapshot-bridge');
});
```

- [ ] **Step 2: Run failing runtime tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- build-preview-srcdoc.test.ts
```

Expected: FAIL because bridge options and scripts are not implemented.

- [ ] **Step 3: Add bridge options and injection**

Modify `BuildPreviewSrcdocOptions`:

```ts
export interface BuildPreviewSrcdocOptions {
  editBridge: boolean;
  sizeBridge?: boolean;
  annotationBridge?: boolean;
  snapshotBridge?: boolean;
}
```

Before returning, inject scripts:

```ts
  if (options.annotationBridge) {
    documentHtml = injectBeforeBodyEnd(documentHtml, canvasAnnotationBridge());
  }

  if (options.snapshotBridge) {
    documentHtml = injectBeforeBodyEnd(documentHtml, canvasPreviewSnapshotBridge());
  }
```

Implement `canvasAnnotationBridge()` as a self-contained injected script with these exact responsibilities:

- keeps `annotationEnabled` and `tool`
- reuses `data-vd-id`, `data-vd-source-path`, `data-vd-runtime-id`, `id`, DOM path identity order
- posts `vd-annotation-targets` on enable/load/mutation
- posts `vd-annotation-hover`, `vd-annotation-leave`, and `vd-annotation-target` on picker hover/click
- for pod mode, accumulates pointer points and posts a `vd-annotation-target` with `selectionKind: 'pod'`, `podMembers`, and union bounds

Implement `canvasPreviewSnapshotBridge()` with viewport snapshot code and script stripping. Keep string markers exact for tests:

```js
window.parent.postMessage({ type: 'vd-preview-snapshot-result', id: id, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }, '*');
```

- [ ] **Step 4: Add host snapshot helper**

Create `web/src/features/canvas-workspace/annotations/preview-snapshot.ts`:

```ts
export interface PreviewSnapshot {
  dataUrl: string;
  width: number;
  height: number;
}

export type PreviewSnapshotResult =
  | { ok: true; snapshot: PreviewSnapshot }
  | { ok: false; reason: 'loading' | 'post-message-error' | 'render-error' | 'timeout'; error?: string };

export function requestPreviewSnapshotResult(
  iframe: HTMLIFrameElement,
  timeoutMs = 8000,
): Promise<PreviewSnapshotResult> {
  const win = iframe.contentWindow;
  if (!win) return Promise.resolve({ ok: false, reason: 'loading' });
  const id = `vd-snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    let done = false;
    function finish(result: PreviewSnapshotResult) {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      resolve(result);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== win) return;
      const data = event.data as { type?: string; id?: string; dataUrl?: string; width?: number; height?: number; error?: string } | null;
      if (!data || data.type !== 'vd-preview-snapshot-result' || data.id !== id) return;
      if (data.dataUrl && data.width && data.height) {
        finish({ ok: true, snapshot: { dataUrl: data.dataUrl, width: data.width, height: data.height } });
      } else {
        finish({ ok: false, reason: 'render-error', error: data.error });
      }
    }
    window.addEventListener('message', onMessage);
    try {
      win.postMessage({ type: 'vd-preview-snapshot-request', id }, '*');
    } catch {
      finish({ ok: false, reason: 'post-message-error' });
    }
    window.setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
  });
}
```

- [ ] **Step 5: Pass bridge options through design runtime builder**

Modify `BuildDesignRuntimeSrcdocOptions` with `annotationBridge?: boolean` and `snapshotBridge?: boolean`, then pass them to `buildPreviewSrcdoc`.

- [ ] **Step 6: Run runtime tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- build-preview-srcdoc.test.ts
pnpm --filter @vibe-design/web type-check
```

Expected: PASS.

- [ ] **Step 7: Commit runtime bridges**

```bash
git add web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts web/src/features/canvas-workspace/annotations/preview-snapshot.ts web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts
git commit -m "feat: add annotation iframe bridges"
```

---

### Task 5: Annotation Model Helpers

**Files:**
- Create: `web/src/features/canvas-workspace/annotations/annotation-model.ts`
- Test: `web/src/features/canvas-workspace/annotations/annotation-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `annotation-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { annotationAttachmentFromSaved, visualAnnotationAttachment, targetFromSnapshot } from './annotation-model';

describe('annotation model', () => {
  it('builds saved annotation attachment', () => {
    expect(annotationAttachmentFromSaved({
      id: 'annotation-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      filePath: 'index.html',
      elementId: 'path-0',
      selector: '[data-vd-source-path="path-0"]',
      label: 'Hero',
      text: 'Hero copy',
      position: { x: 1, y: 2, width: 3, height: 4 },
      htmlHint: '<section>',
      selectionKind: 'element',
      note: 'Improve',
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    }, 2)).toMatchObject({
      id: 'annotation-1',
      order: 2,
      filePath: 'index.html',
      elementId: 'path-0',
      comment: 'Improve',
      selectionKind: 'element',
      source: 'saved-annotation',
    });
  });

  it('builds visual annotation attachment with fallback target', () => {
    expect(visualAnnotationAttachment({
      order: 1,
      screenshotPath: 'uploads/mark.png',
      markKind: 'stroke',
      note: 'Tighten this area',
      bounds: { x: 10, y: 20, width: 30, height: 40 },
      target: { filePath: 'index.html', position: { x: 10, y: 20, width: 30, height: 40 } },
    })).toMatchObject({
      filePath: 'index.html',
      selectionKind: 'visual',
      screenshotPath: 'uploads/mark.png',
      markKind: 'stroke',
      comment: 'Tighten this area',
    });
  });

  it('normalizes target snapshot text and html hint', () => {
    const target = targetFromSnapshot({
      filePath: 'index.html',
      elementId: 'path-0',
      selector: '[data-vd-source-path="path-0"]',
      label: 'Hero',
      text: 'x'.repeat(200),
      position: { x: 1, y: 2, width: 3, height: 4 },
      htmlHint: '<section>' + 'x'.repeat(220),
    });
    expect(target.text.length).toBeLessThanOrEqual(160);
    expect(target.htmlHint.length).toBeLessThanOrEqual(180);
  });
});
```

- [ ] **Step 2: Run failing model tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- annotation-model.test.ts
```

Expected: FAIL because `annotation-model.ts` does not exist.

- [ ] **Step 3: Implement model helpers**

Create `annotation-model.ts`:

```ts
import type {
  ChatAnnotationAttachment,
  PreviewAnnotation,
  PreviewAnnotationMarkKind,
  PreviewAnnotationPosition,
  PreviewAnnotationTarget,
} from '../../../types';

export interface PreviewAnnotationTargetSnapshot extends PreviewAnnotationTarget {
  hoverPoint?: { x: number; y: number };
}

export function targetFromSnapshot(snapshot: PreviewAnnotationTargetSnapshot): PreviewAnnotationTarget {
  return {
    filePath: snapshot.filePath,
    elementId: snapshot.elementId,
    selector: snapshot.selector,
    label: snapshot.label,
    text: trimText(snapshot.text, 160),
    position: normalizePosition(snapshot.position),
    htmlHint: trimText(snapshot.htmlHint, 180),
    style: snapshot.style,
    selectionKind: snapshot.selectionKind === 'pod' ? 'pod' : 'element',
    memberCount: snapshot.selectionKind === 'pod' ? snapshot.memberCount ?? snapshot.podMembers?.length ?? 0 : undefined,
    podMembers: snapshot.selectionKind === 'pod' ? snapshot.podMembers : undefined,
  };
}

export function annotationAttachmentFromSaved(annotation: PreviewAnnotation, order: number): ChatAnnotationAttachment {
  return {
    id: annotation.id,
    order,
    filePath: annotation.filePath,
    elementId: annotation.elementId,
    selector: annotation.selector,
    label: annotation.label,
    comment: annotation.note,
    currentText: trimText(annotation.text, 160),
    pagePosition: normalizePosition(annotation.position),
    htmlHint: trimText(annotation.htmlHint, 180),
    style: annotation.style,
    selectionKind: annotation.selectionKind,
    memberCount: annotation.memberCount,
    podMembers: annotation.podMembers,
    source: 'saved-annotation',
  };
}

export function visualAnnotationAttachment(input: {
  order: number;
  screenshotPath: string;
  markKind: PreviewAnnotationMarkKind;
  note: string;
  bounds: PreviewAnnotationPosition;
  target?: Partial<PreviewAnnotationTarget> | null;
}): ChatAnnotationAttachment {
  const idSeed = input.screenshotPath.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mark';
  const elementId = input.target?.elementId?.trim() || `visual-mark-${idSeed}`;
  const intent = visualIntent(input.markKind);
  return {
    id: `${elementId}-visual-${idSeed}`,
    order: input.order,
    filePath: input.target?.filePath?.trim() || input.screenshotPath,
    elementId,
    selector: input.target?.selector?.trim() || '',
    label: input.target?.label?.trim() || 'Marked screenshot region',
    comment: input.note.trim() || intent,
    currentText: trimText(input.target?.text ?? '', 160),
    pagePosition: normalizePosition(input.target?.position ?? input.bounds),
    htmlHint: trimText(input.target?.htmlHint ?? '', 180),
    style: input.target?.style,
    selectionKind: 'visual',
    screenshotPath: input.screenshotPath,
    markKind: input.markKind,
    intent,
    source: 'annotation-batch',
  };
}

export function visualIntent(markKind: PreviewAnnotationMarkKind): string {
  if (markKind === 'click') return 'User clicked a preview target. Apply the request to the blue highlighted target.';
  if (markKind === 'click+stroke') return 'User clicked a preview target and drew visual marks. Apply the request to the blue target and red marked area.';
  return 'User drew a visual mark on the preview screenshot. Apply the request to the marked area.';
}

function normalizePosition(position: PreviewAnnotationPosition): PreviewAnnotationPosition {
  return {
    x: finite(position.x),
    y: finite(position.y),
    width: Math.max(0, finite(position.width)),
    height: Math.max(0, finite(position.height)),
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function trimText(value: string, max: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
```

- [ ] **Step 4: Run model tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- annotation-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit model helpers**

```bash
git add web/src/features/canvas-workspace/annotations/annotation-model.ts web/src/features/canvas-workspace/annotations/annotation-model.test.ts
git commit -m "feat: add annotation model helpers"
```

---

### Task 6: Canvas Mark Mode And Preview Message Wiring

**Files:**
- Modify: `web/src/features/canvas-workspace/canvas-workspace-types.ts`
- Modify: `web/src/features/canvas-workspace/workspace-mode.ts`
- Modify: `web/src/features/canvas-workspace/CanvasPreview.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write failing mode test**

Add to `CanvasWorkspace.test.tsx`:

```ts
it('shows Mark mode for html files and disables inspect selection while marking', () => {
  render(<CanvasWorkspace files={[{
    name: 'index.html',
    path: 'index.html',
    kind: 'html',
    mime: 'text/html',
    contents: '<html><body><section>Hello</section></body></html>',
  }]} initialTabs={{ tabs: [{ kind: 'file', key: 'file:index.html', name: 'index.html', path: 'index.html' }], activeTabKey: 'file:index.html' }} />);

  expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Inspect' })).toBeInTheDocument();
  const mark = screen.getByRole('tab', { name: 'Mark' });
  fireEvent.click(mark);
  expect(mark).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('annotation-dock')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing mode test**

Run:

```bash
pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx
```

Expected: FAIL because `Mark` mode does not exist.

- [ ] **Step 3: Add mark mode type**

In `canvas-workspace-types.ts`:

```ts
export type FileSurfaceMode = 'preview' | 'inspect' | 'mark';
```

In `workspace-mode.ts`, allow `mark` in guarded transitions exactly like `preview` for dirty inspect exit:

```ts
export function defaultModeForTab(tab: WorkspaceTab): FileSurfaceMode {
  return 'preview';
}
```

Ensure `setModeForTab` accepts `FileSurfaceMode`.

- [ ] **Step 4: Extend CanvasPreview props and message handling**

Add props:

```ts
annotationMode?: boolean;
annotationTool?: 'picker' | 'pod';
onAnnotationTargetsChange?: (targets: PreviewAnnotationTargetSnapshot[]) => void;
onAnnotationHoverChange?: (target: PreviewAnnotationTargetSnapshot | null) => void;
onAnnotationTargetSelect?: (target: PreviewAnnotationTargetSnapshot) => void;
```

Build srcdoc with:

```ts
annotationBridge: annotationMode,
snapshotBridge: annotationMode,
editBridge: editMode,
```

In message handler, accept:

```ts
if (message.type === 'vd-annotation-targets') onAnnotationTargetsChange?.(message.targets);
if (message.type === 'vd-annotation-hover') onAnnotationHoverChange?.(message.target);
if (message.type === 'vd-annotation-leave') onAnnotationHoverChange?.(null);
if (message.type === 'vd-annotation-target') onAnnotationTargetSelect?.(message.target);
```

Replay command:

```ts
frame?.contentWindow?.postMessage({ type: 'vd-annotation-mode', enabled: annotationMode, tool: annotationTool ?? 'picker' }, '*');
```

- [ ] **Step 5: Add Mark tab and initial dock shell**

In `CanvasWorkspace.tsx`, add `Mark` to the mode switch:

```tsx
{canInspectActiveFile ? (
  <Button
    type="button"
    role="tab"
    aria-selected={activeMode === 'mark'}
    className="h-8 rounded-md px-3"
    size="sm"
    variant={activeMode === 'mark' ? 'secondary' : 'chrome'}
    onClick={() => setActiveFileMode('mark')}
  >
    Mark
  </Button>
) : null}
```

Pass:

```tsx
annotationMode={activeMode === 'mark'}
annotationTool="picker"
```

Render the first functional dock shell. This shell is replaced by the full `AnnotationDock` in Task 7, but it must already be wired to Mark mode and accessible for tests:

```tsx
{activeMode === 'mark' ? (
  <div data-testid="annotation-dock" className="absolute bottom-4 right-4 top-4 z-20 w-[360px] rounded-lg border border-[var(--border-1)] bg-[var(--background-fronted)] p-4">
    <div className="text-sm font-medium text-[var(--text-primary)]">Annotations</div>
    <div className="mt-1 text-xs text-[var(--text-secondary)]">Click a preview element or draw on the preview.</div>
  </div>
) : null}
```

- [ ] **Step 6: Run mode tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx CanvasPreview.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: PASS.

- [ ] **Step 7: Commit mark mode plumbing**

```bash
git add web/src/features/canvas-workspace
git commit -m "feat: add canvas mark mode"
```

---

### Task 7: Annotation Overlay And Dock UI

**Files:**
- Create: `web/src/features/canvas-workspace/annotations/CanvasAnnotationOverlay.tsx`
- Create: `web/src/features/canvas-workspace/annotations/AnnotationDock.tsx`
- Create: `web/src/features/canvas-workspace/annotations/AnnotationComposerPopover.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Test: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write failing UI test**

Add:

```ts
it('opens annotation composer after target selection and saves annotation', async () => {
  const saveAnnotation = vi.fn();
  render(<CanvasWorkspace
    files={[{ name: 'index.html', path: 'index.html', kind: 'html', mime: 'text/html', contents: '<html><body>Hello</body></html>' }]}
    initialTabs={{ tabs: [{ kind: 'file', key: 'file:index.html', name: 'index.html', path: 'index.html' }], activeTabKey: 'file:index.html' }}
    annotationServiceOverride={{ save: saveAnnotation }}
  />);

  fireEvent.click(screen.getByRole('tab', { name: 'Mark' }));
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'vd-annotation-target',
      target: {
        filePath: 'index.html',
        elementId: 'path-0',
        selector: '[data-vd-source-path="path-0"]',
        label: 'body',
        text: 'Hello',
        position: { x: 0, y: 0, width: 100, height: 50 },
        htmlHint: '<body>',
      },
    },
  }));

  await userEvent.type(screen.getByLabelText('Annotation note'), 'Make this clearer');
  await userEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
  expect(saveAnnotation).toHaveBeenCalled();
});
```

Use the existing DI test harness pattern for this test. Register a fake `IPreviewAnnotationService` in the test container so production `CanvasWorkspace` props remain domain-focused.

- [ ] **Step 2: Run failing UI test**

Run:

```bash
pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx
```

Expected: FAIL because the full composer and dock components are not implemented yet.

- [ ] **Step 3: Implement `CanvasAnnotationOverlay`**

Create a component with props:

```ts
export interface CanvasAnnotationOverlayProps {
  active: boolean;
  captureTarget: PreviewAnnotationTargetSnapshot | null;
  filePath: string;
  iframe: HTMLIFrameElement | null;
  onSubmit(input: { file: File | null; note: string; markKind?: PreviewAnnotationMarkKind; bounds?: PreviewAnnotationPosition; target?: PreviewAnnotationTargetSnapshot | null }): Promise<void>;
  onClose(): void;
}
```

Behavior:

- render children/preview below overlay from `CanvasWorkspace`
- track `box`, `strokes`, `tool`, `note`
- support box, pen, undo, redo, clear
- request snapshot with `requestPreviewSnapshotResult`
- composite snapshot and drawing into `File`
- call `onSubmit`

Use `Button` from `@tutti-os/ui-system/components` and icons from `@tutti-os/ui-system/icons`.

- [ ] **Step 4: Implement `AnnotationComposerPopover`**

Props:

```ts
export interface AnnotationComposerPopoverProps {
  target: PreviewAnnotationTargetSnapshot;
  draft: string;
  onDraftChange(value: string): void;
  onSave(): Promise<void> | void;
  onSend(): Promise<void> | void;
  onClose(): void;
  sending?: boolean;
}
```

Render a compact popover with textarea `aria-label="Annotation note"`, `Save annotation`, and `Send annotation`.

- [ ] **Step 5: Implement `AnnotationDock`**

Props:

```ts
export interface AnnotationDockProps {
  annotations: PreviewAnnotation[];
  selectedIds: Set<string>;
  onToggle(id: string): void;
  onSendSelected(): void;
  onDelete(id: string): void;
  onResolve(id: string): void;
}
```

Render `data-testid="annotation-dock"`, empty state, selected count, and annotation rows grouped by current file.

- [ ] **Step 6: Wire UI into CanvasWorkspace**

Replace the temporary dock. Use service from DI:

```ts
const annotations = useService(IPreviewAnnotationService);
```

Load when `activeConversationId` changes. If `CanvasWorkspace` does not currently receive active conversation id, pass it from `ProjectEditorPage` using `IChatTimelineService.getSnapshot().activeConversationId`.

On save:

```ts
await annotations.save(activeConversationId, { target: targetFromSnapshot(activeAnnotationTarget), note: annotationDraft });
```

On send:

```ts
const attachment = annotationAttachmentFromSaved(saved, 1);
await onSendAnnotation({ draft: annotationDraft, files: [], annotationAttachments: [attachment] });
```

- [ ] **Step 7: Run UI tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- CanvasWorkspace.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: PASS.

- [ ] **Step 8: Commit annotation UI**

```bash
git add web/src/features/canvas-workspace/annotations web/src/features/canvas-workspace/CanvasWorkspace.tsx web/src/features/canvas-workspace/CanvasWorkspace.test.tsx
git commit -m "feat: add preview annotation ui"
```

---

### Task 8: Chat Annotation Attachments

**Files:**
- Modify: `web/src/services/chat-session/chat-session-types.ts`
- Modify: `web/src/services/chat-session/internal/chat-session-service.ts`
- Modify: `web/src/services/run/run-types.ts`
- Modify: `web/src/services/chat-timeline/chat-timeline-types.ts`
- Modify: `web/src/services/chat-timeline/internal/chat-timeline-service.ts`
- Modify: `web/src/components/ChatPane.tsx`
- Test: `web/src/services/chat-session/internal/chat-session-service.test.ts`

- [ ] **Step 1: Write failing chat-session test**

Add:

```ts
it('passes annotation attachments to run creation and user message', async () => {
  const deps = makeChatSessionDeps();
  const service = new ChatSessionService(deps);

  await service.sendTurn({
    draft: 'Apply this',
    files: [],
    annotationAttachments: [{
      id: 'annotation-1',
      order: 1,
      filePath: 'index.html',
      elementId: 'path-0',
      selector: '[data-vd-source-path="path-0"]',
      label: 'Hero',
      comment: 'Apply this',
      currentText: 'Hero',
      pagePosition: { x: 0, y: 0, width: 100, height: 40 },
      htmlHint: '<section>',
      selectionKind: 'element',
      source: 'saved-annotation',
    }],
  });

  expect(deps.timeline.appendUserMessage).toHaveBeenCalledWith(expect.objectContaining({
    annotationAttachments: expect.arrayContaining([expect.objectContaining({ id: 'annotation-1' })]),
  }));
  expect(deps.run.createRun).toHaveBeenCalledWith(expect.objectContaining({
    annotationAttachments: expect.arrayContaining([expect.objectContaining({ id: 'annotation-1' })]),
  }));
});
```

- [ ] **Step 2: Run failing chat test**

Run:

```bash
pnpm --filter @vibe-design/web test -- chat-session-service.test.ts
```

Expected: FAIL because `annotationAttachments` is not part of the contracts.

- [ ] **Step 3: Extend contracts**

In `chat-session-types.ts`:

```ts
import type { ChatAnnotationAttachment } from '../../types';

export interface SendTurnInput {
  draft: string;
  files: File[];
  annotationAttachments?: ChatAnnotationAttachment[];
}
```

In `run-types.ts`:

```ts
import type { AgentEvent, ChatAnnotationAttachment, ChatAttachment, RunContextSelection, RunStatus } from '../../types';
...
annotationAttachments?: ChatAnnotationAttachment[];
```

In `chat-timeline-types.ts`:

```ts
import type { AgentEvent, ChatAnnotationAttachment, ChatAttachment, ChatMessage, RunPhase, RunStatus } from '../../types';
...
export interface AppendUserMessageInput {
  content: string;
  attachments?: ChatAttachment[];
  annotationAttachments?: ChatAnnotationAttachment[];
}
```

Add optional `annotationAttachments?: ChatAnnotationAttachment[]` to `ChatMessage` in `web/src/types.ts`.

- [ ] **Step 4: Pass annotation attachments through session**

In `ChatSessionService.prepareTurn`:

```ts
const annotationAttachments = input.annotationAttachments ?? [];
const userMessage = this.dependencies.timeline.appendUserMessage({
  content: input.draft,
  attachments,
  annotationAttachments,
});
...
return { prompt, attachments, annotationAttachments, conversationId, context, userMessageId: userMessage.id };
```

In `PreparedTurn`:

```ts
annotationAttachments: ChatAnnotationAttachment[];
```

In `startTurn`:

```ts
...(turn.annotationAttachments.length > 0 ? { annotationAttachments: turn.annotationAttachments } : {}),
```

- [ ] **Step 5: Store and display timeline annotation attachments**

In `ChatTimelineService.appendUserMessage`, store cloned `annotationAttachments`. Add a `cloneAnnotationAttachments` helper using `cloneValue`.

In `ChatPane.tsx`, render user message annotation chips near file attachments:

```tsx
{message.annotationAttachments?.length ? (
  <div className="chat-message__annotation-attachments" aria-label="Preview annotations">
    {message.annotationAttachments.map((annotation) => (
      <Badge key={annotation.id} variant="secondary">
        {annotation.selectionKind === 'visual' ? 'Visual mark' : annotation.label || annotation.elementId}
      </Badge>
    ))}
  </div>
) : null}
```

- [ ] **Step 6: Run chat tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- chat-session-service.test.ts ChatPane.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: PASS.

- [ ] **Step 7: Commit chat integration**

```bash
git add web/src/types.ts web/src/services/chat-session web/src/services/run web/src/services/chat-timeline web/src/components/ChatPane.tsx
git commit -m "feat: send preview annotation attachments"
```

---

### Task 9: End-To-End Wiring And Status Updates

**Files:**
- Modify: `web/src/ProjectEditorPage.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Modify: `web/src/services/preview-annotations/internal/preview-annotation-service.ts`
- Test: `web/src/ProjectEditorPage.test.tsx`

- [ ] **Step 1: Write failing integration test**

Add a test that renders `ProjectEditorPage` with fake services and asserts that sending a saved annotation calls `session.sendTurn` with `annotationAttachments`.

Use this fake:

```ts
const chatSessionService = {
  _serviceBrand: undefined,
  sendTurn: vi.fn(async () => undefined),
  stopActiveRun: vi.fn(async () => undefined),
  answerToolQuestion: vi.fn(async () => undefined),
};
```

Expected assertion:

```ts
expect(chatSessionService.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
  annotationAttachments: expect.arrayContaining([expect.objectContaining({ source: 'saved-annotation' })]),
}));
```

- [ ] **Step 2: Run failing integration test**

Run:

```bash
pnpm --filter @vibe-design/web test -- ProjectEditorPage.test.tsx
```

Expected: FAIL until `CanvasWorkspace` receives an `onSendAnnotation` callback.

- [ ] **Step 3: Pass chat send callback into CanvasWorkspace**

In `ProjectEditorPage`, read `IChatSessionService` at page level and pass:

```tsx
<CanvasWorkspace
  ...
  activeConversationId={timelineSnapshot.activeConversationId}
  onSendAnnotation={(input) => session.sendTurn(input)}
/>
```

If `ChatPanel` currently owns `session`, move `const session = useService(IChatSessionService)` to `ProjectEditorPage` and keep passing it to `ChatPanel` through existing props only where needed.

- [ ] **Step 4: Patch saved annotation statuses**

After successful send of saved annotations, call:

```ts
await annotations.patchStatus(activeConversationId, annotation.id, 'attached');
```

Do not set `applying` from arbitrary assistant text. For this implementation, saved annotations move to `attached` after a successful send and remain there until the user resolves them or a later explicit status flow is added.

- [ ] **Step 5: Run integration tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- ProjectEditorPage.test.tsx CanvasWorkspace.test.tsx
pnpm --filter @vibe-design/web type-check
```

Expected: PASS.

- [ ] **Step 6: Commit end-to-end wiring**

```bash
git add web/src/ProjectEditorPage.tsx web/src/features/canvas-workspace/CanvasWorkspace.tsx web/src/services/preview-annotations/internal/preview-annotation-service.ts web/src/ProjectEditorPage.test.tsx
git commit -m "feat: wire annotations into project editor"
```

---

### Task 10: Final Verification And Browser Smoke

**Files:**
- Modify only files needed for failures found during verification.

- [ ] **Step 1: Run full server verification**

Run:

```bash
pnpm --filter @vibe-design/server test
pnpm --filter @vibe-design/server type-check
```

Expected: PASS.

- [ ] **Step 2: Run full web verification**

Run:

```bash
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/web build
```

Expected: PASS.

- [ ] **Step 3: Start local app**

Run:

```bash
pnpm dev
```

Expected: server starts and serves the web app. Keep this session running until browser smoke completes.

- [ ] **Step 4: Browser smoke checklist**

Open the local server URL in the in-app browser. Verify:

- HTML project opens in the canvas workspace.
- `Preview`, `Inspect`, and `Mark` mode tabs are visible.
- `Inspect` still selects and edits an element.
- `Mark` shows the annotation dock and does not show the inspect panel.
- Clicking an element in `Mark` opens the annotation composer.
- Saving annotation shows it in the dock.
- Drawing a rectangle and sending creates an image attachment and starts/queues a chat turn.
- User message displays annotation chip/card.
- No console errors from iframe bridge message handling.

- [ ] **Step 5: Stop dev server**

Stop the dev server session cleanly with `Ctrl+C`.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: no uncommitted changes except intentionally generated local artifacts ignored by git.

---

## Self-Review Notes

- Spec coverage: backend persistence, REST API, web DI service, `vd-*` bridge, snapshot capture, Mark UI, dock, element/pod/visual annotations, chat attachments, and verification are mapped to tasks.
- Placeholder scan: this plan intentionally avoids `TBD` and names exact files, commands, contracts, and expected outcomes.
- Type consistency: names match the approved spec: `PreviewAnnotation`, `PreviewAnnotationTarget`, `ChatAnnotationAttachment`, `vd-annotation-*`, and `preview_annotations`.
