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

async function createProject(api: { url: (path: string) => string }): Promise<{ projectId: string; conversationId: string }> {
  const response = await fetch(api.url('/api/projects'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Build a landing page', projectKind: 'prototype' }),
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { project: { id: string }; conversationId: string };
  return { projectId: payload.project.id, conversationId: payload.conversationId };
}

function commentPath(projectId: string, conversationId: string, commentId?: string): string {
  const base = `/api/projects/${projectId}/conversations/${conversationId}/comments`;
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
    const { projectId, conversationId } = await createProject(api);

    const createResponse = await fetch(api.url(commentPath(projectId, conversationId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Tighten this heading')),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { comment: { id: string; note: string; status: string } };
    expect(created.comment).toMatchObject({ note: 'Tighten this heading', status: 'open' });

    const listResponse = await fetch(api.url(commentPath(projectId, conversationId)));
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as { comments: Array<{ id: string }> };
    expect(listed.comments.map((comment) => comment.id)).toEqual([created.comment.id]);

    const patchResponse = await fetch(api.url(commentPath(projectId, conversationId, created.comment.id)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({ comment: { id: created.comment.id, status: 'resolved' } });

    const deleteResponse = await fetch(api.url(commentPath(projectId, conversationId, created.comment.id)), { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true });
  });

  it('rejects empty notes and invalid statuses', async () => {
    const api = await startApi();
    const { projectId, conversationId } = await createProject(api);

    const emptyNote = await fetch(api.url(commentPath(projectId, conversationId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('   ')),
    });
    expect(emptyNote.status).toBe(400);

    const created = await fetch(api.url(commentPath(projectId, conversationId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Track this')),
    });
    const payload = (await created.json()) as { comment: { id: string } };

    const invalidStatus = await fetch(api.url(commentPath(projectId, conversationId, payload.comment.id)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(invalidStatus.status).toBe(400);
  });

  it('returns not found for missing preview comment patch and delete', async () => {
    const api = await startApi();
    const { projectId, conversationId } = await createProject(api);

    const patchResponse = await fetch(api.url(commentPath(projectId, conversationId, 'missing-comment')), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await fetch(api.url(commentPath(projectId, conversationId, 'missing-comment')), { method: 'DELETE' });
    expect(deleteResponse.status).toBe(404);
  });

  it('rejects invalid preview comment ids on patch and delete', async () => {
    const api = await startApi();
    const { projectId, conversationId } = await createProject(api);
    const invalidCommentId = 'bad comment';

    const patchResponse = await fetch(api.url(commentPath(projectId, conversationId, invalidCommentId)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(400);

    const deleteResponse = await fetch(api.url(commentPath(projectId, conversationId, invalidCommentId)), {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(400);
  });

  it('returns not found when project and conversation ids do not belong together', async () => {
    const api = await startApi();
    const projectA = await createProject(api);
    const projectB = await createProject(api);

    const createResponse = await fetch(api.url(commentPath(projectA.projectId, projectB.conversationId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Wrong scope')),
    });
    expect(createResponse.status).toBe(404);

    const listResponse = await fetch(api.url(commentPath(projectA.projectId, projectB.conversationId)));
    expect(listResponse.status).toBe(404);

    const validCreate = await fetch(api.url(commentPath(projectA.projectId, projectA.conversationId)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody('Valid scope')),
    });
    const payload = (await validCreate.json()) as { comment: { id: string } };

    const patchResponse = await fetch(api.url(commentPath(projectA.projectId, projectB.conversationId, payload.comment.id)), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(patchResponse.status).toBe(404);
    await expect(patchResponse.json()).resolves.toMatchObject({ error: { code: 'CONVERSATION_NOT_FOUND' } });

    const deleteResponse = await fetch(api.url(commentPath(projectA.projectId, projectB.conversationId, payload.comment.id)), {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(404);
    await expect(deleteResponse.json()).resolves.toMatchObject({ error: { code: 'CONVERSATION_NOT_FOUND' } });
  });
});
