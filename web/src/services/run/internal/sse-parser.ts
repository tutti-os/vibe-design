import type { AgentEvent } from '../../../types';

const SUPPORTED_AGENT_EVENT_TYPES = new Set([
  'status',
  'text_delta',
  'thinking_delta',
  'thinking_start',
  'tool_use',
  'tool_result',
  'usage',
  'turn_end',
  'error',
  'end',
  'raw',
]);

export interface SseParseState {
  buffer: string;
  eventType: string;
  eventId?: string;
  dataLines: string[];
}

export function createSseParseState(): SseParseState {
  return {
    buffer: '',
    eventType: 'message',
    dataLines: [],
  };
}

export function parseSseChunkLines(state: SseParseState, chunk: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  state.buffer += chunk;

  let lineEndIndex = findLineEndIndex(state.buffer);
  while (lineEndIndex !== -1) {
    if (state.buffer[lineEndIndex] === '\r' && lineEndIndex === state.buffer.length - 1) {
      break;
    }
    const rawLine = state.buffer.slice(0, lineEndIndex);
    const nextOffset = state.buffer[lineEndIndex] === '\r' && state.buffer[lineEndIndex + 1] === '\n' ? 2 : 1;
    state.buffer = state.buffer.slice(lineEndIndex + nextOffset);
    consumeSseLine(state, rawLine, events);
    lineEndIndex = findLineEndIndex(state.buffer);
  }

  return events;
}

function consumeSseLine(state: SseParseState, rawLine: string, events: AgentEvent[]): void {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

  if (line === '') {
    const event = dispatchEvent(state);
    if (event) {
      events.push(event);
    }
    resetFrame(state);
    return;
  }

  if (line.startsWith(':')) {
    return;
  }

  const separatorIndex = line.indexOf(':');
  const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
  const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
  const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

  if (field === 'event') {
    state.eventType = value || 'message';
    return;
  }

  if (field === 'id') {
    state.eventId = value;
    return;
  }

  if (field === 'data') {
    state.dataLines.push(value);
  }
}

function dispatchEvent(state: SseParseState): AgentEvent | null {
  if (state.dataLines.length === 0) {
    return null;
  }

  const line = state.dataLines.join('\n');
  const eventId = normalizeEventId(state.eventId);

  if (!SUPPORTED_AGENT_EVENT_TYPES.has(state.eventType)) {
    return { type: 'raw', eventId, line };
  }

  try {
    const payload = JSON.parse(line);
    if (!isObject(payload)) {
      return { type: 'raw', eventId, line };
    }
    return {
      ...payload,
      type: state.eventType,
      ...(eventId !== null ? { eventId } : {}),
    } as AgentEvent;
  } catch {
    return { type: 'raw', eventId, line };
  }
}

function resetFrame(state: SseParseState): void {
  state.eventType = 'message';
  state.eventId = undefined;
  state.dataLines = [];
}

function findLineEndIndex(value: string): number {
  const newlineIndex = value.indexOf('\n');
  const carriageReturnIndex = value.indexOf('\r');

  if (newlineIndex === -1) {
    return carriageReturnIndex;
  }

  if (carriageReturnIndex === -1) {
    return newlineIndex;
  }

  return Math.min(newlineIndex, carriageReturnIndex);
}

function normalizeEventId(value: string | undefined): number | string | null {
  if (value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && String(numericValue) === value ? numericValue : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
