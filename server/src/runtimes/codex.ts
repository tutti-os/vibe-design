import type { RuntimeAgentDef } from '../agents.js';

export const codexAgentDef: RuntimeAgentDef = {
  id: 'codex',
  label: 'Codex',
  capabilities: ['agent-acp-kit', 'streaming', 'tool-use'],
  models: [
    {
      id: 'default',
      label: 'Default',
      description: 'Use the default Codex model.',
    },
    {
      id: 'codex:gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
    },
    { id: 'codex:gpt-5.4', label: 'GPT-5.4' },
    { id: 'codex:gpt-5', label: 'GPT-5' },
  ],
};
