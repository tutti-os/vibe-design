import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';

let server: Server | undefined;
const tempRoots: string[] = [];

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server?.listening) {
      server = undefined;
      resolve();
      return;
    }

    server.close((error) => {
      server = undefined;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function startApi(): Promise<{ url: (path: string) => string }> {
  const runtimeDir = await mkdtemp(join(tmpdir(), 'vibe-design-comments-api-'));
  tempRoots.push(runtimeDir);
  const candidate = createServer({ runtimeDir });
  server = candidate;

  const port = await new Promise<number>((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(0, '127.0.0.1', () => {
      const address = candidate.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });

  return { url: (path: string) => `http://127.0.0.1:${port}${path}` };
}

async function createProject(api: { url: (path: string) => string }): Promise<{ projectId: string }> {
  const response = await fetch(api.url('/api/projects'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Build a landing page', projectKind: 'prototype' }),
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { project: { id: string } };
  return { projectId: payload.project.id };
}

async function createConversation(api: { url: (path: string) => string }, projectId: string): Promise<string> {
  const response = await fetch(api.url(`/api/projects/${projectId}/conversations`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Follow-up' }),
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { conversation: { id: string } };
  return payload.conversation.id;
}

function commentPath(projectId: string, commentId?: string): string {
  const base = `/api/projects/${projectId}/comments`;
  return commentId ? `${base}/${commentId}` : base;
}

function createBody(note: string) {
  return {
    note,
    target: {
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      text: 'The main landing page heading',
      position: { x: 4.4, y: 10.5, width: 320.2, height: 80.9 },
      htmlHint: '<h1 id="hero-title">The main landing page heading</h1>',
    },
  };
}

describe('comment routes', () => {
  it('creates, lists, patches, and deletes preview comments', async () => {
    const api = await startApi();
    const { projectId } = await createProject(api);

    const createResponse = await fetch(api.url(commentPath(projectId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Tighten this heading')),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { comment: { id: string; note: string; status: string } };
    expect(created.comment).toMatchObject({ note: 'Tighten this heading', status: 'open' });

    const listResponse = await fetch(api.url(commentPath(projectId)));
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as { comments: Array<{ id: string }> };
    expect(listed.comments.map((comment) => comment.id)).toEqual([created.comment.id]);

    const patchResponse = await fetch(api.url(commentPath(projectId, created.comment.id)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({ comment: { id: created.comment.id, status: 'resolved' } });

    const deleteResponse = await fetch(api.url(commentPath(projectId, created.comment.id)), { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true });
  });

  it('keeps preview comments available across conversations in the same project', async () => {
    const api = await startApi();
    const { projectId } = await createProject(api);
    const nextConversationId = await createConversation(api, projectId);
    expect(nextConversationId).toMatch(/^conversation-/);

    const createResponse = await fetch(api.url(commentPath(projectId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('First note')),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { comment: { id: string } };

    const updateResponse = await fetch(api.url(commentPath(projectId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Updated note')),
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as { comment: { id: string; note: string } };
    expect(updated.comment).toMatchObject({ id: created.comment.id, note: 'Updated note' });

    const listResponse = await fetch(api.url(commentPath(projectId)));
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as { comments: Array<{ id: string; note: string }> };
    expect(listed.comments).toEqual([expect.objectContaining({ id: created.comment.id, note: 'Updated note' })]);
  });

  it('rejects empty notes and invalid statuses', async () => {
    const api = await startApi();
    const { projectId } = await createProject(api);

    const emptyNote = await fetch(api.url(commentPath(projectId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('   ')),
    });
    expect(emptyNote.status).toBe(400);

    const created = await fetch(api.url(commentPath(projectId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Track this')),
    });
    const payload = (await created.json()) as { comment: { id: string } };

    const invalidStatus = await fetch(api.url(commentPath(projectId, payload.comment.id)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(invalidStatus.status).toBe(400);
  });

  it('returns not found for missing preview comment patch and delete', async () => {
    const api = await startApi();
    const { projectId } = await createProject(api);

    const patchResponse = await fetch(api.url(commentPath(projectId, 'missing-comment')), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await fetch(api.url(commentPath(projectId, 'missing-comment')), { method: 'DELETE' });
    expect(deleteResponse.status).toBe(404);
  });

  it('rejects invalid preview comment ids on patch and delete', async () => {
    const api = await startApi();
    const { projectId } = await createProject(api);
    const invalidCommentId = 'bad comment';

    const patchResponse = await fetch(api.url(commentPath(projectId, invalidCommentId)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(400);

    const deleteResponse = await fetch(api.url(commentPath(projectId, invalidCommentId)), {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(400);
  });

  it('keeps preview comments isolated by project only', async () => {
    const api = await startApi();
    const projectA = await createProject(api);
    const projectB = await createProject(api);

    const createResponse = await fetch(api.url(commentPath(projectA.projectId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Project A scope')),
    });
    expect(createResponse.status).toBe(200);
    const payload = (await createResponse.json()) as { comment: { id: string } };

    const projectAList = await fetch(api.url(commentPath(projectA.projectId)));
    expect(projectAList.status).toBe(200);
    await expect(projectAList.json()).resolves.toMatchObject({ comments: [{ id: payload.comment.id }] });

    const projectBList = await fetch(api.url(commentPath(projectB.projectId)));
    expect(projectBList.status).toBe(200);
    await expect(projectBList.json()).resolves.toEqual({ comments: [] });

    const patchResponse = await fetch(api.url(commentPath(projectB.projectId, payload.comment.id)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(404);
    await expect(patchResponse.json()).resolves.toMatchObject({ error: { code: 'COMMENT_NOT_FOUND' } });

    const deleteResponse = await fetch(api.url(commentPath(projectB.projectId, payload.comment.id)), {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(404);
    await expect(deleteResponse.json()).resolves.toMatchObject({ error: { code: 'COMMENT_NOT_FOUND' } });
  });
});
