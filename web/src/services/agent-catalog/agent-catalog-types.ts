export interface AgentAvailability {
  agentTargetId: string;
  providerId?: string;
  label: string;
  supported: boolean;
  authState: 'ok' | 'missing' | 'expired' | 'unknown';
  isDefault?: true;
  unavailableReason?: string;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface AgentModelCatalogEntry {
  agentTargetId: string;
  providerId?: string;
  label: string;
  supported: boolean;
  isDefault?: true;
  models: AgentModelOption[];
}

export function resolveLegacyProviderAgentTargetId(
  catalog: readonly Pick<AgentModelCatalogEntry, 'agentTargetId' | 'providerId'>[],
  providerId: string,
): string | null {
  const normalizedProviderId = providerId.trim();
  if (!normalizedProviderId) return null;
  const matches = catalog.filter((entry) => (
    normalizeLegacyProviderId(entry.providerId) === normalizeLegacyProviderId(normalizedProviderId)
  ));
  return matches.length === 1 ? matches[0]?.agentTargetId ?? null : null;
}

export function isLegacyProviderAgentTargetAmbiguous(
  catalog: readonly Pick<AgentModelCatalogEntry, 'providerId'>[],
  providerId: string,
): boolean {
  const normalizedProviderId = normalizeLegacyProviderId(providerId);
  return Boolean(normalizedProviderId) && catalog.filter(
    (entry) => normalizeLegacyProviderId(entry.providerId) === normalizedProviderId,
  ).length > 1;
}

export function normalizeLegacyProviderId(providerId: string | undefined): string {
  const normalized = providerId?.trim() ?? '';
  return normalized === 'claude' ? 'claude-code' : normalized;
}
