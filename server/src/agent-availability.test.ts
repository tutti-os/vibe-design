import { describe, expect, it } from 'vitest';

import {
  projectAgentAvailability,
  resolveAvailableAgentTarget,
} from './agent-availability.js';

const agents = [
  {
    agentTargetId: 'team:writer',
    providerId: 'codex',
    label: 'Writer',
    supported: true,
    authState: 'ok' as const,
    isDefault: true as const,
  },
  {
    agentTargetId: 'team:reviewer',
    providerId: 'codex',
    label: 'Reviewer',
    supported: true,
    authState: 'ok' as const,
  },
];

describe('resolveAvailableAgentTarget', () => {
  it('uses the daemon-selected exact default target', () => {
    expect(resolveAvailableAgentTarget(agents, {})).toMatchObject({
      agentTargetId: 'team:writer',
      providerId: 'codex',
    });
  });

  it('fails closed when the daemon-selected default target is unavailable', () => {
    expect(() => resolveAvailableAgentTarget([
      { ...agents[0]!, supported: false, unavailableReason: 'Writer is offline.' },
      agents[1]!,
    ], {})).toThrow('Writer is offline.');
  });

  it('fails closed for an ambiguous legacy provider', () => {
    expect(() => resolveAvailableAgentTarget(agents, { legacyProviderId: 'codex' }))
      .toThrow('Multiple agent targets use legacy provider codex');
  });

  it('migrates an old CLI agent-id through a unique full-catalog provider mapping', () => {
    expect(resolveAvailableAgentTarget(
      [agents[0]!],
      {
        agentTargetId: 'codex',
        allowLegacyProviderFallbackForAgentTargetId: true,
      },
    )).toMatchObject({ agentTargetId: 'team:writer', providerId: 'codex' });
  });

  it('preserves the historical claude provider alias during unique migration', () => {
    expect(resolveAvailableAgentTarget(
      [{
        agentTargetId: 'local:claude-code',
        providerId: 'claude-code',
        label: 'Claude Code',
        supported: true,
        authState: 'ok',
      }],
      { legacyProviderId: 'claude' },
    )).toMatchObject({ agentTargetId: 'local:claude-code', providerId: 'claude-code' });
  });

  it('does not guess an old CLI agent-id when its provider maps to multiple targets', () => {
    expect(() => resolveAvailableAgentTarget(
      agents,
      {
        agentTargetId: 'codex',
        allowLegacyProviderFallbackForAgentTargetId: true,
      },
    )).toThrow('Multiple agent targets use legacy provider codex');
  });
});

describe('projectAgentAvailability', () => {
  it('preserves multiple exact targets that share one provider', () => {
    expect(projectAgentAvailability([
      { agentTargetId: 'team:writer', providerId: 'codex', label: 'Writer', supported: true, authState: 'ok', models: [] },
      { agentTargetId: 'team:reviewer', providerId: 'codex', label: 'Reviewer', supported: true, authState: 'ok', models: [] },
    ])).toEqual([
      expect.objectContaining({ agentTargetId: 'team:writer', providerId: 'codex' }),
      expect.objectContaining({ agentTargetId: 'team:reviewer', providerId: 'codex' }),
    ]);
  });

  it('omits ambiguous legacy provider rows from a full exact-target catalog', () => {
    expect(projectAgentAvailability([
      { agentTargetId: 'team:writer', providerId: 'codex', label: 'Writer', supported: true, authState: 'ok', models: [] },
      { agentTargetId: 'team:reviewer', providerId: 'codex', label: 'Reviewer', supported: true, authState: 'ok', models: [] },
      { id: 'codex', label: 'Legacy Codex', supported: true, authState: 'ok', models: [] },
    ])).toHaveLength(2);
  });
});
