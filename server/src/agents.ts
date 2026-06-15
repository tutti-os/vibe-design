export interface ModelSummary {
  id: string;
  label: string;
  description?: string;
}

export const DEFAULT_AGENT_ID = 'codex';

export interface RuntimeAgentDef {
  id: string;
  label: string;
  capabilities: string[];
  models: ModelSummary[];
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface AgentRegistry {
  getAgentDef(agentId: string): RuntimeAgentDef | null;
  listAgentDefs(): RuntimeAgentDef[];
  isKnownModel(agentId: string, model: string): boolean;
  sanitizeCustomModel(agentId: string, model: string): string;
  listProviderModels(agentId: string): ModelSummary[];
  testAgentConnection(agentId: string): Promise<ConnectionTestResult>;
}

type AgentConnectionProbe = (agent: RuntimeAgentDef) => Promise<ConnectionTestResult> | ConnectionTestResult;

const SAFE_MODEL_ID_PATTERN = /^(?!-)[A-Za-z0-9/._:+-]{1,128}$/;

function cloneAgentDef(def: RuntimeAgentDef): RuntimeAgentDef {
  return {
    ...def,
    capabilities: [...def.capabilities],
    models: def.models.map((model) => ({ ...model })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentRegistry(defs: RuntimeAgentDef[], probe?: AgentConnectionProbe): AgentRegistry {
  const orderedDefs = defs.map(cloneAgentDef);
  const byId = new Map<string, RuntimeAgentDef>();

  for (const def of orderedDefs) {
    if (byId.has(def.id)) {
      throw new Error(`Duplicate agent definition id: ${def.id}`);
    }

    byId.set(def.id, def);
  }

  return {
    getAgentDef(agentId) {
      const agent = byId.get(agentId);
      return agent ? cloneAgentDef(agent) : null;
    },

    listAgentDefs() {
      return orderedDefs.map(cloneAgentDef);
    },

    isKnownModel(agentId, model) {
      const trimmedModel = model.trim();
      const agent = byId.get(agentId);
      return agent?.models.some((knownModel) => knownModel.id === trimmedModel) ?? false;
    },

    sanitizeCustomModel(_agentId, model) {
      const trimmedModel = model.trim();
      if (trimmedModel.length === 0) {
        return 'default';
      }

      return SAFE_MODEL_ID_PATTERN.test(trimmedModel) ? trimmedModel : 'default';
    },

    listProviderModels(agentId) {
      return byId.get(agentId)?.models.map((model) => ({ ...model })) ?? [];
    },

    async testAgentConnection(agentId) {
      const agent = byId.get(agentId);
      if (!agent) {
        return { ok: false, error: `Unknown agent: ${agentId}` };
      }

      try {
        return probe ? await probe(cloneAgentDef(agent)) : { ok: false, error: 'Connection probe not configured' };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}
