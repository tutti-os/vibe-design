import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileProjectFilesFromDisk } from './project-file-reconciler';
import {
  getProjectFileFromStore,
  writeProjectToStore,
  type StoredProject,
} from './sqlite-store';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProjectsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibe-design-reconciler-'));
  tempRoots.push(root);
  return join(root, 'projects');
}

function storedProject(id: string): StoredProject {
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

async function setTimes(filePath: string, epochMs: number): Promise<void> {
  const seconds = epochMs / 1000;
  await utimes(filePath, seconds, seconds);
}

describe('reconcileProjectFilesFromDisk', () => {
  it('refreshes the served asset copy when the project-root file is edited', async () => {
    const projectsDir = await createProjectsDir();
    const projectId = 'project-edit';
    writeProjectToStore(projectsDir, storedProject(projectId));

    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });

    // Initial generation: root file materialized into assets/ and the store.
    const original = '<html>v1</html>';
    await writeFile(join(projectDir, 'index.html'), original, 'utf8');
    await writeFile(join(assetsDir, 'index.html'), original, 'utf8');
    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    // Agent edits the project-root copy (e.g. via the Edit tool); the served
    // asset copy is now stale and older on disk.
    const edited = '<html>v2 — much longer body after the edit</html>';
    await writeFile(join(projectDir, 'index.html'), edited, 'utf8');
    await setTimes(join(assetsDir, 'index.html'), Date.now() - 60_000);
    await setTimes(join(projectDir, 'index.html'), Date.now());

    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    const servedAsset = await readFile(join(assetsDir, 'index.html'), 'utf8');
    expect(servedAsset).toBe(edited);

    const stored = getProjectFileFromStore(projectsDir, projectId, 'index.html');
    expect(stored?.size).toBe(Buffer.byteLength(edited));
  });

  it('propagates an edit made to the assets copy back to the project root', async () => {
    const projectsDir = await createProjectsDir();
    const projectId = 'project-asset-edit';
    writeProjectToStore(projectsDir, storedProject(projectId));

    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });

    const original = '<html>v1</html>';
    await writeFile(join(projectDir, 'index.html'), original, 'utf8');
    await writeFile(join(assetsDir, 'index.html'), original, 'utf8');
    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    // Agent edits the assets/ copy it was handed as context; the root is stale.
    const edited = '<html>v2 edited directly in assets</html>';
    await writeFile(join(assetsDir, 'index.html'), edited, 'utf8');
    await setTimes(join(projectDir, 'index.html'), Date.now() - 60_000);
    await setTimes(join(assetsDir, 'index.html'), Date.now());

    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    const rootFile = await readFile(join(projectDir, 'index.html'), 'utf8');
    expect(rootFile).toBe(edited);
    const servedAsset = await readFile(join(assetsDir, 'index.html'), 'utf8');
    expect(servedAsset).toBe(edited);
  });

  it('leaves matching copies untouched', async () => {
    const projectsDir = await createProjectsDir();
    const projectId = 'project-stable';
    writeProjectToStore(projectsDir, storedProject(projectId));

    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });

    const content = '<html>stable</html>';
    await writeFile(join(projectDir, 'index.html'), content, 'utf8');
    await writeFile(join(assetsDir, 'index.html'), content, 'utf8');
    await setTimes(join(assetsDir, 'index.html'), Date.now());
    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    const before = await stat(join(assetsDir, 'index.html'));
    await reconcileProjectFilesFromDisk(projectsDir, projectId);
    const after = await stat(join(assetsDir, 'index.html'));

    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
