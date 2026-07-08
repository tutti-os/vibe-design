import {
  createLocalAgentRuntime,
  type AgentDetection,
  type DetectContext,
} from '@tutti-os/agent-acp-kit';
import type { ModelSummary, RuntimeAgentDef } from './agents.js';
import { createVibeLocalAgentProviderPlugins } from './local-agent-providers.js';
import { agentRegistry } from './runtimes/index.js';

export interface AgentModelCatalogEntry {
  id: string;
  label: string;
  models: ModelSummary[];
}

export type DetectAgentModelCatalog = (context?: DetectContext) => Promise<AgentModelCatalogEntry[]>;

const agentModelRuntime = createLocalAgentRuntime({
  providers: createVibeLocalAgentProviderPlugins(),
});

export async function detectLocalAgentModelCatalog(context?: DetectContext): Promise<AgentModelCatalogEntry[]> {
  const detections = await agentModelRuntime.detect(context);
  const byProvider = new Map<string, AgentDetection | null>();
  for (const detection of detections) {
    byProvider.set(detection.provider, detection.result);
  }

  return agentRegistry.listAgentDefs().map((agent) => modelCatalogEntryFromDetection(agent, byProvider.get(agent.id)));
}

export function fallbackAgentModelCatalog(): AgentModelCatalogEntry[] {
  return agentRegistry.listAgentDefs().map((agent) => ({
    id: agent.id,
    label: agent.label,
    models: sanitizeModelOptions(agent.models),
  }));
}

export function modelCatalogEntryFromDetection(
  agent: RuntimeAgentDef,
  detection: AgentDetection | null | undefined,
): AgentModelCatalogEntry {
  const detectedModels = sanitizeModelOptions(detection?.models);
  return {
    id: agent.id,
    label: agent.label,
    models: detectedModels.length > 0 ? detectedModels : sanitizeModelOptions(agent.models),
  };
}

function sanitizeModelOptions(models: readonly ModelSummary[] | undefined): ModelSummary[] {
  const sanitized: ModelSummary[] = [];
  const seen = new Set<string>();
  for (const model of models ?? []) {
    const id = model.id.trim();
    const label = model.label.trim();
    if (!id || !label || seen.has(id)) {
      continue;
    }
    seen.add(id);
    sanitized.push({
      id,
      label,
      ...(model.description?.trim() ? { description: model.description.trim() } : {}),
    });
  }
  return sanitized;
}
