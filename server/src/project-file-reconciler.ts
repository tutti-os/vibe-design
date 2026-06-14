import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getProjectFileFromStore, upsertProjectFileInStore, type ProjectFileKind } from './sqlite-store.js';

export async function reconcileProjectFilesFromDisk(projectsDir: string, projectId: string): Promise<void> {
  const projectDir = path.join(projectsDir, projectId);
  const assetsDir = path.join(projectDir, 'assets');

  await reconcileAssetDirectory(projectsDir, projectId, assetsDir);
  await reconcileProjectRootFiles(projectsDir, projectId, projectDir, assetsDir);
}

async function reconcileAssetDirectory(projectsDir: string, projectId: string, assetsDir: string): Promise<void> {
  const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !isSafeDesignFileName(entry.name)) {
      continue;
    }

    if (getProjectFileFromStore(projectsDir, projectId, entry.name)) {
      continue;
    }

    const assetPath = path.join(assetsDir, entry.name);
    const assetStats = await stat(assetPath).catch(() => null);
    if (!assetStats?.isFile()) {
      continue;
    }

    upsertProjectFileInStore(projectsDir, projectId, {
      name: entry.name,
      path: projectAssetRelativePath(entry.name),
      size: assetStats.size,
      mime: getContentType(entry.name),
      kind: getFileKind(entry.name),
    });
  }
}

async function reconcileProjectRootFiles(
  projectsDir: string,
  projectId: string,
  projectDir: string,
  assetsDir: string,
): Promise<void> {
  const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !isSafeDesignFileName(entry.name)) {
      continue;
    }

    const sourcePath = path.join(projectDir, entry.name);
    const sourceStats = await stat(sourcePath).catch(() => null);
    if (!sourceStats?.isFile()) {
      continue;
    }

    const assetPath = path.join(assetsDir, entry.name);
    const existingFile = getProjectFileFromStore(projectsDir, projectId, entry.name);
    const existingAssetStats = await stat(assetPath).catch(() => null);
    if (!existingAssetStats?.isFile()) {
      await mkdir(assetsDir, { recursive: true });
      await copyFile(sourcePath, assetPath);
    }

    if (existingFile) {
      continue;
    }

    const indexedSize = existingAssetStats?.isFile() ? existingAssetStats.size : sourceStats.size;
    upsertProjectFileInStore(projectsDir, projectId, {
      name: entry.name,
      path: projectAssetRelativePath(entry.name),
      size: indexedSize,
      mime: getContentType(entry.name),
      kind: getFileKind(entry.name),
    });
  }
}

function projectAssetRelativePath(name: string): string {
  return `assets/${name}`;
}

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
  if (
    extension === '.png' ||
    extension === '.jpg' ||
    extension === '.jpeg' ||
    extension === '.gif' ||
    extension === '.webp' ||
    extension === '.svg'
  ) {
    return 'image';
  }
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
