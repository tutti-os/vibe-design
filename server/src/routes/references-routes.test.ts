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
      score?: number;
      parentGroupLabel?: string;
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

async function searchReferences(api: Api, body: Record<string, unknown>): Promise<ListResponse> {
  const response = await fetch(api.url('/tutti/references/search'), {
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

describe('references search endpoint', () => {
  it('recursively searches files across projects and returns scored references only', async () => {
    const api = await startApi();
    const projectA = await createProject(api, 'Build a landing page');
    await createFile(api, projectA, 'hero.html', '<!doctype html>');
    const projectB = await createProject(api, 'Build a dashboard');
    await createFile(api, projectB, 'my-hero.html', '<!doctype html>');
    await createFile(api, projectB, 'sidebar.css', 'body{}');

    const result = await searchReferences(api, { query: 'hero' });

    // Reference-only, no group items.
    expect(result.items.every((item) => item.type === 'reference')).toBe(true);
    const names = result.items.map((item) => item.reference?.displayName);
    expect(names).toContain('hero.html');
    expect(names).toContain('my-hero.html');
    expect(names).not.toContain('sidebar.css');

    // Prefix match ("hero.html") outranks the substring match ("my-hero.html"),
    // and scores are within (0, 1].
    expect(names[0]).toBe('hero.html');
    for (const item of result.items) {
      expect(item.reference?.score).toBeGreaterThan(0);
      expect(item.reference?.score).toBeLessThanOrEqual(1);
    }
    // Locations resolve under the owning project's assets directory.
    const heroItem = result.items.find((item) => item.reference?.displayName === 'hero.html');
    expect(heroItem?.reference?.location).toEqual({
      type: 'app-data-relative',
      path: `projects/${projectA}/assets/hero.html`,
    });

    // Each flattened search hit carries its owning project's title as the
    // context subtitle (parentGroupLabel), matching the root group displayName.
    const rootGroups = await listReferences(api, {});
    const projectATitle = rootGroups.items.find((item) => item.id === projectA)?.displayName;
    expect(projectATitle).toBeTruthy();
    expect(heroItem?.reference?.parentGroupLabel).toBe(projectATitle);
    for (const item of result.items) {
      expect(item.reference?.parentGroupLabel).toBeTruthy();
    }
  });

  it('matches the query against file names only, not the project title', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Checkout flow redesign');
    await createFile(api, projectId, 'page.html', '<!doctype html>');
    await createFile(api, projectId, 'checkout.html', '<!doctype html>');

    const result = await searchReferences(api, { query: 'checkout' });
    const names = result.items.map((item) => item.reference?.displayName);
    // The file named "checkout.html" matches; "page.html" does not, even though
    // its project title contains "checkout".
    expect(names).toEqual(['checkout.html']);
  });

  it('returns an empty result for a blank query with no filters', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'index.html', '<!doctype html>');

    expect(await searchReferences(api, { query: '   ' })).toEqual({ items: [], nextCursor: null });
  });

  it('restricts query matches to the requested file-type categories (OR semantics)', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'hero.html', '<!doctype html>');
    await createFile(api, projectId, 'hero.css', 'body{}');
    await createFile(api, projectId, 'hero.png', 'x');

    const result = await searchReferences(api, { query: 'hero', filters: ['image', 'code'] });
    const names = result.items.map((item) => item.reference?.displayName);
    // css → code, png → image are kept; html → document is filtered out.
    expect(names).toContain('hero.css');
    expect(names).toContain('hero.png');
    expect(names).not.toContain('hero.html');
  });

  it('supports filter-only search (empty query) ordered by recency, without scores', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'a.png', 'x');
    await createFile(api, projectId, 'b.png', 'y');
    await createFile(api, projectId, 'notes.md', 'hi');

    const result = await searchReferences(api, { filters: ['image'] });
    const names = result.items.map((item) => item.reference?.displayName);
    expect(names).toEqual(expect.arrayContaining(['a.png', 'b.png']));
    expect(names).not.toContain('notes.md');
    // Newest-created file comes first; filter-only results carry no relevance score.
    expect(names[0]).toBe('b.png');
    for (const item of result.items) {
      expect(item.reference?.score).toBeUndefined();
    }
  });

  it('ignores unknown filter ids and returns empty when no query remains', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'index.html', '<!doctype html>');

    expect(await searchReferences(api, { filters: ['banana'] })).toEqual({ items: [], nextCursor: null });
  });

  it('treats files with no recognized extension as the "other" category', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'README', 'plain');
    await createFile(api, projectId, 'index.html', '<!doctype html>');

    const result = await searchReferences(api, { filters: ['other'] });
    const names = result.items.map((item) => item.reference?.displayName);
    expect(names).toContain('README');
    expect(names).not.toContain('index.html');
  });

  it('paginates search results with an opaque cursor', async () => {
    const api = await startApi();
    const projectId = await createProject(api, 'Build a landing page');
    await createFile(api, projectId, 'tile-a.html', '<!doctype html>');
    await createFile(api, projectId, 'tile-b.html', '<!doctype html>');
    await createFile(api, projectId, 'tile-c.html', '<!doctype html>');

    const first = await searchReferences(api, { query: 'tile', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await searchReferences(api, { query: 'tile', limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});
