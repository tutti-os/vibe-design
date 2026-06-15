import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindConversationProviderInStore,
  createConversationInStore,
  deleteConversationFromStore,
  deletePreviewCommentFromStore,
  getProjectFromStore,
  getStore,
  listProjectFilesFromStore,
  listProjectSummariesFromStore,
  listConversationMessagesFromStore,
  listConversationsFromStore,
  listPreviewCommentsFromStore,
  sqlitePathForProjectsDir,
  updateConversationResumeMetadataInStore,
  upsertMessageInStore,
  upsertPreviewCommentInStore,
  updatePreviewCommentStatusInStore,
  upsertProjectFileInStore,
  writeProjectToStore,
  type StoredProject,
} from './sqlite-store';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProjectsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibe-design-store-'));
  tempRoots.push(root);
  return join(root, 'projects');
}

async function createSqliteFile(filePath: string, schema: string): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(schema);
  await writeFile(filePath, Buffer.from(db.export()));
  db.close();
}

function project(id: string): StoredProject {
  const now = Date.now();
  return {
    id,
    designSystemId: null,
    createdAt: now,
    updatedAt: now,
    tabsState: { tabs: [], activeTabKey: null },
    metadata: {},
  };
}

function writeConversation(projectsDir: string, projectId = 'project-a', conversationId = 'conversation-a'): void {
  writeProjectToStore(projectsDir, project(projectId));
  createConversationInStore(projectsDir, projectId, conversationId, 'Conversation');
}

async function waitForNextMillisecond(): Promise<void> {
  const started = Date.now();
  while (Date.now() <= started) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function readParentUpdatedAt(projectsDir: string, projectId = 'project-a', conversationId = 'conversation-a') {
  const project = getProjectFromStore(projectsDir, projectId);
  const conversation = listConversationsFromStore(projectsDir, projectId).find((entry) => entry.id === conversationId);
  if (!project || !conversation) {
    throw new Error('expected project and conversation');
  }

  return { project: project.updatedAt, conversation: conversation.updatedAt };
}

function commentInput(note: string, overrides: Partial<Parameters<typeof upsertPreviewCommentInStore>[2]['target']> = {}) {
  return {
    note,
    target: {
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      text: 'The main landing page heading',
      position: { x: 12.8, y: -5, width: 200.2, height: 44.9 },
      htmlHint: '<h1 id="hero-title">The main landing page heading</h1>',
      style: { color: 'red' },
      selectionKind: 'element',
      memberCount: 2,
      podMembers: ['hero-title', 'hero-subtitle'],
      screenshotPath: 'screenshots/hero.png',
      markKind: 'box',
      ...overrides,
    },
  };
}

describe('sqlite preview comments', () => {
  it('classifies markdown project files as readable text', async () => {
    const projectsDir = await createProjectsDir();
    writeProjectToStore(projectsDir, project('project-a'));

    upsertProjectFileInStore(projectsDir, 'project-a', {
      name: 'DESIGN.md',
      path: 'assets/DESIGN.md',
      size: 24,
    });

    expect(listProjectFilesFromStore(projectsDir, 'project-a')).toMatchObject([
      {
        name: 'DESIGN.md',
        path: 'assets/DESIGN.md',
        kind: 'text',
        mime: 'text/markdown',
      },
    ]);
  });

  it('includes a project cover image in project summaries', async () => {
    const projectsDir = await createProjectsDir();
    writeProjectToStore(projectsDir, {
      ...project('project-a'),
      tabsState: {
        tabs: [{ kind: 'file', name: 'index.html', key: 'file:index.html' }],
        activeTabKey: 'file:index.html',
      },
      metadata: { title: 'Project A', prompt: 'Project A' },
    });
    upsertProjectFileInStore(projectsDir, 'project-a', {
      name: 'index.html',
      path: 'assets/index.html',
      size: 20,
      mime: 'text/html',
      kind: 'html',
    });
    upsertProjectFileInStore(projectsDir, 'project-a', {
      name: 'notes.txt',
      path: 'assets/notes.txt',
      size: 12,
      mime: 'text/plain',
      kind: 'file',
    });
    upsertProjectFileInStore(projectsDir, 'project-a', {
      name: 'homepage-preview.png',
      path: 'assets/homepage-preview.png',
      size: 24,
      mime: 'image/png',
      kind: 'image',
    });

    expect(listProjectSummariesFromStore(projectsDir)).toEqual([
      expect.objectContaining({
        id: 'project-a',
        coverUrl: '/api/projects/project-a/files/homepage-preview.png',
      }),
    ]);
  });

  it('stores a conversation provider once and updates resume metadata for restore', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    const bound = bindConversationProviderInStore(projectsDir, 'project-a', 'conversation-a', 'claude');
    expect(bound).toMatchObject({ provider: 'claude', providerSessionId: null, resumeToken: null });

    const rebound = bindConversationProviderInStore(projectsDir, 'project-a', 'conversation-a', 'codex');
    expect(rebound).toMatchObject({ provider: 'claude' });

    const updated = updateConversationResumeMetadataInStore(projectsDir, 'project-a', 'conversation-a', {
      providerSessionId: 'claude-session-1',
      resumeToken: 'resume-token-1',
    });

    expect(updated).toMatchObject({
      provider: 'claude',
      providerSessionId: 'claude-session-1',
      resumeToken: 'resume-token-1',
    });
    expect(listConversationsFromStore(projectsDir, 'project-a')[0]).toMatchObject({
      provider: 'claude',
      providerSessionId: 'claude-session-1',
      resumeToken: 'resume-token-1',
    });
  });

  it('deletes a conversation with its messages while keeping project preview comments', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir, 'project-a', 'conversation-a');
    createConversationInStore(projectsDir, 'project-a', 'conversation-b', 'Conversation B');
    upsertMessageInStore(projectsDir, 'project-a', 'conversation-a', {
      id: 'message-a',
      role: 'user',
      content: 'Delete this',
    });
    upsertMessageInStore(projectsDir, 'project-a', 'conversation-b', {
      id: 'message-b',
      role: 'user',
      content: 'Keep this',
    });
    upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('Delete comment'));

    expect(deleteConversationFromStore(projectsDir, 'project-a', 'conversation-a')).toBe('deleted');

    expect(listConversationsFromStore(projectsDir, 'project-a').map((conversation) => conversation.id)).toEqual([
      'conversation-b',
    ]);
    expect(listConversationMessagesFromStore(projectsDir, 'project-a', 'conversation-a')).toBeNull();
    expect(listConversationMessagesFromStore(projectsDir, 'project-a', 'conversation-b')).toEqual([
      expect.objectContaining({ id: 'message-b', content: 'Keep this' }),
    ]);
    expect(listPreviewCommentsFromStore(projectsDir, 'project-missing')).toBeNull();
    expect(listPreviewCommentsFromStore(projectsDir, 'project-a')).toEqual([
      expect.objectContaining({ note: 'Delete comment' }),
    ]);
    expect(deleteConversationFromStore(projectsDir, 'project-a', 'conversation-a')).toBe('not_found');
    expect(deleteConversationFromStore(projectsDir, 'project-a', 'conversation-b')).toBe('last_conversation');
    expect(listConversationsFromStore(projectsDir, 'project-a').map((conversation) => conversation.id)).toEqual([
      'conversation-b',
    ]);
  });

  it('upserts preview comments by scoped target while preserving id and createdAt', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    const created = upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('First note'));
    const updated = upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('Updated note'));

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    expect(updated.note).toBe('Updated note');
    expect(updated.status).toBe('open');
    expect(updated.target.position).toEqual({ x: 13, y: 0, width: 200, height: 45 });
  });

  it('persists preview comment hover point for point-based restore', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    const created = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Point note', {
        targetId: 'hero-title@30-32',
        hoverPoint: { x: 30.4, y: 31.6 },
      } as Partial<Parameters<typeof upsertPreviewCommentInStore>[2]['target']>),
    );
    const [loaded] = listPreviewCommentsFromStore(projectsDir, 'project-a') ?? [];

    expect(created.target.hoverPoint).toEqual({ x: 30.4, y: 31.6 });
    expect(loaded?.target.hoverPoint).toEqual({ x: 30.4, y: 31.6 });
  });

  it('normalizes nested preview comment style and pod members before persisting', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    const created = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Normalize nested fields', {
        selectionKind: 'pod',
        memberCount: 3.7,
        style: {
          color: ' red ',
          backgroundColor: 12,
          fontSize: '16px'.repeat(80),
          unsafe: 'drop me',
        },
        podMembers: [
          {
            targetId: 'child-1',
            selector: '#child-1',
            label: 'Child 1',
            text: 'Child text'.repeat(30),
            position: { x: 2.2, y: -4, width: 50.5, height: 20.2 },
            htmlHint: '<span>Child text</span>'.repeat(20),
            style: { color: ' blue ', fontWeight: 700, lineHeight: '1.2' },
          },
          { targetId: '', selector: '#bad', label: 'Bad', text: 'Bad', position: {}, htmlHint: '<span>Bad</span>' },
          ...Array.from({ length: 20 }, (_, index) => ({
            targetId: `extra-${index}`,
            selector: `#extra-${index}`,
            label: `Extra ${index}`,
            text: 'Extra',
            position: { x: index, y: index, width: 10, height: 10 },
            htmlHint: '<span>Extra</span>',
          })),
        ],
      }),
    );

    expect(created.target.memberCount).toBe(4);
    expect(created.target.style).toEqual({
      color: 'red',
      fontSize: '16px'.repeat(80).slice(0, 160),
    });
    expect(created.target.podMembers).toHaveLength(12);
    expect(created.target.podMembers?.[0]).toEqual({
      targetId: 'child-1',
      selector: '#child-1',
      label: 'Child 1',
      text: 'Child text'.repeat(30).slice(0, 160),
      position: { x: 2, y: 0, width: 51, height: 20 },
      htmlHint: '<span>Child text</span>'.repeat(20).slice(0, 180),
      style: { color: 'blue', lineHeight: '1.2' },
    });
    expect(created.target.podMembers?.some((member) => (member as { targetId?: unknown }).targetId === '')).toBe(false);
  });

  it('normalizes preview comment target fields by selection kind', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    const element = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Element target', {
        selectionKind: undefined,
        memberCount: 2,
        podMembers: [
          {
            targetId: 'child',
            selector: '#child',
            label: 'Child',
            text: 'Child',
            position: { x: 1, y: 1, width: 1, height: 1 },
            htmlHint: '<span>Child</span>',
          },
        ],
        screenshotPath: 'screenshots/element.png',
        markKind: 'box',
      }),
    );
    expect(element.target).toMatchObject({
      selectionKind: 'element',
      memberCount: null,
      podMembers: null,
      screenshotPath: 'screenshots/element.png',
      markKind: null,
    });

    const pod = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Pod target', {
        targetId: 'pod-target',
        selector: '#pod-target',
        selectionKind: 'pod',
        memberCount: 1.2,
        podMembers: [
          {
            targetId: 'pod-child',
            selector: '#pod-child',
            label: 'Pod Child',
            text: 'Child',
            position: { x: 1, y: 1, width: 1, height: 1 },
            htmlHint: '<span>Child</span>',
          },
        ],
        screenshotPath: 'screenshots/pod.png',
        markKind: 'box',
      }),
    );
    expect(pod.target).toMatchObject({
      selectionKind: 'pod',
      memberCount: 1,
      screenshotPath: 'screenshots/pod.png',
      markKind: null,
    });
    expect(pod.target.podMembers).toHaveLength(1);

    const visual = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Visual target', {
        targetId: 'visual-target',
        selector: '#visual-target',
        selectionKind: 'visual',
        memberCount: 3,
        podMembers: [
          {
            targetId: 'visual-child',
            selector: '#visual-child',
            label: 'Visual Child',
            text: 'Child',
            position: { x: 1, y: 1, width: 1, height: 1 },
            htmlHint: '<span>Child</span>',
          },
        ],
        screenshotPath: ' screenshots/visual.png ',
        markKind: ' box ',
      }),
    );
    expect(visual.target).toMatchObject({
      selectionKind: 'visual',
      memberCount: null,
      podMembers: null,
      screenshotPath: 'screenshots/visual.png',
      markKind: 'box',
    });
  });

  it('persists visual intent and clears non-visual intent', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);
    const visualTarget = {
      targetId: 'visual-target',
      selector: '#visual-target',
      selectionKind: 'visual',
      screenshotPath: 'screenshots/visual.png',
      markKind: 'click',
      intent: `  ${'Tune this visual region. '.repeat(20)}  `,
    } satisfies Partial<Parameters<typeof upsertPreviewCommentInStore>[2]['target']> & { intent: string };
    const elementTarget = {
      targetId: 'element-target',
      selector: '#element-target',
      selectionKind: 'element',
      intent: 'Drop this element intent',
    } satisfies Partial<Parameters<typeof upsertPreviewCommentInStore>[2]['target']> & { intent: string };

    const visual = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Visual target with intent', visualTarget),
    );
    const element = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Element target clears intent', elementTarget),
    );

    expect(visual.target.intent).toBe('Tune this visual region. '.repeat(20).trim().slice(0, 200));
    expect(element.target.intent).toBeNull();
    const listed = listPreviewCommentsFromStore(projectsDir, 'project-a');
    expect(listed?.find((comment) => comment.id === visual.id)?.target.intent).toBe(visual.target.intent);
    expect(listed?.find((comment) => comment.id === element.id)?.target.intent).toBeNull();
  });

  it('rejects invalid preview comment selection kinds', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    expect(() =>
      upsertPreviewCommentInStore(
        projectsDir,
        'project-a',
        commentInput('Invalid kind', { selectionKind: 'group' }),
      ),
    ).toThrow('comment selectionKind is invalid');
  });

  it('rejects visual preview comments without markKind', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    expect(() =>
      upsertPreviewCommentInStore(
        projectsDir,
        'project-a',
        commentInput('Visual target missing mark kind', {
          targetId: 'visual-target',
          selector: '#visual-target',
          selectionKind: 'visual',
          markKind: '   ',
        }),
      ),
    ).toThrow('comment markKind is required');
  });

  it('bounds preview comment nested style and pod member scans', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    const created = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Bound nested scans', {
        selectionKind: 'pod',
        style: {
          ...Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`unknown${index}`, 'drop me'])),
          color: 'red',
        },
        podMembers: [
          ...Array.from({ length: 101 }, (_, index) => ({
            targetId: '',
            selector: `#bad-${index}`,
            label: 'Bad',
            text: 'Bad',
            position: { x: 1, y: 1, width: 1, height: 1 },
            htmlHint: '<span>Bad</span>',
          })),
          {
            targetId: 'valid-after-scan-limit',
            selector: '#valid-after-scan-limit',
            label: 'Valid',
            text: 'Valid',
            position: { x: 1, y: 1, width: 1, height: 1 },
            htmlHint: '<span>Valid</span>',
          },
        ],
      }),
    );

    expect(created.target.style).toBeNull();
    expect(created.target.podMembers).toEqual([]);
  });

  it('lists preview comments newest first', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Older note', { targetId: 'first', selector: '#first', label: 'First' }),
    );
    const newer = upsertPreviewCommentInStore(
      projectsDir,
      'project-a',
      commentInput('Newer note', { targetId: 'second', selector: '#second', label: 'Second' }),
    );

    const comments = listPreviewCommentsFromStore(projectsDir, 'project-a');

    expect(comments).not.toBeNull();
    expect(comments).toHaveLength(2);
    expect(comments?.[0]?.id).toBe(newer.id);
    expect(comments?.map((comment) => comment.note)).toEqual(['Newer note', 'Older note']);
  });

  it('persists commentAttachments separately from file attachments', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    upsertMessageInStore(projectsDir, 'project-a', 'conversation-a', {
      id: 'user-1',
      role: 'user',
      content: 'Please update this',
      attachments: [{ kind: 'image', name: 'reference.png' }],
      commentAttachments: [{ commentId: 'comment-1', note: 'Tighten spacing' }],
    });

    const messages = listConversationMessagesFromStore(projectsDir, 'project-a', 'conversation-a');

    expect(messages?.[0]).toMatchObject({
      attachments: [{ kind: 'image', name: 'reference.png' }],
      commentAttachments: [{ commentId: 'comment-1', note: 'Tighten spacing' }],
    });
  });

  it('persists message context for selected skill display', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    upsertMessageInStore(projectsDir, 'project-a', 'conversation-a', {
      id: 'user-1',
      role: 'user',
      content: 'Please use this skill',
      context: {
        selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      },
    });

    const messages = listConversationMessagesFromStore(projectsDir, 'project-a', 'conversation-a');

    expect(messages?.[0]?.context).toEqual({
      selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
    });
  });

  it('shares preview comments across conversations by project file target', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir, 'project-a', 'conversation-a');
    createConversationInStore(projectsDir, 'project-a', 'conversation-b', 'Follow-up');

    const created = upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('First note'));
    const updated = upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('Updated note'));

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.note).toBe('Updated note');
    expect(listPreviewCommentsFromStore(projectsDir, 'project-a')?.map((comment) => comment.note)).toEqual(['Updated note']);
  });

  it('updates status and deletes only project-scoped preview comments', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir, 'project-a', 'conversation-a');
    createConversationInStore(projectsDir, 'project-a', 'conversation-b', 'Follow-up');
    writeConversation(projectsDir, 'project-b', 'conversation-project-b');
    const comment = upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('Track this'));

    expect(updatePreviewCommentStatusInStore(projectsDir, 'project-b', comment.id, 'resolved')).toBeNull();
    const updated = updatePreviewCommentStatusInStore(projectsDir, 'project-a', comment.id, 'resolved');
    expect(updated?.status).toBe('resolved');

    expect(deletePreviewCommentFromStore(projectsDir, 'project-b', comment.id)).toBe(false);
    expect(deletePreviewCommentFromStore(projectsDir, 'project-a', comment.id)).toBe(true);
    expect(listPreviewCommentsFromStore(projectsDir, 'project-a')).toEqual([]);
  });

  it('bumps only the parent project timestamp when preview comments mutate', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);
    const initial = readParentUpdatedAt(projectsDir);

    await waitForNextMillisecond();
    const comment = upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('Track this'));
    const afterCreate = readParentUpdatedAt(projectsDir);
    expect(afterCreate.conversation).toBe(initial.conversation);
    expect(afterCreate.project).toBeGreaterThan(initial.project);

    await waitForNextMillisecond();
    expect(updatePreviewCommentStatusInStore(projectsDir, 'project-a', comment.id, 'resolved')).not.toBeNull();
    const afterStatus = readParentUpdatedAt(projectsDir);
    expect(afterStatus.conversation).toBe(afterCreate.conversation);
    expect(afterStatus.project).toBeGreaterThan(afterCreate.project);

    await waitForNextMillisecond();
    expect(deletePreviewCommentFromStore(projectsDir, 'project-a', comment.id)).toBe(true);
    const afterDelete = readParentUpdatedAt(projectsDir);
    expect(afterDelete.conversation).toBe(afterStatus.conversation);
    expect(afterDelete.project).toBeGreaterThan(afterStatus.project);
  });

  it('rejects missing project scopes for preview comments', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir, 'project-a', 'conversation-a');
    writeConversation(projectsDir, 'project-b', 'conversation-b');
    const comment = upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('Track this'));

    expect(listPreviewCommentsFromStore(projectsDir, 'project-missing')).toBeNull();
    expect(() =>
      upsertPreviewCommentInStore(projectsDir, 'project-missing', commentInput('Wrong scope')),
    ).toThrow('project not found');
    expect(updatePreviewCommentStatusInStore(projectsDir, 'project-missing', comment.id, 'resolved')).toBeNull();
    expect(deletePreviewCommentFromStore(projectsDir, 'project-missing', comment.id)).toBe(false);
  });

  it('rejects blank notes and invalid statuses', async () => {
    const projectsDir = await createProjectsDir();
    writeConversation(projectsDir);

    expect(() => upsertPreviewCommentInStore(projectsDir, 'project-a', commentInput('   '))).toThrow(
      'comment note is required',
    );
    expect(() =>
      updatePreviewCommentStatusInStore(projectsDir, 'project-a', 'missing-comment', 'closed'),
    ).toThrow('preview comment status is invalid');
  });

  it('adds message context and comment attachments columns when migrating an existing messages table', async () => {
    const projectsDir = await createProjectsDir();
    await mkdir(join(projectsDir, '..'), { recursive: true });
    await createSqliteFile(
      sqlitePathForProjectsDir(projectsDir),
      `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        design_system_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        tabs_state_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments_json TEXT NOT NULL,
        events_json TEXT NOT NULL,
        run_id TEXT,
        run_status TEXT,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        PRIMARY KEY (conversation_id, id)
      );
    `,
    );

    const columns = getStore(projectsDir).prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['comment_attachments_json', 'context_json']));
  });

  it('adds missing preview comment columns when migrating an existing table', async () => {
    const projectsDir = await createProjectsDir();
    await mkdir(join(projectsDir, '..'), { recursive: true });
    await createSqliteFile(
      sqlitePathForProjectsDir(projectsDir),
      `
      CREATE TABLE preview_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        target_id TEXT NOT NULL,
        selector TEXT NOT NULL,
        label TEXT NOT NULL,
        text TEXT NOT NULL,
        position_json TEXT NOT NULL,
        html_hint TEXT NOT NULL,
        style_json TEXT,
        selection_kind TEXT NOT NULL,
        member_count INTEGER,
        pod_members_json TEXT,
        screenshot_path TEXT,
        mark_kind TEXT,
        note TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
    );

    const columns = getStore(projectsDir).prepare('PRAGMA table_info(preview_comments)').all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['intent', 'hover_point_json']));
  });
});
