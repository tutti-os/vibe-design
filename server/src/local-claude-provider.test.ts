import { describe, expect, it } from 'vitest';
import { parseClaudeAuthStatus, parseVibeClaudeStreamEvent } from './local-claude-provider.js';

describe('parseVibeClaudeStreamEvent', () => {
  it('extracts text from current Claude stream-json assistant messages', () => {
    const events = parseVibeClaudeStreamEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'OK' }],
      },
    });

    expect(events).toEqual([{ type: 'text_delta', text: 'OK' }]);
  });
});

describe('parseClaudeAuthStatus', () => {
  it('reports ok when Claude auth status says the user is logged in', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}')).toBe('ok');
  });

  it('reports missing when Claude auth status says the user is logged out', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBe('missing');
  });

  it('keeps malformed Claude auth status as unknown', () => {
    expect(parseClaudeAuthStatus('not json')).toBe('unknown');
  });
});
