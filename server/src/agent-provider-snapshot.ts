import { createHash } from 'node:crypto';

import type { DetectContext } from '@tutti-os/agent-acp-kit';
import {
  loadTuttiAgentCatalog,
  loadTuttiAgentComposerOptions,
} from '@tutti-os/agent-acp-kit/tutti';
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

export async function detectLocalAgentProviders(
  context?: DetectContext,
  runtime: typeof localAgentRuntime = localAgentRuntime,
): Promise<AgentProviderSnapshot[]> {
  const providers = await runtime.detect(context);
  const snapshotRuntime: typeof localAgentRuntime = {
    cancel: (runId) => runtime.cancel(runId),
    detect: async () => providers,
    listProviders: () => runtime.listProviders(),
    run: (input) => runtime.run(input),
  };
  const catalog = await loadTuttiAgentCatalog({ runtime: snapshotRuntime, detectContext: context });
  const byProvider = new Map(providers.map((provider) => [provider.provider, provider]));
  return Promise.all(catalog.agents.map(async (agent) => {
    const provider = byProvider.get(agent.providerId);
    const supported = agent.runtimeSupported && agent.availability.status === 'available';
    const composer = supported
      ? await loadTuttiAgentComposerOptions({
          runtime: snapshotRuntime,
          agentTargetId: agent.agentTargetId,
          detectContext: context,
        })
      : null;
    return {
      agentTargetId: agent.agentTargetId,
      providerId: agent.providerId,
      label: agent.displayName,
      supported,
      authState: provider?.authState ?? 'unknown',
      models: (composer?.modelConfig.options ?? []).map((model) => ({
        id: model.value,
        label: model.label,
        ...(model.description ? { description: model.description } : {}),
      })),
      ...(composer?.modelConfig.defaultValue
        ? { defaultModelId: composer.modelConfig.defaultValue }
        : {}),
      ...(agent.agentTargetId === catalog.defaultAgentTargetId ? { isDefault: true as const } : {}),
      ...(agent.availability.detail ? { reason: agent.availability.detail } : {}),
    };
  }));
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
