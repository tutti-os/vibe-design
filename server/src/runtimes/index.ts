import { createAgentRegistry } from '../agents.js';
import { buildAgentDefsFromDefaultPlugins } from './build-agent-defs.js';

export { claudeAgentDef } from './claude.js';
export { codexAgentDef } from './codex.js';

export const AGENT_DEFS = buildAgentDefsFromDefaultPlugins();
export const agentRegistry = createAgentRegistry(AGENT_DEFS);
