import { createHash } from 'node:crypto';

import type { DetectContext } from '@tutti-os/agent-acp-kit';
import { loadTuttiAgentCatalog } from '@tutti-os/agent-acp-kit/tutti';
import type { ModelSummary } from './agents.js';
import { localAgentRuntime } from './local-agent-runtime.js';

export interface AgentProviderSnapshot {
  agentTargetId?: string;
  providerId?: string;
  /** @deprecated Test/injection compatibility. */
  id?: string;
  label: string;
  supported: boolean;
  authState: 'ok' | 'missing' | 'expired' | 'unknown';
  models: ModelSummary[];
  defaultModelId?: string;
  isDefault?: true;
  reason?: string;
}

export type DetectAgentProviders = (context?: DetectContext) => Promise<AgentProviderSnapshot[]>;

export async function detectLocalAgentProviders(context?: DetectContext): Promise<AgentProviderSnapshot[]> {
  const [catalog, providers] = await Promise.all([
    loadTuttiAgentCatalog({ runtime: localAgentRuntime, detectContext: context }),
    localAgentRuntime.detect(context),
  ]);
  const byProvider = new Map(providers.map((provider) => [provider.provider, provider]));
  return catalog.agents.map((agent) => {
    const provider = byProvider.get(agent.providerId);
    return {
    agentTargetId: agent.agentTargetId,
    providerId: agent.providerId,
    label: agent.displayName,
    supported: agent.runtimeSupported
      && agent.availability.status === 'available'
      && provider?.supported === true,
    authState: provider?.authState ?? 'unknown',
    models: (provider?.models ?? []).map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.description ? { description: model.description } : {}),
    })),
    ...(provider?.defaultModelId ? { defaultModelId: provider.defaultModelId } : {}),
    ...(agent.agentTargetId === catalog.defaultAgentTargetId ? { isDefault: true as const } : {}),
    ...(agent.availability.detail || provider?.reason
      ? { reason: agent.availability.detail || provider?.reason }
      : {}),
  };
  });
}

export function createAgentProviderSnapshotDetector(detectProviders: DetectAgentProviders): {
  detect(context?: DetectContext): Promise<AgentProviderSnapshot[]>;
} {
  const inFlight = new Map<string, Promise<AgentProviderSnapshot[]>>();

  return {
    detect(context?: DetectContext): Promise<AgentProviderSnapshot[]> {
      const key = providerSnapshotKey(context);
      const existing = inFlight.get(key);
      if (existing) return existing;

      const detection = Promise.resolve()
        .then(() => detectProviders(context))
        .finally(() => {
          if (inFlight.get(key) === detection) {
            inFlight.delete(key);
          }
        });
      inFlight.set(key, detection);
      return detection;
    },
  };
}

function providerSnapshotKey(context?: DetectContext): string {
  const managed = context?.managedAgentInvocation;
  const workspace = managed?.cwd
    ?? context?.cwd
    ?? context?.env?.TSH_WORKSPACE_ID
    ?? context?.env?.TUTTI_WORKSPACE_ROOT
    ?? process.env.TSH_WORKSPACE_ID
    ?? process.env.TUTTI_WORKSPACE_ROOT
    ?? 'standalone';
  const credentialFingerprint = managed?.credential
    ? createHash('sha256').update(managed.credential).digest('hex')
    : 'none';
  const environmentFingerprint = createHash('sha256')
    .update(
      Object.entries(context?.env ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => `${key}\u0000${value}`)
        .join('\u0001'),
    )
    .digest('hex');
  return [
    managed ? 'managed' : 'standalone',
    context?.refresh ? 'refresh' : 'normal',
    workspace,
    credentialFingerprint,
    environmentFingerprint,
  ].join('\u0000');
}
