# Vibe Design Preview Annotation Workflow Design

**Date:** 2026-06-03

## 1. References

This design extends the current `vibe-design` canvas workspace and uses `reference-design` only as a behavioral reference for preview annotations.

Reference paths inspected:

- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/components/FileViewer.tsx`
- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/components/PreviewDrawOverlay.tsx`
- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/runtime/srcdoc.ts`
- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/comments.ts`
- `/Users/chovy/Desktop/workspace/reference-design/apps/daemon/src/db.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasPreview.tsx`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/canvas-edit/bridge.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/components/ChatComposer.tsx`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/services/chat-session/internal/chat-session-service.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/server/src/sqlite-store.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/server/src/routes/chat-routes.ts`

Related Vibe Design specs:

- `/Users/chovy/Desktop/workspace/vibe-design/docs/superpowers/specs/2026-06-02-vibe-design-workspace-preview-inspect-design.md`
- `/Users/chovy/Desktop/workspace/vibe-design/docs/superpowers/specs/2026-06-03-design-runtime-preview-design.md`

## 2. Goal

Implement the full preview annotation workflow in `vibe-design`:

- mark an HTML preview visually with box and pen tools
- click an HTML element and attach structured element context
- create, persist, list, update, delete, select, and resend preview annotations
- attach annotation context and screenshot evidence to chat turns
- keep the workflow consistent with the existing `CanvasWorkspace`, `CanvasPreview`, DI services, and `vd-*` iframe bridge namespace

The result should feel native to `vibe-design`, not like copied `reference-design` code. The behavior can match the reference, but protocols, component names, service boundaries, and UI wording must use Vibe Design semantics.

## 3. Source To Target Mapping

| Reference Design concept | Vibe Design concept |
| --- | --- |
| `PreviewComment` | `PreviewAnnotation` |
| `PreviewCommentTarget` | `PreviewAnnotationTarget` |
| `ChatCommentAttachment` | `ChatAnnotationAttachment` |
| comment mode | annotation mode |
| board batch | annotation send batch |
| visual mark | preview mark |
| `data-od-id` | `data-vd-id` or `data-vd-source-path` |
| `od:comment-target` | `vd-annotation-target` |
| `od:comment-targets` | `vd-annotation-targets` |
| `od:snapshot` | `vd-preview-snapshot-request` |
| `od:snapshot:result` | `vd-preview-snapshot-result` |
| `PreviewDrawOverlay` | `CanvasAnnotationOverlay` |
| `CommentSideDock` | `AnnotationDock` |
| `BoardComposerPopover` | `AnnotationComposerPopover` |
| `preview_comments` table | `preview_annotations` table |

## 4. Scope

### In Scope

- add `mark` as a file surface mode for HTML files
- support click-to-target, rectangle marking, freehand pen marking, and combined click + visual mark
- support a side dock for saved annotations
- support an inline/floating annotation composer for the active target
- persist annotations per project and conversation
- attach annotations to a chat turn with structured target metadata and optional screenshot path
- update persisted annotation status after send/apply/review flows
- render saved annotation overlays on the preview
- support deletion and selection of saved annotations
- use only `@tutti-os/ui-system` public entrypoints for new common controls and icons
- keep all iframe bridge messages in the `vd-*` namespace

### Out Of Scope

- multi-user realtime cursors
- threaded comment replies
- direct DOM mutation from annotation mode
- storing raw full-page screenshots in the annotations table
- cross-origin deployed URL annotation capture
- visual diffing between annotation creation and later preview changes

## 5. Protocols That Must Stay Stable

Existing Vibe Design bridge messages must not be renamed:

```text
vd-edit-targets
vd-edit-hover
vd-edit-select
vd-edit-text-commit
vd-edit-selected-target
vd-edit-preview-style
vd-edit-preview-style-reset
vd-edit-preview-style-applied
vd-preview-size
```

New annotation bridge messages:

```ts
type PreviewAnnotationBridgeMessage =
  | { type: 'vd-annotation-targets'; targets: PreviewAnnotationTargetSnapshot[] }
  | { type: 'vd-annotation-hover'; target: PreviewAnnotationTargetSnapshot }
  | { type: 'vd-annotation-leave' }
  | { type: 'vd-annotation-target'; target: PreviewAnnotationTargetSnapshot }
  | { type: 'vd-annotation-active-target-update'; target: PreviewAnnotationTargetSnapshot }
  | { type: 'vd-preview-scroll'; frameLeft: number; frameTop: number; canvasLeft: number; canvasTop: number }
  | { type: 'vd-preview-snapshot-result'; id: string; dataUrl?: string; width?: number; height?: number; error?: string };
```

New host-to-iframe commands:

```ts
type PreviewAnnotationIframeCommand =
  | { type: 'vd-annotation-mode'; enabled: boolean; tool: 'picker' | 'pod' }
  | { type: 'vd-annotation-active-target'; elementId: string | null; selector?: string | null }
  | { type: 'vd-preview-scroll-restore'; frameLeft: number; frameTop: number; canvasLeft: number; canvasTop: number }
  | { type: 'vd-preview-scroll-by'; left: number; top: number }
  | { type: 'vd-preview-snapshot-request'; id: string };
```

Server API contract:

```text
GET    /api/projects/:projectId/conversations/:conversationId/annotations
POST   /api/projects/:projectId/conversations/:conversationId/annotations
PATCH  /api/projects/:projectId/conversations/:conversationId/annotations/:annotationId
DELETE /api/projects/:projectId/conversations/:conversationId/annotations/:annotationId
```

Chat run creation should accept the additive field:

```ts
annotationAttachments?: ChatAnnotationAttachment[]
```

This field is additive. Existing `prompt`, `attachments`, and `context` behavior must continue to work unchanged.

## 6. Data Model

### 6.1 Selection Kinds

```ts
type PreviewAnnotationSelectionKind = 'element' | 'pod';
type PreviewAnnotationMarkKind = 'click' | 'stroke' | 'click+stroke';
type ChatAnnotationSelectionKind = PreviewAnnotationSelectionKind | 'visual';
```

### 6.2 Target Snapshot

```ts
interface PreviewAnnotationTargetSnapshot {
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: { x: number; y: number; width: number; height: number };
  hoverPoint?: { x: number; y: number };
  htmlHint: string;
  style?: Record<string, string>;
  selectionKind?: PreviewAnnotationSelectionKind;
  memberCount?: number;
  podMembers?: PreviewAnnotationTargetMember[];
}
```

### 6.3 Persisted Annotation

```ts
type PreviewAnnotationStatus =
  | 'open'
  | 'attached'
  | 'applying'
  | 'needs_review'
  | 'resolved'
  | 'failed';

interface PreviewAnnotation {
  id: string;
  projectId: string;
  conversationId: string;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: { x: number; y: number; width: number; height: number };
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

### 6.4 Chat Attachment

```ts
interface ChatAnnotationAttachment {
  id: string;
  order: number;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  comment: string;
  currentText: string;
  pagePosition: { x: number; y: number; width: number; height: number };
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

## 7. Architecture

### 7.1 Backend

Extend `server/src/sqlite-store.ts` with a `preview_annotations` table:

```sql
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
```

Add store functions:

- `listPreviewAnnotationsFromStore`
- `upsertPreviewAnnotationInStore`
- `updatePreviewAnnotationStatusInStore`
- `deletePreviewAnnotationFromStore`

Add a route registration module:

```text
server/src/routes/annotation-routes.ts
```

The route validates:

- project exists
- conversation exists and belongs to project
- note is non-empty for create/update
- `filePath`, `elementId`, `selector`, and `label` are non-empty
- position fields are finite numbers
- status is one of the allowed status values

### 7.2 Web Service Boundary

Add a domain service:

```text
web/src/services/preview-annotations/
  preview-annotation-types.ts
  preview-annotation-api.ts
  preview-annotation-service.interface.ts
  internal/preview-annotation-service.ts
```

Responsibilities:

- load annotations for active project and conversation
- upsert annotations
- delete annotations
- patch status
- keep a readonly store/snapshot for UI
- project raw API responses into domain types
- expose commands to attach selected annotations to chat

`CanvasWorkspace` and `ChatSessionService` should not build annotation API URLs directly.

Register the service in the existing web composition root used by the launch flow. The concrete API implementation should receive the active project id the same way existing project-scoped services do.

### 7.3 Chat Session Integration

Extend `SendTurnInput`:

```ts
interface SendTurnInput {
  draft: string;
  files: File[];
  annotationAttachments?: ChatAnnotationAttachment[];
}
```

`ChatSessionService.prepareTurn` should:

1. upload normal files and screenshot files through `IDesignFileService`
2. append user message with regular attachments and annotation attachments
3. call run creation with `annotationAttachments`
4. inject annotation context into the prompt only in the run payload layer, not by mutating the visible chat draft

The timeline should display annotation chips/cards separately from normal file attachments.

Server run creation should include annotation context in the agent prompt:

```xml
<attached-preview-annotations>
Scope: apply the user request to the attached preview target by default. For visual marks, inspect the screenshot and modify the marked region first. Preserve unrelated elements.
...
</attached-preview-annotations>
```

### 7.4 Iframe Bridge

Extend `build-preview-srcdoc.ts` with:

```ts
interface BuildPreviewSrcdocOptions {
  editBridge: boolean;
  sizeBridge?: boolean;
  annotationBridge?: boolean;
  snapshotBridge?: boolean;
}
```

The annotation bridge should reuse the same target identity priority as the edit bridge:

1. `data-vd-id`
2. `data-vd-source-path`
3. `data-vd-runtime-id`
4. element `id`
5. generated DOM path

The annotation bridge should be independent from edit mode, but it can reuse pure helpers from `canvas-edit/bridge.ts` by extracting shared target utilities into a small runtime helper module.

The snapshot bridge should:

- clone `document.documentElement`
- inline a bounded set of computed styles
- copy image/current input/canvas state where possible
- strip scripts from the cloned snapshot
- remove external stylesheet/preload/preconnect links from the clone
- render the visible viewport through SVG `foreignObject`
- draw the result onto a canvas and return a PNG data URL
- respond with a timeout-safe error payload if rendering fails

### 7.5 Canvas UI

Add `mark` to `FileSurfaceMode`:

```ts
type FileSurfaceMode = 'preview' | 'inspect' | 'mark';
```

`CanvasWorkspace` top mode switch becomes:

- `Preview`
- `Inspect`
- `Mark`

`Mark` mode:

- disables inspect selection/editing
- enables annotation bridge
- shows annotation dock
- renders saved annotation overlays
- renders `CanvasAnnotationOverlay` above the active iframe

New UI components under:

```text
web/src/features/canvas-workspace/annotations/
  CanvasAnnotationOverlay.tsx
  AnnotationDock.tsx
  AnnotationComposerPopover.tsx
  annotation-model.ts
  annotation-snapshot.ts
```

Use `@tutti-os/ui-system/components` and `@tutti-os/ui-system/icons` for buttons, badges, tabs, dialog, tooltip, icon buttons, and empty states.

## 8. User Workflow

### 8.1 Create Element Annotation

1. User opens an HTML file.
2. User switches to `Mark`.
3. iframe receives `vd-annotation-mode`.
4. User clicks an element.
5. iframe posts `vd-annotation-target`.
6. Host shows `AnnotationComposerPopover` anchored to the target bounds.
7. User writes a note.
8. User chooses `Save` or `Send`.
9. `Save` persists the annotation and leaves it `open`.
10. `Send` creates an annotation attachment and starts or queues a chat turn.

### 8.2 Create Visual Annotation

1. User switches to `Mark`.
2. User chooses rectangle or pen tool.
3. User marks the preview.
4. On submit, host requests `vd-preview-snapshot-request`.
5. Host composites screenshot, target outline, box, and pen strokes into a PNG.
6. Host uploads the PNG as a project file.
7. Host creates a `ChatAnnotationAttachment` with `selectionKind: 'visual'`.
8. Host sends or queues the chat turn.

### 8.3 Create Pod Annotation

1. User switches to `Mark`.
2. User chooses the pod selection tool.
3. iframe receives `vd-annotation-mode` with `tool: 'pod'`.
4. User draws a stroke across multiple preview elements.
5. iframe emits candidate target snapshots for elements intersecting the stroke.
6. Host builds one `PreviewAnnotationTargetSnapshot` with `selectionKind: 'pod'`, `memberCount`, and `podMembers`.
7. Host shows a composer listing included members and allows removing individual members before save/send.
8. Saved pod annotations persist as one annotation row with `pod_members_json`.

### 8.4 Manage Saved Annotations

The dock supports:

- list open annotations for current file
- select annotation and scroll/highlight preview target
- send selected annotations to chat
- delete annotation
- mark resolved
- show empty state when there are no annotations

## 9. Error Handling

- If snapshot capture fails, do not send a visual-only annotation; show an inline warning and keep the draft/marks intact.
- If upload fails after a screenshot is created, keep the annotation composer open and show the upload error.
- If annotation save fails, keep the note and target active.
- If a saved element no longer exists in the current DOM, render it in the dock as stale and allow delete or send with stale context.
- If the active conversation changes, reload annotations and detach annotations from the old conversation.
- If a run is already active, sending annotations should follow the existing queued-turn behavior.

## 10. Security And Sandboxing

- Do not use `allow-same-origin` as a new requirement for annotation capture. The bridge must work through `postMessage` in srcdoc mode.
- Validate all inbound iframe messages by source window.
- Do not trust selectors sent from the iframe for CSS injection. Use selectors only as metadata for Agent context and DOM lookup.
- Snapshot bridge must strip scripts from clones.
- API validation must cap text fields:
  - `text`: 160 chars
  - `htmlHint`: 180 chars
  - `note`: 4000 chars
  - `label`: 120 chars
  - `selector`: 500 chars
- Stored JSON fields must be normalized and not blindly echoed into executable code.

## 11. Implementation Phases

### Phase 1: Protocol And Persistence

- add annotation domain types
- add SQLite table and migrations
- add server routes
- add web service/API layer
- add focused unit tests for store and API mapping

### Phase 2: Iframe Bridge And Snapshot

- add annotation bridge
- add snapshot bridge
- add host request helper with timeout handling
- add tests for srcdoc injection and message handling

### Phase 3: Canvas Mark UI

- add `mark` file mode
- add annotation overlay with rectangle, pen, undo, redo, clear, note, save/send
- add annotation target overlays and composer popover
- add annotation dock
- add UI tests for mode switching and annotation creation

### Phase 4: Chat Integration

- extend `SendTurnInput`
- extend visible timeline message model for annotation attachments
- include annotation context in run payload
- patch saved annotation statuses after send
- add queued-run tests

### Phase 5: Verification And Polish

- browser smoke test at desktop viewport
- test stale target rendering
- test visual annotation capture failure path
- run type-check and relevant web/server tests

## 12. Testing Plan

Server:

- `sqlite-store` annotation CRUD and validation
- annotation routes for list/create/patch/delete
- run creation includes annotation context without changing existing attachment behavior

Web service:

- API response mapping
- service store transitions
- attach/delete/status commands

Runtime:

- `build-preview-srcdoc` injects annotation and snapshot bridges only when requested
- bridge emits `vd-annotation-targets`
- snapshot helper handles success, render error, postMessage error, and timeout

React:

- `CanvasWorkspace` supports `Preview / Inspect / Mark`
- `Mark` disables inspect bridge and enables annotation bridge
- visual mark creates a file plus `ChatAnnotationAttachment`
- saved annotation list renders and can send selected annotations
- stale annotations remain manageable

Validation commands:

```bash
pnpm --filter @vibe-design/server test
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/web type-check
```

If package filter names differ in the local workspace, use the package scripts from `vibe-design/package.json` and the relevant `web/package.json` / `server/package.json` files.

## 13. Risks

- Snapshot rendering through SVG `foreignObject` may fail for external images, fonts, or browser-specific CSS. The fallback is to block visual-only sends and preserve the draft.
- URL-loaded previews cannot be fully captured unless they use the same injected bridge. First full implementation should prefer srcdoc previews for mark mode.
- Adding persistent annotations touches backend, web services, workspace UI, timeline, and run prompts; implementation should be phased and tested at each boundary.
- A large generated HTML document can create many targets. The bridge should cap target enumeration and prefer visible meaningful nodes.

## 14. Non-Deviations

- The implementation must use `vd-*` protocols, not `od-*`.
- The UI must use `@tutti-os/ui-system` public entrypoints for new common controls.
- Annotation mode must not mutate HTML directly.
- Existing inspect mode behavior must remain intact.
- Existing chat file attachment behavior must remain intact.
