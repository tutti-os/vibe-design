import type {
  AgentAvailability,
  AgentModelCatalogEntry,
} from './agent-catalog-types';
import {
  isLegacyProviderAgentTargetAmbiguous,
  normalizeLegacyProviderId,
  resolveLegacyProviderAgentTargetId,
} from './agent-catalog-types';

export async function fetchAgentModelCatalog(): Promise<AgentModelCatalogEntry[]> {
  const response = await fetch('/api/agents/models');
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(data) ?? 'Agent model catalog request failed.');
  }
  return readAgentModelCatalog(data);
}

export async function fetchAgentAvailability(): Promise<AgentAvailability[]> {
  const [availabilityResponse, catalog] = await Promise.all([
    fetch('/api/agents/availability'),
    fetchAgentModelCatalog().catch(() => []),
  ]);
  const data = await availabilityResponse.json().catch(() => null);
  return availabilityResponse.ok ? readAgentAvailability(data, catalog) : [];
}

export function readAgentModelCatalog(data: unknown): AgentModelCatalogEntry[] {
  const value = isRecord(data) ? data.agents : null;
  if (!Array.isArray(value)) return [];
  const parsedItems = value.map((item) => ({ item, exact: parseExactModelCatalogEntry(item) }));
  const exactEntries = parsedItems.flatMap(({ exact }) => exact ? [exact] : []);
  return parsedItems.flatMap(({ item, exact }) => {
    if (exact) return [exact];
    if (
      !isRecord(item)
      || !isAgentId(item.id)
      || typeof item.label !== 'string'
      || typeof item.supported !== 'boolean'
      || !Array.isArray(item.models)
    ) return [];
    const providerId = item.id.trim();
    const providerMatches = parsedItems.filter(({ item: candidate, exact: candidateExact }) => {
      const candidateProviderId = candidateExact?.providerId
        ?? (isRecord(candidate) && isAgentId(candidate.id) ? candidate.id.trim() : null);
      return candidateProviderId
        && normalizeLegacyProviderId(candidateProviderId) === normalizeLegacyProviderId(providerId);
    });
    if (providerMatches.length !== 1) {
      throw new Error(`Legacy agent provider ${providerId} is ambiguous in the current agent catalog.`);
    }
    const mappedTargetId = resolveLegacyProviderAgentTargetId(exactEntries, providerId);
    if (!mappedTargetId && isLegacyProviderAgentTargetAmbiguous(exactEntries, providerId)) {
      throw new Error(`Legacy agent provider ${providerId} is ambiguous in the current agent catalog.`);
    }
    const agentTargetId = mappedTargetId ?? `local:${providerId}`;
    return [{
      agentTargetId,
      providerId,
      label: item.label,
      supported: item.supported,
      ...(item.isDefault === true ? { isDefault: true as const } : {}),
      ...(typeof item.defaultModelId === 'string' && item.defaultModelId.trim()
        ? { defaultModelId: item.defaultModelId.trim() }
        : {}),
      models: readModels(item.models),
    }];
  });
}

function parseExactModelCatalogEntry(item: unknown): AgentModelCatalogEntry | null {
    if (
      !isRecord(item)
      || !isAgentId(item.agentTargetId)
      || !isAgentId(item.providerId)
      || typeof item.label !== 'string'
      || typeof item.supported !== 'boolean'
      || !Array.isArray(item.models)
    ) {
      return null;
    }
    return {
      agentTargetId: item.agentTargetId.trim(),
      providerId: item.providerId.trim(),
      label: item.label,
      supported: item.supported,
      ...(item.isDefault === true ? { isDefault: true as const } : {}),
      ...(typeof item.defaultModelId === 'string' && item.defaultModelId.trim()
        ? { defaultModelId: item.defaultModelId.trim() }
        : {}),
      models: readModels(item.models),
    };
}

export function readAgentAvailability(
  data: unknown,
  catalog: readonly AgentModelCatalogEntry[] = [],
): AgentAvailability[] {
  const value = isRecord(data) ? data.agentAvailability : null;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const exactAgentTargetId = isAgentId(item.agentTargetId) ? item.agentTargetId.trim() : null;
    const legacyProviderId = isAgentId(item.id) ? item.id.trim() : null;
    const providerId = isAgentId(item.providerId) ? item.providerId.trim() : legacyProviderId;
    const agentTargetId = exactAgentTargetId
      ?? (providerId ? resolveLegacyProviderAgentTargetId(catalog, providerId) : null);
    if (
      !agentTargetId
      || !providerId
      || typeof item.label !== 'string'
      || typeof item.supported !== 'boolean'
      || !isAgentAuthState(item.authState)
    ) return [];
    return [{
      agentTargetId,
      providerId,
      label: item.label,
      supported: item.supported,
      authState: item.authState,
      ...(item.isDefault === true ? { isDefault: true as const } : {}),
      ...(typeof item.unavailableReason === 'string' ? { unavailableReason: item.unavailableReason } : {}),
    }];
  });
}

function readModels(value: unknown[]): AgentModelCatalogEntry['models'] {
  return value.flatMap((model) => {
    if (!isRecord(model) || typeof model.id !== 'string' || typeof model.label !== 'string') return [];
    return [{
      id: model.id,
      label: model.label,
      ...(typeof model.description === 'string' && model.description.trim()
        ? { description: model.description }
        : {}),
    }];
  });
}

function isAgentId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAgentAuthState(value: unknown): value is AgentAvailability['authState'] {
  return value === 'ok' || value === 'missing' || value === 'expired' || value === 'unknown';
}

function readApiErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const error = isRecord(data.error) ? data.error : null;
  return typeof error?.message === 'string' && error.message.trim() ? error.message : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
