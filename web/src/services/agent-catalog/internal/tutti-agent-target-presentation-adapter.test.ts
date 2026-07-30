import { describe, expect, it } from 'vitest';
import {
  loadTuttiAgentTargetIconUrls,
  mergeTuttiAgentTargetPresentations,
} from './tutti-agent-target-presentation-adapter';

describe('Tutti agent target presentation adapter', () => {
  it('indexes host icons by exact agentTargetId', async () => {
    const icons = await loadTuttiAgentTargetIconUrls({
      agentActivity: {
        listTargets: async () => ({
          agents: [
            {
              agentTargetId: 'team:tutti-agent',
              availability: { status: 'ready' },
              description: null,
              iconUrl: 'data:image/webp;base64,tutti',
              name: 'Tutti Agent',
              provider: 'tutti-agent',
            },
          ],
          capturedAtUnixMs: 123,
          error: null,
          status: 'ready',
        }),
      },
    });

    expect(icons.get('team:tutti-agent')).toBe('data:image/webp;base64,tutti');
    expect(icons.has('local:tutti-agent')).toBe(false);
  });

  it('keeps the runtime catalog authoritative when the host is unavailable', async () => {
    const runtimeCatalog = [{
      agentTargetId: 'team:tutti-agent',
      providerId: 'tutti-agent',
      label: 'Tutti Agent',
      supported: true,
      models: [],
    }];

    const icons = await loadTuttiAgentTargetIconUrls({
      agentActivity: {
        listTargets: async () => {
          throw new Error('old host');
        },
      },
    });

    expect(mergeTuttiAgentTargetPresentations(runtimeCatalog, icons)).toEqual(runtimeCatalog);
  });
});
