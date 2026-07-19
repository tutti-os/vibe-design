import { createHash } from 'node:crypto';

import type { DetectContext } from '@tutti-os/agent-acp-kit';
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
  const cwd = resolveAgentCatalogCwd(context);
  const detectContext = context?.cwd === cwd ? context : { ...context, cwd };
  const providers = await runtime.detect(detectContext);
  return providers.flatMap((provider) => {
    const agentTargetId = provider.agentTargetId?.trim();
    if (!agentTargetId) return [];
    return [{
      agentTargetId,
      providerId: provider.provider,
      label: provider.displayName,
      supported: provider.supported,
      authState: provider.authState,
      models: provider.models.map((model) => ({ ...model })),
      ...(provider.defaultModelId ? { defaultModelId: provider.defaultModelId } : {}),
      ...(provider.isDefault ? { isDefault: true as const } : {}),
      ...(provider.reason ? { reason: provider.reason } : {}),
    }];
  });
}

function resolveAgentCatalogCwd(context?: DetectContext): string {
  return context?.cwd?.trim() || process.cwd();
}

export function createAgentProviderSnapshotDetector(detectProviders: DetectAgentProviders): {
  detect(context?: DetectContext): Promise<AgentProviderSnapshot[]>;
} {
  const inFlight = new Map<string, Promise<AgentProviderSnapshot[]>>();
  const resolved = new Map<string, AgentProviderSnapshot[]>();

  return {
    detect(context?: DetectContext): Promise<AgentProviderSnapshot[]> {
      const key = providerSnapshotKey(context);
      if (!context?.refresh) {
        const cached = resolved.get(key);
        if (cached) return Promise.resolve(cached.map(cloneProvider));
      }
      const existing = inFlight.get(key);
      if (existing) return existing;

      const detection = Promise.resolve()
        .then(() => detectProviders(context))
        .then((providers) => {
          const normalKey = providerSnapshotKey({ ...context, refresh: false });
          const snapshot = providers.map(cloneProvider);
          resolved.set(normalKey, snapshot);
          return snapshot.map(cloneProvider);
        })
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

function cloneProvider(provider: AgentProviderSnapshot): AgentProviderSnapshot {
  return { ...provider, models: provider.models.map((model) => ({ ...model })) };
}

function providerSnapshotKey(context?: DetectContext): string {
  const workspace = resolveAgentCatalogCwd(context);
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
    context?.refresh ? 'refresh' : 'normal',
    workspace,
    environmentFingerprint,
  ].join('\u0000');
}
