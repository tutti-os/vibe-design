import { createHash } from 'node:crypto';

import type { DetectContext } from '@tutti-os/agent-acp-kit';
import type { ModelSummary } from './agents.js';
import { localAgentRuntime } from './local-agent-runtime.js';

export interface AgentProviderSnapshot {
  id: string;
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
  const providers = await localAgentRuntime.detect(context);
  return providers.map((provider) => ({
    id: provider.provider,
    label: provider.displayName,
    supported: provider.supported,
    authState: provider.authState,
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.description ? { description: model.description } : {}),
    })),
    ...(provider.defaultModelId ? { defaultModelId: provider.defaultModelId } : {}),
    ...(provider.isDefault ? { isDefault: true as const } : {}),
    ...(provider.reason ? { reason: provider.reason } : {}),
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
  return [managed ? 'managed' : 'standalone', context?.refresh ? 'refresh' : 'normal', workspace, credentialFingerprint].join('\u0000');
}
