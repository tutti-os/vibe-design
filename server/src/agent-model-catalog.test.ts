import { describe, expect, it } from 'vitest';

import { projectAgentModelCatalog } from './agent-model-catalog.js';

describe('projectAgentModelCatalog', () => {
  it('returns sanitized models while preserving unavailable providers', () => {
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
      agentTargetId: 'local:codex',
      providerId: 'codex',
      label: 'Codex',
      supported: true,
      models: [{ id: 'default', label: 'Default' }],
    }, {
      agentTargetId: 'local:claude-code',
      providerId: 'claude-code',
      label: 'Claude Code',
      supported: false,
      models: [{ id: 'opus', label: 'Opus' }],
    }]);
  });

  it('keeps exact targets separate and omits an ambiguous legacy provider row', () => {
    expect(projectAgentModelCatalog([
      { agentTargetId: 'team:writer', providerId: 'codex', label: 'Writer', supported: true, authState: 'ok', models: [{ id: 'writer', label: 'Writer model' }] },
      { agentTargetId: 'team:reviewer', providerId: 'codex', label: 'Reviewer', supported: true, authState: 'ok', models: [{ id: 'reviewer', label: 'Reviewer model' }] },
      { id: 'codex', label: 'Legacy Codex', supported: true, authState: 'ok', models: [] },
    ])).toEqual([
      expect.objectContaining({ agentTargetId: 'team:writer', models: [{ id: 'writer', label: 'Writer model' }] }),
      expect.objectContaining({ agentTargetId: 'team:reviewer', models: [{ id: 'reviewer', label: 'Reviewer model' }] }),
    ]);
  });
});
