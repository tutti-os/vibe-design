import type { AgentDetection } from '@tutti-os/agent-acp-kit';
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

export type DetectAgentAvailability = () => Promise<AgentAvailability[]>;

export async function detectLocalAgentAvailability(): Promise<AgentAvailability[]> {
  const detections = await localAgentRuntime.detect();
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
    return `${agent.label} is not authenticated. Run ${agent.id === 'claude' ? 'claude auth login' : `${agent.id} login`} first.`;
  }

  if (detection.authState === 'expired') {
    return `${agent.label} authentication has expired.`;
  }

  return null;
}
