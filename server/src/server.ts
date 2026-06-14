import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { isProjectId, type ProjectEditorInitialData, type VibeDesignRoute } from '@vibe-design/web';
import { renderPage } from '@vibe-design/web/render-page';
import { DEFAULT_AGENT_ID } from './agents.js';
import {
  detectLocalAgentAvailability,
  findUnavailableAgent,
  unavailableAgentsForDetectionFailure,
  type AgentAvailability,
  type DetectAgentAvailability,
} from './agent-availability.js';
import { createSseErrorPayload, createSseResponse } from './http/sse.js';
import { startAgentRun, type StartAgentRunInput } from './agent-launcher.js';
import { materializeProjectArtifactsFromEvents } from './artifact-materializer.js';
import { installClaudeCode as installLocalClaudeCode } from './local-claude-installer.js';
import { reconcileProjectFilesFromDisk } from './project-file-reconciler.js';
import {
  bindConversationProvider,
  createAssistantMessageId,
  createUserMessageId,
  ensureDefaultConversation,
  isSafeConversationId,
  listConversationMessages,
  listConversations,
  persistRunEventToConversation,
  upsertConversationMessage,
} from './conversations.js';
import { registerChatRoutes } from './routes/chat-routes.js';
import { registerCliRoutes } from './routes/cli-routes.js';
import { registerCommentRoutes } from './routes/comment-routes.js';
import { registerConversationRoutes } from './routes/conversation-routes.js';
import { registerDesignSystemRoutes } from './routes/design-system-routes.js';
import { ensureProject, isSafeProjectId, listProjectSummaries, registerProjectRoutes } from './routes/project-routes.js';
import { registerSkillsRoutes } from './routes/skills-routes.js';
import { createChatRunService } from './runs.js';
import {
  listProjectFilesFromStore,
  type ProjectFileKind,
  type StoredConversationMessage,
  type StoredProject,
} from './sqlite-store.js';
import type { ServerContext, SubmitToolResultResult } from './server-context.js';
import type { ChatRun, ChatRunCreateMeta } from './types/run.js';

export interface CreateServerOptions {
  runtimeDir?: string;
  userSkillsRoot?: string;
  builtInSkillsRoot?: string;
  userDesignSystemsRoot?: string;
  builtInDesignSystemsRoot?: string;
  startAgentRun?: (input: StartAgentRunInput) => Promise<void> | void;
  detectAgentAvailability?: DetectAgentAvailability;
  installClaudeCode?: () => Promise<void>;
}

type PersistentRunBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SERVER_DIR, '..', '..');
const APP_ICON_PATH = resolve(REPO_ROOT, 'icon.png');
const WEB_STYLES_PATH = resolve(SERVER_DIR, '../../web/dist/styles.css');
const WEB_CLIENT_PATH = resolve(SERVER_DIR, '../../web/dist/client.js');
const UI_SYSTEM_STYLES_PATH = resolve(SERVER_DIR, '../../web/dist/ui-system-styles.css');
const WEB_AGENT_ICONS_DIRS = [
  resolve(SERVER_DIR, '../../web/dist/assets/agent-icons'),
  resolve(REPO_ROOT, 'web/src/assets/agent-icons'),
];
const WEB_BRAND_ASSET_DIRS = [
  resolve(SERVER_DIR, '../../web/dist/assets/brand'),
  resolve(REPO_ROOT, 'web/src/assets/brand'),
];
const CHAT_UI_CSS_PATHS = [
  resolve(SERVER_DIR, '../../web/dist/assets/chat-ui.css'),
  resolve(REPO_ROOT, 'web/src/components/chat-ui.css'),
];

export function createServer(options: CreateServerOptions = {}): http.Server {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (isJsonBodyParseError(err)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'invalid JSON body');
      return;
    }

    next(err);
  });

  const runtimeDir =
    options.runtimeDir ??
    process.env.TUTTI_APP_DATA_DIR ??
    join(process.cwd(), '.vibe');
  const userDataDir = process.env.TUTTI_APP_DATA_DIR ?? runtimeDir;
  const projectsDir = join(runtimeDir, 'projects');
  const runsLogDir = join(runtimeDir, 'runs');
  const detectAgentAvailability = options.detectAgentAvailability ?? detectLocalAgentAvailability;
  const installClaudeCode = options.installClaudeCode ?? installLocalClaudeCode;
  const runs = createChatRunService({
    createSseResponse,
    createSseErrorPayload,
    runsLogDir: null,
    onEvent: (run, record) => persistRunEventToConversation(projectsDir, run, record),
  });

  function sendApiError(
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    res.status(status).json({
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    });
  }

  function submitToolResultToRun(
    runId: string,
    toolUseId: string,
    content: string,
    isError = false,
  ): SubmitToolResultResult {
    const run = runs.get(runId);
    if (!run) {
      return { ok: false, reason: 'not_found' };
    }

    if (runs.isTerminal(run.status)) {
      return { ok: false, reason: 'run_terminal' };
    }

    const normalizedToolUseId = toolUseId.trim();
    if (normalizedToolUseId.length === 0 || !run.pendingHostAnswers.has(normalizedToolUseId)) {
      return { ok: false, reason: 'bad_tool_use_id' };
    }

    const stdin = run.child?.stdin ?? null;
    if (run.child && (!stdin || stdin.destroyed || stdin.writableEnded)) {
      return { ok: false, reason: 'stdin_closed' };
    }

    if (!run.stdinOpen) {
      return { ok: false, reason: 'stdin_text_mode' };
    }

    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      return { ok: false, reason: 'stdin_closed' };
    }

    try {
      const message = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: normalizedToolUseId,
              content,
              is_error: isError,
            },
          ],
        },
      };
      stdin.write(`${JSON.stringify(message)}\n`);
      run.pendingHostAnswers.delete(normalizedToolUseId);
      if (run.pendingHostAnswers.size === 0 && run.stdinOpen && !stdin.destroyed && !stdin.writableEnded) {
        stdin.end();
        run.stdinOpen = false;
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: 'write_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const ctx: ServerContext = {
    design: {
      runs,
    },
    http: {
      createSseResponse,
      createSseErrorPayload,
      sendApiError,
    },
    paths: {
      runtimeDir,
      projectsDir,
      runsLogDir,
      userSkillsRoot: options.userSkillsRoot ?? process.env.VIBE_USER_SKILLS_DIR ?? join(userDataDir, 'skills'),
      builtInSkillsRoot: options.builtInSkillsRoot ?? process.env.VIBE_BUILTIN_SKILLS_DIR ?? join(REPO_ROOT, 'skills'),
      userDesignSystemsRoot:
        options.userDesignSystemsRoot ?? process.env.VIBE_USER_DESIGN_SYSTEMS_DIR ?? join(userDataDir, 'design-systems'),
      builtInDesignSystemsRoot: options.builtInDesignSystemsRoot ?? process.env.VIBE_BUILTIN_DESIGN_SYSTEMS_DIR ?? join(REPO_ROOT, 'design-systems'),
    },
    chat: {
      submitToolResultToRun,
    },
  };

  app.use('/api', (req: Request, res: Response, next: NextFunction): void => {
    if (!isMutatingMethod(req.method) || isAllowedOrigin(req.get('origin'), req.get('host'))) {
      next();
      return;
    }

    sendApiError(res, 403, 'FORBIDDEN_ORIGIN', 'cross-origin API writes are not allowed');
  });

  function startRunFromRequest(run: ChatRun, request: Record<string, unknown>): Promise<void> | void {
    const runner = options.startAgentRun ?? startAgentRun;
    return runner({
      run,
      runs,
      request,
      paths: {
        projectsDir,
        userSkillsRoot: ctx.paths.userSkillsRoot,
        builtInSkillsRoot: ctx.paths.builtInSkillsRoot,
        userDesignSystemsRoot: ctx.paths.userDesignSystemsRoot,
        builtInDesignSystemsRoot: ctx.paths.builtInDesignSystemsRoot,
      },
    });
  }

  async function preparePersistentRunBody(body: Record<string, unknown>): Promise<PersistentRunBodyResult> {
    const projectId = readString(body.projectId);
    if (!projectId || !isSafeProjectId(projectId)) {
      return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'projectId is required and must be path-safe' };
    }

    const existingConversationId = readString(body.conversationId);
    if (existingConversationId !== null && !isSafeConversationId(existingConversationId)) {
      return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'conversationId is invalid' };
    }

    const requestedProvider = readString(body.agentId) ?? DEFAULT_AGENT_ID;
    const unavailableAgent = findUnavailableAgent(await safeDetectAgentAvailability(detectAgentAvailability), requestedProvider);
    if (unavailableAgent) {
      return {
        ok: false,
        status: 409,
        code: 'AGENT_UNAVAILABLE',
        message: unavailableAgent.unavailableReason ?? `${unavailableAgent.label} is unavailable.`,
      };
    }

    let conversationId: string;
    if (existingConversationId) {
      const conversations = await listConversations(ctx.paths.projectsDir, projectId);
      const existingConversation = conversations.find((conversation) => conversation.id === existingConversationId);
      if (!existingConversation) {
        return { ok: false, status: 404, code: 'CONVERSATION_NOT_FOUND', message: 'conversation not found' };
      }
      if (existingConversation.provider && existingConversation.provider !== requestedProvider) {
        return {
          ok: false,
          status: 409,
          code: 'CONVERSATION_PROVIDER_LOCKED',
          message: `conversation already uses provider ${existingConversation.provider}`,
        };
      }
      await ensureProject(ctx, projectId);
      conversationId = existingConversationId;
    } else {
      await ensureProject(ctx, projectId);
      const defaultConversation = await ensureDefaultConversation(ctx.paths.projectsDir, projectId, readString(body.title));
      if (defaultConversation.provider && defaultConversation.provider !== requestedProvider) {
        return {
          ok: false,
          status: 409,
          code: 'CONVERSATION_PROVIDER_LOCKED',
          message: `conversation already uses provider ${defaultConversation.provider}`,
        };
      }
      conversationId = defaultConversation.id;
    }

    const conversation = await bindConversationProvider(
      ctx.paths.projectsDir,
      projectId,
      conversationId,
      requestedProvider,
    );
    if (!conversation) {
      return { ok: false, status: 404, code: 'CONVERSATION_NOT_FOUND', message: 'conversation not found' };
    }
    const assistantMessageId = readString(body.assistantMessageId) ?? createAssistantMessageId();

    return {
      ok: true,
      body: {
        ...body,
        conversationId,
        agentId: conversation.provider ?? requestedProvider,
        provider: conversation.provider ?? requestedProvider,
        providerSessionId: conversation.providerSessionId,
        resumeToken: conversation.resumeToken,
        assistantMessageId,
      },
    };
  }

  function sendPersistentRunBodyError(res: Response, result: Extract<PersistentRunBodyResult, { ok: false }>): void {
    sendApiError(res, result.status, result.code, result.message);
  }

  async function persistRunMessages(body: Record<string, unknown>, run: ChatRun): Promise<void> {
    if (!run.projectId || !run.conversationId || !run.assistantMessageId) {
      return;
    }

    const prompt = readPrompt(body);
    if (prompt) {
      const attachments = readAttachments(body.attachments);
      const commentAttachments = readCommentAttachments(body.commentAttachments);
      const messageContext = readMessageContext(body.messageContext);
      await upsertConversationMessage(ctx.paths.projectsDir, run.projectId, run.conversationId, {
        id: createUserMessageId(),
        role: 'user',
        content: prompt,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(commentAttachments.length > 0 ? { commentAttachments } : {}),
        ...(messageContext ? { context: messageContext } : {}),
      });
    }

    await upsertConversationMessage(ctx.paths.projectsDir, run.projectId, run.conversationId, {
      id: run.assistantMessageId,
      role: 'assistant',
      content: '',
      runId: run.id,
      runStatus: run.status,
      startedAt: run.createdAt,
    });
  }

  app.post('/api/runs', async (req: Request, res: Response): Promise<void> => {
    const body = readBody(req.body);
    if (!body) {
      sendApiError(res, 400, 'BAD_REQUEST', 'request body must be an object');
      return;
    }

    if (typeof body.projectId !== 'string' || !isSafeProjectId(body.projectId)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required and must be path-safe');
      return;
    }

    const persistentBodyResult = await preparePersistentRunBody(body);
    if (!persistentBodyResult.ok) {
      sendPersistentRunBodyError(res, persistentBodyResult);
      return;
    }
    const persistentBody = persistentBodyResult.body;

    const run = runs.create(createRunMeta(persistentBody));
    await persistRunMessages(persistentBody, run);
    res.status(202).json({
      runId: run.id,
      conversationId: run.conversationId,
      assistantMessageId: run.assistantMessageId,
      provider: run.agentId,
    });
    runs.start(run, (startedRun) => startRunFromRequest(startedRun, persistentBody));
  });

  app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
    const body = readBody(req.body);
    if (!body) {
      sendApiError(res, 400, 'BAD_REQUEST', 'request body must be an object');
      return;
    }

    if (typeof body.projectId !== 'string' || !isSafeProjectId(body.projectId)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required and must be path-safe');
      return;
    }

    const persistentBodyResult = await preparePersistentRunBody(body);
    if (!persistentBodyResult.ok) {
      sendPersistentRunBodyError(res, persistentBodyResult);
      return;
    }
    const persistentBody = persistentBodyResult.body;

    const run = runs.create(createRunMeta(persistentBody));
    await persistRunMessages(persistentBody, run);
    runs.stream(run, req, res);
    runs.start(run, (startedRun) => startRunFromRequest(startedRun, persistentBody));
  });

  app.post('/api/agents/claude/install', async (_req: Request, res: Response): Promise<void> => {
    const currentAvailability = await safeDetectAgentAvailability(detectAgentAvailability);
    const currentClaude = currentAvailability.find((agent) => agent.id === 'claude');
    if (currentClaude?.available) {
      res.status(200).json({ agentAvailability: currentAvailability });
      return;
    }

    try {
      await installClaudeCode();
    } catch (error) {
      sendApiError(
        res,
        500,
        'CLAUDE_INSTALL_FAILED',
        error instanceof Error ? error.message : 'Claude Code installation failed.',
      );
      return;
    }

    res.status(200).json({
      agentAvailability: await safeDetectAgentAvailability(detectAgentAvailability),
    });
  });

  registerChatRoutes(app, ctx);
  registerCliRoutes(app, ctx);
  registerCommentRoutes(app, ctx);
  registerConversationRoutes(app, ctx);
  registerDesignSystemRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerSkillsRoutes(app, ctx);

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(204).end();
  });

  app.get('/styles.css', async (_req: Request, res: Response) => {
    try {
      setFrontendAssetCacheHeaders(res);
      res.type('text/css').send(await readFile(WEB_STYLES_PATH, 'utf8'));
    } catch {
      res.status(404).type('text/plain').send('Stylesheet not built. Run pnpm --filter @vibe-design/web build:css.');
    }
  });

  app.get('/client.js', async (_req: Request, res: Response) => {
    try {
      setFrontendAssetCacheHeaders(res);
      res.type('text/javascript').send(await readFile(WEB_CLIENT_PATH, 'utf8'));
    } catch {
      res.status(404).type('text/plain').send('Client bundle not built. Run pnpm --filter @vibe-design/web build:client.');
    }
  });

  app.get(['/icon.png', '/assets/app-icon.png'], async (_req: Request, res: Response) => {
    try {
      sendNoStore(res);
      res.type('image/png').send(await readFile(APP_ICON_PATH));
    } catch {
      res.status(404).type('text/plain').send('App icon not found.');
    }
  });

  app.get('/assets/chat-ui.css', (_req: Request, res: Response) => {
    sendNoStore(res);
    void sendCssFile(res, CHAT_UI_CSS_PATHS, 'Chat UI stylesheet not found.');
  });

  app.get('/assets/@tutti-os/ui-system/styles.css', (_req: Request, res: Response) => {
    sendNoStore(res);
    void sendCssFile(res, [UI_SYSTEM_STYLES_PATH], 'UI system stylesheet not found.');
  });

  app.get('/assets/agent-icons/:assetName', async (req: Request<{ assetName: string }>, res: Response) => {
    const assetName = req.params.assetName;
    if (!isSafeAssetFileName(assetName)) {
      res.status(404).type('text/plain').send('Asset not found.');
      return;
    }

    try {
      sendNoStore(res);
      res.type(staticImageContentType(assetName)).send(await readFirstFile(WEB_AGENT_ICONS_DIRS.map((dir) => join(dir, assetName))));
    } catch {
      res.status(404).type('text/plain').send('Asset not found.');
    }
  });

  app.get('/assets/brand/:assetName', async (req: Request<{ assetName: string }>, res: Response) => {
    const assetName = req.params.assetName;
    if (!isSafeAssetFileName(assetName)) {
      res.status(404).type('text/plain').send('Asset not found.');
      return;
    }

    try {
      sendNoStore(res);
      res.type(staticImageContentType(assetName)).send(await readFirstFile(WEB_BRAND_ASSET_DIRS.map((dir) => join(dir, assetName))));
    } catch {
      res.status(404).type('text/plain').send('Asset not found.');
    }
  });

  app.get(['/', '/index.html'], async (_req: Request, res: Response) => {
    const recentProjects = await listProjectSummaries(projectsDir, 20);
    sendNoStore(res);
    res.type('html').send(renderPage({ route: { kind: 'dashboard' }, recentProjects }));
  });

  app.get('/project/:projectId', async (req: Request<{ projectId: string }>, res: Response) => {
    const route = resolveProjectRoute(req.params.projectId);
    if (!route || route.kind !== 'project') {
      res.status(404).type('text/plain').send('Not Found');
      return;
    }

    const project = await ensureProject(ctx, route.projectId);
    const projectEditor = await createProjectEditorInitialData(
      projectsDir,
      project,
      await safeDetectAgentAvailability(detectAgentAvailability),
    );
    sendNoStore(res);
    res.type('html').send(renderPage({ route, projectEditor }));
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).type('text/plain').send('Not Found');
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof URIError) {
      res.status(400).json({ error: 'Invalid request path encoding.' });
      return;
    }

    sendApiError(res, 500, 'INTERNAL', err instanceof Error ? err.message : 'Internal Server Error');
  });

  return http.createServer(app);
}

function readBody(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

async function createProjectEditorInitialData(
  projectsDir: string,
  project: StoredProject,
  agentAvailability: AgentAvailability[],
): Promise<ProjectEditorInitialData> {
  const conversations = await listConversations(projectsDir, project.id);
  const activeConversation = conversations[0] ?? (await ensureDefaultConversation(projectsDir, project.id, readProjectTitle(project)));
  const messages = await listConversationMessages(projectsDir, project.id, activeConversation.id);
  for (const message of messages ?? []) {
    if (Array.isArray(message.events)) {
      materializeProjectArtifactsFromEvents(projectsDir, project.id, message.events);
    }
  }
  await reconcileProjectFilesFromDisk(projectsDir, project.id);

  const files = await Promise.all(listProjectFilesFromStore(projectsDir, project.id).map(async (file) => {
    const kind = workspaceFileKind(file.kind);
    const url = `/api/projects/${encodeURIComponent(project.id)}/files/${encodeURIComponent(file.name)}`;
    const contents = shouldReadWorkspaceFileContent(kind, file.mime)
      ? await readFile(projectAssetPath(projectsDir, project.id, file.name), 'utf8').catch(() => '')
      : undefined;
    return {
      name: file.name,
      path: file.name,
      kind,
      mime: file.mime,
      size: file.size,
      ...(contents === undefined ? { url } : { contents, url }),
    } satisfies ProjectEditorInitialData['files'][number];
  }));
  const fileNames = new Set(files.map((file) => file.name));
  const tabs = project.tabsState.tabs.flatMap((tab) => {
    if (tab.kind !== 'file' || !fileNames.has(tab.name)) {
      return [];
    }

    return [{ kind: 'file' as const, key: tab.key, name: tab.name, path: tab.name }];
  });
  const activeTabKey = tabs.some((tab) => tab.key === project.tabsState.activeTabKey)
    ? project.tabsState.activeTabKey
    : null;

  return {
    project: {
      id: project.id,
      title: readProjectTitle(project),
      designSystemId: project.designSystemId,
      tabsState: { tabs, activeTabKey },
    },
    files,
    conversations: conversations.length > 0 ? conversations.map(conversationSummaryForClient) : [conversationSummaryForClient(activeConversation)],
    activeConversationId: activeConversation.id,
    messages: (messages ?? []).map(messageForClient),
    agentAvailability,
  };
}

async function safeDetectAgentAvailability(detectAgentAvailability: DetectAgentAvailability): Promise<AgentAvailability[]> {
  try {
    return await detectAgentAvailability();
  } catch (error) {
    return unavailableAgentsForDetectionFailure(error);
  }
}

function conversationSummaryForClient(conversation: {
  id: string;
  title: string | null;
  provider?: string | null;
  createdAt: number;
  updatedAt: number;
}): ProjectEditorInitialData['conversations'][number] {
  return {
    id: conversation.id,
    title: conversation.title ?? 'New conversation',
    provider: conversation.provider ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function messageForClient(message: StoredConversationMessage): ProjectEditorInitialData['messages'][number] {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    attachments: Array.isArray(message.attachments)
      ? (message.attachments as ProjectEditorInitialData['messages'][number]['attachments'])
      : [],
    commentAttachments: Array.isArray(message.commentAttachments) ? message.commentAttachments : [],
    context: message.context ?? undefined,
    events: Array.isArray(message.events)
      ? (message.events as ProjectEditorInitialData['messages'][number]['events'])
      : [],
    blocks:
      message.role === 'assistant' && message.content
        ? [{ kind: 'text', content: message.content, markdown: true }]
        : [],
    runId: message.runId ?? undefined,
    runStatus: message.runStatus ?? undefined,
    createdAt: message.createdAt,
    startedAt: message.startedAt ?? undefined,
    endedAt: message.endedAt ?? undefined,
  } as ProjectEditorInitialData['messages'][number] & { commentAttachments: unknown[] };
}

function workspaceFileKind(kind: ProjectFileKind): ProjectEditorInitialData['files'][number]['kind'] {
  if (kind === 'html') return 'html';
  if (kind === 'image') return 'image';
  if (kind === 'css' || kind === 'code' || kind === 'json' || kind === 'text') return 'text';
  return 'unsupported';
}

function shouldReadWorkspaceFileContent(
  kind: ProjectEditorInitialData['files'][number]['kind'],
  mime: string,
): boolean {
  if (kind === 'html') return true;
  if (kind === 'text') return true;
  return kind === 'image' && isSvgMime(mime);
}

function isSvgMime(mime: string): boolean {
  return mime.split(';', 1)[0]?.trim().toLowerCase() === 'image/svg+xml';
}

function projectAssetPath(projectsDir: string, projectId: string, name: string): string {
  return join(projectsDir, projectId, 'assets', name);
}

function staticImageContentType(name: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function readProjectTitle(project: StoredProject): string | null {
  return typeof project.metadata.title === 'string' ? project.metadata.title : null;
}

async function sendCssFile(res: Response, filePaths: string[], notFoundMessage: string): Promise<void> {
  try {
    setFrontendAssetCacheHeaders(res);
    res.type('text/css').send(await readFirstTextFile(filePaths));
  } catch {
    res.status(404).type('text/plain').send(notFoundMessage);
  }
}

function setFrontendAssetCacheHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

function sendNoStore(res: Response): void {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
}

async function readFirstFile(filePaths: string[]): Promise<Buffer> {
  for (const filePath of filePaths) {
    try {
      return await readFile(filePath);
    } catch {
      // Try the next packaged/development asset location.
    }
  }
  throw new Error('asset not found');
}

async function readFirstTextFile(filePaths: string[]): Promise<string> {
  return (await readFirstFile(filePaths)).toString('utf8');
}

function isSafeAssetFileName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function isJsonBodyParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError) || !isRecord(error)) {
    return false;
  }

  return (error.status === 400 || error.statusCode === 400) && error.type === 'entity.parse.failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPrompt(body: Record<string, unknown>): string | null {
  return readString(body.prompt) ?? readString(body.message) ?? readString(body.input);
}

function readAttachments(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const path = readString(item.path);
    const name = readString(item.name);
    if (!path || !name || !isAttachmentKind(item.kind)) {
      return [];
    }

    return [
      {
        path,
        name,
        kind: item.kind,
        ...(typeof item.size === 'number' && Number.isFinite(item.size) ? { size: item.size } : {}),
        ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      },
    ];
  });
}

function readCommentAttachments(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: unknown[] = [];
  for (const item of value.slice(0, 200)) {
    const attachment = normalizeCommentAttachment(item);
    if (!attachment) {
      continue;
    }

    attachments.push(attachment);
    if (attachments.length >= 20) {
      break;
    }
  }

  return attachments;
}

function readMessageContext(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const selectedSkills = readMessageContextSkills(value.selectedSkills);
  const selectedDesignFiles = readMessageContextDesignFiles(value.selectedDesignFiles);
  if (selectedSkills.length === 0 && selectedDesignFiles.length === 0) {
    return null;
  }

  return {
    ...(selectedSkills.length > 0 ? { selectedSkills } : {}),
    ...(selectedDesignFiles.length > 0 ? { selectedDesignFiles } : {}),
  };
}

function readMessageContextSkills(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((skill) => {
    if (!isRecord(skill)) {
      return [];
    }
    const id = readString(skill.id);
    const name = readString(skill.name);
    if (!id || !name) {
      return [];
    }

    const triggers = Array.isArray(skill.triggers)
      ? skill.triggers.flatMap((trigger) => {
        const normalized = readString(trigger);
        return normalized ? [normalized] : [];
      }).slice(0, 20)
      : [];

    return [{
      id,
      name,
      ...(readString(skill.description) ? { description: readString(skill.description) } : {}),
      ...(triggers.length > 0 ? { triggers } : {}),
    }];
  }).slice(0, 20);
}

const MESSAGE_CONTEXT_FILE_KINDS = new Set([
  'html',
  'image',
  'video',
  'audio',
  'sketch',
  'text',
  'code',
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'binary',
]);

function readMessageContextDesignFiles(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((file) => {
    if (!isRecord(file)) {
      return [];
    }

    const name = readString(file.name);
    const kind = readString(file.kind);
    const mime = readString(file.mime);
    if (!name || !kind || !mime || !MESSAGE_CONTEXT_FILE_KINDS.has(kind)) {
      return [];
    }

    const id = readString(file.id);
    const path = readString(file.path);
    const updatedAt = typeof file.updatedAt === 'number' && Number.isFinite(file.updatedAt)
      ? Math.max(0, Math.round(file.updatedAt))
      : null;

    return [{
      ...(id ? { id } : {}),
      name,
      ...(path ? { path } : {}),
      size: normalizeNonNegativeInteger(file.size),
      mtime: normalizeNonNegativeInteger(file.mtime),
      kind,
      mime,
      ...(updatedAt !== null ? { updatedAt } : {}),
    }];
  }).slice(0, 50);
}

const COMMENT_ATTACHMENT_STYLE_KEYS = new Set([
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'fontFamily',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
]);

function normalizeCommentAttachment(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = boundedString(value.id, 128);
  const filePath = boundedString(value.filePath, 512);
  const targetId = boundedString(value.targetId, 160);
  const selector = boundedString(value.selector, 512);
  const label = boundedString(value.label, 160);
  const comment = boundedString(value.comment, 1000);
  const currentText = boundedContextString(value.currentText, 160);
  const pagePosition = normalizeCommentPosition(value.pagePosition);
  const htmlHint = boundedContextString(value.htmlHint, 180);
  const selectionKind = readCommentSelectionKind(value.selectionKind);
  const source = readCommentAttachmentSource(value.source);

  if (
    !id ||
    !filePath ||
    !targetId ||
    !selector ||
    !label ||
    !comment ||
    !pagePosition ||
    !selectionKind ||
    !source
  ) {
    return null;
  }

  if (selectionKind === 'visual' && source !== 'visual-mark' && source !== 'saved-comment') {
    return null;
  }

  const attachment: Record<string, unknown> = {
    id,
    order: normalizeNonNegativeInteger(value.order),
    filePath,
    targetId,
    selector,
    label,
    comment,
    currentText,
    pagePosition,
    htmlHint,
    selectionKind,
    source,
  };

  const style = normalizeCommentStyle(value.style);
  if (style) {
    attachment.style = style;
  }

  if (selectionKind === 'visual') {
    const markKind = readVisualMarkKind(value.markKind);
    if (!markKind) {
      return null;
    }

    attachment.markKind = markKind;
    const screenshotPath = boundedString(value.screenshotPath, 512);
    if (screenshotPath) {
      attachment.screenshotPath = screenshotPath;
    }
    const intent = boundedString(value.intent, 200);
    if (intent) {
      attachment.intent = intent;
    }
    return attachment;
  }

  if (source === 'visual-mark') {
    return null;
  }

  if (selectionKind === 'pod') {
    if (value.memberCount !== undefined) {
      if (typeof value.memberCount !== 'number' || !Number.isFinite(value.memberCount)) {
        return null;
      }
      attachment.memberCount = normalizeNonNegativeInteger(value.memberCount);
    }

    if (value.podMembers !== undefined) {
      const podMembers = normalizePodMembers(value.podMembers);
      if (!podMembers) {
        return null;
      }
      attachment.podMembers = podMembers;
    }
  }

  return attachment;
}

function normalizePodMembers(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const members: Array<Record<string, unknown>> = [];
  for (const item of value.slice(0, 12)) {
    if (!isRecord(item)) {
      return null;
    }

    const targetId = boundedString(item.targetId, 160);
    const selector = boundedString(item.selector, 512);
    const label = boundedString(item.label, 160);
    const text = boundedString(item.text, 160);
    const position = normalizeCommentPosition(item.position);
    const htmlHint = boundedString(item.htmlHint, 180);
    if (!targetId || !selector || !label || !text || !position || !htmlHint) {
      return null;
    }

    const member: Record<string, unknown> = { targetId, selector, label, text, position, htmlHint };
    const style = normalizeCommentStyle(item.style);
    if (style) {
      member.style = style;
    }
    members.push(member);
  }

  return members;
}

function normalizeCommentStyle(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }

  const style: Record<string, string> = {};
  let scanned = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    scanned += 1;
    if (scanned > 100) {
      break;
    }
    if (!COMMENT_ATTACHMENT_STYLE_KEYS.has(key)) {
      continue;
    }

    const rawValue = value[key];
    const stringValue = boundedString(rawValue, 160);
    if (stringValue) {
      style[key] = stringValue;
    }
  }

  return Object.keys(style).length > 0 ? style : null;
}

function normalizeCommentPosition(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    x: normalizeNonNegativeInteger(value.x),
    y: normalizeNonNegativeInteger(value.y),
    width: normalizeNonNegativeInteger(value.width),
    height: normalizeNonNegativeInteger(value.height),
  };
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function boundedContextString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function readCommentSelectionKind(value: unknown): 'element' | 'pod' | 'visual' | null {
  return value === 'element' || value === 'pod' || value === 'visual' ? value : null;
}

function readCommentAttachmentSource(value: unknown): 'saved-comment' | 'board-batch' | 'visual-mark' | null {
  return value === 'saved-comment' || value === 'board-batch' || value === 'visual-mark' ? value : null;
}

function readVisualMarkKind(value: unknown): string | null {
  return boundedString(value, 64);
}

function isAttachmentKind(value: unknown): value is 'file' | 'image' {
  return value === 'file' || value === 'image';
}

function isMutatingMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (!host) {
    return false;
  }

  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host === host) {
      return parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:';
    }

    const requestHost = parseHost(host);
    return (
      requestHost !== null &&
      parsedOrigin.port === requestHost.port &&
      isLoopbackHost(parsedOrigin.hostname) &&
      isLoopbackHost(requestHost.hostname)
    );
  } catch {
    return false;
  }
}

function parseHost(host: string): { hostname: string; port: string } | null {
  try {
    const parsed = new URL(`http://${host}`);
    return { hostname: parsed.hostname, port: parsed.port };
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function resolveProjectRoute(projectId: string): VibeDesignRoute | null {
  return isProjectId(projectId) ? { kind: 'project', projectId } : null;
}

function createRunMeta(body: Record<string, unknown>): ChatRunCreateMeta {
  return {
    projectId: body.projectId,
    conversationId: body.conversationId,
    assistantMessageId: body.assistantMessageId,
    clientRequestId: body.clientRequestId,
    agentId: body.agentId ?? DEFAULT_AGENT_ID,
    providerSessionId: body.providerSessionId,
    resumeToken: body.resumeToken,
    appliedPluginSnapshotId: body.appliedPluginSnapshotId,
    pluginId: body.pluginId,
    mediaExecution: body.mediaExecution,
    toolBundle: body.toolBundle,
  };
}
