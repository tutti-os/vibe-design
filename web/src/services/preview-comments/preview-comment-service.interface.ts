import { createDecorator } from '@tutti-os/infra/di';
import type { CanvasCommentStatus, CanvasPreviewComment } from '../../features/canvas-workspace/canvas-comment/canvas-comment-types';
import type { PreviewCommentSnapshot, PreviewCommentUpsertInput } from './preview-comment-types';

export interface IPreviewCommentService {
  readonly _serviceBrand: undefined;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PreviewCommentSnapshot;
  load(): Promise<void>;
  upsert(input: PreviewCommentUpsertInput): Promise<CanvasPreviewComment>;
  patchStatus(commentId: string, status: CanvasCommentStatus): Promise<CanvasPreviewComment>;
  delete(commentId: string): Promise<void>;
}

export const IPreviewCommentService = createDecorator<IPreviewCommentService>('preview-comment-service');
