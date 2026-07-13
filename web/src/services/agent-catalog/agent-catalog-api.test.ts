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
        id: 'cursor',
        label: 'Cursor',
        supported: false,
        authState: 'missing',
      }],
    }), { status: 200 })));

    await expect(fetchAgentAvailability()).resolves.toEqual([{
      id: 'cursor',
      label: 'Cursor',
      supported: false,
      authState: 'missing',
    }]);
  });

  it('keeps dynamic model descriptions', () => {
    expect(readAgentModelCatalog({
      agents: [{
        id: 'opencode',
        label: 'OpenCode',
        models: [{ id: 'default', label: 'Default', description: 'CLI default' }],
      }],
    })).toEqual([{
      agentId: 'opencode',
      label: 'OpenCode',
      models: [{ id: 'default', label: 'Default', description: 'CLI default' }],
    }]);
  });
});
