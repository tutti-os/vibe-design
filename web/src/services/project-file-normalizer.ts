import type { ProjectFile, ProjectFileKind } from '../types';

const PROJECT_FILE_KINDS = new Set<ProjectFileKind>([
  'html',
  'image',
  'video',
  'audio',
  'sketch',
  'text',
  'code',
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'binary',
]);

export function readProjectFile(value: unknown): ProjectFile | null {
  if (!isObject(value)) return null;
  if (typeof value.name !== 'string') return null;

  const path = typeof value.path === 'string' ? value.path : value.name;
  const id = typeof value.id === 'string' ? value.id : path;

  return {
    id,
    name: value.name,
    path,
    type: value.kind === 'directory' || value.type === 'directory' ? 'directory' : 'file',
    size: typeof value.size === 'number' ? value.size : 0,
    mtime: readTimestamp(value.mtime, value.updatedAt),
    kind: normalizeProjectFileKind(value.kind, value.name, value.mime, value.mimeType),
    mime: typeof value.mime === 'string'
      ? value.mime
      : typeof value.mimeType === 'string'
        ? value.mimeType
        : 'application/octet-stream',
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : undefined,
  };
}

function normalizeProjectFileKind(
  kind: unknown,
  name: string,
  mime: unknown,
  mimeType: unknown,
): ProjectFileKind {
  if (typeof kind === 'string' && PROJECT_FILE_KINDS.has(kind as ProjectFileKind)) {
    return kind as ProjectFileKind;
  }

  const contentType = typeof mime === 'string' ? mime : typeof mimeType === 'string' ? mimeType : '';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';

  if (contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) {
    return 'image';
  }
  if (contentType.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(extension)) return 'video';
  if (contentType.startsWith('audio/') || ['mp3', 'wav', 'ogg'].includes(extension)) return 'audio';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(extension)) return 'document';
  if (['ppt', 'pptx'].includes(extension)) return 'presentation';
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(extension)) return 'spreadsheet';
  if (['txt', 'md', 'markdown'].includes(extension)) return 'text';
  if (
    [
      'css',
      'js',
      'jsx',
      'json',
      'ts',
      'tsx',
      'vue',
      'svelte',
      'py',
      'rb',
      'go',
      'rs',
      'java',
      'kt',
      'swift',
    ].includes(extension)
  ) {
    return 'code';
  }

  return kind === 'image' ? 'image' : 'binary';
}

function readTimestamp(mtime: unknown, updatedAt: unknown): number {
  if (typeof mtime === 'number') return mtime;
  if (typeof mtime === 'string') {
    const parsed = Date.parse(mtime);
    if (Number.isFinite(parsed)) return parsed;
  }
  return typeof updatedAt === 'number' ? updatedAt : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
