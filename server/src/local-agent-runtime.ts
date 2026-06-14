import { createLocalAgentRuntime } from '@tutti-os/agent-acp-kit';
import { createVibeClaudeProvider } from './local-claude-provider.js';
import { createVibeCodexProvider } from './local-codex-provider.js';

export const localAgentRuntime = createLocalAgentRuntime({
  providers: [createVibeCodexProvider(), createVibeClaudeProvider()],
});
