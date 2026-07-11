import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCatalogService } from './agent-catalog-service';

describe('AgentCatalogService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('caches a successful load and retains it when an explicit refresh fails', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({
        agents: [{ id: 'tutti-agent', label: 'Tutti Agent', models: [] }],
      }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'temporary' } }, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const service = new AgentCatalogService();

    await service.ensureLoaded();
    await service.ensureLoaded();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().catalog.map((entry) => entry.agentId)).toEqual(['tutti-agent']);

    await service.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual({
      catalog: [{ agentId: 'tutti-agent', label: 'Tutti Agent', models: [] }],
      loading: false,
      error: 'temporary',
    });
  });
});
