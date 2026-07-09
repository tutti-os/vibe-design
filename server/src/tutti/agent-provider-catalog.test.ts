import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalAgentRuntime } from '@tutti-os/agent-acp-kit';
import { resolveTuttiAgentProviderCatalog } from './agent-provider-catalog.js';
import { modelsFromTuttiComposerOptions } from './composer-options-models.js';
import { queryTuttiAgentProviderStatuses } from './tutti-daemon-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tutti agent provider catalog', () => {
  it('merges partial daemon status with kit-only providers and accepts available status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const body = String(input).endsWith('/v1/agent-providers/status')
        ? { providers: [{ provider: 'codex', availability: { status: 'available' } }] }
        : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const runtime = {
      detect: async () => [
        { provider: 'codex', displayName: 'Codex', result: { executablePath: 'codex', models: [] } },
        {
          provider: 'cursor',
          displayName: 'Cursor',
          result: {
            executablePath: 'cursor',
            models: [{ id: 'default', label: 'Default', description: 'Cursor default' }],
          },
        },
      ],
    } as unknown as LocalAgentRuntime;

    const catalog = await resolveTuttiAgentProviderCatalog({
      runtime,
      includeComposerModels: false,
      daemon: { apiBaseUrl: 'http://localhost:43120', appServerToken: 'token' },
    });

    expect(catalog.providers.map((provider) => provider.provider)).toEqual(['codex', 'cursor']);
    expect(catalog.providers[0]?.available).toBe(true);
    expect(catalog.providers[1]?.models[0]?.description).toBe('Cursor default');
  });

  it('uses injected CLI runners without a configured binary path', async () => {
    const result = await queryTuttiAgentProviderStatuses([], {
      runTuttiCli: async () => ({ providers: [{ provider: 'cursor', status: 'available' }] }),
    });
    expect(result?.providers[0]?.provider).toBe('cursor');
  });

  it('uses category model config options and their current value', () => {
    expect(modelsFromTuttiComposerOptions({
      runtimeContext: {
        configOptions: [{
          id: 'active-profile',
          category: 'model',
          currentValue: 'composer-1',
          options: [{ value: 'composer-1', display_name: 'Composer 1' }],
        }],
      },
    })).toEqual({
      models: [{ id: 'composer-1', label: 'Composer 1' }],
      defaultModelId: 'composer-1',
    });
  });
});
