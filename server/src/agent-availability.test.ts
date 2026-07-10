import { describe, expect, it } from 'vitest';

import { resolvePreSessionFallback } from './agent-availability.js';

describe('resolvePreSessionFallback', () => {
  it('accepts the legacy Claude alias and returns a canonical fallback target', () => {
    expect(resolvePreSessionFallback([
      { id: 'codex', label: 'Codex', available: true },
      { id: 'claude-code', label: 'Claude Code', available: false, unavailableReason: 'Not authenticated.' },
    ], 'claude')).toMatchObject({
      fromAgentId: 'claude',
      toAgentId: 'codex',
      stage: 'pre-session',
    });
  });
});
