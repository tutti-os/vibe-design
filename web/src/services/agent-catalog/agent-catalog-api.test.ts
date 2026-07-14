import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAgentAvailability,
  readAgentModelCatalog,
} from './agent-catalog-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent catalog API', () => {
  it('maps availability responses behind the API adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      agentAvailability: [{
        agentTargetId: 'team:cursor',
        providerId: 'cursor',
        label: 'Cursor',
        supported: false,
        authState: 'missing',
      }],
    }), { status: 200 })));

    await expect(fetchAgentAvailability()).resolves.toEqual([{
      agentTargetId: 'team:cursor',
      providerId: 'cursor',
      label: 'Cursor',
      supported: false,
      authState: 'missing',
    }]);
  });

  it('keeps dynamic model descriptions', () => {
    expect(readAgentModelCatalog({
      agents: [{
        agentTargetId: 'team:opencode',
        providerId: 'opencode',
        label: 'OpenCode',
        supported: false,
        models: [{ id: 'default', label: 'Default', description: 'CLI default' }],
      }],
    })).toEqual([{
      agentTargetId: 'team:opencode',
      providerId: 'opencode',
      label: 'OpenCode',
      supported: false,
      models: [{ id: 'default', label: 'Default', description: 'CLI default' }],
    }]);
  });

  it('normalizes a legacy provider catalog without losing its entries', () => {
    expect(readAgentModelCatalog({
      agents: [{ id: 'codex', label: 'Codex', supported: true, models: [] }],
    })).toEqual([{
      agentTargetId: 'local:codex',
      providerId: 'codex',
      label: 'Codex',
      supported: true,
      models: [],
    }]);
  });

  it('does not map a legacy row over an ambiguous exact provider catalog', () => {
    expect(() => readAgentModelCatalog({
      agents: [
        { agentTargetId: 'team:a', providerId: 'codex', label: 'A', supported: true, models: [] },
        { agentTargetId: 'team:b', providerId: 'codex', label: 'B', supported: true, models: [] },
        { id: 'codex', label: 'Legacy Codex', supported: true, models: [] },
      ],
    })).toThrow('Legacy agent provider codex is ambiguous');
  });

  it('treats claude and claude-code as the same provider for ambiguity checks', () => {
    expect(() => readAgentModelCatalog({
      agents: [
        { agentTargetId: 'team:a', providerId: 'claude-code', label: 'A', supported: true, models: [] },
        { agentTargetId: 'team:b', providerId: 'claude', label: 'B', supported: true, models: [] },
        { id: 'claude', label: 'Legacy Claude', supported: true, models: [] },
      ],
    })).toThrow('Legacy agent provider claude is ambiguous');
  });

  it('rejects catalog entries without an explicit support state', () => {
    expect(readAgentModelCatalog({
      agents: [{
        id: 'opencode',
        label: 'OpenCode',
        models: [],
      }],
    })).toEqual([]);
  });
});
