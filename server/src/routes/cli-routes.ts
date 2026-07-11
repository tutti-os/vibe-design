import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { isProjectId } from '@vibe-design/web';
import { createManagedAgentDetectContextFromHeaders } from '@tutti-os/agent-acp-kit';
import { isSafeConversationId, listConversationMessages, listConversations } from '../conversations.js';
import type { CliServiceResult, RouteDeps } from '../server-context.js';
import {
  getProjectFileFromStore,
  getProjectFromStore,
  listPreviewCommentsFromStore,
  listProjectFilesFromStore,
  listProjectSummariesFromStore,
  type ProjectFileKind,
} from '../sqlite-store.js';
import { isSafeFileName, isSafeProjectId } from './project-routes.js';

type CliRouteDeps = RouteDeps<'http' | 'paths' | 'cli'>;

type CliInput = Record<string, unknown>;

export function registerCliRoutes(app: Express, ctx: CliRouteDeps): void {
  const postCli = (path: string, handler: (req: Request, res: Response) => Promise<void> | void): void => {
    app.post(path, handler);
  };

  postCli('/tutti/cli/projects', async (req: Request, res: Response) => {
    const limit = readInteger(cliInput(req.body).limit, 50);
    sendCliJson(res, {
      projects: listProjectSummariesFromStore(ctx.paths.projectsDir, clamp(limit, 1, 500)),
    });
  });

  postCli('/tutti/cli/open', async (req: Request, res: Response) => {
    const input = cliInput(req.body);
    const projectId = readOptionalRoutableProjectId(res, input);
    if (projectId === null) return;

    if (projectId && !getProjectFromStore(ctx.paths.projectsDir, projectId)) {
      sendCliError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return;
    }

    const route = projectId ? `/project/${encodeURIComponent(projectId)}` : '/';
    const detectContext = createManagedAgentDetectContextFromHeaders(req.headers, {
      appDataDir: ctx.paths.runtimeDir,
    });
    sendCliServiceResult(res, await ctx.cli.openApp({
      detectContext,
      route,
      ...(projectId ? { projectId } : {}),
    }));
  });

  postCli('/tutti/cli/project-create', async (req: Request, res: Response) => {
    sendCliServiceResult(res, await ctx.cli.createProject(cliInput(req.body)));
  });

  postCli('/tutti/cli/project-update', async (req: Request, res: Response) => {
    sendCliServiceResult(res, await ctx.cli.updateProject(cliInput(req.body)));
  });

  postCli('/tutti/cli/session-start', async (req: Request, res: Response) => {
    const detectContext = createManagedAgentDetectContextFromHeaders(req.headers, {
      appDataDir: ctx.paths.runtimeDir,
    });
    sendCliServiceResult(res, await ctx.cli.startSession({
      detectContext,
      input: cliInput(req.body),
      managedAgentHeaders: req.headers,
    }));
  });

  postCli('/tutti/cli/conversations', async (req: Request, res: Response) => {
    const projectId = readRequiredSafeProjectId(res, cliInput(req.body));
    if (!projectId) return;
    sendCliJson(res, { conversations: await listConversations(ctx.paths.projectsDir, projectId) });
  });

  postCli('/tutti/cli/conversation-messages', async (req: Request, res: Response) => {
    const ids = readProjectConversationIds(res, cliInput(req.body));
    if (!ids) return;
    const messages = await listConversationMessages(ctx.paths.projectsDir, ids.projectId, ids.conversationId);
    if (!messages) {
      sendCliError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found');
      return;
    }
    sendCliJson(res, { messages });
  });

  postCli('/tutti/cli/files', async (req: Request, res: Response) => {
    const projectId = readRequiredSafeProjectId(res, cliInput(req.body));
    if (!projectId) return;
    sendCliJson(res, {
      files: listProjectFilesFromStore(ctx.paths.projectsDir, projectId)
        .map((file) => ({
          ...file,
          absolutePath: projectAssetPath(ctx.paths.projectsDir, projectId, file.name),
          url: projectFileStaticUrl(req, projectId, file.name),
        })),
    });
  });

  postCli('/tutti/cli/file-get', async (req: Request, res: Response) => {
    const input = cliInput(req.body);
    const projectId = readRequiredSafeProjectId(res, input);
    if (!projectId) return;
    const name = readRequiredSafeFileName(res, input);
    if (!name) return;
    const file = getProjectFileFromStore(ctx.paths.projectsDir, projectId, name);
    if (!file) {
      sendCliError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      return;
    }
    const absolutePath = projectAssetPath(ctx.paths.projectsDir, projectId, name);
    const content = await readFile(absolutePath);
    const text = shouldReturnUtf8(file.mime, file.kind);
    sendCliJson(res, {
      file: { ...file, absolutePath },
      encoding: text ? 'utf8' : 'base64',
      content: text ? content.toString('utf8') : content.toString('base64'),
    });
  });

  postCli('/tutti/cli/comments', async (req: Request, res: Response) => {
    const projectId = readRequiredSafeProjectId(res, cliInput(req.body));
    if (!projectId) return;
    const comments = listPreviewCommentsFromStore(ctx.paths.projectsDir, projectId);
    if (!comments) {
      sendCliError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return;
    }
    sendCliJson(res, { comments });
  });
}

function cliInput(value: unknown): CliInput {
  return isRecord(value) && isRecord(value.input) ? value.input : {};
}

function sendCliJson(res: Response, value: unknown): void {
  res.status(200).json({ kind: 'json', value });
}

function sendCliError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function sendCliServiceResult(res: Response, result: CliServiceResult): void {
  if (result.ok) {
    sendCliJson(res, result.value);
    return;
  }

  sendCliError(res, result.status, result.code, result.message);
}

function readRequiredSafeProjectId(res: Response, input: CliInput): string | null {
  const projectId = readString(input['project-id'] ?? input.projectId);
  if (!projectId || !isSafeProjectId(projectId)) {
    sendCliError(res, 400, 'BAD_REQUEST', 'project-id is required and must be path-safe');
    return null;
  }
  return projectId;
}

function readOptionalRoutableProjectId(res: Response, input: CliInput): string | null | undefined {
  const rawProjectId = input['project-id'] ?? input.projectId;
  if (rawProjectId === undefined) {
    return undefined;
  }

  const projectId = readString(rawProjectId);
  if (!projectId || !isSafeProjectId(projectId) || !isProjectId(projectId)) {
    sendCliError(res, 400, 'BAD_REQUEST', 'project-id must be routable and path-safe when provided');
    return null;
  }

  return projectId;
}

function readProjectConversationIds(res: Response, input: CliInput): { projectId: string; conversationId: string } | null {
  const projectId = readRequiredSafeProjectId(res, input);
  if (!projectId) return null;
  const conversationId = readString(input['conversation-id'] ?? input.conversationId);
  if (!conversationId || !isSafeConversationId(conversationId)) {
    sendCliError(res, 400, 'BAD_REQUEST', 'conversation-id is required and must be path-safe');
    return null;
  }
  return { projectId, conversationId };
}

function readRequiredSafeFileName(res: Response, input: CliInput): string | null {
  const name = readString(input.name);
  if (!name || !isSafeFileName(name)) {
    sendCliError(res, 400, 'BAD_REQUEST', 'name is required and must be a safe file name');
    return null;
  }
  return name;
}

function projectAssetPath(projectsDir: string, projectId: string, name: string): string {
  return path.resolve(projectsDir, projectId, 'assets', name);
}

function projectFileStaticUrl(req: Request, projectId: string, name: string): string {
  const host = req.get('host') ?? '127.0.0.1';
  return `${req.protocol}://${host}/static/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(name)}`;
}

function shouldReturnUtf8(mime: string, kind: ProjectFileKind): boolean {
  return (
    kind !== 'image' ||
    mime === 'image/svg+xml'
  ) && (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'image/svg+xml' ||
    mime === 'application/javascript' ||
    mime === 'text/javascript'
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
