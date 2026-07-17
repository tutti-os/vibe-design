import { isUtf8 } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { ensureDefaultConversation } from '../conversations.js';
import { listAvailableDesignSystems } from '../design-systems.js';
import { prepareProjectFilesFromDisk } from '../project-file-preparation.js';
import type { RouteDeps } from '../server-context.js';
import {
  deleteProjectFileFromStore,
  deleteProjectFromStore,
  getProjectFileFromStore,
  getProjectFromStore,
  getPublicAssetFromStore,
  listProjectFilesFromStore,
  listPublicAssetsFromStore,
  listProjectSummariesFromStore,
  renameProjectFileInStore,
  sqlitePathForProjectsDir,
  upsertProjectFileInStore,
  upsertPublicAssetInStore,
  writeProjectToStore,
  type ProjectFileKind,
  type ProjectSummary,
  type ProjectTabsState,
  type ProjectTab,
  type StoredProject,
} from '../sqlite-store.js';

type ProjectRouteDeps = RouteDeps<'http' | 'paths'>;
type ProjectParams = { id: string };
type ProjectFileParams = { id: string; name: string };
type FileEncoding = 'base64' | 'utf8';
interface ProjectFile {
  name: string;
  path: string;
  url: string;
  size: number;
  mtime: string;
  kind: ProjectFileKind;
  mime: string;
}

export interface ProjectFileWrite {
  name: string;
  content: Buffer | string;
  encoding?: BufferEncoding;
  mime?: string;
  uniqueName?: boolean;
}

const PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const PROJECT_TEXT_MAX_LENGTH = 200;
const PROJECT_TITLE_MAX_LENGTH = 20;

export function isSafeProjectId(id: string): boolean {
  return id.length >= 1 && id.length <= 128 && PROJECT_ID_PATTERN.test(id) && !isOnlyDots(id);
}

export function isSafeFileName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 255 &&
    path.basename(name) === name &&
    path.win32.basename(name) === name &&
    !isOnlyDots(name)
  );
}

export function registerProjectRoutes(app: Express, ctx: ProjectRouteDeps): void {
  const { sendApiError } = ctx.http;

  app.post('/api/assets', async (req: Request, res: Response): Promise<void> => {
    let fileWrite: ProjectFileWrite | null;
    try {
      fileWrite = await readProjectFileWrite(req);
    } catch (error) {
      sendInternalError(ctx, res, error, 'public asset body read failed');
      return;
    }

    if (!fileWrite) {
      sendApiError(res, 400, 'BAD_REQUEST', 'asset body is invalid');
      return;
    }

    if (!isSafeFileName(fileWrite.name)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'asset name is invalid');
      return;
    }

    try {
      const content = Buffer.isBuffer(fileWrite.content)
        ? fileWrite.content
        : Buffer.from(fileWrite.content, fileWrite.encoding ?? 'utf8');
      const name = await uniquePublicAssetName(ctx.paths.projectsDir, ctx.paths.runtimeDir, fileWrite.name);
      await writePublicAsset(ctx.paths.runtimeDir, name, content);
      res.json({
        file: upsertPublicAssetInStore(ctx.paths.projectsDir, {
          name,
          path: publicAssetRelativePath(name),
          size: content.length,
          mime: fileWrite.mime ?? getContentType(name),
        }),
      });
    } catch (error) {
      sendInternalError(ctx, res, error, 'public asset write failed');
    }
  });

  app.get('/api/assets/:name', async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    const name = req.params.name;
    if (!isSafeFileName(name)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'asset name is invalid');
      return;
    }

    try {
      const asset = getPublicAssetFromStore(ctx.paths.projectsDir, name);
      if (!asset) {
        sendApiError(res, 404, 'ASSET_NOT_FOUND', 'asset not found');
        return;
      }

      res.type(asset.mime).send(await readPublicAsset(ctx.paths.runtimeDir, asset.name));
    } catch (error) {
      sendInternalError(ctx, res, error, 'public asset read failed');
    }
  });

  app.get('/api/projects', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ projects: await listProjectSummaries(ctx.paths.projectsDir) });
    } catch (error) {
      sendInternalError(ctx, res, error, 'projects list failed');
    }
  });

  app.post('/api/projects', async (req: Request<unknown, unknown, unknown>, res: Response): Promise<void> => {
    const projectInput = readProjectCreateInput(req.body);
    if (!projectInput) {
      sendApiError(res, 400, 'BAD_REQUEST', 'request body must be an object');
      return;
    }

    try {
      const designSystemResult = await validateDesignSystemId(ctx, projectInput.designSystemId);
      if (!designSystemResult.ok) {
        sendApiError(res, 400, designSystemResult.code, designSystemResult.message);
        return;
      }
      const project = await createProject(ctx, projectInput);
      const conversation = await initializeProjectConversation(ctx, project.id);
      res
        .status(201)
        .json({
          project,
          conversationId: conversation.id,
          resolvedDir: sqlitePathForProjectsDir(ctx.paths.projectsDir),
        });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project create failed');
    }
  });

  app.post('/projects', async (req: Request<unknown, unknown, unknown>, res: Response): Promise<void> => {
    const projectInput = readProjectCreateInput(req.body);
    if (!projectInput) {
      res.status(400).type('text/plain').send('Project prompt is required.');
      return;
    }

    try {
      const designSystemResult = await validateDesignSystemId(ctx, projectInput.designSystemId);
      if (!designSystemResult.ok) {
        res.status(400).type('text/plain').send(designSystemResult.message);
        return;
      }
      const project = await createProject(ctx, projectInput);
      await initializeProjectConversation(ctx, project.id);
      res.redirect(303, `/project/${encodeURIComponent(project.id)}`);
    } catch (error) {
      sendInternalError(ctx, res, error, 'project create failed');
    }
  });

  app.get('/api/projects/:id', async (req: Request<ProjectParams>, res: Response): Promise<void> => {
    const id = req.params.id;
    if (!isSafeProjectId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
      return;
    }

    try {
      const project = await ensureProject(ctx, id);
      res.json({ project, resolvedDir: sqlitePathForProjectsDir(ctx.paths.projectsDir) });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project read failed');
    }
  });

  app.patch('/api/projects/:id', async (req: Request<ProjectParams, unknown, unknown>, res: Response): Promise<void> => {
    const id = req.params.id;
    if (!isSafeProjectId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
      return;
    }

    const projectUpdate = readProjectUpdate(req.body);
    if (!projectUpdate) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project update body is invalid');
      return;
    }

    try {
      if (projectUpdate.designSystemId !== undefined) {
        const designSystemResult = await validateDesignSystemId(ctx, projectUpdate.designSystemId);
        if (!designSystemResult.ok) {
          sendApiError(res, 400, designSystemResult.code, designSystemResult.message);
          return;
        }
      }

      const project = await ensureProject(ctx, id);
      const updatedProject = await updateProject(ctx, project, projectUpdate);
      res.json({ project: updatedProject, resolvedDir: sqlitePathForProjectsDir(ctx.paths.projectsDir) });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project update failed');
    }
  });

  app.delete('/api/projects/:id', async (req: Request<ProjectParams>, res: Response): Promise<void> => {
    const id = req.params.id;
    if (!isSafeProjectId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
      return;
    }

    try {
      const deleted = deleteProjectFromStore(ctx.paths.projectsDir, id);
      if (!deleted) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      await rm(path.join(ctx.paths.projectsDir, id), { recursive: true, force: true });
      res.json({ ok: true });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project delete failed');
    }
  });

  app.put('/api/projects/:id/tabs-state', async (req: Request<ProjectParams, unknown, unknown>, res: Response) => {
    const id = req.params.id;
    if (!isSafeProjectId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
      return;
    }

    const tabsState = readTabsState(req.body);
    if (!tabsState) {
      sendApiError(res, 400, 'BAD_REQUEST', 'tabs-state body is invalid');
      return;
    }

    try {
      const project = await ensureProject(ctx, id);
      await writeProject(ctx.paths.projectsDir, { ...project, tabsState, updatedAt: Date.now() });
      res.json({ ok: true });
    } catch (error) {
      sendInternalError(ctx, res, error, 'tabs-state write failed');
    }
  });

  app.get('/api/projects/:id/files', async (req: Request<ProjectParams>, res: Response): Promise<void> => {
    const id = req.params.id;
    if (!isSafeProjectId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
      return;
    }

    try {
      await ensureProject(ctx, id);
      await prepareProjectFilesFromDisk(ctx.paths.projectsDir, id);
      const files: ProjectFile[] = listProjectFilesFromStore(ctx.paths.projectsDir, id)
        .map((file) => withProjectFileUrl(req, id, file));
      res.json({ files });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project files read failed');
    }
  });

  app.post('/api/projects/:id/files', async (req: Request<ProjectParams, unknown, unknown>, res: Response) => {
    const id = req.params.id;
    if (!isSafeProjectId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
      return;
    }

    let fileWrite: ProjectFileWrite | null;
    try {
      fileWrite = await readProjectFileWrite(req);
    } catch (error) {
      sendInternalError(ctx, res, error, 'project file body read failed');
      return;
    }

    if (!fileWrite) {
      sendApiError(res, 400, 'BAD_REQUEST', 'file body is invalid');
      return;
    }

    if (!isSafeFileName(fileWrite.name)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'file name is invalid');
      return;
    }

    try {
      await ensureProject(ctx, id);
      const file = await saveProjectFile(ctx, id, fileWrite);
      res.json({ file: withProjectFileUrl(req, id, file) });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project file write failed');
    }
  });

  app.get('/api/projects/:id/files/:name', async (req: Request<ProjectFileParams>, res: Response): Promise<void> => {
    const safeParams = validateFileParams(ctx, res, req.params);
    if (!safeParams) {
      return;
    }

    try {
      await ensureProject(ctx, safeParams.id);
      const file = getProjectFileFromStore(ctx.paths.projectsDir, safeParams.id, safeParams.name);
      if (!file) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }

      const content = await readProjectAsset(ctx.paths.projectsDir, safeParams.id, file.name);
      if (shouldInjectPreviewScrollbar(req.query) && isHtmlProjectFile(file)) {
        res.type(file.mime).send(injectPreviewScrollbar(content.toString('utf8')));
        return;
      }

      res.type(file.mime).send(content);
    } catch (error) {
      sendInternalError(ctx, res, error, 'project file read failed');
    }
  });

  app.get('/static/projects/:id/assets/:name', async (req: Request<ProjectFileParams>, res: Response): Promise<void> => {
    const safeParams = validateFileParams(ctx, res, req.params);
    if (!safeParams) {
      return;
    }

    try {
      await ensureProject(ctx, safeParams.id);
      const file = getProjectFileFromStore(ctx.paths.projectsDir, safeParams.id, safeParams.name);
      if (!file) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }

      sendNoStore(res);
      res.type(file.mime).send(await readProjectAsset(ctx.paths.projectsDir, safeParams.id, file.name));
    } catch (error) {
      sendInternalError(ctx, res, error, 'static project file read failed');
    }
  });

  app.delete('/api/projects/:id/files/:name', async (req: Request<ProjectFileParams>, res: Response): Promise<void> => {
    const safeParams = validateFileParams(ctx, res, req.params);
    if (!safeParams) {
      return;
    }

    try {
      await ensureProject(ctx, safeParams.id);
      const file = getProjectFileFromStore(ctx.paths.projectsDir, safeParams.id, safeParams.name);
      if (!deleteProjectFileFromStore(ctx.paths.projectsDir, safeParams.id, safeParams.name)) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }
      if (file) {
        await deleteProjectAsset(ctx.paths.projectsDir, safeParams.id, file.name);
      }
      res.json({ ok: true });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project file delete failed');
    }
  });

  app.put('/api/projects/:id/files/:name', async (req: Request<ProjectFileParams, unknown, unknown>, res: Response) => {
    const safeParams = validateFileParams(ctx, res, req.params);
    if (!safeParams) {
      return;
    }

    const body = readRecord(req.body);
    const nextName = readString(body?.name);
    if (!nextName || !isSafeFileName(nextName)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'target file name is invalid');
      return;
    }

    try {
      await ensureProject(ctx, safeParams.id);
      const currentFile = getProjectFileFromStore(ctx.paths.projectsDir, safeParams.id, safeParams.name);
      if (!currentFile) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }
      if (getProjectFileFromStore(ctx.paths.projectsDir, safeParams.id, nextName)) {
        sendApiError(res, 409, 'FILE_EXISTS', 'target file already exists');
        return;
      }
      if (await projectAssetExists(ctx.paths.projectsDir, safeParams.id, nextName)) {
        sendApiError(res, 409, 'FILE_EXISTS', 'target file already exists');
        return;
      }
      await renameProjectAsset(ctx.paths.projectsDir, safeParams.id, safeParams.name, nextName);
      const result = renameProjectFileInStore(ctx.paths.projectsDir, safeParams.id, safeParams.name, nextName);
      if (result.status === 'exists') {
        await renameProjectAsset(ctx.paths.projectsDir, safeParams.id, nextName, safeParams.name).catch(() => undefined);
        sendApiError(res, 409, 'FILE_EXISTS', 'target file already exists');
        return;
      }

      if (result.status === 'missing') {
        await renameProjectAsset(ctx.paths.projectsDir, safeParams.id, nextName, safeParams.name).catch(() => undefined);
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }

      if (result.status !== 'renamed') {
        sendApiError(res, 500, 'INTERNAL', 'project file rename failed');
        return;
      }

      res.json({ file: withProjectFileUrl(req, safeParams.id, result.file) });
    } catch (error) {
      sendInternalError(ctx, res, error, 'project file rename failed');
    }
  });
}

export async function listProjectSummaries(projectsDir: string, limit = 20): Promise<ProjectSummary[]> {
  return listProjectSummariesFromStore(projectsDir, limit);
}

export async function ensureProject(ctx: ProjectRouteDeps, id: string): Promise<StoredProject> {
  const existing = getProjectFromStore(ctx.paths.projectsDir, id);
  if (existing) {
    return existing;
  }

  const project = createDefaultProject(id);
  writeProjectToStore(ctx.paths.projectsDir, project);
  return project;
}

async function writeProject(projectsDir: string, project: StoredProject): Promise<void> {
  if (!isSafeProjectId(project.id)) {
    throw new Error('project id is unsafe');
  }

  writeProjectToStore(projectsDir, project);
}

async function createUniqueProjectId(projectsDir: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = randomUUID();
    if (!getProjectFromStore(projectsDir, id)) {
      return id;
    }
  }

  throw new Error('could not allocate project id');
}

export async function createProject(ctx: ProjectRouteDeps, input: ProjectCreateInput): Promise<StoredProject> {
  const id = await createUniqueProjectId(ctx.paths.projectsDir);
  const project = createDefaultProject(id, {
    title: input.title,
    prompt: input.prompt,
    projectKind: input.projectKind,
  }, input.designSystemId);
  writeProjectToStore(ctx.paths.projectsDir, project);
  return project;
}

export async function initializeProjectConversation(
  ctx: ProjectRouteDeps,
  projectId: string,
) {
  return ensureDefaultConversation(ctx.paths.projectsDir, projectId);
}

export async function updateProject(
  ctx: ProjectRouteDeps,
  project: StoredProject,
  projectUpdate: ProjectUpdateInput,
): Promise<StoredProject> {
  const updatedProject = {
    ...project,
    ...(projectUpdate.designSystemId !== undefined ? { designSystemId: projectUpdate.designSystemId } : {}),
    ...(projectUpdate.title !== undefined
      ? { metadata: { ...project.metadata, title: projectUpdate.title } }
      : {}),
    updatedAt: Date.now(),
  };
  await writeProject(ctx.paths.projectsDir, updatedProject);
  return updatedProject;
}

export async function saveProjectFile(
  ctx: ProjectRouteDeps,
  projectId: string,
  fileWrite: ProjectFileWrite,
) {
  await ensureProject(ctx, projectId);
  const content = Buffer.isBuffer(fileWrite.content)
    ? fileWrite.content
    : Buffer.from(fileWrite.content, fileWrite.encoding ?? 'utf8');
  const name = fileWrite.uniqueName ? await uniqueProjectFileName(ctx.paths.projectsDir, projectId, fileWrite.name) : fileWrite.name;
  const relativePath = projectAssetRelativePath(name);
  await writeProjectAsset(ctx.paths.projectsDir, projectId, name, content);
  return upsertProjectFileInStore(ctx.paths.projectsDir, projectId, {
    name,
    path: relativePath,
    size: content.length,
    mime: fileWrite.mime ?? getContentType(name),
  });
}

function createDefaultProject(
  id: string,
  metadata: Record<string, unknown> = {},
  designSystemId: string | null = null,
): StoredProject {
  const timestamp = Date.now();
  return {
    id,
    designSystemId,
    createdAt: timestamp,
    updatedAt: timestamp,
    tabsState: { tabs: [], activeTabKey: null },
    metadata,
  };
}

export interface ProjectCreateInput {
  title: string;
  prompt: string;
  projectKind: string;
  designSystemId: string | null;
}

export interface ProjectUpdateInput {
  title?: string;
  designSystemId?: string | null;
}

export function readProjectCreateInput(bodyValue: unknown): ProjectCreateInput | null {
  const body = readRecord(bodyValue);
  if (!body) {
    return null;
  }

  const prompt = normalizeProjectText(readString(body.prompt));
  if (!prompt) {
    return null;
  }

  return {
    title: normalizeProjectCreateTitle(readString(body.title), prompt),
    prompt,
    projectKind: normalizeProjectKind(readString(body.projectKind)),
    designSystemId: normalizeDesignSystemId(readString(body.designSystemId)),
  };
}

export function readProjectUpdate(bodyValue: unknown): ProjectUpdateInput | null {
  const body = readRecord(bodyValue);
  if (!body) {
    return null;
  }

  const update: ProjectUpdateInput = {};
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = normalizeProjectText(readString(body.title));
    if (!title) {
      return null;
    }
    update.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'designSystemId')) {
    if (body.designSystemId === null) {
      update.designSystemId = null;
    } else {
      const designSystemId = normalizeDesignSystemId(readString(body.designSystemId));
      if (!designSystemId) {
        return null;
      }
      update.designSystemId = designSystemId;
    }
  }

  return Object.keys(update).length > 0 ? update : null;
}

function normalizeDesignSystemId(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function validateDesignSystemId(
  ctx: ProjectRouteDeps,
  id: string | null,
): Promise<
  | { ok: true }
  | { ok: false; code: string; message: string }
> {
  if (!id) {
    return { ok: true };
  }

  const systems = await listAvailableDesignSystems({
    builtInRoot: ctx.paths.builtInDesignSystemsRoot,
    userRoot: ctx.paths.userDesignSystemsRoot,
  });
  if (systems.some((system) => system.id === id)) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'DESIGN_SYSTEM_NOT_FOUND',
    message: 'design system not found',
  };
}

function normalizeProjectText(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return Array.from(trimmed).slice(0, PROJECT_TEXT_MAX_LENGTH).join('');
}

function normalizeProjectCreateTitle(value: string | null, prompt: string): string {
  const explicitTitle = value?.trim();
  const source = explicitTitle || summarizeProjectPromptAsTitle(prompt);
  return Array.from(source).slice(0, PROJECT_TITLE_MAX_LENGTH).join('');
}

function summarizeProjectPromptAsTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  const sentence = compact.split(/[。.!！?？；;\n]/).find((part) => part.trim());
  return sentence?.trim() || compact;
}

function normalizeProjectKind(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 64 ? trimmed : 'prototype';
}

function readTabsState(value: unknown): ProjectTabsState | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) {
    return null;
  }

  const tabs: ProjectTab[] = [];
  const tabKeys = new Set<string>();
  for (const tab of value.tabs) {
    const parsed = readProjectTab(tab);
    if (!parsed || tabKeys.has(parsed.key)) {
      return null;
    }

    tabKeys.add(parsed.key);
    tabs.push(parsed);
  }

  if (value.activeTabKey !== null && typeof value.activeTabKey !== 'string') {
    return null;
  }

  if (typeof value.activeTabKey === 'string' && !tabKeys.has(value.activeTabKey)) {
    return null;
  }

  return { tabs, activeTabKey: value.activeTabKey };
}

function readProjectTab(value: unknown): ProjectTab | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = readString(value.kind);
  const key = readNonEmptyString(value.key);
  if (!key) {
    return null;
  }

  if (kind === 'file') {
    const name = readNonEmptyString(value.name);
    return name ? { kind, name, key } : null;
  }

  if (kind === 'live-artifact') {
    const id = readNonEmptyString(value.id);
    if (!id) {
      return null;
    }

    const label = readOptionalString(value.label);
    return label === undefined ? { kind, id, key } : { kind, id, label, key };
  }

  if (kind === 'sketch-editor') {
    if (value.isPending !== true) {
      return null;
    }

    const name = readOptionalString(value.name);
    return name === undefined ? { kind, key, isPending: true } : { kind, name, key, isPending: true };
  }

  return null;
}

async function readProjectFileWrite(req: Request): Promise<ProjectFileWrite | null> {
  const contentType = req.get('content-type') ?? '';
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    return readMultipartProjectFile(req, contentType);
  }

  const body = readRecord(req.body);
  const name = readString(body?.name);
  const content = readString(body?.content);
  const encoding = readFileEncoding(body?.encoding);
  if (!name || content === null || !encoding) {
    return null;
  }

  if (encoding === 'base64') {
    return { name, content: Buffer.from(content, 'base64') };
  }

  return { name, content, encoding: 'utf8' };
}

async function uniqueProjectFileName(projectsDir: string, projectId: string, name: string): Promise<string> {
  const parsed = path.parse(name);
  const existingNames = new Set(listProjectFilesFromStore(projectsDir, projectId).map((file) => file.name));
  let candidate = name;
  let suffix = 2;

  while (existingNames.has(candidate) || (await projectAssetExists(projectsDir, projectId, candidate))) {
    candidate = `${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }

  return candidate;
}

async function uniquePublicAssetName(projectsDir: string, runtimeDir: string, name: string): Promise<string> {
  const parsed = path.parse(name);
  const existingNames = new Set(listPublicAssetsFromStore(projectsDir).map((file) => file.name));
  let candidate = name;
  let suffix = 2;

  while (existingNames.has(candidate) || (await publicAssetExists(runtimeDir, candidate))) {
    candidate = `${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }

  return candidate;
}

function projectAssetRelativePath(name: string): string {
  return `assets/${name}`;
}

function publicAssetRelativePath(name: string): string {
  return `assets/${name}`;
}

function withProjectFileUrl<T extends Omit<ProjectFile, 'url'>>(req: Request, projectId: string, file: T): T & { url: string } {
  return {
    ...file,
    url: projectFileStaticUrl(req, projectId, file.name),
  };
}

function projectFileStaticUrl(req: Request, projectId: string, name: string): string {
  const host = req.get('host') ?? '127.0.0.1';
  return `${req.protocol}://${host}/static/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(name)}`;
}

function projectAssetsDir(projectsDir: string, projectId: string): string {
  return path.join(projectsDir, projectId, 'assets');
}

function projectAssetPath(projectsDir: string, projectId: string, name: string): string {
  return path.join(projectAssetsDir(projectsDir, projectId), name);
}

async function writeProjectAsset(projectsDir: string, projectId: string, name: string, content: Buffer): Promise<void> {
  await mkdir(projectAssetsDir(projectsDir, projectId), { recursive: true });
  await writeFile(projectAssetPath(projectsDir, projectId, name), content);
}

async function readProjectAsset(projectsDir: string, projectId: string, name: string): Promise<Buffer> {
  return readFile(projectAssetPath(projectsDir, projectId, name));
}

async function deleteProjectAsset(projectsDir: string, projectId: string, name: string): Promise<void> {
  await rm(projectAssetPath(projectsDir, projectId, name), { force: true });
}

async function renameProjectAsset(projectsDir: string, projectId: string, name: string, nextName: string): Promise<void> {
  await rename(projectAssetPath(projectsDir, projectId, name), projectAssetPath(projectsDir, projectId, nextName));
}

async function projectAssetExists(projectsDir: string, projectId: string, name: string): Promise<boolean> {
  try {
    return (await stat(projectAssetPath(projectsDir, projectId, name))).isFile();
  } catch {
    return false;
  }
}

function publicAssetsDir(runtimeDir: string): string {
  return path.join(runtimeDir, 'assets');
}

function publicAssetPath(runtimeDir: string, name: string): string {
  return path.join(publicAssetsDir(runtimeDir), name);
}

async function writePublicAsset(runtimeDir: string, name: string, content: Buffer): Promise<void> {
  await mkdir(publicAssetsDir(runtimeDir), { recursive: true });
  await writeFile(publicAssetPath(runtimeDir, name), content);
}

async function readPublicAsset(runtimeDir: string, name: string): Promise<Buffer> {
  return readFile(publicAssetPath(runtimeDir, name));
}

function sendNoStore(res: Response): void {
  res.setHeader('cache-control', 'no-store');
}

async function publicAssetExists(runtimeDir: string, name: string): Promise<boolean> {
  try {
    return (await stat(publicAssetPath(runtimeDir, name))).isFile();
  } catch {
    return false;
  }
}

async function readMultipartProjectFile(req: Request, contentType: string): Promise<ProjectFileWrite | null> {
  const boundary = readMultipartBoundary(contentType);
  if (!boundary) {
    return null;
  }

  const body = await readRequestBuffer(req);
  return parseMultipartFile(body, boundary);
}

function readMultipartBoundary(contentType: string): string | null {
  const boundary = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return boundary?.[1] ?? boundary?.[2]?.trim() ?? null;
}

async function readRequestBuffer(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function parseMultipartFile(body: Buffer, boundary: string): ProjectFileWrite | null {
  const bodyText = body.toString('latin1');
  const boundaryMarker = `--${boundary}`;

  for (const rawPart of bodyText.split(boundaryMarker)) {
    let part = rawPart;
    if (part.startsWith('\r\n')) {
      part = part.slice(2);
    }

    if (part.length === 0 || part === '--\r\n' || part === '--') {
      continue;
    }

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      continue;
    }

    const headerText = part.slice(0, headerEnd);
    const disposition = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-disposition:'));
    const filename = disposition ? readDispositionFilename(disposition) : null;
    if (!filename) {
      continue;
    }
    const mime = readPartContentType(headerText);

    let contentText = part.slice(headerEnd + 4);
    if (contentText.endsWith('\r\n')) {
      contentText = contentText.slice(0, -2);
    }

    return { name: filename, content: Buffer.from(contentText, 'latin1'), mime, uniqueName: true };
  }

  return null;
}

function readDispositionFilename(disposition: string): string | null {
  const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1];
  if (!filename || filename.length === 0) {
    return null;
  }

  return decodeMultipartHeaderValue(filename);
}

function decodeMultipartHeaderValue(value: string): string {
  const bytes = Buffer.from(value, 'latin1');
  return isUtf8(bytes) ? bytes.toString('utf8') : value;
}

function readPartContentType(headerText: string): string | undefined {
  const contentType = headerText
    .split('\r\n')
    .find((line) => line.toLowerCase().startsWith('content-type:'))
    ?.slice('content-type:'.length)
    .trim();
  return contentType || undefined;
}

function validateFileParams(
  ctx: ProjectRouteDeps,
  res: Response,
  params: ProjectFileParams,
): ProjectFileParams | null {
  if (!isSafeProjectId(params.id)) {
    ctx.http.sendApiError(res, 400, 'BAD_REQUEST', 'project id is invalid');
    return null;
  }

  if (!isSafeFileName(params.name)) {
    ctx.http.sendApiError(res, 400, 'BAD_REQUEST', 'file name is invalid');
    return null;
  }

  return params;
}

function readFileEncoding(value: unknown): FileEncoding | null {
  if (value === undefined || value === 'utf8') {
    return 'utf8';
  }

  return value === 'base64' ? 'base64' : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shouldInjectPreviewScrollbar(query: unknown): boolean {
  if (!isRecord(query)) return false;
  const value = query.vdPreviewScrollbar;
  return value === '1' || value === 'true';
}

function isHtmlProjectFile(file: { kind: ProjectFileKind; mime: string }): boolean {
  return file.kind === 'html' || file.mime.toLowerCase().includes('text/html');
}

function injectPreviewScrollbar(html: string): string {
  if (html.includes('data-vd-preview-scrollbar')) {
    return html;
  }

  const style = `<style data-vd-preview-scrollbar>
html{scrollbar-width:none;-ms-overflow-style:none;}
html::-webkit-scrollbar,body::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}
[data-vd-preview-scrollbar="track"]{position:fixed;top:6px;right:5px;bottom:6px;width:12px;z-index:2147483000;pointer-events:none;opacity:0;transition:opacity 120ms ease;}
[data-vd-preview-scrollbar="track"][data-visible="true"]{opacity:1;pointer-events:auto;}
[data-vd-preview-scrollbar="thumb"]{position:absolute;right:2px;top:0;width:7px;min-height:34px;border-radius:999px;background:rgba(69,66,59,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.38);cursor:grab;transition:background 120ms ease,width 120ms ease,right 120ms ease;}
[data-vd-preview-scrollbar="track"]:hover [data-vd-preview-scrollbar="thumb"],[data-vd-preview-scrollbar="thumb"][data-dragging="true"]{right:1px;width:9px;background:rgba(69,66,59,.42);}
[data-vd-preview-scrollbar="thumb"][data-dragging="true"]{cursor:grabbing;}
</style>`;
  const script = `<script data-vd-preview-scrollbar>
(function(){var track=null,thumb=null,dragging=false,dragOffset=0,scheduled=false;function maxScroll(){var root=document.documentElement;var body=document.body;var scrollHeight=Math.max(root.scrollHeight||0,body?body.scrollHeight||0:0);var viewportHeight=window.innerHeight||root.clientHeight||1;return Math.max(0,scrollHeight-viewportHeight);}function ensureNodes(){if(track&&thumb)return;track=document.createElement('div');track.setAttribute('data-vd-preview-scrollbar','track');track.setAttribute('aria-hidden','true');thumb=document.createElement('div');thumb.setAttribute('data-vd-preview-scrollbar','thumb');track.appendChild(thumb);document.body.appendChild(track);thumb.addEventListener('pointerdown',startDrag);track.addEventListener('pointerdown',jumpToPoint);}function update(){scheduled=false;ensureNodes();if(!track||!thumb)return;var available=track.clientHeight||Math.max(1,window.innerHeight-12);var viewportHeight=window.innerHeight||document.documentElement.clientHeight||1;var scrollable=maxScroll();if(scrollable<=1){track.removeAttribute('data-visible');return;}var documentHeight=viewportHeight+scrollable;var thumbHeight=Math.max(34,Math.round((viewportHeight/documentHeight)*available));var travel=Math.max(1,available-thumbHeight);var progress=Math.min(1,Math.max(0,(window.scrollY||window.pageYOffset||0)/scrollable));thumb.style.height=thumbHeight+'px';thumb.style.transform='translateY('+Math.round(progress*travel)+'px)';track.setAttribute('data-visible','true');}function scheduleUpdate(){if(scheduled)return;scheduled=true;window.requestAnimationFrame(update);}function scrollToThumbPosition(clientY){if(!track||!thumb)return;var rect=track.getBoundingClientRect();var thumbHeight=thumb.offsetHeight||34;var travel=Math.max(1,rect.height-thumbHeight);var top=Math.min(travel,Math.max(0,clientY-rect.top-dragOffset));window.scrollTo({top:(top/travel)*maxScroll(),behavior:'auto'});}function startDrag(event){if(!thumb)return;dragging=true;dragOffset=event.clientY-thumb.getBoundingClientRect().top;thumb.setAttribute('data-dragging','true');thumb.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();}function jumpToPoint(event){if(event.target===thumb||!thumb)return;dragOffset=Math.round((thumb.offsetHeight||34)/2);scrollToThumbPosition(event.clientY);event.preventDefault();event.stopPropagation();}function handlePointerMove(event){if(!dragging)return;scrollToThumbPosition(event.clientY);event.preventDefault();}function stopDrag(event){if(!dragging)return;dragging=false;if(thumb){thumb.removeAttribute('data-dragging');if(typeof thumb.releasePointerCapture==='function'){try{thumb.releasePointerCapture(event.pointerId);}catch(error){}}}}window.addEventListener('scroll',scheduleUpdate,{passive:true});window.addEventListener('resize',scheduleUpdate);window.addEventListener('pointermove',handlePointerMove);window.addEventListener('pointerup',stopDrag);window.addEventListener('pointercancel',stopDrag);window.addEventListener('load',scheduleUpdate);if(document.fonts&&document.fonts.ready){document.fonts.ready.then(scheduleUpdate).catch(function(){});}if(window.ResizeObserver&&document.documentElement){new ResizeObserver(scheduleUpdate).observe(document.documentElement);}if(window.MutationObserver&&document.documentElement){new MutationObserver(scheduleUpdate).observe(document.documentElement,{attributes:true,childList:true,subtree:true});}window.setTimeout(scheduleUpdate,50);window.setTimeout(scheduleUpdate,300);scheduleUpdate();})();
</script>`;

  return injectIntoHtml(injectIntoHtml(html, style, 'head'), script, 'body');
}

function injectIntoHtml(html: string, snippet: string, target: 'head' | 'body'): string {
  const closeTag = target === 'head' ? '</head>' : '</body>';
  const index = html.toLowerCase().lastIndexOf(closeTag);
  if (index < 0) {
    return target === 'head' ? `${snippet}${html}` : `${html}${snippet}`;
  }
  return `${html.slice(0, index)}${snippet}${html.slice(index)}`;
}

function isOnlyDots(value: string): boolean {
  return /^\.+$/.test(value);
}

function getContentType(name: string): string {
  const extension = path.extname(name).toLowerCase();
  if (extension === '.html' || extension === '.htm') {
    return 'text/html; charset=utf-8';
  }

  if (extension === '.css') {
    return 'text/css; charset=utf-8';
  }

  if (extension === '.js' || extension === '.mjs') {
    return 'text/javascript; charset=utf-8';
  }

  if (extension === '.ts' || extension === '.tsx') {
    return 'text/plain; charset=utf-8';
  }

  if (extension === '.json') {
    return 'application/json; charset=utf-8';
  }

  if (extension === '.md' || extension === '.markdown') {
    return 'text/markdown; charset=utf-8';
  }

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.gif') {
    return 'image/gif';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  if (extension === '.svg') {
    return 'image/svg+xml; charset=utf-8';
  }

  return 'application/octet-stream';
}

function sendInternalError(ctx: ProjectRouteDeps, res: Response, error: unknown, message: string): void {
  const reason = error instanceof Error ? error.message : String(error);
  ctx.http.sendApiError(res, 500, 'INTERNAL', `${message}: ${reason}`);
}
