export type FileOutputProtocolEvent =
  | { type: 'text'; delta: string }
  | { type: 'file:start'; path: string; mime: string }
  | { type: 'file:chunk'; path: string; delta: string }
  | { type: 'file:end'; path: string; mime: string; fullContent: string };

const OPEN_PREFIX = '<vibe-file';
const CLOSE_TAG = '</vibe-file>';

interface ParserState {
  inside: boolean;
  buffer: string;
  path: string;
  mime: string;
  content: string;
}

export function createFileOutputProtocolParser() {
  const state: ParserState = {
    inside: false,
    buffer: '',
    path: '',
    mime: '',
    content: '',
  };

  function* feed(delta: string): Generator<FileOutputProtocolEvent> {
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
        state.path = attrs.path ?? '';
        state.mime = attrs.mime ?? '';
        state.content = '';
        state.buffer = state.buffer.slice(open.end);
        yield { type: 'file:start', path: state.path, mime: state.mime };
        continue;
      }

      const closeIndex = state.buffer.toLowerCase().indexOf(CLOSE_TAG);
      if (closeIndex === -1) {
        const keep = Math.max(0, CLOSE_TAG.length - 1);
        if (state.buffer.length <= keep) return;
        const chunk = state.buffer.slice(0, state.buffer.length - keep);
        state.content += chunk;
        state.buffer = state.buffer.slice(state.buffer.length - keep);
        yield { type: 'file:chunk', path: state.path, delta: chunk };
        return;
      }

      const finalChunk = state.buffer.slice(0, closeIndex);
      if (finalChunk) {
        state.content += finalChunk;
        yield { type: 'file:chunk', path: state.path, delta: finalChunk };
      }
      yield { type: 'file:end', path: state.path, mime: state.mime, fullContent: state.content };
      state.inside = false;
      state.path = '';
      state.mime = '';
      state.content = '';
      state.buffer = state.buffer.slice(closeIndex + CLOSE_TAG.length);
    }
  }

  function* flush(): Generator<FileOutputProtocolEvent> {
    if (state.inside) {
      const escaped = `${OPEN_PREFIX}${state.path ? ` path="${state.path}"` : ''}${state.mime ? ` mime="${state.mime}"` : ''}>${state.content}${state.buffer}`;
      resetState();
      if (escaped) yield { type: 'text', delta: escaped };
      return;
    }

    if (state.buffer) {
      yield { type: 'text', delta: state.buffer };
      state.buffer = '';
    }
  }

  return { feed, flush };

  function resetState(): void {
    state.inside = false;
    state.buffer = '';
    state.path = '';
    state.mime = '';
    state.content = '';
  }
}

function findOpenTag(buffer: string):
  | { kind: 'none' }
  | { kind: 'partial'; start: number }
  | { kind: 'complete'; start: number; end: number; attrs: string } {
  const lower = buffer.toLowerCase();
  const start = lower.indexOf(OPEN_PREFIX);
  if (start === -1) {
    const partialStart = findPartialPrefixStart(lower);
    return partialStart === -1 ? { kind: 'none' } : { kind: 'partial', start: partialStart };
  }

  const end = buffer.indexOf('>', start);
  if (end === -1) return { kind: 'partial', start };

  return {
    kind: 'complete',
    start,
    end: end + 1,
    attrs: buffer.slice(start + OPEN_PREFIX.length, end),
  };
}

function findPartialPrefixStart(buffer: string): number {
  const max = Math.min(buffer.length, OPEN_PREFIX.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (OPEN_PREFIX.startsWith(buffer.slice(buffer.length - length))) {
      return buffer.length - length;
    }
  }
  return -1;
}

function parseAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of value.matchAll(attrRe)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}
