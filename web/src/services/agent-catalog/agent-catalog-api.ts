import type {
  AgentAvailability,
  AgentModelCatalogEntry,
} from './agent-catalog-types';

export async function installClaudeCodeAgent(): Promise<AgentAvailability[]> {
  const response = await fetch('/api/agents/claude/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(data) ?? 'Claude Code installation failed.');
  }
  return readAgentAvailability(data);
}

export async function fetchAgentModelCatalog(): Promise<AgentModelCatalogEntry[]> {
  const response = await fetch('/api/agents/models');
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(data) ?? 'Agent model catalog request failed.');
  }
  return readAgentModelCatalog(data);
}

export async function fetchAgentAvailability(): Promise<AgentAvailability[]> {
  const response = await fetch('/api/agents/availability');
  const data = await response.json().catch(() => null);
  return response.ok ? readAgentAvailability(data) : [];
}

export function readAgentModelCatalog(data: unknown): AgentModelCatalogEntry[] {
  const value = isRecord(data) ? data.agents : null;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isAgentId(item.id) || typeof item.label !== 'string' || !Array.isArray(item.models)) {
      return [];
    }
    const models = item.models.flatMap((model) => {
      if (!isRecord(model) || typeof model.id !== 'string' || typeof model.label !== 'string') return [];
      return [{
        id: model.id,
        label: model.label,
        ...(typeof model.description === 'string' && model.description.trim()
          ? { description: model.description }
          : {}),
      }];
    });
    return [{
      agentId: item.id,
      label: item.label,
      supported: typeof item.supported === 'boolean' ? item.supported : true,
      models,
    }];
  });
}

export function readAgentAvailability(data: unknown): AgentAvailability[] {
  const value = isRecord(data) ? data.agentAvailability : null;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.label !== 'string'
      || typeof item.supported !== 'boolean'
      || !isAgentAuthState(item.authState)
    ) return [];
    return [{
      id: item.id,
      label: item.label,
      supported: item.supported,
      authState: item.authState,
      ...(typeof item.unavailableReason === 'string' ? { unavailableReason: item.unavailableReason } : {}),
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
