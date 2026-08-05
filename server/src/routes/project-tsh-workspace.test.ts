import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('creates, renames, and deletes bound workspace roots', async () => {
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
          prompt: '猫猫插画工作室的着陆页原型',
          parentPath: workspaceRoot,
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        project: { id: string; metadata: { title: string }; workspaceRoot: string | null };
      };
      expect(created.project.metadata.title).toContain('猫猫插画');
      expect(created.project.workspaceRoot).toMatch(new RegExp(`^${workspaceRoot}/.+-[a-f0-9]{8}$`));

      const projectsDir = join(runtimeDir, 'projects');
      const stored = getProjectFromStore(projectsDir, created.project.id);
      expect(stored?.workspaceRoot).toBe(created.project.workspaceRoot);
      expect(resolveProjectWorkspaceDir(projectsDir, created.project.id)).toBe(
        created.project.workspaceRoot,
      );
      expect(await readdir(created.project.workspaceRoot!)).toContain('assets');

      const renameResponse = await fetch(
        `http://127.0.0.1:${port}/api/projects/${encodeURIComponent(created.project.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: '海边奇遇' }),
        },
      );
      expect(renameResponse.status).toBe(200);
      const renamed = await renameResponse.json() as {
        project: { workspaceRoot: string | null; metadata: { title: string } };
      };
      expect(renamed.project.metadata.title).toBe('海边奇遇');
      expect(renamed.project.workspaceRoot).toMatch(/\/海边奇遇-[a-f0-9]{8}$/);
      expect(renamed.project.workspaceRoot).not.toBe(created.project.workspaceRoot);

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
