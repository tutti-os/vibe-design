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

/** The provider we want to use by default, and the provider we fall back to when it breaks. */
export const PRIMARY_AGENT_ID = 'codex';
export const FALLBACK_AGENT_ID = 'claude';

export interface AgentFallback {
  /** Provider the caller asked for (or the default) that turned out to be unusable. */
  fromAgentId: string;
  /** Provider we switched to instead. */
  toAgentId: string;
  /** When/why the switch happened relative to the agent run. */
  stage: 'pre-session' | 'in-session' | 'conversation-locked';
  /** Human-readable reason the original provider was abandoned. */
  reason: string;
}

function findAvailable(agents: AgentAvailability[], agentId: string): AgentAvailability | null {
  return agents.find((candidate) => candidate.id === agentId && candidate.available) ?? null;
}

/**
 * Decide whether a requested provider should be swapped for the fallback provider *before* a
 * session is started, based on detected availability. Only the primary provider (codex) falls
 * back, and only when the fallback (claude) is actually available. Returns null when no swap
 * applies (the normal flow — including surfacing an AGENT_UNAVAILABLE error — then continues).
 */
export function resolvePreSessionFallback(
  agents: AgentAvailability[],
  requestedProvider: string,
): AgentFallback | null {
  if (requestedProvider !== PRIMARY_AGENT_ID) {
    return null;
  }

  const primary = agents.find((candidate) => candidate.id === PRIMARY_AGENT_ID) ?? null;
  if (!primary || primary.available) {
    return null;
  }

  if (!findAvailable(agents, FALLBACK_AGENT_ID)) {
    return null;
  }

  return {
    fromAgentId: PRIMARY_AGENT_ID,
    toAgentId: FALLBACK_AGENT_ID,
    stage: 'pre-session',
    reason: primary.unavailableReason ?? `${primary.label} is unavailable.`,
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
 * Decide whether to retry on the fallback provider *after* a run has already failed. Applies only
 * when the primary provider (codex) was the one that failed, the failure looks like the provider
 * is broken, and the fallback (claude) is available.
 */
export function resolveRunFailureFallback(
  agents: AgentAvailability[],
  agentId: string,
  failure: { errorCode: string | null; error: string | null },
): AgentFallback | null {
  if (agentId !== PRIMARY_AGENT_ID) {
    return null;
  }

  if (!isAgentBrokenFailure(failure.errorCode, failure.error)) {
    return null;
  }

  if (!findAvailable(agents, FALLBACK_AGENT_ID)) {
    return null;
  }

  return {
    fromAgentId: PRIMARY_AGENT_ID,
    toAgentId: FALLBACK_AGENT_ID,
    stage: 'in-session',
    reason: failure.error ?? `${PRIMARY_AGENT_ID} run failed.`,
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
