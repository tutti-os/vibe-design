export type CanvasCommentSelectionKind = 'element' | 'pod' | 'visual';
export type CanvasCommentTargetSelectionKind = Extract<CanvasCommentSelectionKind, 'element' | 'pod'>;
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

interface CanvasCommentTargetSnapshotBase {
  filePath: string;
  targetId: string;
  selector: string;
  label: string;
  text: string;
  position: CanvasCommentPosition;
  htmlHint: string;
  style?: CanvasCommentStyleSnapshot;
  hoverPoint?: CanvasCommentPoint;
  screenshotPath?: string;
}

export interface CanvasElementCommentTargetSnapshot extends CanvasCommentTargetSnapshotBase {
  selectionKind?: 'element';
  memberCount?: never;
  podMembers?: never;
}

export interface CanvasPodCommentTargetSnapshot extends CanvasCommentTargetSnapshotBase {
  selectionKind: 'pod';
  memberCount?: number;
  podMembers?: CanvasCommentMember[];
}

export type CanvasCommentTargetSnapshot = CanvasElementCommentTargetSnapshot | CanvasPodCommentTargetSnapshot;

interface CanvasCommentTargetBase extends CanvasCommentTargetSnapshotBase {
  hoverPoint?: CanvasCommentPoint;
}

export interface CanvasElementCommentTarget extends CanvasCommentTargetBase {
  selectionKind: 'element';
  memberCount?: never;
  podMembers?: never;
  markKind?: never;
}

export interface CanvasPodCommentTarget extends CanvasCommentTargetBase {
  selectionKind: 'pod';
  memberCount?: number;
  podMembers?: CanvasCommentMember[];
  markKind?: never;
}

export interface CanvasVisualCommentTarget extends CanvasCommentTargetBase {
  selectionKind: 'visual';
  memberCount?: never;
  podMembers?: never;
  screenshotPath?: string;
  markKind: CanvasVisualMarkKind | (string & {});
  intent?: string;
}

export type CanvasCommentTarget = CanvasElementCommentTarget | CanvasPodCommentTarget;
export type CanvasPreviewCommentTarget = CanvasCommentTarget | CanvasVisualCommentTarget;

export type CanvasPreviewComment = CanvasPreviewCommentTarget & {
  id: string;
  projectId: string;
  conversationId: string;
  note: string;
  status: CanvasCommentStatus;
  createdAt: number;
  updatedAt: number;
};

interface CanvasCommentAttachmentBase {
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
}

interface CanvasElementAttachmentFields {
  selectionKind: 'element';
  memberCount?: never;
  podMembers?: never;
  screenshotPath?: never;
  markKind?: never;
  intent?: never;
}

interface CanvasPodAttachmentFields {
  selectionKind: 'pod';
  memberCount?: number;
  podMembers?: CanvasCommentMember[];
  screenshotPath?: never;
  markKind?: never;
  intent?: never;
}

type CanvasSavedCommentAttachmentBase = CanvasCommentAttachmentBase & {
  source: 'saved-comment';
};

interface CanvasSavedVisualAttachmentFields {
  selectionKind: 'visual';
  memberCount?: never;
  podMembers?: never;
  screenshotPath?: string;
  markKind: CanvasVisualMarkKind | (string & {});
  intent?: string;
}

export type CanvasSavedCommentAttachment = CanvasSavedCommentAttachmentBase &
  (CanvasElementAttachmentFields | CanvasPodAttachmentFields | CanvasSavedVisualAttachmentFields);

type CanvasBoardBatchCommentAttachmentBase = CanvasCommentAttachmentBase & {
  source: 'board-batch';
  screenshotPath?: never;
  markKind?: never;
  intent?: never;
};

export type CanvasBoardBatchCommentAttachment = CanvasBoardBatchCommentAttachmentBase &
  (CanvasElementAttachmentFields | CanvasPodAttachmentFields);

export interface CanvasVisualMarkCommentAttachment extends CanvasCommentAttachmentBase {
  source: 'visual-mark';
  selectionKind: 'visual';
  memberCount?: never;
  podMembers?: never;
  screenshotPath?: string;
  markKind: CanvasVisualMarkKind | (string & {});
  intent?: string;
}

export type CanvasCommentAttachment =
  | CanvasSavedCommentAttachment
  | CanvasBoardBatchCommentAttachment
  | CanvasVisualMarkCommentAttachment;
