import { describe, expect, it } from 'vitest';
import { createSseParseState, parseSseChunkLines } from './sse-parser';

describe('sse parser', () => {
  it('uses the event field as AgentEvent.type', () => {
    const state = createSseParseState();

    const events = parseSseChunkLines(
      state,
      'id: 7\nevent: text_delta\ndata: {"type":"wrong","delta":"Hi"}\n\n',
    );

    expect(events).toEqual([{ type: 'text_delta', eventId: 7, delta: 'Hi' }]);
  });

  it('preserves SSE id as eventId instead of id', () => {
    const state = createSseParseState();

    const events = parseSseChunkLines(
      state,
      'id: 7\nevent: status\ndata: {"label":"Running"}\n\n',
    );

    expect(events).toEqual([{ type: 'status', eventId: 7, label: 'Running' }]);
    expect(events[0]).not.toHaveProperty('id');
  });

  it('keeps tool_use id separate from the transport eventId', () => {
    const state = createSseParseState();

    const events = parseSseChunkLines(
      state,
      'id: 7\nevent: tool_use\ndata: {"id":"tool-1","name":"Read","input":{}}\n\n',
    );

    expect(events).toEqual([{ type: 'tool_use', eventId: 7, id: 'tool-1', name: 'Read', input: {} }]);
  });

  it('returns raw events with eventId for malformed JSON', () => {
    const state = createSseParseState();

    const events = parseSseChunkLines(state, 'id: 7\nevent: text_delta\ndata: nope\n\n');

    expect(events).toEqual([{ type: 'raw', eventId: 7, line: 'nope' }]);
  });

  it('returns raw events for unsupported event names', () => {
    const state = createSseParseState();

    const events = parseSseChunkLines(state, 'id: 7\nevent: custom_event\ndata: {"delta":"Hi"}\n\n');

    expect(events).toEqual([{ type: 'raw', eventId: 7, line: '{"delta":"Hi"}' }]);
  });

  it('returns raw events for default message frames', () => {
    const state = createSseParseState();

    const events = parseSseChunkLines(state, 'id: 7\ndata: {"delta":"Hi"}\n\n');

    expect(events).toEqual([{ type: 'raw', eventId: 7, line: '{"delta":"Hi"}' }]);
  });

  it('keeps reading a frame when a CRLF line ending is split across chunks', () => {
    const state = createSseParseState();

    expect(parseSseChunkLines(state, 'event: text_delta\r')).toEqual([]);
    expect(parseSseChunkLines(state, '\ndata: {"delta":"Hi"}\r\n\r\n')).toEqual([
      { type: 'text_delta', delta: 'Hi' },
    ]);
  });
});
