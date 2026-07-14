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
  defaultModelId?: string;
  models: AgentModelOption[];
}

export interface ConversationAgentSelection {
  selectedAgentTargetId: string | null;
  unresolvedAgentTargetLock: boolean;
}

export function resolveConversationAgentSelection(input: {
  catalog: readonly AgentModelCatalogEntry[];
  conversationAgentTargetId?: string | null;
  legacyConversationProviderId?: string | null;
  fallbackAgentTargetId?: string | null;
}): ConversationAgentSelection {
  const exactTargetId = input.conversationAgentTargetId?.trim() || null;
  const legacyProviderId = !exactTargetId ? input.legacyConversationProviderId?.trim() || null : null;
  const migratedTargetId = legacyProviderId
    ? resolveLegacyProviderAgentTargetId(input.catalog, legacyProviderId)
    : null;
  const unresolvedAgentTargetLock = Boolean(legacyProviderId && !migratedTargetId);
  const selectedAgentTargetId = unresolvedAgentTargetLock
    ? null
    : exactTargetId
      ?? migratedTargetId
      ?? input.fallbackAgentTargetId?.trim()
      ?? (input.catalog.find((entry) => entry.isDefault && entry.supported)?.agentTargetId
        ?? input.catalog.find((entry) => entry.supported)?.agentTargetId
        ?? null);
  return { selectedAgentTargetId, unresolvedAgentTargetLock };
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
