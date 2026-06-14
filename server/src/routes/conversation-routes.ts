import type { Express, Request, Response } from 'express';
import {
  createConversation,
  deleteConversation,
  isSafeConversationId,
  listConversationMessages,
  listConversations,
  renameConversation,
  type StoredConversation,
} from '../conversations.js';
import type { RouteDeps } from '../server-context.js';
import { isSafeProjectId } from './project-routes.js';

type ConversationRouteDeps = RouteDeps<'http' | 'paths'>;
type ProjectParams = { id: string };
type ConversationParams = { id: string; conversationId: string };

export function registerConversationRoutes(app: Express, ctx: ConversationRouteDeps): void {
  const { sendApiError } = ctx.http;

  app.get('/api/projects/:id/conversations', async (req: Request<ProjectParams>, res: Response): Promise<void> => {
    const projectId = req.params.id;
    if (!isSafeProjectId(projectId)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
      return;
    }

    try {
      const conversations = await listConversations(ctx.paths.projectsDir, projectId);
      res.json({ conversations: conversations.map(conversationForClient) });
    } catch (error) {
      sendInternalError(ctx, res, error, 'conversation list failed');
    }
  });

  app.post(
    '/api/projects/:id/conversations',
    async (req: Request<ProjectParams, unknown, unknown>, res: Response): Promise<void> => {
      const projectId = req.params.id;
      if (!isSafeProjectId(projectId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
        return;
      }

      const title = readTitle(req.body);
      const requestedId = readConversationId(req.body);
      if (requestedId !== null && !isSafeConversationId(requestedId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'conversation id is invalid');
        return;
      }

      try {
        const conversation = await createConversation(ctx.paths.projectsDir, projectId, title, requestedId ?? undefined);
        res.status(201).json({ conversation: conversationForClient(conversation) });
      } catch (error) {
        sendInternalError(ctx, res, error, 'conversation create failed');
      }
    },
  );

  app.put(
    '/api/projects/:id/conversations/:conversationId',
    async (req: Request<ConversationParams, unknown, unknown>, res: Response): Promise<void> => {
      const { id: projectId, conversationId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeConversationId(conversationId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'conversation path is invalid');
        return;
      }

      const title = readTitle(req.body);
      if (!title) {
        sendApiError(res, 400, 'BAD_REQUEST', 'conversation title is required');
        return;
      }

      try {
        const conversation = await renameConversation(ctx.paths.projectsDir, projectId, conversationId, title);
        if (!conversation) {
          sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found');
          return;
        }

        res.json({ conversation: conversationForClient(conversation) });
      } catch (error) {
        sendInternalError(ctx, res, error, 'conversation rename failed');
      }
    },
  );

  app.delete(
    '/api/projects/:id/conversations/:conversationId',
    async (req: Request<ConversationParams>, res: Response): Promise<void> => {
      const { id: projectId, conversationId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeConversationId(conversationId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'conversation path is invalid');
        return;
      }

      try {
        const deleteResult = await deleteConversation(ctx.paths.projectsDir, projectId, conversationId);
        if (deleteResult === 'not_found') {
          sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found');
          return;
        }
        if (deleteResult === 'last_conversation') {
          sendApiError(res, 409, 'LAST_CONVERSATION', 'at least one conversation is required');
          return;
        }

        res.json({ ok: true });
      } catch (error) {
        sendInternalError(ctx, res, error, 'conversation delete failed');
      }
    },
  );

  app.get(
    '/api/projects/:id/conversations/:conversationId/messages',
    async (req: Request<ConversationParams>, res: Response): Promise<void> => {
      const { id: projectId, conversationId } = req.params;
      if (!isSafeProjectId(projectId) || !isSafeConversationId(conversationId)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'conversation path is invalid');
        return;
      }

      try {
        const messages = await listConversationMessages(ctx.paths.projectsDir, projectId, conversationId);
        if (!messages) {
          sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found');
          return;
        }

        res.json({ messages });
      } catch (error) {
        sendInternalError(ctx, res, error, 'conversation messages read failed');
      }
    },
  );
}

function readTitle(value: unknown): string | null {
  if (!isRecord(value) || typeof value.title !== 'string') {
    return null;
  }

  const trimmed = value.title.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function readConversationId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }

  const trimmed = value.id.trim();
  return trimmed || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function conversationForClient(conversation: StoredConversation): StoredConversation {
  return {
    ...conversation,
    title: conversation.title ?? 'New conversation',
  };
}

function sendInternalError(ctx: ConversationRouteDeps, res: Response, error: unknown, fallbackMessage: string): void {
  ctx.http.sendApiError(res, 500, 'INTERNAL', error instanceof Error ? error.message : fallbackMessage);
}
