import {
  createDefaultLocalAgentRuntime,
  type DetectContext,
} from '@tutti-os/agent-acp-kit';
import { resolveTuttiAgentProviderCatalog } from '@tutti-os/agent-acp-kit/tutti';
import type { ModelSummary } from './agents.js';

export interface AgentModelCatalogEntry {
  id: string;
  label: string;
  models: ModelSummary[];
}

export type DetectAgentModelCatalog = (context?: DetectContext) => Promise<AgentModelCatalogEntry[]>;

const agentModelRuntime = createDefaultLocalAgentRuntime();

export async function detectLocalAgentModelCatalog(context?: DetectContext): Promise<AgentModelCatalogEntry[]> {
  const catalog = await resolveTuttiAgentProviderCatalog({
    runtime: agentModelRuntime,
    detectContext: context,
    cwd: process.env.TUTTI_WORKSPACE_ROOT?.trim() || undefined,
    includeComposerModels: true,
  });

  return catalog.providers
    .map((entry) => ({
      id: entry.provider,
      label: entry.displayName,
      models: sanitizeModelOptions(
        entry.models.map((model) => ({
          id: model.id,
          label: model.label,
          ...(model.description ? { description: model.description } : {}),
        })),
      ),
    }));
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
