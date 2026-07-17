import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { upsertProjectFileInStore } from './sqlite-store.js';
import type { ChatRun } from './types/run.js';

type ArtifactParserEvent =
  | { type: 'text'; delta: string }
  | { type: 'artifact:start'; identifier: string; artifactType: string; title: string }
  | { type: 'artifact:chunk'; identifier: string; delta: string }
  | { type: 'artifact:end'; identifier: string; fullContent: string };

interface ParsedArtifact {
  identifier: string;
  artifactType: string;
  title: string;
  html: string;
}

interface MaterializerState {
  parser: ReturnType<typeof createArtifactParser>;
  activeArtifact: ParsedArtifact | null;
}

interface MaterializeOptions {
  overwriteExisting: boolean;
}

const materializerStates = new Map<string, MaterializerState>();
const projectMaterializations = new Map<string, Promise<void>>();
const OPEN_PREFIX = '<artifact';
const CLOSE_TAG = '</artifact>';
const OVERWRITE_ARTIFACT: MaterializeOptions = { overwriteExisting: true };
const BACKFILL_ARTIFACT: MaterializeOptions = { overwriteExisting: false };

export function materializeArtifactRunEvent(projectsDir: string, run: ChatRun, event: unknown): Promise<void> {
  if (!run.projectId || !isRecord(event)) return Promise.resolve();

  const projectKey = materializerKey(projectsDir, run.projectId);
  const previous = projectMaterializations.get(projectKey) ?? Promise.resolve();
  let materialization: Promise<void>;
  materialization = previous
    // One failed disk write must not poison every event already queued behind
    // it. The failed caller still observes its own error, while the next event
    // starts from a clean per-run parser state below.
    .catch(() => undefined)
    .then(() => materializeArtifactRunEventNow(projectsDir, run, event));
  materialization = materialization.finally(() => {
    if (projectMaterializations.get(projectKey) === materialization) {
      projectMaterializations.delete(projectKey);
    }
  });
  projectMaterializations.set(projectKey, materialization);
  return materialization;
}

export async function waitForProjectArtifactMaterialization(projectsDir: string, projectId: string): Promise<void> {
  await projectMaterializations.get(materializerKey(projectsDir, projectId));
}

async function materializeArtifactRunEventNow(projectsDir: string, run: ChatRun, event: Record<string, unknown>): Promise<void> {
  if (!run.projectId) return;

  const key = materializerKey(projectsDir, run.id);
  const state = materializerStates.get(key) ?? createMaterializerState();
  materializerStates.set(key, state);

  try {
    await materializeArtifactEvent(projectsDir, run.projectId, state, event, OVERWRITE_ARTIFACT);
  } catch (error) {
    materializerStates.delete(key);
    throw error;
  }

  if (event.type === 'end' || event.type === 'error') {
    materializerStates.delete(key);
  }
}

export async function materializeProjectArtifactsFromEvents(
  projectsDir: string,
  projectId: string,
  events: unknown[],
): Promise<void> {
  const state = createMaterializerState();
  for (const event of events) {
    if (isRecord(event)) {
      await materializeArtifactEvent(projectsDir, projectId, state, event, BACKFILL_ARTIFACT);
    }
  }
  for (const parsed of state.parser.flush()) {
    await handleParserEvent(projectsDir, projectId, state, parsed, BACKFILL_ARTIFACT);
  }
}

async function materializeArtifactEvent(
  projectsDir: string,
  projectId: string,
  state: MaterializerState,
  event: Record<string, unknown>,
  options: MaterializeOptions,
): Promise<void> {
  if (event.type === 'text_delta') {
    const delta = typeof event.delta === 'string' ? event.delta : typeof event.text === 'string' ? event.text : '';
    if (delta) {
      for (const parsed of state.parser.feed(delta)) {
        await handleParserEvent(projectsDir, projectId, state, parsed, options);
      }
    }
    return;
  }

  if (event.type === 'end' || event.type === 'error') {
    for (const parsed of state.parser.flush()) {
      await handleParserEvent(projectsDir, projectId, state, parsed, options);
    }
  }
}

function createMaterializerState(): MaterializerState {
  return {
    parser: createArtifactParser(),
    activeArtifact: null,
  };
}

async function handleParserEvent(
  projectsDir: string,
  projectId: string,
  state: MaterializerState,
  event: ArtifactParserEvent,
  options: MaterializeOptions,
): Promise<void> {
  if (event.type === 'text') return;

  if (event.type === 'artifact:start') {
    state.activeArtifact = {
      identifier: event.identifier,
      artifactType: event.artifactType,
      title: event.title,
      html: '',
    };
    return;
  }

  if (event.type === 'artifact:chunk') {
    state.activeArtifact = state.activeArtifact
      ? { ...state.activeArtifact, html: `${state.activeArtifact.html}${event.delta}` }
      : { identifier: event.identifier, artifactType: '', title: '', html: event.delta };
    return;
  }

  const artifact = state.activeArtifact
    ? { ...state.activeArtifact, html: event.fullContent }
    : { identifier: event.identifier, artifactType: '', title: '', html: event.fullContent };
  state.activeArtifact = null;

  if (!isCompleteHtmlDocument(artifact.html)) return;

  const name = artifactFileName(artifact);
  const content = Buffer.from(artifact.html, 'utf8');
  const assetDir = path.join(projectsDir, projectId, 'assets');
  const assetPath = path.join(assetDir, name);
  await mkdir(assetDir, { recursive: true });
  let fileSize = content.length;
  if (options.overwriteExisting) {
    await writeFile(assetPath, content);
  } else {
    try {
      await writeFile(assetPath, content, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      fileSize = (await stat(assetPath)).size;
    }
  }
  upsertProjectFileInStore(projectsDir, projectId, {
    name,
    path: `assets/${name}`,
    size: fileSize,
    kind: 'html',
    mime: artifact.artifactType || 'text/html',
  });
}

function materializerKey(projectsDir: string, runId: string): string {
  return `${projectsDir}\0${runId}`;
}

function artifactFileName(artifact: Pick<ParsedArtifact, 'identifier' | 'title'>): string {
  const source = artifact.identifier || artifact.title || 'artifact';
  const safeBase = source
    .toLowerCase()
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'artifact';
  return `${safeBase}.html`;
}

function isCompleteHtmlDocument(html: string): boolean {
  const trimmed = html.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html');
}

interface ParserState {
  inside: boolean;
  buffer: string;
  identifier: string;
  artifactType: string;
  title: string;
  content: string;
}

function createArtifactParser() {
  const state: ParserState = {
    inside: false,
    buffer: '',
    identifier: '',
    artifactType: '',
    title: '',
    content: '',
  };

  function* feed(delta: string): Generator<ArtifactParserEvent> {
    state.buffer += delta;

    while (state.buffer.length > 0) {
      if (!state.inside) {
        const open = findOpenTag(state.buffer);
        if (open.kind === 'none') {
          yield { type: 'text', delta: state.buffer };
          state.buffer = '';
          return;
        }
        if (open.kind === 'partial') {
          if (open.start > 0) {
            yield { type: 'text', delta: state.buffer.slice(0, open.start) };
            state.buffer = state.buffer.slice(open.start);
          }
          return;
        }

        if (open.start > 0) {
          yield { type: 'text', delta: state.buffer.slice(0, open.start) };
        }
        const attrs = parseAttrs(open.attrs);
        state.inside = true;
        state.identifier = attrs.identifier ?? '';
        state.artifactType = attrs.type ?? '';
        state.title = attrs.title ?? '';
        state.content = '';
        state.buffer = state.buffer.slice(open.end);
        yield {
          type: 'artifact:start',
          identifier: state.identifier,
          artifactType: state.artifactType,
          title: state.title,
        };
        continue;
      }

      const closeIdx = state.buffer.indexOf(CLOSE_TAG);
      if (closeIdx === -1) {
        const flushUpTo = state.buffer.length - (CLOSE_TAG.length - 1);
        if (flushUpTo > 0) {
          const chunk = state.buffer.slice(0, flushUpTo);
          state.content += chunk;
          state.buffer = state.buffer.slice(flushUpTo);
          yield { type: 'artifact:chunk', identifier: state.identifier, delta: chunk };
        }
        return;
      }

      const finalChunk = state.buffer.slice(0, closeIdx);
      if (finalChunk) {
        state.content += finalChunk;
        yield { type: 'artifact:chunk', identifier: state.identifier, delta: finalChunk };
      }
      yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };
      state.buffer = state.buffer.slice(closeIdx + CLOSE_TAG.length);
      state.inside = false;
      state.identifier = '';
      state.artifactType = '';
      state.title = '';
      state.content = '';
    }
  }

  function* flush(): Generator<ArtifactParserEvent> {
    if (state.inside) {
      if (state.buffer) {
        state.content += state.buffer;
        yield { type: 'artifact:chunk', identifier: state.identifier, delta: state.buffer };
      }
      yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };
    } else if (state.buffer) {
      yield { type: 'text', delta: state.buffer };
    }
    state.inside = false;
    state.buffer = '';
    state.identifier = '';
    state.artifactType = '';
    state.title = '';
    state.content = '';
  }

  return { feed, flush };
}

type OpenTagMatch =
  | { kind: 'complete'; start: number; end: number; attrs: string }
  | { kind: 'partial'; start: number }
  | { kind: 'none' };

function findOpenTag(buffer: string): OpenTagMatch {
  const idx = buffer.indexOf(OPEN_PREFIX);
  if (idx === -1) {
    const tailLt = buffer.lastIndexOf('<');
    if (tailLt >= 0 && OPEN_PREFIX.startsWith(buffer.slice(tailLt))) {
      return { kind: 'partial', start: tailLt };
    }
    return { kind: 'none' };
  }

  const afterPrefix = idx + OPEN_PREFIX.length;
  const next = buffer.charAt(afterPrefix);
  if (next && !/[\s>]/.test(next)) {
    return { kind: 'none' };
  }

  let quote: '"' | "'" | null = null;
  for (let pos = afterPrefix; pos < buffer.length; pos += 1) {
    const char = buffer.charAt(pos);
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      return {
        kind: 'complete',
        start: idx,
        end: pos + 1,
        attrs: buffer.slice(afterPrefix, pos),
      };
    }
  }

  return { kind: 'partial', start: idx };
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = attrRe.exec(raw);
  while (match) {
    attrs[match[1] as string] = (match[2] ?? match[3] ?? '') as string;
    match = attrRe.exec(raw);
  }
  return attrs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
