import { describe, expect, it } from 'vitest';
import { NESTED_CLAUDE_SESSION_ENV_VARS, scrubNestedClaudeSessionEnv } from './nested-session-env.js';

describe('scrubNestedClaudeSessionEnv', () => {
  it('removes leaked nested-session markers and reports them', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '4242',
      PATH: '/usr/bin',
    };

    const removed = scrubNestedClaudeSessionEnv(env);

    expect(removed.sort()).toEqual([...NESTED_CLAUDE_SESSION_ENV_VARS].sort());
    for (const key of NESTED_CLAUDE_SESSION_ENV_VARS) {
      expect(key in env).toBe(false);
    }
    expect(env.PATH).toBe('/usr/bin');
  });

  it('is a no-op when no markers are present', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };

    expect(scrubNestedClaudeSessionEnv(env)).toEqual([]);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('only removes markers that are actually set', () => {
    const env: NodeJS.ProcessEnv = { CLAUDECODE: '1' };

    expect(scrubNestedClaudeSessionEnv(env)).toEqual(['CLAUDECODE']);
    expect('CLAUDECODE' in env).toBe(false);
  });
});
