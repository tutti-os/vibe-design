# Vibe Design Full HTML Preview Comments

**Date:** 2026-06-03

## 1. References

This design is based on the current `vibe-design` implementation and the full Reference Design preview-comment chain reviewed in this session.

Reference Design reference paths:

- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/runtime/srcdoc.ts`
- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/components/FileViewer.tsx`
- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/components/BoardComposerPopover.tsx`
- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/components/PreviewDrawOverlay.tsx`
- `/Users/chovy/Desktop/workspace/reference-design/apps/web/src/comments.ts`
- `/Users/chovy/Desktop/workspace/reference-design/apps/daemon/src/project-routes.ts`
- `/Users/chovy/Desktop/workspace/reference-design/apps/daemon/src/db.ts`

Target Vibe Design paths:

- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasPreview.tsx`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/features/canvas-workspace/canvas-edit/bridge.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/services/chat-session/internal/chat-session-service.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/services/chat-timeline/chat-timeline-types.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/web/src/services/run/run-types.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/server/src/agent-launcher.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/server/src/sqlite-store.ts`
- `/Users/chovy/Desktop/workspace/vibe-design/server/src/routes/conversation-routes.ts`

## 2. Goal

Implement the full HTML preview comment capability in `vibe-design`:

- select elements inside an HTML preview
- hover and active target overlays
- comment popover for the selected target
- persistent saved comments per project conversation
- saved markers and a comment side panel
- send saved or draft comments to the chat agent
- pod selection by drawing around multiple elements
- free-pin comments on inert preview areas
- visual screenshot annotations with box and pen marks
- comment status lifecycle tied to agent runs

The feature should read as native `vibe-design` code. It should reuse the current canvas workspace, preview iframe, edit bridge identity model, chat session service, and server routing style instead of moving Reference Design files over.

## 3. Non-Goals

- Do not replace the existing `CanvasPreview` dual iframe strategy.
- Do not rename or weaken existing `vd-edit-*` and `vd-preview-size` bridge messages.
- Do not make comment mode trigger text editing or inspector style editing.
- Do not introduce a second UI component system.
- Do not deep import from `@tutti-os/ui-system`.
- Do not implement collaborative realtime comments.
- Do not persist comments inside the generated HTML source.
- Do not require generated HTML to include Reference Design `data-od-*` attributes.

## 4. Concept Mapping

| Reference Design Concept | Vibe Design Concept |
| --- | --- |
| `od:comment-mode` | `vd-comment-mode` |
| `od:comment-targets` | `vd-comment-targets` |
| `od:comment-hover` | `vd-comment-hover` |
| `od:comment-target` | `vd-comment-select` |
| `od:comment-active-target` | `vd-comment-active-target` |
| `od:comment-active-target-update` | `vd-comment-active-target-update` |
| `od:pod-stroke` | `vd-comment-pod-stroke` |
| `od:pod-select` | `vd-comment-pod-select` |
| `PreviewCommentSnapshot` | `CanvasCommentTargetSnapshot` |
| `PreviewCommentTarget` | `CanvasCommentTarget` |
| `PreviewComment` | `CanvasPreviewComment` |
| `ChatCommentAttachment` | `CanvasCommentAttachment` |
| `CommentTargetOverlay` | `CanvasCommentOverlay` |
| `BoardComposerPopover` | `CanvasCommentPopover` |
| `CommentSideDock` | `CanvasCommentPanel` |
| `PreviewDrawOverlay` | `CanvasVisualCommentOverlay` |
| `preview_comments` | `preview_comments` in Vibe Design SQLite |
| `data-od-id` / `data-screen-label` | `data-vd-id` / `data-vd-source-path` / `data-vd-runtime-id` |

## 5. Protocols

Existing protocols that must stay stable:

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

New iframe-to-host messages:

```ts
type CanvasCommentBridgeMessage =
  | { type: 'vd-comment-targets'; targets: CanvasCommentTargetSnapshot[] }
  | { type: 'vd-comment-hover'; target: CanvasCommentTargetSnapshot }
  | { type: 'vd-comment-leave' }
  | { type: 'vd-comment-select'; target: CanvasCommentTargetSnapshot }
  | { type: 'vd-comment-active-target-update'; target: CanvasCommentTargetSnapshot }
  | { type: 'vd-comment-pod-clear' }
  | { type: 'vd-comment-pod-stroke'; points: CanvasCommentPoint[] }
  | { type: 'vd-comment-pod-select'; points: CanvasCommentPoint[] };
```

New host-to-iframe messages:

```ts
type CanvasCommentHostCommand =
  | { type: 'vd-comment-mode'; enabled: boolean; mode: 'picker' | 'pod' }
  | { type: 'vd-comment-active-target'; targetId: string | null; selector?: string };
```

These messages are additive. They do not replace edit or inspect messages.

## 6. Target Data Models

Add web/server shared shape in `web/src/types.ts` and mirrored server types where needed:

```ts
type CanvasCommentSelectionKind = 'element' | 'pod' | 'visual';
type CanvasCommentStatus = 'open' | 'attached' | 'applying' | 'needs_review' | 'resolved' | 'failed';
type CanvasVisualMarkKind = 'click' | 'stroke' | 'click+stroke';

interface CanvasCommentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasCommentStyleSnapshot {
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

interface CanvasCommentMember {
  targetId: string;
  selector: string;
  label: string;
  text: string;
  position: CanvasCommentPosition;
  htmlHint: string;
  style?: CanvasCommentStyleSnapshot;
}

interface CanvasCommentTarget {
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

interface CanvasPreviewComment extends CanvasCommentTarget {
  id: string;
  projectId: string;
  conversationId: string;
  note: string;
  status: CanvasCommentStatus;
  createdAt: number;
  updatedAt: number;
}

interface CanvasCommentAttachment {
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

## 7. End-To-End Flow

### 7.1 Element Comment

1. User opens an HTML file in `CanvasWorkspace`.
2. User switches the file surface mode to `Comment`.
3. `CanvasPreview` builds srcdoc with `commentBridge: true`.
4. Host posts `{ type: 'vd-comment-mode', enabled: true, mode: 'picker' }`.
5. The iframe bridge scans eligible DOM nodes and emits `vd-comment-targets`.
6. Hover emits `vd-comment-hover`.
7. Click emits `vd-comment-select` with target id, selector, text, rect, html hint, and computed style.
8. Host renders `CanvasCommentOverlay` and `CanvasCommentPopover`.
9. User can save the note or send it to chat.

### 7.2 Saved Comment

1. `CanvasCommentPopover` calls `onSaveComment`.
2. `CanvasWorkspace` calls the comment service.
3. The service posts to `/api/projects/:id/conversations/:conversationId/comments`.
4. Server upserts the comment in SQLite.
5. The comment list refreshes and saved pins render over the preview.

### 7.3 Send To Chat

1. Draft or saved comments are converted to `CanvasCommentAttachment`.
2. `ChatSessionService.sendTurn` appends a user message with `commentAttachments`.
3. `RunApi.createRun` sends `commentAttachments` to `/api/runs`.
4. Server persists `commentAttachments` with the user message.
5. `agent-launcher.ts` formats an `# Attached preview comments` section into the agent prompt.
6. Persisted saved comments included in the send are patched from `open` to `attached`, then to `applying` while the run is active.

### 7.4 Pod Selection

1. User switches comment tool to pod.
2. Host posts `{ type: 'vd-comment-mode', enabled: true, mode: 'pod' }`.
3. Iframe bridge captures pointer stroke points and emits `vd-comment-pod-stroke`.
4. On pointer up it emits `vd-comment-pod-select`.
5. Host intersects the stroke with live targets, prunes broad containers, and builds a synthetic pod target.
6. Popover supports multiple queued notes and member removal before sending or saving.

### 7.5 Free Pin

1. If picker mode click does not resolve a meaningful target, the bridge can create a synthetic `pin-*` target.
2. Native interactive elements such as links, buttons, inputs, labels, and editable nodes are skipped so normal preview behavior is not broken.
3. The synthetic selector is `[data-vd-pin="<pin-id>"]`; the host uses stored coordinates for saved marker rehydration.

### 7.6 Visual Mark

1. User enables visual mark mode from Comment controls.
2. `CanvasVisualCommentOverlay` sits over the preview and supports box and pen tools.
3. The overlay requests a preview screenshot through a snapshot bridge injected into srcdoc.
4. The marked screenshot is uploaded through the existing project file or public asset upload API; do not add a separate screenshot storage channel.
5. A `CanvasCommentAttachment` with `selectionKind: 'visual'`, screenshot path, mark kind, bounds, and note is sent to chat.

## 8. Architecture

### 8.1 Runtime Bridge

Create a dedicated module:

```text
web/src/features/canvas-workspace/canvas-comment/bridge.ts
```

Responsibilities:

- define comment bridge string builder
- reuse `data-vd-id`, `data-vd-source-path`, and `data-vd-runtime-id`
- discover meaningful targets
- capture element style snapshots
- post comment messages to host
- support picker, pod, active-target refresh, and free pin

The existing edit bridge remains responsible for inspect/edit behavior only. Shared identity helper constants can stay in `canvas-edit/bridge.ts` or move to a small shared module if duplication becomes material.

### 8.2 Srcdoc Builder

Extend:

```ts
interface BuildPreviewSrcdocOptions {
  editBridge: boolean;
  commentBridge?: boolean;
  snapshotBridge?: boolean;
  sizeBridge?: boolean;
}
```

`buildDesignRuntimeSrcdoc` passes these options through after sibling script inlining.

Comment bridge injection must happen before snapshot bridge injection and after source-path annotation so the bridge can identify generated nodes.

### 8.3 CanvasPreview

Extend props:

```ts
commentMode?: boolean;
commentTool?: 'picker' | 'pod';
activeCommentTargetId?: string | null;
onCommentTargetsChange?: (targets: CanvasCommentTargetSnapshot[]) => void;
onCommentHoverChange?: (target: CanvasCommentTargetSnapshot | null) => void;
onCommentSelect?: (target: CanvasCommentTargetSnapshot) => void;
onCommentPodStroke?: (points: CanvasCommentPoint[]) => void;
onCommentPodSelect?: (points: CanvasCommentPoint[]) => void;
```

`CanvasPreview` should:

- inject comment bridge only for HTML srcdoc previews
- post `vd-comment-mode` to the active srcdoc iframe
- validate `event.source` before accepting messages
- keep URL preview behavior unchanged
- keep inspect edit messages gated behind `editMode`
- expose preview scale/size or render a local overlay host so comment overlays align with iframe coordinates

Initial support should target srcdoc-backed previews. If active URL preview is shown, comment mode should either force srcdoc preview or show a clear disabled state. For consistency with inspect mode, comment mode should use srcdoc.

### 8.4 CanvasWorkspace

Extend file surface mode:

```ts
type FileSurfaceMode = 'preview' | 'inspect' | 'comment';
```

Workspace-owned state:

- active comment mode target
- hovered comment target
- live comment targets
- saved comments for active conversation
- selected saved comment ids
- comment draft
- queued pod notes
- comment panel open/collapsed state
- comment tool: picker, pod, visual
- visual overlay state

Mode rules:

- `Preview`: no comment or edit bridge active.
- `Inspect`: edit bridge active, comment bridge inactive.
- `Comment`: comment bridge active, edit bridge inactive.

Dirty inspect guard should also guard transitions from `Inspect` to `Comment`.

### 8.5 Comment Service

Add a web service boundary:

```text
web/src/services/preview-comments/
  preview-comment-service.interface.ts
  preview-comment-types.ts
  preview-comment-api.ts
  internal/preview-comment-service.ts
```

Responsibilities:

- load comments for project + active conversation
- upsert comments
- delete comments
- patch status
- prepare visual comment screenshots by reusing existing file/asset upload APIs
- expose readonly store snapshot
- hide API transport from UI

`ProjectEditorPage` coordinates active project/conversation and passes comment service state into `CanvasWorkspace` or lets the workspace consume the service through DI.

### 8.6 Server Routes

Add:

```text
server/src/routes/comment-routes.ts
```

Routes:

```text
GET    /api/projects/:id/conversations/:conversationId/comments
POST   /api/projects/:id/conversations/:conversationId/comments
PATCH  /api/projects/:id/conversations/:conversationId/comments/:commentId
DELETE /api/projects/:id/conversations/:conversationId/comments/:commentId
```

The routes should follow existing `project-routes.ts` and `conversation-routes.ts` validation style:

- validate safe project id
- validate safe conversation id
- return 404 if project/conversation does not exist
- return 400 for invalid target/note/status
- update project/conversation timestamps when comments mutate

### 8.7 SQLite

Add table:

```sql
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
```

Upsert behavior:

- same `project_id + conversation_id + file_path + target_id` updates the existing row
- updated notes reset status to `open`
- text, style, rect, and html hint refresh on every upsert
- pod fields are populated only for pod comments
- visual fields are populated only for visual comments

### 8.8 Chat Timeline And Run Protocol

Extend:

- `ChatMessage`
- `ChatTimelineMessage`
- `AppendUserMessageInput`
- `SendTurnInput`
- `PreparedTurn`
- `CreateRunInput`
- persisted message rows
- server `/api/runs` body handling

`messages` table should get `comment_attachments_json TEXT` through migration. This avoids encoding comment attachments inside `attachments_json`, which currently represents uploaded files.

### 8.9 Agent Prompt Section

Add to `server/src/agent-launcher.ts`:

```text
# Attached preview comments

Scope: apply the user request to these preview targets by default. For visual marks, inspect the screenshot and modify the marked region first. Preserve unrelated areas.

1. <targetId>
targetKind=<element|pod|visual>
file=<filePath>
selector=<selector>
label=<label>
position=x<value> y<value> <width>x<height>
currentText=<trimmed current text>
htmlHint=<trimmed html hint>
computedStyle=<compact style list>
comment=<user note>
```

For pod comments, append:

```text
memberCount=<n>
members:
- <targetId> | <selector> | <label> | <text>
```

For visual comments, append:

```text
screenshot=<asset path>
markKind=<click|stroke|click+stroke>
intent=<derived intent>
```

Formatting should be deterministic and bounded. Text and HTML hint should be compacted and truncated to protect prompt size.

## 9. UI Design

Use `@tutti-os/ui-system` public imports only.

Canvas workspace top mode switch:

- `Preview`
- `Inspect`
- `Comment`

Comment toolbar inside the file surface:

- picker icon button
- pod icon button
- visual mark icon button
- comment panel toggle

Comment popover:

- target label and file badge
- size/style summary
- pod member chips with remove controls
- note textarea
- `Comment` button for saving persistent comments
- `Add note` for pod queued notes
- `Send to chat` button
- delete button when editing an existing saved comment

Comment panel:

- saved comment list for active file
- status badge
- selected checkbox/toggle
- reply/edit action
- delete action
- send selected action
- select all / clear selection

Visual overlay:

- box and pen segmented control
- undo/redo
- clear
- note input
- queue/send buttons

Avoid cards inside cards. The workspace canvas remains the primary surface; comment controls should be compact and tool-like.

## 10. Status Lifecycle

Statuses:

- `open`: saved and not currently attached to a run
- `attached`: selected or included in a pending user message
- `applying`: run is active and comments are being applied
- `needs_review`: run completed but comments should be reviewed
- `resolved`: user marks done or agent run result is accepted
- `failed`: run failed or send failed

Initial implementation rules:

- save/upsert sets `open`
- selecting saved comments for chat sets optimistic `attached`
- run start sets persisted comment attachments to `applying`
- successful run end sets `needs_review`
- failed/canceled run end sets `failed`
- user can manually mark `resolved` from the panel

## 11. Error Handling

Bridge:

- ignore messages not from the active iframe
- ignore malformed target payloads
- bound target count to avoid large DOM message floods
- debounce `vd-comment-targets` after resize/scroll/mutation

UI:

- disable comment mode for non-HTML files
- explain if URL preview cannot be commented and switch to srcdoc when possible
- keep draft text if save fails
- show a compact error state in popover or panel

Server:

- reject empty note
- reject unsafe status
- reject missing target id, selector, file path, or position
- normalize and truncate text/html hint
- cap pod member count
- cap visual screenshot path length

Agent prompt:

- sanitize newlines in compact fields
- do not trust iframe-provided CSS text
- include structured style fields only

## 12. Testing Plan

Web unit tests:

- `build-preview-srcdoc.test.ts`: comment bridge injection and no duplicate bridge scripts.
- `build-design-runtime-srcdoc.test.ts`: comment bridge composes after sibling script inlining.
- `canvas-comment/bridge.test.ts`: target identity, free pin, pod stroke messages, bounded payload.
- `CanvasPreview.test.tsx`: comment mode posts command, accepts only active iframe messages, keeps inspect messages gated.
- `CanvasWorkspace.test.tsx`: Comment mode UI, popover save/send, saved marker rendering, side panel selection.
- `CanvasVisualCommentOverlay.test.tsx`: box/pen state, undo/redo, send disabled states.
- `chat-session-service.test.ts`: comment attachments pass into user messages and run creation.
- `chat-timeline-service.test.ts`: persisted and restored comment attachments.

Server tests:

- `sqlite-store` comment CRUD and migration tests.
- `comment-routes` validation and happy path tests.
- `agent-launcher.test.ts`: `# Attached preview comments` formatting for element, pod, and visual attachments.
- `/api/runs` persistence test for `commentAttachments`.

Regression checks:

```bash
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/server test
```

## 13. Implementation Order

1. Add shared comment types and pure attachment formatting helpers.
2. Add SQLite migration, comment store methods, and comment routes.
3. Add web preview-comment service and API client.
4. Add comment bridge injection and bridge tests.
5. Extend `CanvasPreview` to support comment messages and commands.
6. Add `Comment` mode in `CanvasWorkspace`.
7. Add overlay, popover, saved markers, and side panel.
8. Extend chat timeline, chat session, run API, server message persistence, and agent prompt formatting.
9. Add pod selection.
10. Add free-pin fallback.
11. Add visual screenshot annotation.
12. Add status lifecycle updates tied to run start/end.

This order still delivers the full capability, but each checkpoint has an independently testable behavior.

## 14. Open Decisions Resolved

- Full feature set is in scope.
- Implementation should be native to `vibe-design`, not a direct file move from Reference Design.
- Comment protocol uses `vd-comment-*`.
- Comment mode is separate from Inspect mode.
- Comments are stored in SQLite, not in generated HTML.
- `commentAttachments` are separate from uploaded file attachments.
- Initial comment mode should use srcdoc preview for reliable bridge support.
