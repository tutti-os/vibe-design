import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  markProjectFilesDirty,
  prepareProjectFilesFromDisk,
  prepareProjectFilesWithHistory,
  scanProjectFilesAfterRun,
} from './project-file-preparation.js';
import {
  deleteProjectFileFromStore,
  getArtifactBackfillWatermark,
  getProjectFilePreparationState,
  isProjectFileTombstoned,
  markProjectFileScanDirty,
  upsertProjectFileInStore,
  writeProjectToStore,
  type StoredProject,
  type ProjectFileIdentity,
} from './sqlite-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function artifact(identifier: string, body: string): unknown[] {
  return [
    {
      type: 'text_delta',
      delta: `<artifact identifier="${identifier}" type="text/html" title="${identifier}"><!doctype html><html><body>${body}</body></html></artifact>`,
    },
    { type: 'end' },
  ];
}

describe('prepareProjectFilesWithHistory', () => {
  it('persists per-message watermarks and processes changed batches only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-1';
    writeProjectToStore(projectsDir, storedProject(projectId));

    await prepareProjectFilesWithHistory(projectsDir, projectId, [{ id: 'message-1', events: artifact('first', 'first') }]);
    await prepareProjectFilesWithHistory(projectsDir, projectId, [
      { id: 'message-1', events: artifact('first', 'ignored duplicate') },
      { id: 'message-2', events: artifact('second', 'second') },
    ]);

    await expect(readFile(join(projectsDir, projectId, 'assets', 'first.html'), 'utf8')).resolves.toContain(
      '<body>first</body>',
    );
    await expect(readFile(join(projectsDir, projectId, 'assets', 'second.html'), 'utf8')).resolves.toContain(
      '<body>second</body>',
    );
  });

  it('runs the legacy root migration once and keeps later GET preparation on the SQLite fast path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-legacy';
    writeProjectToStore(projectsDir, storedProject(projectId));
    await mkdir(join(projectsDir, projectId), { recursive: true });
    await writeFile(join(projectsDir, projectId, 'legacy.html'), '<html>legacy</html>', 'utf8');

    await prepareProjectFilesWithHistory(projectsDir, projectId, []);
    await writeFile(join(projectsDir, projectId, 'later.html'), '<html>later</html>', 'utf8');
    await prepareProjectFilesWithHistory(projectsDir, projectId, []);

    await expect(readFile(join(projectsDir, projectId, 'assets', 'legacy.html'), 'utf8')).resolves.toContain('legacy');
    await expect(readFile(join(projectsDir, projectId, 'assets', 'later.html'), 'utf8')).rejects.toThrow();
  });

  it('overwrites a same-name artifact when durable history advances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-recovery';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const first = artifact('preview', 'old');
    await prepareProjectFilesWithHistory(projectsDir, projectId, [{ id: 'message-1', events: first }]);
    await prepareProjectFilesWithHistory(projectsDir, projectId, [{
      id: 'message-1',
      events: [...first, ...artifact('preview', 'new')],
    }]);

    await expect(readFile(join(projectsDir, projectId, 'assets', 'preview.html'), 'utf8')).resolves.toContain(
      '<body>new</body>',
    );
  });

  it('advances a history watermark only after artifact materialization succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-watermark-failure';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const blockedPath = join(projectsDir, projectId, 'assets', 'blocked.html');
    await mkdir(blockedPath, { recursive: true });

    await expect(prepareProjectFilesWithHistory(projectsDir, projectId, [
      { id: 'message-blocked', events: artifact('blocked', 'eventual') },
    ])).rejects.toThrow();
    expect(getArtifactBackfillWatermark(projectsDir, projectId, 'message-blocked')).toBeNull();

    await rm(blockedPath, { recursive: true, force: true });
    await prepareProjectFilesWithHistory(projectsDir, projectId, [
      { id: 'message-blocked', events: artifact('blocked', 'eventual') },
    ]);
    expect(getArtifactBackfillWatermark(projectsDir, projectId, 'message-blocked')).toMatchObject({ eventCount: 2 });
  });

  it('replays an uncommitted history suffix and restores its latest same-name artifact after a crash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-suffix-recovery';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const blockedPath = join(projectsDir, projectId, 'assets', 'blocked.html');
    const previewPath = join(projectsDir, projectId, 'assets', 'preview.html');
    await mkdir(blockedPath, { recursive: true });
    const batches = [
      { id: 'message-old', events: artifact('preview', 'old') },
      { id: 'message-new', events: [...artifact('preview', 'new'), ...artifact('blocked', 'blocked')] },
    ];

    await expect(prepareProjectFilesWithHistory(projectsDir, projectId, batches)).rejects.toThrow();
    expect(getArtifactBackfillWatermark(projectsDir, projectId, 'message-old')).toMatchObject({ eventCount: 2 });
    expect(getArtifactBackfillWatermark(projectsDir, projectId, 'message-new')).toBeNull();
    await writeFile(previewPath, '<html><body>stale after crash</body></html>', 'utf8');
    await rm(blockedPath, { recursive: true, force: true });

    await prepareProjectFilesWithHistory(projectsDir, projectId, batches);

    await expect(readFile(previewPath, 'utf8')).resolves.toContain('<body>new</body>');
  });

  it('keeps the durable dirty marker until the last concurrent run scans successfully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-concurrent-runs';
    writeProjectToStore(projectsDir, storedProject(projectId));
    await mkdir(join(projectsDir, projectId, 'assets'), { recursive: true });
    await writeFile(join(projectsDir, projectId, 'assets', 'initial.html'), '<html>initial</html>', 'utf8');
    await prepareProjectFilesFromDisk(projectsDir, projectId);

    markProjectFilesDirty(projectsDir, projectId, 'run-a');
    markProjectFilesDirty(projectsDir, projectId, 'run-b');
    await writeFile(join(projectsDir, projectId, 'assets', 'during-run.html'), '<html>partial</html>', 'utf8');

    await prepareProjectFilesFromDisk(projectsDir, projectId);
    expect(getProjectFilePreparationState(projectsDir, projectId)?.scanDirty).toBe(true);

    await scanProjectFilesAfterRun(projectsDir, projectId, 'run-a');
    expect(getProjectFilePreparationState(projectsDir, projectId)?.scanDirty).toBe(true);

    await scanProjectFilesAfterRun(projectsDir, projectId, 'run-b');
    expect(getProjectFilePreparationState(projectsDir, projectId)?.scanDirty).toBe(false);
  });

  it('does not resurrect a tombstoned artifact during history replay and lets a live write clear it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-tombstone-replay';
    writeProjectToStore(projectsDir, storedProject(projectId));
    const events = artifact('deleted-preview', 'old');
    await prepareProjectFilesWithHistory(projectsDir, projectId, [{ id: 'message-1', events }]);
    expect(deleteProjectFileFromStore(projectsDir, projectId, 'deleted-preview.html')).toBe(true);
    await rm(join(projectsDir, projectId, 'assets', 'deleted-preview.html'));
    expect(isProjectFileTombstoned(projectsDir, projectId, 'deleted-preview.html')).toBe(true);

    await prepareProjectFilesWithHistory(projectsDir, projectId, [{
      id: 'message-1',
      events: [...events, ...artifact('deleted-preview', 'history-update')],
    }]);
    await expect(readFile(join(projectsDir, projectId, 'assets', 'deleted-preview.html'), 'utf8')).rejects.toThrow();

    await writeFile(join(projectsDir, projectId, 'assets', 'deleted-preview.html'), '<html>live</html>', 'utf8');
    upsertProjectFileInStore(projectsDir, projectId, {
      name: 'deleted-preview.html',
      path: 'assets/deleted-preview.html',
      size: Buffer.byteLength('<html>live</html>'),
    });
    expect(isProjectFileTombstoned(projectsDir, projectId, 'deleted-preview.html')).toBe(false);
  });

  it('revives tombstoned assets and legacy-root files recreated by Bash during an active run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-shell-recreate';
    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    writeProjectToStore(projectsDir, storedProject(projectId));
    await mkdir(assetsDir, { recursive: true });
    await Promise.all([
      writeFile(join(assetsDir, 'asset-live.html'), '<html>old asset</html>', 'utf8'),
      writeFile(join(projectDir, 'root-live.html'), '<html>old root</html>', 'utf8'),
    ]);
    await prepareProjectFilesFromDisk(projectsDir, projectId);

    expect(deleteProjectFileFromStore(projectsDir, projectId, 'asset-live.html', {
      assetIdentity: await fileIdentity(join(assetsDir, 'asset-live.html')),
    })).toBe(true);
    expect(deleteProjectFileFromStore(projectsDir, projectId, 'root-live.html', {
      assetIdentity: await fileIdentity(join(assetsDir, 'root-live.html')),
      rootIdentity: await fileIdentity(join(projectDir, 'root-live.html')),
    })).toBe(true);
    await Promise.all([
      rm(join(assetsDir, 'asset-live.html')),
      rm(join(assetsDir, 'root-live.html')),
      rm(join(projectDir, 'root-live.html')),
    ]);
    markProjectFilesDirty(projectsDir, projectId, 'run-shell');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.all([
      writeFile(join(assetsDir, 'asset-live.html'), '<html>new asset</html>', 'utf8'),
      writeFile(join(projectDir, 'root-live.html'), '<html>new root</html>', 'utf8'),
    ]);

    await scanProjectFilesAfterRun(projectsDir, projectId, 'run-shell');

    expect(isProjectFileTombstoned(projectsDir, projectId, 'asset-live.html')).toBe(false);
    expect(isProjectFileTombstoned(projectsDir, projectId, 'root-live.html')).toBe(false);
    await expect(readFile(join(assetsDir, 'asset-live.html'), 'utf8')).resolves.toContain('new asset');
    await expect(readFile(join(assetsDir, 'root-live.html'), 'utf8')).resolves.toContain('new root');
  });

  it('recovers Bash recreations after a crash using same-domain identity while retaining a stale root tombstone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-crash-recreate';
    const projectDir = join(projectsDir, projectId);
    const assetsDir = join(projectDir, 'assets');
    writeProjectToStore(projectsDir, storedProject(projectId));
    await mkdir(assetsDir, { recursive: true });
    await Promise.all([
      writeFile(join(assetsDir, 'equal-clock.html'), '<html>AAAA</html>', 'utf8'),
      writeFile(join(projectDir, 'offset-clock.html'), '<html>CCCC</html>', 'utf8'),
      writeFile(join(projectDir, 'stale-root.html'), '<html>stale</html>', 'utf8'),
    ]);
    await prepareProjectFilesFromDisk(projectsDir, projectId);

    const equalAssetIdentity = await fileIdentity(join(assetsDir, 'equal-clock.html'));
    const offsetRootIdentity = await fileIdentity(join(projectDir, 'offset-clock.html'));
    const staleRootIdentity = await fileIdentity(join(projectDir, 'stale-root.html'));
    expect(deleteProjectFileFromStore(projectsDir, projectId, 'equal-clock.html', {
      assetIdentity: equalAssetIdentity,
    })).toBe(true);
    expect(deleteProjectFileFromStore(projectsDir, projectId, 'offset-clock.html', {
      assetIdentity: await fileIdentity(join(assetsDir, 'offset-clock.html')),
      rootIdentity: offsetRootIdentity,
    })).toBe(true);
    expect(deleteProjectFileFromStore(projectsDir, projectId, 'stale-root.html', {
      assetIdentity: await fileIdentity(join(assetsDir, 'stale-root.html')),
      rootIdentity: staleRootIdentity,
    })).toBe(true);
    await Promise.all([
      rm(join(assetsDir, 'equal-clock.html')),
      rm(join(assetsDir, 'offset-clock.html')),
      rm(join(projectDir, 'offset-clock.html')),
      rm(join(assetsDir, 'stale-root.html')),
    ]);

    // Simulate a process crash: only the durable dirty marker remains; the
    // in-memory active-run Set is intentionally never populated.
    markProjectFileScanDirty(projectsDir, projectId, true);
    await writeFile(join(assetsDir, 'equal-clock.html'), '<html>BBBB</html>', 'utf8');
    await utimes(
      join(assetsDir, 'equal-clock.html'),
      equalAssetIdentity.mtimeMs / 1000,
      equalAssetIdentity.mtimeMs / 1000,
    );
    await writeFile(join(projectDir, 'offset-clock.html'), '<html>DDDD</html>', 'utf8');
    const offsetSeconds = (offsetRootIdentity.mtimeMs - 86_400_000) / 1000;
    await utimes(join(projectDir, 'offset-clock.html'), offsetSeconds, offsetSeconds);

    await prepareProjectFilesFromDisk(projectsDir, projectId);

    expect(isProjectFileTombstoned(projectsDir, projectId, 'equal-clock.html')).toBe(false);
    expect(isProjectFileTombstoned(projectsDir, projectId, 'offset-clock.html')).toBe(false);
    expect(isProjectFileTombstoned(projectsDir, projectId, 'stale-root.html')).toBe(true);
    await expect(readFile(join(assetsDir, 'equal-clock.html'), 'utf8')).resolves.toContain('BBBB');
    await expect(readFile(join(assetsDir, 'offset-clock.html'), 'utf8')).resolves.toContain('DDDD');
    await expect(readFile(join(assetsDir, 'stale-root.html'), 'utf8')).rejects.toThrow();
    expect(getProjectFilePreparationState(projectsDir, projectId)?.scanDirty).toBe(false);
  });
});

async function fileIdentity(filePath: string): Promise<ProjectFileIdentity> {
  const info = await stat(filePath);
  return { ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
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
