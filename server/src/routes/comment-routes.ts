import type { Express, Request, Response } from 'express';
import type { RouteDeps } from '../server-context.js';
import {
  deletePreviewCommentFromStore,
  isPreviewCommentStatus,
  listPreviewCommentsFromStore,
  upsertPreviewCommentInStore,
  updatePreviewCommentStatusInStore,
  type UpsertPreviewCommentInput,
} from '../sqlite-store.js';
import { isSafeProjectId } from './project-routes.js';

type CommentRouteDeps = RouteDeps<'http' | 'paths'>;
type ProjectParams = { id: string };
type CommentParams = ProjectParams & { commentId: string };

export function registerCommentRoutes(app: Express, ctx: CommentRouteDeps): void {
  const { sendApiError } = ctx.http;

  app.get(
    '/api/projects/:id/comments',
    async (req: Request<ProjectParams>, res: Response): Promise<void> => {
      const { id: projectId } = req.params;
      if (!isSafeProjectId(projectId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      try {
        const comments = listPreviewCommentsFromStore(ctx.paths.projectsDir, projectId);
        if (!comments) {
          sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
          return;
        }

        res.json({ comments });
      } catch (error) {
        sendInternalError(ctx, res, error, 'preview comment list failed');
      }
    },
  );

  app.post(
    '/api/projects/:id/comments',
    async (req: Request<ProjectParams, unknown, unknown>, res: Response): Promise<void> => {
      const { id: projectId } = req.params;
      if (!isSafeProjectId(projectId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      const input = readCommentInput(req.body);
      if (!input) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment body is invalid');
        return;
      }

      try {
        res.json({ comment: upsertPreviewCommentInStore(ctx.paths.projectsDir, projectId, input) });
      } catch (error) {
        sendWriteError(ctx, res, error, 'preview comment write failed');
      }
    },
  );

  app.patch(
    '/api/projects/:id/comments/:commentId',
    async (req: Request<CommentParams, unknown, unknown>, res: Response): Promise<void> => {
      const { id: projectId, commentId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeCommentId(commentId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      const status = readStatus(req.body);
      if (!status) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment status is invalid');
        return;
      }

      try {
        const comment = updatePreviewCommentStatusInStore(ctx.paths.projectsDir, projectId, commentId, status);
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
    '/api/projects/:id/comments/:commentId',
    async (req: Request<CommentParams>, res: Response): Promise<void> => {
      const { id: projectId, commentId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeCommentId(commentId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'comment path is invalid');
        return;
      }

      try {
        if (!deletePreviewCommentFromStore(ctx.paths.projectsDir, projectId, commentId)) {
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
  if (message === 'project not found') {
    ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', message);
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
