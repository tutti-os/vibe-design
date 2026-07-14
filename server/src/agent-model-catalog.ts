import type { ModelSummary } from './agents.js';
import type { AgentProviderSnapshot } from './agent-provider-snapshot.js';

export interface AgentModelCatalogEntry {
  agentTargetId: string;
  providerId: string;
  label: string;
  supported: boolean;
  isDefault?: true;
  models: ModelSummary[];
}

export function projectAgentModelCatalog(providers: readonly AgentProviderSnapshot[]): AgentModelCatalogEntry[] {
  return providers
    .flatMap((entry) => {
      const identity = resolveSnapshotIdentity(providers, entry);
      if (!identity) return [];
      return [{
        ...identity,
        label: entry.label,
        supported: entry.supported,
        ...(entry.isDefault ? { isDefault: true as const } : {}),
        models: sanitizeModelOptions(entry.models),
      }];
    });
}

function resolveSnapshotIdentity(
  catalog: readonly AgentProviderSnapshot[],
  entry: AgentProviderSnapshot,
): Pick<AgentModelCatalogEntry, 'agentTargetId' | 'providerId'> | null {
  const providerId = (entry.providerId ?? entry.id)?.trim();
  if (!providerId) return null;
  const exactTargetId = entry.agentTargetId?.trim();
  if (exactTargetId) return { agentTargetId: exactTargetId, providerId };
  const normalizedProviderId = normalizeLegacyProviderId(providerId);
  const matches = catalog.filter((candidate) => (
    normalizeLegacyProviderId(candidate.providerId ?? candidate.id) === normalizedProviderId
  ));
  return matches.length === 1
    ? { agentTargetId: `local:${providerId}`, providerId }
    : null;
}

function normalizeLegacyProviderId(providerId: string | undefined): string {
  const normalized = providerId?.trim() ?? '';
  return normalized === 'claude' ? 'claude-code' : normalized;
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
