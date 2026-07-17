import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileProjectFilesFromDisk } from './project-file-reconciler';
import {
  getProjectFileFromStore,
  listProjectFilesFromStore,
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
  it('imports a newer legacy project-root file into canonical assets using metadata only', async () => {
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

  it('keeps assets canonical and does not copy an asset edit back to the legacy root', async () => {
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
    expect(rootFile).toBe(original);
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
    const indexedBefore = listProjectFilesFromStore(projectsDir, projectId)[0]?.mtime;
    await reconcileProjectFilesFromDisk(projectsDir, projectId);
    const after = await stat(join(assetsDir, 'index.html'));

    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(listProjectFilesFromStore(projectsDir, projectId)[0]?.mtime).toBe(indexedBefore);
  });

  it('does not resurrect a deleted canonical asset from an unchanged legacy root', async () => {
    const projectsDir = await createProjectsDir();
    const projectId = 'project-delete';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(projectDir, 'index.html'), '<html>legacy</html>', 'utf8');
    await reconcileProjectFilesFromDisk(projectsDir, projectId);
    await rm(join(assetsDir, 'index.html'));

    await reconcileProjectFilesFromDisk(projectsDir, projectId, { pruneMissing: true });

    await expect(readFile(join(assetsDir, 'index.html'), 'utf8')).rejects.toThrow();
    expect(getProjectFileFromStore(projectsDir, projectId, 'index.html')).toBeNull();
  });

  it('imports a legacy root when mtime is equal but size differs', async () => {
    const projectsDir = await createProjectsDir();
    const projectId = 'project-equal-mtime';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const rootPath = join(projectDir, 'index.html');
    const assetPath = join(assetsDir, 'index.html');
    await writeFile(rootPath, '<html>larger root content</html>', 'utf8');
    await writeFile(assetPath, '<html>x</html>', 'utf8');
    const epoch = Date.now() - 10_000;
    await setTimes(rootPath, epoch);
    await setTimes(assetPath, epoch);

    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    await expect(readFile(assetPath, 'utf8')).resolves.toBe('<html>larger root content</html>');
  });

  it('imports a same-mtime same-size legacy overwrite using ctime and inode identity', async () => {
    const projectsDir = await createProjectsDir();
    const projectId = 'project-equal-metadata-overwrite';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const rootPath = join(projectDir, 'index.html');
    const assetPath = join(assetsDir, 'index.html');
    const epoch = Date.now() - 10_000;
    await writeFile(rootPath, '<html>AAA</html>', 'utf8');
    await writeFile(assetPath, '<html>AAA</html>', 'utf8');
    await Promise.all([setTimes(rootPath, epoch), setTimes(assetPath, epoch)]);
    await reconcileProjectFilesFromDisk(projectsDir, projectId);
    const canonicalMtime = (await stat(assetPath)).mtimeMs;

    const replacement = join(projectDir, 'replacement.tmp');
    await writeFile(replacement, '<html>BBB</html>', 'utf8');
    await setTimes(replacement, canonicalMtime);
    await rename(replacement, rootPath);
    await setTimes(rootPath, canonicalMtime);

    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    await expect(readFile(assetPath, 'utf8')).resolves.toBe('<html>BBB</html>');
  });

  it('propagates inaccessible directory errors and keeps indexed files when pruning', async () => {
    const projectsDir = await createProjectsDir();
    const projectId = 'project-inaccessible-assets';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const assetsDir = join(projectsDir, projectId, 'assets');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'index.html'), '<html>indexed</html>', 'utf8');
    await reconcileProjectFilesFromDisk(projectsDir, projectId);

    await chmod(assetsDir, 0o000);
    try {
      await expect(reconcileProjectFilesFromDisk(projectsDir, projectId, { pruneMissing: true })).rejects.toMatchObject({
        code: 'EACCES',
      });
      expect(getProjectFileFromStore(projectsDir, projectId, 'index.html')).not.toBeNull();
    } finally {
      await chmod(assetsDir, 0o755);
    }
  });
});
