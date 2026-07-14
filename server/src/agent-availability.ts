import type { AgentProviderSnapshot } from './agent-provider-snapshot.js';

export interface AgentAvailability {
  agentTargetId: string;
  providerId: string;
  label: string;
  supported: boolean;
  authState: 'ok' | 'missing' | 'expired' | 'unknown';
  isDefault?: true;
  unavailableReason?: string;
}

export function projectAgentAvailability(providers: readonly AgentProviderSnapshot[]): AgentAvailability[] {
  return providers.flatMap((entry) => {
    const identity = resolveSnapshotIdentity(providers, entry);
    if (!identity) return [];
    return [{
      ...identity,
      label: entry.label,
      supported: entry.supported,
      authState: entry.authState,
      ...(entry.isDefault ? { isDefault: true as const } : {}),
      ...(entry.reason ? { unavailableReason: entry.reason } : {}),
    }];
  });
}

export function resolveAvailableAgentTarget(
  agents: AgentAvailability[],
  input: {
    agentTargetId?: string | null;
    legacyProviderId?: string | null;
    allowLegacyProviderFallbackForAgentTargetId?: boolean;
  },
): AgentAvailability {
  const requestedTarget = input.agentTargetId?.trim();
  let match: AgentAvailability | undefined;
  if (requestedTarget) {
    match = agents.find((candidate) => candidate.agentTargetId === requestedTarget);
    if (!match && input.allowLegacyProviderFallbackForAgentTargetId) {
      match = resolveUniqueLegacyProvider(agents, requestedTarget);
    }
  } else if (input.legacyProviderId?.trim()) {
    match = resolveUniqueLegacyProvider(agents, input.legacyProviderId.trim());
  } else {
    match = agents.find((candidate) => candidate.isDefault)
      ?? agents.find((candidate) => candidate.supported);
  }
  if (!match) {
    throw new Error(requestedTarget
      ? `Agent target is not exposed by Tutti: ${requestedTarget}.`
      : 'No available agent target is exposed by Tutti.');
  }
  if (!match.supported) {
    throw new Error(match.unavailableReason ?? `${match.label} is unavailable.`);
  }
  return match;
}

function resolveSnapshotIdentity(
  catalog: readonly AgentProviderSnapshot[],
  entry: AgentProviderSnapshot,
): Pick<AgentAvailability, 'agentTargetId' | 'providerId'> | null {
  const providerId = (entry.providerId ?? entry.id)?.trim();
  if (!providerId) return null;
  const exactTargetId = entry.agentTargetId?.trim();
  if (exactTargetId) return { agentTargetId: exactTargetId, providerId };
  const matches = catalog.filter((candidate) => {
    const candidateProviderId = (candidate.providerId ?? candidate.id)?.trim();
    return candidateProviderId && legacyProviderIdsMatch(candidateProviderId, providerId);
  });
  return matches.length === 1
    ? { agentTargetId: `local:${providerId}`, providerId }
    : null;
}

function resolveUniqueLegacyProvider(
  agents: AgentAvailability[],
  providerId: string,
): AgentAvailability {
  const matches = agents.filter((candidate) => legacyProviderIdsMatch(candidate.providerId, providerId));
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No agent target uses legacy provider ${providerId}.`
        : `Multiple agent targets use legacy provider ${providerId}; select an exact agent target id.`,
    );
  }
  return matches[0]!;
}

export function legacyProviderIdsMatch(left: string, right: string): boolean {
  return normalizeLegacyProviderId(left) === normalizeLegacyProviderId(right);
}

function normalizeLegacyProviderId(providerId: string): string {
  const normalized = providerId.trim();
  return normalized === 'claude' ? 'claude-code' : normalized;
}

export function agentDetectionFailureReason(error: unknown): string {
  const reason = error instanceof Error ? error.message.trim() : '';
  return reason
    ? `Agent provider availability could not be verified: ${reason}`
    : 'Agent provider availability could not be verified.';
}
