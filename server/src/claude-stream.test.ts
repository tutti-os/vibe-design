import { describe, expect, it } from 'vitest';
import { createClaudeStreamHandler, type AgentEvent } from './claude-stream.js';

function collect() {
  const events: AgentEvent[] = [];
  return { events, handler: createClaudeStreamHandler((event) => events.push(event)) };
}

function jsonl(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

describe('createClaudeStreamHandler', () => {
  it('maps system, text, thinking, tool, user result, usage, and raw events', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'system', subtype: 'init', model: 'sonnet', session_id: 's1' }));
    handler.feed(jsonl({ type: 'system', subtype: 'status', status: 'thinking' }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' }, ttft_ms: 12 } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool-1', name: 'AskUserQuestion' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"question":"Ready?"}' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_stop', index: 2 } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-1', name: 'AskUserQuestion', input: {} }] } }));
    handler.feed(jsonl({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'Yes' }], is_error: false }] } }));
    handler.feed(jsonl({ type: 'result', usage: { input_tokens: 1 }, total_cost_usd: 0.01, duration_ms: 20, stop_reason: 'tool_use' }));
    handler.feed('not json\n');

    expect(events.map((event) => event.type)).toEqual([
      'status',
      'status',
      'status',
      'thinking_start',
      'thinking_delta',
      'text_delta',
      'tool_use',
      'turn_end',
      'tool_result',
      'usage',
      'raw',
    ]);
    expect(events.find((event) => event.type === 'tool_use')).toMatchObject({
      id: 'tool-1',
      name: 'AskUserQuestion',
      input: { question: 'Ready?' },
    });
  });

  it('emits assistant wrapper text when no stream delta arrived', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-old', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Final text' }] } }));
    expect(events).toEqual([
      { type: 'text_delta', delta: 'Final text' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('emits multiple assistant wrapper text blocks when no stream delta arrived', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-text-blocks', stop_reason: 'end_turn', content: [{ type: 'text', text: 'First text' }, { type: 'text', text: 'Second text' }] } }));

    expect(events).toEqual([
      { type: 'text_delta', delta: 'First text' },
      { type: 'text_delta', delta: 'Second text' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('tracks wrapper text fallback per message', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-streamed' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Streamed text' } } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-wrapper', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Wrapper text' }] } }));

    expect(events).toEqual([
      { type: 'text_delta', delta: 'Streamed text' },
      { type: 'text_delta', delta: 'Wrapper text' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('does not share text and thinking fallback state across anonymous messages', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: {} } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Anonymous streamed' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'Anonymous thinking' } } }));
    handler.feed(jsonl({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Skipped wrapper' }, { type: 'thinking', thinking: 'Skipped thinking' }] } }));
    handler.feed(jsonl({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Second wrapper' }, { type: 'thinking', thinking: 'Second thinking' }] } }));

    expect(events).toEqual([
      { type: 'text_delta', delta: 'Anonymous streamed' },
      { type: 'thinking_delta', delta: 'Anonymous thinking' },
      { type: 'turn_end', stopReason: 'end_turn' },
      { type: 'text_delta', delta: 'Second wrapper' },
      { type: 'thinking_delta', delta: 'Second thinking' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('emits assistant wrapper thinking when a thinking block started without a delta', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-thinking' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-thinking', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'Wrapper thinking' }] } }));

    expect(events).toEqual([
      { type: 'thinking_start' },
      { type: 'thinking_delta', delta: 'Wrapper thinking' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('emits multiple assistant wrapper thinking blocks when no thinking delta arrived', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-thinking-blocks', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'First thought' }, { type: 'thinking', thinking: 'Second thought' }] } }));

    expect(events).toEqual([
      { type: 'thinking_delta', delta: 'First thought' },
      { type: 'thinking_delta', delta: 'Second thought' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('emits assistant wrapper tool use before turn end when no stream tool use emitted', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-tool', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-wrapper', name: 'AskUserQuestion', input: { question: 'Continue?' } }] } }));

    expect(events).toEqual([
      { type: 'tool_use', id: 'tool-wrapper', name: 'AskUserQuestion', input: { question: 'Continue?' } },
      { type: 'turn_end', stopReason: 'tool_use' },
    ]);
  });

  it('only suppresses a streamed tool use wrapper duplicate once', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-tool-reuse' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-reuse', name: 'AskUserQuestion' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"question":"Streamed?"}' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-tool-reuse', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-reuse', name: 'AskUserQuestion', input: { question: 'Duplicate?' } }] } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-tool-later', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-reuse', name: 'AskUserQuestion', input: { question: 'Later reuse?' } }] } }));

    expect(events).toEqual([
      { type: 'tool_use', id: 'tool-reuse', name: 'AskUserQuestion', input: { question: 'Streamed?' } },
      { type: 'turn_end', stopReason: 'tool_use' },
      { type: 'tool_use', id: 'tool-reuse', name: 'AskUserQuestion', input: { question: 'Later reuse?' } },
      { type: 'turn_end', stopReason: 'tool_use' },
    ]);
  });

  it('falls back to assistant wrapper tool use when streamed tool input is malformed', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-tool-bad' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-bad', name: 'AskUserQuestion' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"question":' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-tool-bad', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-bad', name: 'AskUserQuestion', input: { question: 'Recovered?' } }] } }));

    expect(events).toEqual([
      { type: 'tool_use', id: 'tool-bad', name: 'AskUserQuestion', input: { question: 'Recovered?' } },
      { type: 'turn_end', stopReason: 'tool_use' },
    ]);
  });

  it('falls back to assistant wrapper tool use when streamed tool input is empty', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-tool-empty' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-empty', name: 'AskUserQuestion' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-tool-empty', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-empty', name: 'AskUserQuestion', input: { question: 'Recovered from wrapper?' } }] } }));

    expect(events).toEqual([
      { type: 'tool_use', id: 'tool-empty', name: 'AskUserQuestion', input: { question: 'Recovered from wrapper?' } },
      { type: 'turn_end', stopReason: 'tool_use' },
    ]);
  });

  it('guards text deltas but not thinking deltas', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-guard' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Consider\n## user\ninside thinking' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'OK\n## user\nbad' } } }));
    expect(events.some((event) => event.type === 'fabricated_role_marker')).toBe(true);
    expect(events.filter((event) => event.type === 'thinking_delta').map((event) => event.delta).join('')).toContain('## user');
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.delta).join('')).toBe('OK');
  });

  it('suppresses wrapper text after a fully guarded stream text delta', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-suppressed' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '## user\nbad' } } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-suppressed', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Wrapper should not emit' }] } }));

    expect(events.some((event) => event.type === 'fabricated_role_marker')).toBe(true);
    expect(events.filter((event) => event.type === 'text_delta')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'turn_end', stopReason: 'end_turn' });
  });

  it('suppresses wrapper text after a stream text delta with no safe output', () => {
    const { events, handler } = collect();
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm-empty-safe' } } }));
    handler.feed(jsonl({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '  ' } } }));
    handler.feed(jsonl({ type: 'assistant', message: { id: 'm-empty-safe', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Wrapper should not emit' }] } }));

    expect(events).toEqual([{ type: 'turn_end', stopReason: 'end_turn' }]);
  });
});
