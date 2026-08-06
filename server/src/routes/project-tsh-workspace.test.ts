import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../server.js';
import { getProjectFromStore } from '../sqlite-store.js';
import { resolveProjectWorkspaceDir } from '../project-workspace.js';

const tempRoots: string[] = [];

async function createRuntimeDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibe-tsh-'));
  tempRoots.push(root);
  return root;
}

async function listen(server: ReturnType<typeof createServer>): Promise<{ port: number; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected TCP address');
  }
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

describe('TSH project workspace lifecycle', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('creates dated workspace roots and follows filesystem renames', async () => {
    const runtimeDir = await createRuntimeDir();
    const workspaceRoot = join(runtimeDir, 'workspace');
    vi.stubEnv('TSH_WORKSPACE_APP', '1');
    vi.stubEnv('TSH_WORKSPACE_ROOT', workspaceRoot);

    const { port, close } = await listen(createServer({ runtimeDir }));
    try {
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({
        ok: true,
        tshWorkspaceApp: true,
        defaultParentPath: workspaceRoot,
      });

      const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Untitled',
          prompt: '猫猫插画风格的着陆页原型',
          parentPath: workspaceRoot,
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        project: { id: string; metadata: { title: string }; workspaceRoot: string | null };
      };
      expect(dirname(created.project.workspaceRoot!)).toBe(workspaceRoot);
      expect(basename(created.project.workspaceRoot!)).toMatch(/^design-\d{4}-\d{2}-\d{2}-\d+$/);
      expect(created.project.metadata.title).toBe('猫猫插画风格的着陆页原型');

      const projectsDir = join(runtimeDir, 'projects');
      const stored = getProjectFromStore(projectsDir, created.project.id);
      expect(stored?.workspaceRoot).toBe(created.project.workspaceRoot);
      expect(resolveProjectWorkspaceDir(projectsDir, created.project.id)).toBe(
        created.project.workspaceRoot,
      );
      expect(await readdir(created.project.workspaceRoot!)).toContain('assets');

      // Title PATCH must not rename the TSH directory.
      const renameResponse = await fetch(
        `http://127.0.0.1:${port}/api/projects/${encodeURIComponent(created.project.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: '海边奇遇' }),
        },
      );
      expect(renameResponse.status).toBe(200);
      const patched = await renameResponse.json() as {
        project: { workspaceRoot: string | null; metadata: { title: string } };
      };
      expect(patched.project.workspaceRoot).toBe(created.project.workspaceRoot);
      expect(patched.project.metadata.title).toBe('海边奇遇');

      // Filesystem rename rebinds workspaceRoot but must not overwrite display title.
      const nextRoot = join(workspaceRoot, '海边奇遇');
      await rename(created.project.workspaceRoot!, nextRoot);
      const getResponse = await fetch(
        `http://127.0.0.1:${port}/api/projects/${encodeURIComponent(created.project.id)}`,
      );
      expect(getResponse.status).toBe(200);
      const loaded = await getResponse.json() as {
        project: { workspaceRoot: string | null; metadata: { title: string } };
      };
      expect(loaded.project.workspaceRoot).toBe(nextRoot);
      expect(loaded.project.metadata.title).toBe('海边奇遇');

      const deleteResponse = await fetch(
        `http://127.0.0.1:${port}/api/projects/${encodeURIComponent(created.project.id)}`,
        { method: 'DELETE' },
      );
      expect(deleteResponse.status).toBe(200);
      expect(getProjectFromStore(projectsDir, created.project.id)).toBeNull();
    } finally {
      await close();
    }
  });
});
