import { ACP_PROVIDER_SPECS, createDefaultLocalAgentProviderPlugins } from '@tutti-os/agent-acp-kit';
import type { RuntimeAgentDef } from '../agents.js';
import { claudeAgentDef } from './claude.js';
import { codexAgentDef } from './codex.js';

const KNOWN_AGENT_DEFS: Record<string, RuntimeAgentDef> = {
  codex: codexAgentDef,
  'claude-code': {
    ...claudeAgentDef,
    id: 'claude-code',
    models: claudeAgentDef.models.map((model) => ({
      ...model,
      id: model.id.startsWith('claude:')
        ? `claude-code:${model.id.slice('claude:'.length)}`
        : model.id,
    })),
  },
};

const ACP_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map(
  ACP_PROVIDER_SPECS.map((spec) => [spec.id, spec.displayName] as const),
);

export function buildAgentDefsFromDefaultPlugins(): RuntimeAgentDef[] {
  return createDefaultLocalAgentProviderPlugins()
    .map((plugin) => {
      const known = KNOWN_AGENT_DEFS[plugin.id];
      if (known) return known;
      return {
        id: plugin.id,
        label: ACP_DISPLAY_NAMES.get(plugin.id) ?? plugin.id,
        capabilities: ['agent-acp-kit', 'streaming', 'tool-use'],
        models: [
          {
            id: 'default',
            label: 'Default',
          },
        ],
      };
    });
}
