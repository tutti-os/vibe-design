import type { RuntimeAgentDef } from '../agents.js';

export const claudeAgentDef: RuntimeAgentDef = {
  id: 'claude',
  label: 'Claude Code',
  capabilities: ['agent-acp-kit', 'streaming', 'tool-use'],
  models: [
    { id: 'default', label: 'Default' },
    { id: 'claude:sonnet', label: 'Sonnet (alias)' },
    { id: 'claude:opus', label: 'Opus (alias)' },
    { id: 'claude:haiku', label: 'Haiku (alias)' },
  ],
};
