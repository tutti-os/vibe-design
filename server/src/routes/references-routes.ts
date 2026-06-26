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
const DISPLAY_NAME_MAX_LENGTH = 160;
const DESCRIPTION_MAX_LENGTH = 140;
// Tutti already trims the query; this is a defensive bound mirroring the daemon.
const SEARCH_QUERY_MAX_LENGTH = 200;

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

interface SearchOptions {
  query: string;
  limit: number;
  offset: number;
  timeRange: TimeRange | null;
  filters: Set<FileCategory> | null;
  wantsFiles: boolean;
}

type ProjectSummary = ReturnType<typeof listProjectSummariesFromStore>[number];

interface MatchedFile {
  project: ProjectSummary;
  file: StoredProjectFile;
  // null in filter-only search (empty query), where recency decides order.
  score: number | null;
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

  // Implements the Tutti "Reference Search Runtime Protocol": a recursive search
  // across every project's assets (not a single group's direct children like the
  // list filterText). Returns a flat, relevance-ordered list of file references
  // with a 0..1 `score`; search never returns group items.
  app.post('/tutti/references/search', (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    const rawQuery = readString(body.query);
    const query = rawQuery ? rawQuery.slice(0, SEARCH_QUERY_MAX_LENGTH).toLowerCase() : '';
    const filters = readFilters(body.filters);
    // Filtering and search are one capability: either a non-empty query or a
    // non-empty filter set is a valid request. Nothing to match → empty result.
    if (!query && !filters) {
      res.json({ items: [], nextCursor: null });
      return;
    }

    const options: SearchOptions = {
      query,
      limit: clamp(readInteger(body.limit, MAX_PAGE_LIMIT), 1, MAX_PAGE_LIMIT),
      offset: decodeCursor(body.cursor),
      timeRange: readTimeRange(body.timeRange),
      filters,
      wantsFiles: readKindsWantsFiles(body.kinds),
    };

    res.json(searchProjectFileReferences(ctx.paths.projectsDir, options));
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
      displayName: truncate(project.title, DISPLAY_NAME_MAX_LENGTH),
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

function searchProjectFileReferences(projectsDir: string, options: SearchOptions): unknown {
  if (!options.wantsFiles) {
    return { items: [], nextCursor: null };
  }

  const projects = listProjectSummariesFromStore(projectsDir, PROJECT_SCAN_LIMIT);
  const matches: MatchedFile[] = [];
  for (const project of projects) {
    const files = filterFilesByRange(listProjectFilesFromStore(projectsDir, project.id), options.timeRange);
    for (const file of files) {
      if (!isSafeFileName(file.name)) continue;
      // Result = intersection of the file-name query and the file-type filters.
      // OR semantics across the requested categories.
      if (options.filters && !options.filters.has(categoryOf(file.name))) continue;
      if (!options.query) {
        // Filter-only search: every file passing the category/time filters is a
        // match; recency decides order, so no relevance score is attached.
        matches.push({ project, file, score: null });
        continue;
      }
      // The query matches against the file name only, never the project title.
      const score = scoreText(file.name.toLowerCase(), options.query);
      if (score <= 0) continue;
      matches.push({ project, file, score });
    }
  }

  if (options.query) {
    // Descending relevance; stable tie-break by name so cursor paging is deterministic.
    matches.sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.file.name.localeCompare(right.file.name));
  } else {
    // Filter-only: newest first, with the same stable name tie-break.
    matches.sort((left, right) => mtimeMsOf(right.file) - mtimeMsOf(left.file) || left.file.name.localeCompare(right.file.name));
  }

  const page = paginate(matches, options.offset, options.limit);
  const items = page.slice.map(({ project, file, score }) => ({
    type: 'reference',
    reference: {
      kind: 'file',
      displayName: file.name,
      location: {
        type: 'app-data-relative',
        path: `projects/${project.id}/assets/${file.name}`,
      },
      sizeBytes: file.size,
      mtimeMs: mtimeMsOf(file),
      mimeType: file.mime,
      // Omitted in filter-only search so Tutti preserves the recency order.
      ...(score != null ? { score: roundScore(score) } : {}),
      // Owning project's title: shown as the result's context subtitle so users
      // can tell which project a flattened search hit belongs to.
      parentGroupLabel: truncate(project.title, DISPLAY_NAME_MAX_LENGTH),
    },
  }));

  return { items, nextCursor: page.nextCursor };
}

// Relevance score in [0, 1]: exact > prefix > substring; 0 means no match.
function scoreText(haystack: string, query: string): number {
  if (!haystack) return 0;
  if (haystack === query) return 1;
  if (haystack.startsWith(query)) return 0.9;
  if (haystack.includes(query)) return 0.7;
  return 0;
}

function roundScore(score: number): number {
  return Math.round(clamp(score, 0, 1) * 100) / 100;
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

// Global file-type categories from the Tutti reference search protocol. Every
// file resolves to exactly one; unrecognized extensions fall into `other`.
// Authoritative source: Tutti packages/workspace/file-reference/src/core/referenceFilterCategories.ts.
// `document` includes spreadsheets; audio/code/archive extensions are not listed
// and therefore resolve to `other`.
type FileCategory = 'image' | 'video' | 'document' | 'webpage' | 'other';

const KNOWN_CATEGORIES = new Set<FileCategory>([
  'image',
  'video',
  'document',
  'webpage',
  'other',
]);

// Lowercase extension (no dot) → category. Anything absent maps to `other`.
const EXTENSION_CATEGORY: Readonly<Record<string, FileCategory>> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', ico: 'image', tiff: 'image', tif: 'image', avif: 'image', heic: 'image',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', m4v: 'video',
  pdf: 'document', doc: 'document', docx: 'document', md: 'document', markdown: 'document',
  txt: 'document', rtf: 'document', odt: 'document', pages: 'document', key: 'document',
  ppt: 'document', pptx: 'document',
  xls: 'document', xlsx: 'document', csv: 'document', tsv: 'document', ods: 'document',
  numbers: 'document',
  html: 'webpage', htm: 'webpage', mhtml: 'webpage', url: 'webpage', webloc: 'webpage',
};

function categoryOf(fileName: string): FileCategory {
  const dot = fileName.lastIndexOf('.');
  // No dot, leading-dot (dotfile), or trailing-dot name has no usable extension.
  if (dot <= 0 || dot === fileName.length - 1) return 'other';
  return EXTENSION_CATEGORY[fileName.slice(dot + 1).toLowerCase()] ?? 'other';
}

// Parses the `filters` array into a category set, ignoring unknown ids. Returns
// null when no recognized category remains, meaning "no category constraint".
function readFilters(value: unknown): Set<FileCategory> | null {
  if (!Array.isArray(value)) return null;
  const set = new Set<FileCategory>();
  for (const entry of value) {
    if (typeof entry === 'string' && KNOWN_CATEGORIES.has(entry as FileCategory)) {
      set.add(entry as FileCategory);
    }
  }
  return set.size > 0 ? set : null;
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
