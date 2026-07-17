import type { Dirent, Stats } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  clearProjectFileTombstone,
  deleteProjectFileFromStore,
  getLegacyRootFileBaseline,
  getProjectFileFromStore,
  getProjectFileTombstone,
  listProjectFilesFromStore,
  markLegacyRootFileBaseline,
  upsertProjectFileMetadataInStore,
  type ProjectFileKind,
  type ProjectFileIdentity,
} from './sqlite-store.js';

/**
 * `assets/` is the canonical design-file location. The project root remains a
 * compatibility ingress for older projects and providers that wrote files
 * relative to the old cwd. Reconciliation compares metadata only; it never
 * reads both copies to compare their contents.
 *
 * This function is intended for the one-time canonical migration and a single
 * post-run scan, never for GET /files or other polling request paths.
 */
export async function reconcileProjectFilesFromDisk(
  projectsDir: string,
  projectId: string,
  options: { pruneMissing?: boolean; reviveTombstones?: boolean } = {},
): Promise<void> {
  const projectDir = path.join(projectsDir, projectId);
  const assetsDir = path.join(projectDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const [rootEntries, initialAssetEntries] = await Promise.all([
    readDesignEntries(projectDir),
    readDesignEntries(assetsDir),
  ]);
  const initialAssetNames = new Set(initialAssetEntries.map((entry) => entry.name));
  const canonicalNames = new Set(initialAssetNames);
  const rootIdentities = new Map<string, ProjectFileIdentity>();
  const assetIdentities = new Map<string, ProjectFileIdentity>();

  // Legacy root files are imported only when the canonical asset is missing or
  // the root copy is newer. The root copy is deliberately retained as a safe
  // rollback/compatibility fallback, but is no longer served or copied back
  // from assets.
  await mapWithConcurrency(rootEntries, filesystemConcurrency, async (entry) => {
    const sourcePath = path.join(projectDir, entry.name);
    const assetPath = path.join(assetsDir, entry.name);
    const [sourceStats, assetStats] = await Promise.all([
      statFile(sourcePath),
      initialAssetNames.has(entry.name) ? statFile(assetPath) : Promise.resolve(null),
    ]);
    if (!sourceStats) return;
    rootIdentities.set(entry.name, identityFromStats(sourceStats));
    const tombstoneDisposition = acceptRootTombstoneReplacement(
      projectsDir,
      projectId,
      entry.name,
      sourceStats,
      assetStats,
      options,
    );
    if (tombstoneDisposition === 'blocked') return;
    const baseline = getLegacyRootFileBaseline(projectsDir, projectId, entry.name);
    const hasIdentityBaseline = Boolean(baseline && (baseline.ctimeMs > 0 || baseline.ino > 0));
    const changedFromBaseline = !baseline
      || !sameTimestamp(baseline.mtimeMs, sourceStats.mtimeMs)
      || baseline.size !== sourceStats.size
      || (hasIdentityBaseline && baseline.ctimeMs !== sourceStats.ctimeMs)
      || (hasIdentityBaseline && baseline.ino !== sourceStats.ino);
    const inodeChangedFromBaseline = Boolean(hasIdentityBaseline && baseline && baseline.ino !== sourceStats.ino);
    const sameCanonicalMtime = assetStats ? sameTimestamp(sourceStats.mtimeMs, assetStats.mtimeMs) : false;
    const winsCanonicalSelection = !assetStats ||
      sourceStats.mtimeMs > assetStats.mtimeMs + timestampToleranceMs ||
      (sameCanonicalMtime && (
        sourceStats.size !== assetStats.size
        || sourceStats.ctimeMs > assetStats.ctimeMs
        || inodeChangedFromBaseline
      ));
    if (tombstoneDisposition === 'revived-root' || (changedFromBaseline && winsCanonicalSelection)) {
      await copyFile(sourcePath, assetPath);
    }
    markLegacyRootFileBaseline(projectsDir, projectId, entry.name, {
      mtimeMs: sourceStats.mtimeMs,
      size: sourceStats.size,
      ctimeMs: sourceStats.ctimeMs,
      ino: sourceStats.ino,
    });
    canonicalNames.add(entry.name);
  });

  const indexedCanonicalNames = new Set<string>();
  await mapWithConcurrency([...canonicalNames], filesystemConcurrency, async (name) => {
    const assetStats = await statFile(path.join(assetsDir, name));
    if (!assetStats) return;
    assetIdentities.set(name, identityFromStats(assetStats));
    if (!acceptAssetTombstoneReplacement(projectsDir, projectId, name, assetStats, options)) return;
    indexedCanonicalNames.add(name);
    indexAsset(projectsDir, projectId, name, assetStats);
  });

  if (options.pruneMissing) {
    for (const file of listProjectFilesFromStore(projectsDir, projectId)) {
      if (!indexedCanonicalNames.has(file.name)) {
        deleteProjectFileFromStore(projectsDir, projectId, file.name, {
          assetIdentity: assetIdentities.get(file.name) ?? null,
          rootIdentity: rootIdentities.get(file.name) ?? null,
        });
      }
    }
  }
}

async function readDesignEntries(directory: string): Promise<Dirent[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingError(error)) return [];
    throw error;
  }
  return entries.filter((entry) => entry.isFile() && isSafeDesignFileName(entry.name));
}

async function statFile(filePath: string): Promise<Stats | null> {
  let result: Stats;
  try {
    result = await stat(filePath);
  } catch (error) {
    if (isMissingError(error)) return null;
    throw error;
  }
  return result?.isFile() ? result : null;
}

function isMissingError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function acceptRootTombstoneReplacement(
  projectsDir: string,
  projectId: string,
  name: string,
  rootStats: Stats,
  assetStats: Stats | null,
  options: { reviveTombstones?: boolean },
): 'normal' | 'revived-root' | 'blocked' {
  const tombstone = getProjectFileTombstone(projectsDir, projectId, name);
  if (!tombstone) return 'normal';
  if (!options.reviveTombstones || !tombstone.snapshotComplete) return 'blocked';
  if (assetStats && identityChanged(tombstone.assetIdentity, identityFromStats(assetStats))) {
    clearProjectFileTombstone(projectsDir, projectId, name);
    return 'normal';
  }
  if (!identityChanged(tombstone.rootIdentity, identityFromStats(rootStats))) return 'blocked';
  clearProjectFileTombstone(projectsDir, projectId, name);
  return 'revived-root';
}

function acceptAssetTombstoneReplacement(
  projectsDir: string,
  projectId: string,
  name: string,
  stats: Stats,
  options: { reviveTombstones?: boolean },
): boolean {
  const tombstone = getProjectFileTombstone(projectsDir, projectId, name);
  if (!tombstone) return true;
  if (!options.reviveTombstones || !tombstone.snapshotComplete) return false;
  // Compare two snapshots from the same filesystem clock domain. Date.now is
  // deliberately not involved: VM/NFS clocks may be offset from desktopd.
  // An absent deleted-side snapshot followed by a present file is also an
  // unambiguous new materialization.
  if (!identityChanged(tombstone.assetIdentity, identityFromStats(stats))) return false;
  clearProjectFileTombstone(projectsDir, projectId, name);
  return true;
}

function identityChanged(deleted: ProjectFileIdentity | null | undefined, current: ProjectFileIdentity): boolean {
  return !deleted || !sameFileIdentity(deleted, current);
}

function identityFromStats(stats: Stats): ProjectFileIdentity {
  return { ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs };
}

function sameFileIdentity(left: ProjectFileIdentity, right: ProjectFileIdentity): boolean {
  return left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function sameTimestamp(left: number, right: number): boolean {
  return Math.abs(left - right) <= timestampToleranceMs;
}

const timestampToleranceMs = 1;

function indexAsset(projectsDir: string, projectId: string, name: string, stats: Stats): void {
  const existing = getProjectFileFromStore(projectsDir, projectId, name);
  upsertProjectFileMetadataInStore(projectsDir, projectId, {
    name,
    path: `assets/${name}`,
    size: stats.size,
    mime: existing?.mime ?? getContentType(name),
    kind: existing?.kind ?? getFileKind(name),
    sourceMtimeMs: stats.mtimeMs,
  });
}

async function mapWithConcurrency<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await work(item);
    }
  }));
}

const filesystemConcurrency = 8;

function isSafeDesignFileName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 255 &&
    !name.startsWith('.') &&
    path.basename(name) === name &&
    path.win32.basename(name) === name &&
    !/^\.+$/.test(name)
  );
}

function getFileKind(name: string): ProjectFileKind {
  const extension = path.extname(name).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.css') return 'css';
  if (extension === '.js' || extension === '.mjs' || extension === '.ts' || extension === '.tsx') return 'code';
  if (extension === '.json') return 'json';
  if (extension === '.md' || extension === '.markdown') return 'text';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) return 'image';
  return 'file';
}

function getContentType(name: string): string {
  const extension = path.extname(name).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.ts' || extension === '.tsx') return 'text/plain; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown; charset=utf-8';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  return 'application/octet-stream';
}
