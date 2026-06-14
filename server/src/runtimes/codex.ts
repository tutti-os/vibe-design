import type { RuntimeAgentDef } from '../agents.js';

export const codexAgentDef: RuntimeAgentDef = {
  id: 'codex',
  label: 'Codex',
  capabilities: ['agent-acp-kit', 'streaming', 'tool-use'],
  models: [
    { id: 'default', label: 'Default' },
    { id: 'codex:gpt-5.4', label: 'GPT-5.4' },
    { id: 'codex:gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'codex:gpt-5', label: 'GPT-5' },
    { id: 'codex:gpt-5-mini', label: 'GPT-5 Mini' },
  ],
};
