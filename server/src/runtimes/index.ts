import { createAgentRegistry } from '../agents.js';
import { claudeAgentDef } from './claude.js';
import { codexAgentDef } from './codex.js';

export { claudeAgentDef } from './claude.js';
export { codexAgentDef } from './codex.js';

export const AGENT_DEFS = [claudeAgentDef, codexAgentDef];
export const agentRegistry = createAgentRegistry(AGENT_DEFS);
