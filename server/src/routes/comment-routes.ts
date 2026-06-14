import type { Express, Request, Response } from 'express';
import { isSafeConversationId } from '../conversations.js';
import type { RouteDeps } from '../server-context.js';
import {
  deletePreviewCommentFromStore,
  isPreviewCommentStatus,
  listPreviewCommentsFromStore,
  previewCommentConversationExistsInStore,
  upsertPreviewCommentInStore,
  updatePreviewCommentStatusInStore,
  type UpsertPreviewCommentInput,
} from '../sqlite-store.js';
import { isSafeProjectId } from './project-routes.js';

type CommentRouteDeps = RouteDeps<'http' | 'paths'>;
type ConversationParams = { id: string; conversationId: string };
type CommentParams = ConversationParams & { commentId: string };

export function registerCommentRoutes(app: Express, ctx: CommentRouteDeps): void {
  const { sendApiError } = ctx.http;

  app.get(
    '/api/projects/:id/conversations/:conversationId/comments',
    async (req: Request<ConversationParams>, res: Response): Promise<void> => {
      const { id: projectId, conversationId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeConversationId(conversationId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      try {
        const comments = listPreviewCommentsFromStore(ctx.paths.projectsDir, projectId, conversationId);
        if (!comments) {
          sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found');
          return;
        }

        res.json({ comments });
      } catch (error) {
        sendInternalError(ctx, res, error, 'preview comment list failed');
      }
    },
  );

  app.post(
    '/api/projects/:id/conversations/:conversationId/comments',
    async (req: Request<ConversationParams, unknown, unknown>, res: Response): Promise<void> => {
      const { id: projectId, conversationId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeConversationId(conversationId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      const input = readCommentInput(req.body);
      if (!input) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment body is invalid');
        return;
      }

      try {
        res.json({ comment: upsertPreviewCommentInStore(ctx.paths.projectsDir, projectId, conversationId, input) });
      } catch (error) {
        sendWriteError(ctx, res, error, 'preview comment write failed');
      }
    },
  );

  app.patch(
    '/api/projects/:id/conversations/:conversationId/comments/:commentId',
    async (req: Request<CommentParams, unknown, unknown>, res: Response): Promise<void> => {
      const { id: projectId, conversationId, commentId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeConversationId(conversationId) || !isSafeCommentId(commentId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      const status = readStatus(req.body);
      if (!status) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment status is invalid');
        return;
      }

      try {
        if (!previewCommentConversationExistsInStore(ctx.paths.projectsDir, projectId, conversationId)) {
          sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found');
          return;
        }

        const comment = updatePreviewCommentStatusInStore(ctx.paths.projectsDir, projectId, conversationId, commentId, status);
        if (!comment) {
          sendApiError(res, 404, 'COMMENT_NOT_FOUND', 'preview comment not found');
          return;
        }

        res.json({ comment });
      } catch (error) {
        sendWriteError(ctx, res, error, 'preview comment status update failed');
      }
    },
  );

  app.delete(
    '/api/projects/:id/conversations/:conversationId/comments/:commentId',
    async (req: Request<CommentParams>, res: Response): Promise<void> => {
      const { id: projectId, conversationId, commentId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeConversationId(conversationId) || !isSafeCommentId(commentId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      try {
        if (!previewCommentConversationExistsInStore(ctx.paths.projectsDir, projectId, conversationId)) {
          sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found');
          return;
        }

        if (!deletePreviewCommentFromStore(ctx.paths.projectsDir, projectId, conversationId, commentId)) {
          sendApiError(res, 404, 'COMMENT_NOT_FOUND', 'preview comment not found');
          return;
        }

        res.json({ ok: true });
      } catch (error) {
        sendInternalError(ctx, res, error, 'preview comment delete failed');
      }
    },
  );
}

function readCommentInput(value: unknown): UpsertPreviewCommentInput | null {
  if (!isRecord(value) || !isRecord(value.target)) {
    return null;
  }

  return { note: value.note, target: value.target };
}

function readStatus(value: unknown): string | null {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return null;
  }

  const status = value.status.trim();
  return isPreviewCommentStatus(status) ? status : null;
}

function isSafeCommentId(id: string): boolean {
  return id.length >= 1 && id.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(id) && !/^\.+$/.test(id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sendWriteError(ctx: CommentRouteDeps, res: Response, error: unknown, fallbackMessage: string): void {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (message === 'conversation not found') {
    ctx.http.sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', message);
    return;
  }

  if (message.startsWith('comment ') || message === 'preview comment status is invalid') {
    ctx.http.sendApiError(res, 400, 'BAD_REQUEST', message);
    return;
  }

  sendInternalError(ctx, res, error, fallbackMessage);
}

function sendInternalError(ctx: CommentRouteDeps, res: Response, error: unknown, fallbackMessage: string): void {
  ctx.http.sendApiError(res, 500, 'INTERNAL', error instanceof Error ? error.message : fallbackMessage);
}
