import { createDefaultLocalAgentProviderPlugins } from '@tutti-os/agent-acp-kit';
import { toKitAgentProviderId, tuttiManagedAgentProviders } from './tutti/agent-provider-id.js';
import { createVibeClaudeProvider } from './local-claude-provider.js';
import { createVibeCodexProvider } from './local-codex-provider.js';

const TUTTI_KIT_PROVIDER_IDS = new Set(
  tuttiManagedAgentProviders.map((provider) => toKitAgentProviderId(provider)),
);

export function createVibeLocalAgentProviderPlugins() {
  return createDefaultLocalAgentProviderPlugins()
    .filter((provider) => TUTTI_KIT_PROVIDER_IDS.has(provider.id))
    .map((provider) => {
      if (provider.id === 'claude') return createVibeClaudeProvider();
      if (provider.id === 'codex') return createVibeCodexProvider();
      return provider;
    });
}
