export type ArtifactParserEvent =
  | { type: 'text'; delta: string }
  | { type: 'artifact:start'; identifier: string; artifactType: string; title: string }
  | { type: 'artifact:chunk'; identifier: string; delta: string }
  | { type: 'artifact:end'; identifier: string; fullContent: string };

const OPEN_PREFIX = '<artifact';
const CLOSE_TAG = '</artifact>';

interface ParserState {
  inside: boolean;
  buffer: string;
  identifier: string;
  artifactType: string;
  title: string;
  content: string;
}

export function createArtifactParser() {
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
