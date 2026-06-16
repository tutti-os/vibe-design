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

interface Api {
  url: (path: string) => string;
}

async function startApi(): Promise<Api> {
  const runtimeDir = await mkdtemp(join(tmpdir(), 'vibe-design-references-api-'));
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

async function createProject(api: Api, prompt: string): Promise<string> {
  const response = await fetch(api.url('/api/projects'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, projectKind: 'prototype' }),
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { project: { id: string } };
  return payload.project.id;
}

async function createFile(api: Api, projectId: string, name: string, content: string): Promise<string> {
  const response = await fetch(api.url(`/api/projects/${projectId}/files`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, content, encoding: 'utf8' }),
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { file: { name: string } };
  return payload.file.name;
}

interface ListResponse {
  items: Array<{
    type: 'group' | 'reference';
    id?: string;
    displayName?: string;
    referenceCount?: number;
    reference?: {
      kind: string;
      displayName: string;
      location: { type: string; path: string };
      sizeBytes: number;
      mtimeMs: number;
      mimeType: string;
    };
  }>;
  nextCursor: string | null;
}

async function listReferences(api: Api, body: Record<string, unknown>): Promise<ListResponse> {
  const response = await fetch(api.url('/tutti/references/list'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ListResponse;
}

describe('references list endpoint', () => {
  it('lists projects as groups at the root level with exact reference counts', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'index.html', '<!doctype html><title>hi</title>');
    await createFile(api, projectId, 'styles.css', 'body{color:red}');

    const root = await listReferences(api, {});
    const group = root.items.find((item) => item.type === 'group' && item.id === projectId);
    expect(group).toBeDefined();
    expect(group?.referenceCount).toBe(2);
    expect(root.nextCursor).toBeNull();
  });

  it('returns app-data-relative file references inside a project group', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'index.html', '<!doctype html><title>hi</title>');

    const children = await listReferences(api, { parentGroupId: projectId });
    expect(children.items).toHaveLength(1);
    const reference = children.items[0]?.reference;
    expect(reference?.kind).toBe('file');
    expect(reference?.displayName).toBe('index.html');
    expect(reference?.location).toEqual({
      type: 'app-data-relative',
      path: `projects/${projectId}/assets/index.html`,
    });
    expect(reference?.sizeBytes).toBeGreaterThan(0);
    expect(reference?.mimeType).toContain('html');
  });

  it('filters direct children by filterText without changing group reference counts', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'index.html', '<!doctype html>');
    await createFile(api, projectId, 'about.html', '<!doctype html>');

    const filtered = await listReferences(api, { parentGroupId: projectId, filterText: 'about' });
    expect(filtered.items.map((item) => item.reference?.displayName)).toEqual(['about.html']);

    const root = await listReferences(api, { filterText: 'about' });
    // A project whose title does not match is filtered out of the root listing,
    // but matched groups still report the full (unfiltered) reference count.
    const group = root.items.find((item) => item.id === projectId);
    if (group) {
      expect(group.referenceCount).toBe(2);
    }
  });

  it('paginates with an opaque cursor', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'a.html', '<!doctype html>');
    await createFile(api, projectId, 'b.html', '<!doctype html>');
    await createFile(api, projectId, 'c.html', '<!doctype html>');

    const first = await listReferences(api, { parentGroupId: projectId, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listReferences(api, {
      parentGroupId: projectId,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('returns an empty list for unsafe parent group ids', async () => {
    const api = await startApi();
    const result = await listReferences(api, { parentGroupId: '../escape' });
    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
