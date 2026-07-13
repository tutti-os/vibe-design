import type { ModelSummary } from './agents.js';
import type { AgentProviderSnapshot } from './agent-provider-snapshot.js';

export interface AgentModelCatalogEntry {
  id: string;
  label: string;
  supported: boolean;
  models: ModelSummary[];
}

export function projectAgentModelCatalog(providers: readonly AgentProviderSnapshot[]): AgentModelCatalogEntry[] {
  return providers
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      supported: entry.supported,
      models: sanitizeModelOptions(
        entry.models,
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
