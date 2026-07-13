import { describe, expect, it } from 'vitest';

import { projectAgentModelCatalog } from './agent-model-catalog.js';

describe('projectAgentModelCatalog', () => {
  it('returns sanitized models only for supported providers', () => {
    expect(projectAgentModelCatalog([
      {
        id: 'codex',
        label: 'Codex',
        supported: true,
        authState: 'ok',
        models: [
          { id: ' default ', label: ' Default ' },
          { id: 'default', label: 'Duplicate' },
          { id: '', label: 'Invalid' },
        ],
      },
      {
        id: 'claude-code',
        label: 'Claude Code',
        supported: false,
        authState: 'missing',
        models: [{ id: 'opus', label: 'Opus' }],
        reason: 'Authentication required.',
      },
    ])).toEqual([{
      id: 'codex',
      label: 'Codex',
      models: [{ id: 'default', label: 'Default' }],
    }]);
  });
});
