import { dirname } from 'node:path';
import type { AgentDetection, DetectContext } from '@tutti-os/agent-acp-kit';
import type { RuntimeAgentDef } from './agents.js';
import { localAgentRuntime } from './local-agent-runtime.js';
import { agentRegistry } from './runtimes/index.js';

export interface AgentAvailability {
  id: string;
  label: string;
  available: boolean;
  authState?: AgentDetection['authState'];
  supported?: boolean;
  unavailableReason?: string;
  version?: string;
}

export type DetectAgentAvailability = (context?: DetectContext) => Promise<AgentAvailability[]>;

export async function detectLocalAgentAvailability(context?: DetectContext): Promise<AgentAvailability[]> {
  const detections = await localAgentRuntime.detect(context);
  const byProvider = new Map<string, (typeof detections)[number]>();
  for (const detection of detections) {
    byProvider.set(detection.provider, detection);
  }

  return agentRegistry.listAgentDefs().map((agent) => {
    const detection = byProvider.get(agent.id);
    return availabilityFromDetection(agent, detection?.result ?? null);
  });
}

export function findUnavailableAgent(
  agents: AgentAvailability[],
  agentId: string,
): AgentAvailability | null {
  const agent = agents.find((candidate) => candidate.id === agentId);
  return agent && !agent.available ? agent : null;
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
  return agents.find((candidate) => candidate.id !== requestedProvider && candidate.available) ?? null;
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

export function unavailableAgentsForDetectionFailure(error: unknown): AgentAvailability[] {
  const reason = error instanceof Error ? error.message : 'Agent detection failed.';
  return agentRegistry.listAgentDefs().map((agent) => ({
    id: agent.id,
    label: agent.label,
    available: false,
    unavailableReason: reason,
  }));
}

function availabilityFromDetection(
  agent: RuntimeAgentDef,
  detection: AgentDetection | null,
): AgentAvailability {
  if (!detection) {
    return {
      id: agent.id,
      label: agent.label,
      available: false,
      unavailableReason: `${agent.label} detection is unavailable.`,
    };
  }

  const unavailableReason = unavailableReasonForDetection(agent, detection);
  return {
    id: agent.id,
    label: agent.label,
    available: unavailableReason === null,
    authState: detection.authState,
    supported: detection.supported ?? true,
    ...(unavailableReason ? { unavailableReason } : {}),
    version: detection.version,
  };
}

function unavailableReasonForDetection(
  agent: RuntimeAgentDef,
  detection: AgentDetection,
): string | null {
  if (detection.supported === false) {
    return detection.unsupportedReason || `${agent.label} is not installed or is not available on PATH.`;
  }

  if (detection.authState === 'missing') {
    if (agent.id === 'claude') {
      return claudeMissingAuthReason(agent, detection);
    }
    return `${agent.label} is not authenticated. Run ${agent.id === 'claude' ? 'claude auth login' : `${agent.id} login`} first.`;
  }

  if (detection.authState === 'expired') {
    return `${agent.label} authentication has expired.`;
  }

  return null;
}

function claudeMissingAuthReason(agent: RuntimeAgentDef, detection: AgentDetection): string {
  const claudeHome = detection.configDir ? dirname(detection.configDir) : null;
  const loginCommand = claudeHome
    ? `HOME="${claudeHome}" claude auth login`
    : 'claude auth login';
  return `${agent.label} is not authenticated for this app workspace. Run ${loginCommand} first.`;
}
