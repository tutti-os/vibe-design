import { describe, expect, it } from 'vitest';
import { latestTodoWriteInputForPinnedCard, parseTodoWriteInput } from './todos';
import type { AgentEvent, ChatMessage } from '../types';

describe('todo runtime helpers', () => {
  it('normalizes TodoWrite todos and stopped terminal in-progress rows', () => {
    expect(
      parseTodoWriteInput({
        todos: [
          { content: 'Read source', status: 'completed' },
          { step: 'Write target', status: 'in_progress', active_form: 'coding' },
        ],
      }),
    ).toEqual([
      { content: 'Read source', status: 'completed', activeForm: undefined },
      { content: 'Write target', status: 'in_progress', activeForm: 'coding' },
    ]);

    const event: AgentEvent = {
      type: 'tool_use',
      id: 'tool-1',
      name: 'TodoWrite',
      input: { todos: [{ content: 'Write target', status: 'in_progress' }] },
    };
    const messages: ChatMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        events: [event],
        runStatus: 'failed',
        endedAt: 1,
      },
    ];

    expect(latestTodoWriteInputForPinnedCard(messages)).toEqual({
      todos: [{ content: 'Write target', status: 'stopped' }],
    });
  });
});
