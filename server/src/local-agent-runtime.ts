import { createLocalAgentRuntime } from '@tutti-os/agent-acp-kit';
import { createVibeLocalAgentProviderPlugins } from './local-agent-providers.js';

export const localAgentRuntime = createLocalAgentRuntime({
  providers: createVibeLocalAgentProviderPlugins(),
});
