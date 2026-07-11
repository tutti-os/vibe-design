import type { RuntimeAgentDef } from '../agents.js';

export const claudeAgentDef: RuntimeAgentDef = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: ['agent-acp-kit', 'streaming', 'tool-use'],
  models: [
    {
      id: 'default',
      label: 'Default',
      description: 'Sonnet 4.6 · Best for everyday tasks',
    },
    {
      id: 'claude-code:sonnet',
      label: 'Sonnet',
      description: 'Sonnet 4.6 · Best for everyday tasks',
    },
    {
      id: 'claude-code:opus',
      label: 'Opus',
      description: 'Opus 4.7 · Most capable for complex work · ~2x usage vs Sonnet',
    },
    {
      id: 'claude-code:haiku',
      label: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers',
    },
  ],
};
