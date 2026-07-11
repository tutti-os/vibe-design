import { describe, expect, it } from 'vitest';

import { resolvePreSessionFallback } from './agent-availability.js';

describe('resolvePreSessionFallback', () => {
  it('returns a fallback for the canonical Claude Code provider', () => {
    expect(resolvePreSessionFallback([
      { id: 'codex', label: 'Codex', available: true },
      { id: 'claude-code', label: 'Claude Code', available: false, unavailableReason: 'Not authenticated.' },
    ], 'claude-code')).toMatchObject({
      fromAgentId: 'claude-code',
      toAgentId: 'codex',
      stage: 'pre-session',
    });
  });
});
