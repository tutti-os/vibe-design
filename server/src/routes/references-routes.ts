import type { Express, Request, Response } from 'express';
import type { RouteDeps } from '../server-context.js';
import {
  listProjectFilesFromStore,
  listProjectSummariesFromStore,
  type StoredProjectFile,
} from '../sqlite-store.js';
import { isSafeFileName, isSafeProjectId } from './project-routes.js';

type ReferencesRouteDeps = RouteDeps<'paths'>;

// Upper bound for how many projects the reference root scans. Tutti clamps the
// page size to 1..50, so this only caps the in-memory candidate set.
const PROJECT_SCAN_LIMIT = 1000;
const MAX_PAGE_LIMIT = 50;
const DESCRIPTION_MAX_LENGTH = 140;

interface TimeRange {
  fromMs?: number;
  toMs?: number;
}

interface ListOptions {
  filterText: string;
  limit: number;
  offset: number;
  timeRange: TimeRange | null;
  wantsFiles: boolean;
}

// Implements the Tutti workspace app "Reference List Runtime Protocol".
// Root level returns one navigational group per project; entering a project
// group returns its materialized design assets as file references whose
// `location` is resolved by the daemon, never an absolute host path.
export function registerReferencesRoutes(app: Express, ctx: ReferencesRouteDeps): void {
  app.post('/tutti/references/list', (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    const parentGroupId = readString(body.parentGroupId);
    const options: ListOptions = {
      filterText: (readString(body.filterText) ?? '').toLowerCase(),
      limit: clamp(readInteger(body.limit, MAX_PAGE_LIMIT), 1, MAX_PAGE_LIMIT),
      offset: decodeCursor(body.cursor),
      timeRange: readTimeRange(body.timeRange),
      wantsFiles: readKindsWantsFiles(body.kinds),
    };

    if (parentGroupId === null) {
      res.json(listRootGroups(ctx.paths.projectsDir, options));
      return;
    }

    if (!isSafeProjectId(parentGroupId)) {
      res.json({ items: [], nextCursor: null });
      return;
    }

    res.json(listProjectFileReferences(ctx.paths.projectsDir, parentGroupId, options));
  });
}

function listRootGroups(projectsDir: string, options: ListOptions): unknown {
  const projects = listProjectSummariesFromStore(projectsDir, PROJECT_SCAN_LIMIT);
  const matched = options.filterText
    ? projects.filter((project) => project.title.toLowerCase().includes(options.filterText))
    : projects;

  const page = paginate(matched, options.offset, options.limit);
  const items = page.slice.map((project) => {
    // referenceCount must be exact under kinds/timeRange and is not affected by filterText.
    const files = filterFilesByRange(listProjectFilesFromStore(projectsDir, project.id), options.timeRange);
    const description = truncate(project.prompt, DESCRIPTION_MAX_LENGTH);
    return {
      type: 'group',
      id: project.id,
      displayName: project.title,
      ...(description ? { description } : {}),
      referenceCount: options.wantsFiles ? files.length : 0,
    };
  });

  return { items, nextCursor: page.nextCursor };
}

function listProjectFileReferences(projectsDir: string, projectId: string, options: ListOptions): unknown {
  if (!options.wantsFiles) {
    return { items: [], nextCursor: null };
  }

  const ranged = filterFilesByRange(listProjectFilesFromStore(projectsDir, projectId), options.timeRange);
  const matched = ranged.filter(
    (file) =>
      isSafeFileName(file.name) &&
      (options.filterText ? file.name.toLowerCase().includes(options.filterText) : true),
  );

  const page = paginate(matched, options.offset, options.limit);
  const items = page.slice.map((file) => ({
    type: 'reference',
    reference: {
      kind: 'file',
      displayName: file.name,
      location: {
        type: 'app-data-relative',
        path: `projects/${projectId}/assets/${file.name}`,
      },
      sizeBytes: file.size,
      mtimeMs: mtimeMsOf(file),
      mimeType: file.mime,
    },
  }));

  return { items, nextCursor: page.nextCursor };
}

function paginate<T>(items: T[], offset: number, limit: number): { slice: T[]; nextCursor: string | null } {
  const start = Math.min(Math.max(offset, 0), items.length);
  const slice = items.slice(start, start + limit);
  const nextOffset = start + slice.length;
  return { slice, nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null };
}

function filterFilesByRange(files: StoredProjectFile[], range: TimeRange | null): StoredProjectFile[] {
  if (!range) return files;
  return files.filter((file) => inRange(mtimeMsOf(file), range));
}

function inRange(ms: number, range: TimeRange): boolean {
  if (range.fromMs != null && ms < range.fromMs) return false;
  if (range.toMs != null && ms > range.toMs) return false;
  return true;
}

function mtimeMsOf(file: StoredProjectFile): number {
  const ms = Date.parse(file.mtime);
  return Number.isFinite(ms) ? ms : 0;
}

function readKindsWantsFiles(value: unknown): boolean {
  if (!Array.isArray(value)) return true;
  return value.includes('file');
}

function readTimeRange(value: unknown): TimeRange | null {
  if (!isRecord(value)) return null;
  const fromMs = readFiniteNumber(value.fromMs);
  const toMs = readFiniteNumber(value.toMs);
  if (fromMs == null && toMs == null) return null;
  const range: TimeRange = {};
  if (fromMs != null) range.fromMs = fromMs;
  if (toMs != null) range.toMs = toMs;
  return range;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

function decodeCursor(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const decoded = Number(Buffer.from(value, 'base64').toString('utf8'));
  return Number.isInteger(decoded) && decoded >= 0 ? decoded : 0;
}

function truncate(value: string | undefined, max: number): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) ? parsed : fallback;
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
