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
