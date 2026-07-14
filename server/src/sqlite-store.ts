import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openSqliteDatabase, type SqliteDatabase } from './sqlite-adapter.js';
import type { RunStatus } from './types/run.js';

export type ProjectFileKind = 'html' | 'css' | 'code' | 'json' | 'text' | 'image' | 'file';

export interface StoredProject {
  id: string;
  designSystemId: string | null;
  createdAt: number;
  updatedAt: number;
  tabsState: ProjectTabsState;
  metadata: Record<string, unknown>;
}

export type ProjectTab =
  | { kind: 'file'; name: string; key: string }
  | { kind: 'live-artifact'; id: string; label?: string; key: string }
  | { kind: 'sketch-editor'; name?: string; key: string; isPending: true };

export interface ProjectTabsState {
  tabs: ProjectTab[];
  activeTabKey: string | null;
}

export interface ProjectSummary {
  id: string;
  title: string;
  prompt: string;
  projectKind: string;
  createdAt: number;
  updatedAt: number;
  coverUrl?: string;
}

export interface StoredProjectFile {
  name: string;
  path: string;
  size: number;
  mtime: string;
  kind: ProjectFileKind;
  mime: string;
}

export interface StoredProjectFileContent {
  name: string;
  path: string;
  size: number;
  kind: ProjectFileKind;
  mime: string;
}

export interface StoredConversation {
  id: string;
  projectId: string;
  title: string | null;
  agentTargetId: string | null;
  provider: string | null;
  model: string | null;
  providerSessionId: string | null;
  resumeToken: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: unknown[];
  commentAttachments: unknown[];
  context: unknown | null;
  events: unknown[];
  runId: string | null;
  runStatus: RunStatus | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface UpsertMessageInput {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  attachments?: unknown[];
  commentAttachments?: unknown[];
  context?: unknown | null;
  events?: unknown[];
  runId?: string | null;
  runStatus?: RunStatus | null;
  startedAt?: number | null;
  endedAt?: number | null;
}

export type PreviewCommentStatus = 'open' | 'attached' | 'applying' | 'needs_review' | 'resolved' | 'failed';
export type PreviewCommentSelectionKind = 'element' | 'pod' | 'visual';

export interface PreviewCommentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewCommentPoint {
  x: number;
  y: number;
}

export interface PreviewCommentTarget {
  filePath: string;
  targetId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewCommentPosition;
  hoverPoint?: PreviewCommentPoint;
  htmlHint: string;
  style: unknown | null;
  selectionKind: PreviewCommentSelectionKind;
  memberCount: number | null;
  podMembers: unknown[] | null;
  screenshotPath: string | null;
  markKind: string | null;
  intent: string | null;
}

export interface StoredPreviewComment {
  id: string;
  projectId: string;
  target: PreviewCommentTarget;
  note: string;
  status: PreviewCommentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertPreviewCommentInput {
  target: {
    filePath?: unknown;
    targetId?: unknown;
    selector?: unknown;
    label?: unknown;
    text?: unknown;
    position?: unknown;
    hoverPoint?: unknown;
    htmlHint?: unknown;
    style?: unknown;
    selectionKind?: unknown;
    memberCount?: unknown;
    podMembers?: unknown;
    screenshotPath?: unknown;
    markKind?: unknown;
    intent?: unknown;
  };
  note?: unknown;
}

interface ProjectRow {
  id: string;
  design_system_id: string | null;
  created_at: number;
  updated_at: number;
  tabs_state_json: string;
  metadata_json: string;
}

interface ProjectFileRow {
  name: string;
  path: string;
  size: number;
  mime: string;
  kind: ProjectFileKind;
  updated_at: number;
}

interface ConversationRow {
  id: string;
  project_id: string;
  title: string | null;
  agent_target_id: string | null;
  provider: string | null;
  model: string | null;
  provider_session_id: string | null;
  resume_token: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments_json: string;
  comment_attachments_json: string;
  context_json: string;
  events_json: string;
  run_id: string | null;
  run_status: RunStatus | null;
  position: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

interface PreviewCommentRow {
  id: string;
  project_id: string;
  file_path: string;
  target_id: string;
  selector: string;
  label: string;
  text: string;
  position_json: string;
  hover_point_json: string | null;
  html_hint: string;
  style_json: string | null;
  selection_kind: string;
  member_count: number | null;
  pod_members_json: string | null;
  screenshot_path: string | null;
  mark_kind: string | null;
  intent: string | null;
  note: string;
  status: PreviewCommentStatus;
  created_at: number;
  updated_at: number;
}

export const PREVIEW_COMMENT_STATUSES: readonly PreviewCommentStatus[] = [
  'open',
  'attached',
  'applying',
  'needs_review',
  'resolved',
  'failed',
];

const PREVIEW_COMMENT_STATUS_SET = new Set<PreviewCommentStatus>(PREVIEW_COMMENT_STATUSES);

const PREVIEW_COMMENT_SELECTION_KIND_SET = new Set<PreviewCommentSelectionKind>(['element', 'pod', 'visual']);

const stores = new Map<string, SqliteDatabase>();

export function sqlitePathForProjectsDir(projectsDir: string): string {
  return path.join(path.dirname(projectsDir), 'vibe-design.sqlite');
}

export function getStore(projectsDir: string): SqliteDatabase {
  const sqlitePath = sqlitePathForProjectsDir(projectsDir);
  const cached = stores.get(sqlitePath);
  if (cached) {
    return cached;
  }

  const db = openSqliteDatabase(sqlitePath);
  db.pragma('foreign_keys = ON');
  migrate(db);
  stores.set(sqlitePath, db);
  return db;
}

export function listProjectSummariesFromStore(projectsDir: string, limit = 20): ProjectSummary[] {
  const db = getStore(projectsDir);
  const rows = db
    .prepare(
      `SELECT id, design_system_id, created_at, updated_at, tabs_state_json, metadata_json
       FROM projects
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as ProjectRow[];

  return rows.map((row) => {
    const project = projectFromRow(row);
    return projectToSummary(project, selectProjectCoverUrl(db, project));
  });
}

export function getProjectFromStore(projectsDir: string, id: string): StoredProject | null {
  const row = getStore(projectsDir)
    .prepare(
      `SELECT id, design_system_id, created_at, updated_at, tabs_state_json, metadata_json
       FROM projects
       WHERE id = ?`,
    )
    .get(id) as ProjectRow | undefined;
  return row ? projectFromRow(row) : null;
}

export function writeProjectToStore(projectsDir: string, project: StoredProject): void {
  getStore(projectsDir)
    .prepare(
      `INSERT INTO projects (id, design_system_id, created_at, updated_at, tabs_state_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         design_system_id = excluded.design_system_id,
         updated_at = excluded.updated_at,
         tabs_state_json = excluded.tabs_state_json,
         metadata_json = excluded.metadata_json`,
    )
    .run(
      project.id,
      project.designSystemId,
      project.createdAt,
      project.updatedAt,
      JSON.stringify(project.tabsState),
      JSON.stringify(project.metadata),
    );
}

export function deleteProjectFromStore(projectsDir: string, id: string): boolean {
  const result = getStore(projectsDir).prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}

export function listProjectFilesFromStore(projectsDir: string, projectId: string): StoredProjectFile[] {
  const rows = getStore(projectsDir)
    .prepare('SELECT name, path, size, mime, kind, updated_at FROM project_files WHERE project_id = ? ORDER BY name ASC')
    .all(projectId) as ProjectFileRow[];
  return rows.map(fileFromRow);
}

export function listPublicAssetsFromStore(projectsDir: string): StoredProjectFile[] {
  const rows = getStore(projectsDir)
    .prepare('SELECT name, path, size, mime, kind, updated_at FROM public_assets ORDER BY name ASC')
    .all() as ProjectFileRow[];
  return rows.map(fileFromRow);
}

export function upsertProjectFileInStore(
  projectsDir: string,
  projectId: string,
  file: {
    name: string;
    path: string;
    size: number;
    mime?: string;
    kind?: ProjectFileKind;
  },
): StoredProjectFile {
  const now = Date.now();
  const kind = file.kind ?? getFileKind(file.name);
  const mime = file.mime ?? getFileMime(file.name, kind);
  getStore(projectsDir)
    .prepare(
      `INSERT INTO project_files (project_id, name, path, size, mime, kind, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, name) DO UPDATE SET
         path = excluded.path,
         size = excluded.size,
         mime = excluded.mime,
         kind = excluded.kind,
         updated_at = excluded.updated_at`,
    )
    .run(projectId, file.name, file.path, file.size, mime, kind, now);

  return { name: file.name, path: file.path, size: file.size, mtime: new Date(now).toISOString(), kind, mime };
}

export function upsertPublicAssetInStore(
  projectsDir: string,
  file: {
    name: string;
    path: string;
    size: number;
    mime?: string;
    kind?: ProjectFileKind;
  },
): StoredProjectFile {
  const now = Date.now();
  const kind = file.kind ?? getFileKind(file.name);
  const mime = file.mime ?? getFileMime(file.name, kind);
  getStore(projectsDir)
    .prepare(
      `INSERT INTO public_assets (name, path, size, mime, kind, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         path = excluded.path,
         size = excluded.size,
         mime = excluded.mime,
         kind = excluded.kind,
         updated_at = excluded.updated_at`,
    )
    .run(file.name, file.path, file.size, mime, kind, now);

  return { name: file.name, path: file.path, size: file.size, mtime: new Date(now).toISOString(), kind, mime };
}

export function getProjectFileFromStore(
  projectsDir: string,
  projectId: string,
  name: string,
): StoredProjectFileContent | null {
  const row = getStore(projectsDir)
    .prepare('SELECT name, path, size, mime, kind, updated_at FROM project_files WHERE project_id = ? AND name = ?')
    .get(projectId, name) as ProjectFileRow | undefined;
  return row ? { name: row.name, path: row.path, size: row.size, mime: row.mime, kind: row.kind } : null;
}

export function getPublicAssetFromStore(projectsDir: string, name: string): StoredProjectFileContent | null {
  const row = getStore(projectsDir)
    .prepare('SELECT name, path, size, mime, kind, updated_at FROM public_assets WHERE name = ?')
    .get(name) as ProjectFileRow | undefined;
  return row ? { name: row.name, path: row.path, size: row.size, mime: row.mime, kind: row.kind } : null;
}

export function deleteProjectFileFromStore(projectsDir: string, projectId: string, name: string): boolean {
  const result = getStore(projectsDir)
    .prepare('DELETE FROM project_files WHERE project_id = ? AND name = ?')
    .run(projectId, name);
  return result.changes > 0;
}

export function renameProjectFileInStore(
  projectsDir: string,
  projectId: string,
  name: string,
  nextName: string,
): { status: 'renamed'; file: StoredProjectFile } | { status: 'missing' | 'exists' } {
  const db = getStore(projectsDir);
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT name, path, size, mime, kind, updated_at FROM project_files WHERE project_id = ? AND name = ?')
      .get(projectId, name) as ProjectFileRow | undefined;
    if (!existing) {
      return { status: 'missing' as const };
    }

    const conflict = db
      .prepare('SELECT 1 FROM project_files WHERE project_id = ? AND name = ?')
      .get(projectId, nextName);
    if (conflict) {
      return { status: 'exists' as const };
    }

    const now = Date.now();
    const kind = getFileKind(nextName);
    const mime = getFileMime(nextName, kind);
    const nextPath = `assets/${nextName}`;
    db.prepare('UPDATE project_files SET name = ?, path = ?, mime = ?, kind = ?, updated_at = ? WHERE project_id = ? AND name = ?').run(
      nextName,
      nextPath,
      mime,
      kind,
      now,
      projectId,
      name,
    );
    return {
      status: 'renamed' as const,
      file: { name: nextName, path: nextPath, size: existing.size, mtime: new Date(now).toISOString(), kind, mime },
    };
  });
  return tx();
}

export function createConversationInStore(
  projectsDir: string,
  projectId: string,
  id: string,
  title: string | null,
): StoredConversation {
  const now = Date.now();
  getStore(projectsDir)
    .prepare(
      `INSERT INTO conversations (id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(id, projectId, title, now, now);
  return {
    id,
    projectId,
    title,
    agentTargetId: null,
    provider: null,
    model: null,
    providerSessionId: null,
    resumeToken: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateConversationTitleInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  title: string | null,
): StoredConversation | null {
  const now = Date.now();
  const db = getStore(projectsDir);
  const result = db
    .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE project_id = ? AND id = ?')
    .run(title, now, projectId, conversationId);
  if (result.changes === 0) {
    return null;
  }

  const row = db
    .prepare(
      `SELECT id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at
       FROM conversations
       WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, conversationId) as ConversationRow | undefined;
  return row ? conversationFromRow(row) : null;
}

export type DeleteConversationFromStoreResult = 'deleted' | 'not_found' | 'last_conversation';

export function deleteConversationFromStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
): DeleteConversationFromStoreResult {
  const db = getStore(projectsDir);
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM conversations WHERE project_id = ? AND id = ?')
      .get(projectId, conversationId);
    if (!existing) {
      return 'not_found';
    }

    const countRow = db
      .prepare('SELECT COUNT(*) AS count FROM conversations WHERE project_id = ?')
      .get(projectId) as { count?: number } | undefined;
    if ((countRow?.count ?? 0) <= 1) {
      return 'last_conversation';
    }

    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversations WHERE project_id = ? AND id = ?').run(projectId, conversationId);
    const now = Date.now();
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId);
    return 'deleted';
  });
  return tx();
}

export function getFirstConversationFromStore(projectsDir: string, projectId: string): StoredConversation | null {
  const row = getStore(projectsDir)
    .prepare(
      `SELECT id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at
       FROM conversations
       WHERE project_id = ?
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get(projectId) as ConversationRow | undefined;
  return row ? conversationFromRow(row) : null;
}

export function listConversationsFromStore(projectsDir: string, projectId: string): StoredConversation[] {
  const rows = getStore(projectsDir)
    .prepare(
      `SELECT id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at
       FROM conversations
       WHERE project_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(projectId) as ConversationRow[];
  return rows.map(conversationFromRow);
}

export function listConversationMessagesFromStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
): StoredConversationMessage[] | null {
  const db = getStore(projectsDir);
  const conversation = db
    .prepare('SELECT id FROM conversations WHERE project_id = ? AND id = ?')
    .get(projectId, conversationId);
  if (!conversation) {
    return null;
  }

  const rows = db
    .prepare(
      `SELECT id, conversation_id, role, content, attachments_json, comment_attachments_json, context_json, events_json, run_id, run_status,
        position, created_at, updated_at, started_at, ended_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY position ASC`,
    )
    .all(conversationId) as MessageRow[];
  return rows.map(messageFromRow);
}

export function bindConversationAgentTargetInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  agentTargetId: string,
  provider: string,
  model?: string | null,
): StoredConversation | null {
  const db = getStore(projectsDir);
  const row = db
    .prepare(
      `SELECT id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at
       FROM conversations
       WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, conversationId) as ConversationRow | undefined;
  if (!row) {
    return null;
  }
  if (row.agent_target_id) {
    if (row.agent_target_id === agentTargetId && row.provider !== provider) {
      const now = Date.now();
      db.prepare(
        `UPDATE conversations
         SET provider = ?, model = ?, provider_session_id = NULL, resume_token = NULL, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).run(provider, model ?? null, now, projectId, conversationId);
      return {
        ...conversationFromRow(row),
        provider,
        model: model ?? null,
        providerSessionId: null,
        resumeToken: null,
        updatedAt: now,
      };
    }
    if (row.agent_target_id === agentTargetId && model && row.model !== model) {
      const now = Date.now();
      db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE project_id = ? AND id = ?').run(
        model,
        now,
        projectId,
        conversationId,
      );
      return {
        ...conversationFromRow(row),
        model,
        updatedAt: now,
      };
    }
    return conversationFromRow(row);
  }

  const now = Date.now();
  db.prepare('UPDATE conversations SET agent_target_id = ?, provider = ?, model = ?, updated_at = ? WHERE project_id = ? AND id = ?').run(
    agentTargetId,
    provider,
    model ?? null,
    now,
    projectId,
    conversationId,
  );
  const updated = db
    .prepare(
      `SELECT id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at
       FROM conversations
       WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, conversationId) as ConversationRow | undefined;
  return updated ? conversationFromRow(updated) : null;
}

/** @deprecated Use bindConversationAgentTargetInStore with an exact target id. */
export function bindConversationProviderInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  provider: string,
  model?: string | null,
): StoredConversation | null {
  return bindConversationAgentTargetInStore(
    projectsDir,
    projectId,
    conversationId,
    `local:${provider}`,
    provider,
    model,
  );
}

export function updateConversationResumeMetadataInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  input: {
    providerSessionId?: string | null;
    resumeToken?: string | null;
    agentTargetId?: string | null;
    provider?: string | null;
  },
): StoredConversation | null {
  const db = getStore(projectsDir);
  const existing = db
    .prepare(
      `SELECT id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at
       FROM conversations
       WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, conversationId) as ConversationRow | undefined;
  if (!existing) {
    return null;
  }
  if (
    (input.agentTargetId && existing.agent_target_id !== input.agentTargetId)
    || (input.provider && existing.provider !== input.provider)
  ) {
    return conversationFromRow(existing);
  }

  const now = Date.now();
  const providerSessionId = input.providerSessionId ?? existing.provider_session_id;
  const resumeToken = input.resumeToken ?? existing.resume_token;
  db.prepare(
    `UPDATE conversations
     SET provider_session_id = ?, resume_token = ?, updated_at = ?
     WHERE project_id = ? AND id = ?`,
  ).run(providerSessionId, resumeToken, now, projectId, conversationId);
  const updated = db
    .prepare(
      `SELECT id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at
       FROM conversations
       WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, conversationId) as ConversationRow | undefined;
  return updated ? conversationFromRow(updated) : null;
}

export function upsertMessageInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  input: UpsertMessageInput,
): StoredConversationMessage {
  const db = getStore(projectsDir);
  const tx = db.transaction(() => {
    const existingConversation = db
      .prepare('SELECT id FROM conversations WHERE project_id = ? AND id = ?')
      .get(projectId, conversationId);
    if (!existingConversation) {
      const now = Date.now();
      db.prepare(
        `INSERT INTO conversations (id, project_id, title, agent_target_id, provider, model, provider_session_id, resume_token, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      ).run(conversationId, projectId, now, now);
    }

    const current = db
      .prepare(
        `SELECT id, conversation_id, role, content, attachments_json, comment_attachments_json, context_json, events_json, run_id, run_status,
          position, created_at, updated_at, started_at, ended_at
         FROM messages
         WHERE conversation_id = ? AND id = ?`,
      )
      .get(conversationId, input.id) as MessageRow | undefined;
    const now = Date.now();
    const currentMessage = current ? messageFromRow(current) : null;
    const position =
      currentMessage?.position ??
      ((db.prepare('SELECT COALESCE(MAX(position), 0) AS value FROM messages WHERE conversation_id = ?').get(
        conversationId,
      ) as { value: number }).value + 1);
    const message: StoredConversationMessage = {
      id: input.id,
      role: input.role,
      content: input.content ?? currentMessage?.content ?? '',
      attachments: input.attachments ?? currentMessage?.attachments ?? [],
      commentAttachments: input.commentAttachments ?? currentMessage?.commentAttachments ?? [],
      context: input.context ?? currentMessage?.context ?? null,
      events: input.events ?? currentMessage?.events ?? [],
      runId: input.runId ?? currentMessage?.runId ?? null,
      runStatus: input.runStatus ?? currentMessage?.runStatus ?? null,
      position,
      createdAt: currentMessage?.createdAt ?? now,
      updatedAt: now,
      startedAt: input.startedAt ?? currentMessage?.startedAt ?? null,
      endedAt: input.endedAt ?? currentMessage?.endedAt ?? null,
    };

    db.prepare(
      `INSERT INTO messages (
        id, conversation_id, role, content, attachments_json, comment_attachments_json, context_json, events_json, run_id, run_status,
        position, created_at, updated_at, started_at, ended_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, id) DO UPDATE SET
        role = excluded.role,
        content = excluded.content,
        attachments_json = excluded.attachments_json,
        comment_attachments_json = excluded.comment_attachments_json,
        context_json = excluded.context_json,
        events_json = excluded.events_json,
        run_id = excluded.run_id,
        run_status = excluded.run_status,
        updated_at = excluded.updated_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at`,
    ).run(
      message.id,
      conversationId,
      message.role,
      message.content,
      JSON.stringify(message.attachments),
      JSON.stringify(message.commentAttachments),
      JSON.stringify(message.context),
      JSON.stringify(message.events),
      message.runId,
      message.runStatus,
      message.position,
      message.createdAt,
      message.updatedAt,
      message.startedAt,
      message.endedAt,
    );
    bumpConversation(db, conversationId, now);
    return message;
  });
  return cloneJson(tx());
}

export function listPreviewCommentsFromStore(
  projectsDir: string,
  projectId: string,
): StoredPreviewComment[] | null {
  const db = getStore(projectsDir);
  if (!projectExists(db, projectId)) {
    return null;
  }

  const rows = db
    .prepare(
      `SELECT id, project_id, file_path, target_id, selector, label, text, position_json, hover_point_json,
        html_hint, style_json, selection_kind, member_count, pod_members_json, screenshot_path, mark_kind, intent,
        note, status, created_at, updated_at
       FROM preview_comments
       WHERE project_id = ?
       ORDER BY updated_at DESC, rowid DESC`,
    )
    .all(projectId) as PreviewCommentRow[];
  return rows.map(previewCommentFromRow);
}

export function previewCommentProjectExistsInStore(projectsDir: string, projectId: string): boolean {
  return projectExists(getStore(projectsDir), projectId);
}

export function upsertPreviewCommentInStore(
  projectsDir: string,
  projectId: string,
  input: UpsertPreviewCommentInput,
): StoredPreviewComment {
  const target = normalizePreviewCommentTarget(input.target);
  const note = normalizeRequiredText(input.note, 'comment note is required');
  const db = getStore(projectsDir);
  const tx = db.transaction(() => {
    if (!projectExists(db, projectId)) {
      throw new Error('project not found');
    }

    const current = db
      .prepare(
        `SELECT id, project_id, file_path, target_id, selector, label, text, position_json, hover_point_json,
          html_hint, style_json, selection_kind, member_count, pod_members_json, screenshot_path, mark_kind, intent,
          note, status, created_at, updated_at
         FROM preview_comments
         WHERE project_id = ? AND file_path = ? AND target_id = ?
         ORDER BY updated_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(projectId, target.filePath, target.targetId) as PreviewCommentRow | undefined;
    const now = Date.now();
    const id = current?.id ?? `comment-${randomUUID().slice(0, 8)}`;
    const createdAt = current?.created_at ?? now;
    const values = [
      id,
      projectId,
      target.filePath,
      target.targetId,
      target.selector,
      target.label,
      target.text,
      JSON.stringify(target.position),
      target.hoverPoint ? JSON.stringify(target.hoverPoint) : null,
      target.htmlHint,
      target.style === null ? null : JSON.stringify(target.style),
      target.selectionKind,
      target.memberCount,
      target.podMembers === null ? null : JSON.stringify(target.podMembers),
      target.screenshotPath,
      target.markKind,
      target.intent,
      note,
      'open',
      createdAt,
      now,
    ] as const;

    if (current) {
      db.prepare(
        `UPDATE preview_comments
         SET selector = ?,
           label = ?,
           text = ?,
           position_json = ?,
           hover_point_json = ?,
           html_hint = ?,
           style_json = ?,
           selection_kind = ?,
           member_count = ?,
           pod_members_json = ?,
           screenshot_path = ?,
           mark_kind = ?,
           intent = ?,
           note = ?,
           status = ?,
           updated_at = ?
         WHERE id = ? AND project_id = ?`,
      ).run(
        target.selector,
        target.label,
        target.text,
        JSON.stringify(target.position),
        target.hoverPoint ? JSON.stringify(target.hoverPoint) : null,
        target.htmlHint,
        target.style === null ? null : JSON.stringify(target.style),
        target.selectionKind,
        target.memberCount,
        target.podMembers === null ? null : JSON.stringify(target.podMembers),
        target.screenshotPath,
        target.markKind,
        target.intent,
        note,
        'open',
        now,
        current.id,
        projectId,
      );
    } else {
      db.prepare(
        `INSERT INTO preview_comments (
          id, project_id, file_path, target_id, selector, label, text, position_json, hover_point_json,
          html_hint, style_json, selection_kind, member_count, pod_members_json, screenshot_path, mark_kind, intent,
          note, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...values);
    }
    bumpProject(db, projectId, now);

    const row = db
      .prepare(
        `SELECT id, project_id, file_path, target_id, selector, label, text, position_json, hover_point_json,
          html_hint, style_json, selection_kind, member_count, pod_members_json, screenshot_path, mark_kind, intent,
          note, status, created_at, updated_at
         FROM preview_comments
         WHERE project_id = ? AND file_path = ? AND target_id = ?`,
      )
      .get(projectId, target.filePath, target.targetId) as PreviewCommentRow;
    return previewCommentFromRow(row);
  });
  return cloneJson(tx());
}

export function updatePreviewCommentStatusInStore(
  projectsDir: string,
  projectId: string,
  commentId: string,
  status: string,
): StoredPreviewComment | null {
  if (!isPreviewCommentStatus(status)) {
    throw new Error('preview comment status is invalid');
  }

  const now = Date.now();
  const db = getStore(projectsDir);
  if (!projectExists(db, projectId)) {
    return null;
  }

  const result = db
    .prepare('UPDATE preview_comments SET status = ?, updated_at = ? WHERE project_id = ? AND id = ?')
    .run(status, now, projectId, commentId);
  if (result.changes === 0) {
    return null;
  }
  bumpProject(db, projectId, now);

  const row = db
    .prepare(
      `SELECT id, project_id, file_path, target_id, selector, label, text, position_json, hover_point_json,
        html_hint, style_json, selection_kind, member_count, pod_members_json, screenshot_path, mark_kind, intent,
        note, status, created_at, updated_at
       FROM preview_comments
       WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, commentId) as PreviewCommentRow | undefined;
  return row ? cloneJson(previewCommentFromRow(row)) : null;
}

export function deletePreviewCommentFromStore(
  projectsDir: string,
  projectId: string,
  commentId: string,
): boolean {
  const db = getStore(projectsDir);
  if (!projectExists(db, projectId)) {
    return false;
  }

  const result = db.prepare('DELETE FROM preview_comments WHERE project_id = ? AND id = ?').run(projectId, commentId);
  if (result.changes > 0) {
    bumpProject(db, projectId, Date.now());
  }
  return result.changes > 0;
}

export function appendRunEventToMessageInStore(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  messageId: string,
  event: unknown,
  timestamp: number,
): void {
  const db = getStore(projectsDir);
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, conversation_id, role, content, attachments_json, comment_attachments_json, context_json, events_json, run_id, run_status,
          position, created_at, updated_at, started_at, ended_at
         FROM messages
         WHERE conversation_id = ? AND id = ?`,
      )
      .get(conversationId, messageId) as MessageRow | undefined;
    const conversation = db.prepare('SELECT id FROM conversations WHERE project_id = ? AND id = ?').get(projectId, conversationId);
    if (!row || !conversation) {
      return;
    }

    const message = messageFromRow(row);
    message.events = [...message.events, event];
    if (isRecord(event) && event.type === 'text_delta' && typeof event.delta === 'string') {
      message.content += event.delta;
    }
    if (isRecord(event) && event.type === 'end' && isRunStatus(event.status)) {
      message.runStatus = event.status;
      message.endedAt = timestamp;
    } else if (isRecord(event) && event.type === 'error') {
      message.runStatus = 'failed';
      message.endedAt = timestamp;
    }

    db.prepare(
      `UPDATE messages
       SET content = ?, events_json = ?, run_status = ?, updated_at = ?, ended_at = ?
       WHERE conversation_id = ? AND id = ?`,
    ).run(message.content, JSON.stringify(message.events), message.runStatus, timestamp, message.endedAt, conversationId, messageId);
    bumpConversation(db, conversationId, timestamp);
  });
  tx();
}

function migrate(db: SqliteDatabase): void {
  const projectFilesColumns = db.prepare('PRAGMA table_info(project_files)').all() as Array<{ name: string }>;
  if (projectFilesColumns.some((column) => column.name === 'content')) {
    db.exec('DROP TABLE project_files');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      design_system_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      tabs_state_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_files (
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      kind TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, name),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS public_assets (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      kind TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      agent_target_id TEXT,
      provider TEXT,
      model TEXT,
      provider_session_id TEXT,
      resume_token TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      comment_attachments_json TEXT NOT NULL DEFAULT '[]',
      context_json TEXT NOT NULL DEFAULT 'null',
      events_json TEXT NOT NULL,
      run_id TEXT,
      run_status TEXT,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      PRIMARY KEY (conversation_id, id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS preview_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      target_id TEXT NOT NULL,
      selector TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      position_json TEXT NOT NULL,
      hover_point_json TEXT,
      html_hint TEXT NOT NULL,
      style_json TEXT,
      selection_kind TEXT NOT NULL,
      member_count INTEGER,
      pod_members_json TEXT,
      screenshot_path TEXT,
      mark_kind TEXT,
      intent TEXT,
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, file_path, target_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_position ON messages(conversation_id, position ASC);
    CREATE INDEX IF NOT EXISTS idx_preview_comments_scope_updated
      ON preview_comments(project_id, updated_at DESC);
  `);

  const messageColumns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === 'comment_attachments_json')) {
    db.exec("ALTER TABLE messages ADD COLUMN comment_attachments_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!messageColumns.some((column) => column.name === 'context_json')) {
    db.exec("ALTER TABLE messages ADD COLUMN context_json TEXT NOT NULL DEFAULT 'null'");
  }

  const conversationColumns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>;
  if (!conversationColumns.some((column) => column.name === 'agent_target_id')) {
    db.exec('ALTER TABLE conversations ADD COLUMN agent_target_id TEXT');
  }
  if (!conversationColumns.some((column) => column.name === 'provider')) {
    db.exec('ALTER TABLE conversations ADD COLUMN provider TEXT');
  }
  if (!conversationColumns.some((column) => column.name === 'provider_session_id')) {
    db.exec('ALTER TABLE conversations ADD COLUMN provider_session_id TEXT');
  }
  if (!conversationColumns.some((column) => column.name === 'resume_token')) {
    db.exec('ALTER TABLE conversations ADD COLUMN resume_token TEXT');
  }
  if (!conversationColumns.some((column) => column.name === 'model')) {
    db.exec('ALTER TABLE conversations ADD COLUMN model TEXT');
  }

  const previewCommentColumns = db.prepare('PRAGMA table_info(preview_comments)').all() as Array<{ name: string }>;
  if (!previewCommentColumns.some((column) => column.name === 'intent')) {
    db.exec('ALTER TABLE preview_comments ADD COLUMN intent TEXT');
  }
  if (!previewCommentColumns.some((column) => column.name === 'hover_point_json')) {
    db.exec('ALTER TABLE preview_comments ADD COLUMN hover_point_json TEXT');
  }
  migratePreviewCommentsToProjectScope(db);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_comments_project_target
      ON preview_comments(project_id, file_path, target_id);
    CREATE INDEX IF NOT EXISTS idx_preview_comments_scope_updated
      ON preview_comments(project_id, updated_at DESC);
  `);
}

function migratePreviewCommentsToProjectScope(db: SqliteDatabase): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'preview_comments'")
    .get() as { sql?: string } | undefined;
  const tableSql = row?.sql ?? '';
  if (!/\bconversation_id\b/i.test(tableSql) && !/REFERENCES\s+conversations/i.test(tableSql) && !/UNIQUE\s*\(\s*project_id\s*,\s*conversation_id\s*,\s*file_path\s*,\s*target_id\s*\)/i.test(tableSql)) {
    return;
  }

  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE preview_comments_next (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        target_id TEXT NOT NULL,
        selector TEXT NOT NULL,
        label TEXT NOT NULL,
        text TEXT NOT NULL,
        position_json TEXT NOT NULL,
        hover_point_json TEXT,
        html_hint TEXT NOT NULL,
        style_json TEXT,
        selection_kind TEXT NOT NULL,
        member_count INTEGER,
        pod_members_json TEXT,
        screenshot_path TEXT,
        mark_kind TEXT,
        intent TEXT,
        note TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, file_path, target_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      INSERT INTO preview_comments_next (
        id, project_id, file_path, target_id, selector, label, text, position_json, hover_point_json,
        html_hint, style_json, selection_kind, member_count, pod_members_json, screenshot_path, mark_kind, intent,
        note, status, created_at, updated_at
      )
      SELECT
        current.id,
        current.project_id,
        current.file_path,
        current.target_id,
        current.selector,
        current.label,
        current.text,
        current.position_json,
        current.hover_point_json,
        current.html_hint,
        current.style_json,
        current.selection_kind,
        current.member_count,
        current.pod_members_json,
        current.screenshot_path,
        current.mark_kind,
        current.intent,
        current.note,
        current.status,
        current.created_at,
        current.updated_at
      FROM preview_comments AS current
      WHERE NOT EXISTS (
        SELECT 1
        FROM preview_comments AS newer
        WHERE newer.project_id = current.project_id
          AND newer.file_path = current.file_path
          AND newer.target_id = current.target_id
          AND (
            newer.updated_at > current.updated_at
            OR (newer.updated_at = current.updated_at AND newer.rowid > current.rowid)
          )
      );

      DROP TABLE preview_comments;
      ALTER TABLE preview_comments_next RENAME TO preview_comments;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function projectFromRow(row: ProjectRow): StoredProject {
  return {
    id: row.id,
    designSystemId: row.design_system_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tabsState: parseJson(row.tabs_state_json, { tabs: [], activeTabKey: null }),
    metadata: parseJson(row.metadata_json, {}),
  };
}

function projectToSummary(project: StoredProject, coverUrl?: string): ProjectSummary {
  const title = normalizeText(readString(project.metadata.title));
  const prompt = normalizeText(readString(project.metadata.prompt));
  const projectKind = normalizeProjectKind(readString(project.metadata.projectKind));
  return {
    id: project.id,
    title: title ?? prompt ?? project.id,
    prompt: prompt ?? title ?? '',
    projectKind,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...(coverUrl ? { coverUrl } : {}),
  };
}

function selectProjectCoverUrl(db: SqliteDatabase, project: StoredProject): string | undefined {
  const rows = db
    .prepare(
      `SELECT name, path, size, mime, kind, updated_at
       FROM project_files
       WHERE project_id = ?
       ORDER BY updated_at DESC, name ASC`,
    )
    .all(project.id) as ProjectFileRow[];
  const projectFiles = rows.map(fileFromRow);
  if (!hasActiveHtmlProjectFile(project.tabsState, projectFiles)) {
    return undefined;
  }

  const imageFiles = projectFiles.filter(
    (file) => file.kind === 'image' && file.mime.startsWith('image/') && file.size > 0,
  );
  if (imageFiles.length === 0) {
    return undefined;
  }

  const preferred = imageFiles.find((file) => isPreferredCoverImageName(file.name)) ?? imageFiles[0];
  return `/api/projects/${encodeURIComponent(project.id)}/files/${encodeURIComponent(preferred.name)}`;
}

function hasActiveHtmlProjectFile(tabsState: ProjectTabsState, files: StoredProjectFile[]): boolean {
  const activeTab = tabsState.tabs.find((tab) => tab.key === tabsState.activeTabKey);
  if (!activeTab || activeTab.kind !== 'file') {
    return false;
  }

  return files.some((file) => file.name === activeTab.name && file.kind === 'html');
}

function isPreferredCoverImageName(name: string): boolean {
  return /(?:^|[-_.\s/])(preview|cover|thumbnail|thumb|screenshot|design)(?:[-_.\s/]|$)/i.test(name);
}

function fileFromRow(row: ProjectFileRow): StoredProjectFile {
  return {
    name: row.name,
    path: row.path,
    size: row.size,
    mtime: new Date(row.updated_at).toISOString(),
    kind: row.kind,
    mime: row.mime,
  };
}

function conversationFromRow(row: ConversationRow): StoredConversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    agentTargetId: row.agent_target_id,
    provider: row.provider,
    model: row.model,
    providerSessionId: row.provider_session_id,
    resumeToken: row.resume_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row: MessageRow): StoredConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachments: parseJson(row.attachments_json, []),
    commentAttachments: parseJson(row.comment_attachments_json, []),
    context: parseJson(row.context_json, null),
    events: parseJson(row.events_json, []),
    runId: row.run_id,
    runStatus: isRunStatus(row.run_status) ? row.run_status : null,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function previewCommentFromRow(row: PreviewCommentRow): StoredPreviewComment {
  return {
    id: row.id,
    projectId: row.project_id,
    target: {
      filePath: row.file_path,
      targetId: row.target_id,
      selector: row.selector,
      label: row.label,
      text: row.text,
      position: parseJson(row.position_json, { x: 0, y: 0, width: 0, height: 0 }),
      ...(row.hover_point_json === null ? {} : { hoverPoint: parseJson(row.hover_point_json, undefined) }),
      htmlHint: row.html_hint,
      style: row.style_json === null ? null : parseJson(row.style_json, null),
      selectionKind: normalizeStoredSelectionKind(row.selection_kind),
      memberCount: row.member_count,
      podMembers: row.pod_members_json === null ? null : parseJson(row.pod_members_json, []),
      screenshotPath: row.screenshot_path,
      markKind: row.mark_kind,
      intent: row.intent,
    },
    note: row.note,
    status: isPreviewCommentStatus(row.status) ? row.status : 'open',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePreviewCommentTarget(input: UpsertPreviewCommentInput['target']): PreviewCommentTarget {
  if (!isRecord(input)) {
    throw new Error('comment target is required');
  }

  const selectionKind = normalizeSelectionKind(input.selectionKind);
  const screenshotPath = normalizeOptionalText(input.screenshotPath, 512);
  const visualMarkKind =
    selectionKind === 'visual' ? normalizeRequiredText(input.markKind, 'comment markKind is required', 64) : null;
  const visualIntent = selectionKind === 'visual' ? normalizeOptionalText(input.intent, 200) : null;
  const podMemberCount = selectionKind === 'pod' ? normalizeNullableInteger(input.memberCount) : null;
  const podMembers = selectionKind === 'pod' ? normalizePodMembers(input.podMembers) : null;

  return {
    filePath: normalizeRequiredText(input.filePath, 'comment filePath is required', 512),
    targetId: normalizeRequiredText(input.targetId, 'comment targetId is required', 160),
    selector: normalizeRequiredText(input.selector, 'comment selector is required', 512),
    label: normalizeRequiredText(input.label, 'comment label is required', 160),
    text: normalizeOptionalText(input.text, 160) ?? '',
    position: normalizePosition(input.position),
    hoverPoint: normalizePoint(input.hoverPoint),
    htmlHint: normalizeOptionalText(input.htmlHint, 180) ?? '',
    style: normalizeCommentStyle(input.style),
    selectionKind,
    memberCount: podMemberCount,
    podMembers,
    screenshotPath,
    markKind: visualMarkKind,
    intent: visualIntent,
  };
}

function normalizeSelectionKind(value: unknown): PreviewCommentSelectionKind {
  if (value === undefined || value === null) {
    return 'element';
  }
  if (typeof value !== 'string') {
    throw new Error('comment selectionKind is invalid');
  }

  const trimmed = value.trim();
  if (!PREVIEW_COMMENT_SELECTION_KIND_SET.has(trimmed as PreviewCommentSelectionKind)) {
    throw new Error('comment selectionKind is invalid');
  }
  return trimmed as PreviewCommentSelectionKind;
}

function normalizeStoredSelectionKind(value: unknown): PreviewCommentSelectionKind {
  return PREVIEW_COMMENT_SELECTION_KIND_SET.has(value as PreviewCommentSelectionKind)
    ? (value as PreviewCommentSelectionKind)
    : 'element';
}

function normalizeRequiredText(value: unknown, message: string, maxLength = 2000): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed.slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizePosition(value: unknown): PreviewCommentPosition {
  const input = isRecord(value) ? value : {};
  return {
    x: normalizePositionNumber(input.x),
    y: normalizePositionNumber(input.y),
    width: normalizePositionNumber(input.width),
    height: normalizePositionNumber(input.height),
  };
}

function normalizePoint(value: unknown): PreviewCommentPoint | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.x !== 'number' || !Number.isFinite(value.x)) {
    return undefined;
  }
  if (typeof value.y !== 'number' || !Number.isFinite(value.y)) {
    return undefined;
  }
  return { x: value.x, y: value.y };
}

function normalizePositionNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeNullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

const COMMENT_STYLE_KEYS = new Set([
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
const MAX_COMMENT_STYLE_KEYS_TO_SCAN = 100;
const MAX_POD_MEMBER_ITEMS_TO_SCAN = 100;
const MAX_POD_MEMBERS = 12;

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
    if (scanned > MAX_COMMENT_STYLE_KEYS_TO_SCAN) {
      break;
    }
    if (!COMMENT_STYLE_KEYS.has(key)) {
      continue;
    }

    const rawValue = value[key];
    const text = normalizeOptionalText(rawValue, 160);
    if (text) {
      style[key] = text;
    }
  }

  return Object.keys(style).length > 0 ? style : null;
}

function normalizePodMembers(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const members: unknown[] = [];
  for (const item of value.slice(0, MAX_POD_MEMBER_ITEMS_TO_SCAN)) {
    if (members.length >= MAX_POD_MEMBERS) {
      break;
    }

    const member = normalizePodMember(item);
    if (member) {
      members.push(member);
    }
  }

  return members;
}

function normalizePodMember(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const targetId = normalizeOptionalText(value.targetId, 160);
  const selector = normalizeOptionalText(value.selector, 512);
  const label = normalizeOptionalText(value.label, 160);
  const text = normalizeOptionalText(value.text, 160);
  const htmlHint = normalizeOptionalText(value.htmlHint, 180);
  if (!targetId || !selector || !label || !text || !htmlHint) {
    return null;
  }

  const member: Record<string, unknown> = {
    targetId,
    selector,
    label,
    text,
    position: normalizePosition(value.position),
    htmlHint,
  };
  const style = normalizeCommentStyle(value.style);
  if (style) {
    member.style = style;
  }
  return member;
}

function conversationBelongsToProject(db: SqliteDatabase, projectId: string, conversationId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM conversations WHERE project_id = ? AND id = ?').get(projectId, conversationId));
}

function projectExists(db: SqliteDatabase, projectId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId));
}

function bumpConversation(db: SqliteDatabase, conversationId: string, timestamp: number): void {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(timestamp, conversationId);
}

function bumpProject(db: SqliteDatabase, projectId: string, timestamp: number): void {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, projectId);
}

function bumpConversationAndProject(
  db: SqliteDatabase,
  conversationId: string,
  projectId: string,
  timestamp: number,
): void {
  bumpConversation(db, conversationId, timestamp);
  bumpProject(db, projectId, timestamp);
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeText(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function normalizeProjectKind(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 64 ? trimmed : 'prototype';
}

function getFileKind(name: string): ProjectFileKind {
  const extension = path.extname(name).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.css') return 'css';
  if (extension === '.js' || extension === '.mjs' || extension === '.ts' || extension === '.tsx') return 'code';
  if (extension === '.json') return 'json';
  if (extension === '.md' || extension === '.markdown') return 'text';
  if (
    extension === '.png' ||
    extension === '.jpg' ||
    extension === '.jpeg' ||
    extension === '.gif' ||
    extension === '.webp' ||
    extension === '.svg'
  ) {
    return 'image';
  }
  return 'file';
}

function getFileMime(name: string, kind: ProjectFileKind): string {
  const extension = path.extname(name).toLowerCase();
  if (kind === 'html') return 'text/html';
  if (extension === '.css') return 'text/css';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript';
  if (extension === '.ts' || extension === '.tsx') return 'text/plain';
  if (extension === '.json') return 'application/json';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  return kind === 'file' ? 'application/octet-stream' : 'text/plain';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'canceled';
}

export function isPreviewCommentStatus(value: unknown): value is PreviewCommentStatus {
  return typeof value === 'string' && PREVIEW_COMMENT_STATUS_SET.has(value as PreviewCommentStatus);
}
