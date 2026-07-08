import { createDefaultLocalAgentProviderPlugins } from '@tutti-os/agent-acp-kit';
import { createVibeClaudeProvider } from './local-claude-provider.js';
import { createVibeCodexProvider } from './local-codex-provider.js';

export function createVibeLocalAgentProviderPlugins() {
  return createDefaultLocalAgentProviderPlugins().map((provider) => {
    if (provider.id === 'claude') return createVibeClaudeProvider();
    if (provider.id === 'codex') return createVibeCodexProvider();
    return provider;
  });
}
