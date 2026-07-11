import type { DetectContext } from '@tutti-os/agent-acp-kit';
import { resolveTuttiAgentProviderCatalog } from '@tutti-os/agent-acp-kit/tutti';
import { localAgentRuntime } from './local-agent-runtime.js';

export interface AgentAvailability {
  id: string;
  label: string;
  available: boolean;
  authState?: 'ok' | 'missing' | 'expired' | 'unknown';
  supported?: boolean;
  unavailableReason?: string;
  version?: string;
}

export type DetectAgentAvailability = (context?: DetectContext) => Promise<AgentAvailability[]>;

export async function detectLocalAgentAvailability(context?: DetectContext): Promise<AgentAvailability[]> {
  const catalog = await resolveTuttiAgentProviderCatalog({
    runtime: localAgentRuntime,
    detectContext: context,
    cwd: process.env.TUTTI_WORKSPACE_ROOT?.trim() || undefined,
    includeComposerModels: false,
  });

  return catalog.providers.map((entry) => ({
    id: entry.provider,
    label: entry.displayName,
    available: entry.available && entry.authState !== 'missing' && entry.authState !== 'expired',
    authState: entry.authState,
    supported: !/not supported/i.test(entry.reason ?? ''),
    ...(entry.reason ? { unavailableReason: entry.reason } : {}),
    version: entry.version,
  }));
}

export function findUnavailableAgent(
  agents: AgentAvailability[],
  agentId: string,
): AgentAvailability | null {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return {
      id: agentId,
      label: agentId,
      available: false,
      unavailableReason: `${agentId} is not available from Tutti.`,
    };
  }
  return agent.available ? null : agent;
}

/** Default provider when callers omit an explicit agent id. */
export const PRIMARY_AGENT_ID = 'codex';

export interface AgentFallback {
  fromAgentId: string;
  toAgentId: string;
  stage: 'pre-session' | 'in-session' | 'conversation-locked';
  reason: string;
}

function findFallbackAgent(
  agents: AgentAvailability[],
  requestedProvider: string,
): AgentAvailability | null {
  const fallbackProvider = requestedProvider === 'codex'
    ? 'claude-code'
    : requestedProvider === 'claude-code'
      ? 'codex'
      : null;
  return fallbackProvider
    ? agents.find((candidate) => candidate.id === fallbackProvider && candidate.available) ?? null
    : null;
}

/**
 * When the requested provider is unavailable before a session starts, switch to the first
 * other available provider instead of failing the call.
 */
export function resolvePreSessionFallback(
  agents: AgentAvailability[],
  requestedProvider: string,
): AgentFallback | null {
  const requested = agents.find((candidate) => candidate.id === requestedProvider) ?? null;
  if (!requested || requested.available) {
    return null;
  }

  const fallback = findFallbackAgent(agents, requestedProvider);
  if (!fallback) {
    return null;
  }

  return {
    fromAgentId: requestedProvider,
    toAgentId: fallback.id,
    stage: 'pre-session',
    reason: requested.unavailableReason ?? `${requested.label} is unavailable.`,
  };
}

/**
 * A failed run looks like "the provider is broken" (auth, install, or connectivity problems)
 * rather than "the task itself failed". These are the cases where retrying the same prompt on a
 * different provider is worthwhile.
 */
export function isAgentBrokenFailure(errorCode: string | null, message: string | null): boolean {
  if (errorCode === 'AGENT_UNAVAILABLE') {
    return true;
  }

  const haystack = `${errorCode ?? ''} ${message ?? ''}`.toLowerCase();
  if (!haystack.trim()) {
    return false;
  }

  return [
    '401',
    '403',
    'unauthor', // unauthorized / unauthorised
    'unauthenticated',
    'not authenticated',
    'authentication',
    'missing bearer',
    'api key',
    'apikey',
    'credential',
    'forbidden',
    'enoent',
    'not installed',
    'command not found',
    'spawn',
    'econnrefused',
    'enotfound',
    'etimedout',
    'socket hang up',
    'connection refused',
    'connection reset',
  ].some((needle) => haystack.includes(needle));
}

/**
 * After a run fails in a provider-broken way, retry on the first other available provider.
 */
export function resolveRunFailureFallback(
  agents: AgentAvailability[],
  agentId: string,
  failure: { errorCode: string | null; error: string | null },
): AgentFallback | null {
  if (!isAgentBrokenFailure(failure.errorCode, failure.error)) {
    return null;
  }

  const fallback = findFallbackAgent(agents, agentId);
  if (!fallback) {
    return null;
  }

  return {
    fromAgentId: agentId,
    toAgentId: fallback.id,
    stage: 'in-session',
    reason: failure.error ?? `${agentId} run failed.`,
  };
}

export function agentDetectionFailureReason(error: unknown): string {
  const reason = error instanceof Error ? error.message.trim() : '';
  return reason
    ? `Agent provider availability could not be verified: ${reason}`
    : 'Agent provider availability could not be verified.';
}
