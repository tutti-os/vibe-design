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
  // Match ai-office: never fall back to process.cwd(). Workspace-app process cwd
  // is the package cache (/var/cache/tsh/...), which TSH rejects for managed-agent
  // prepare ("cwd must be under /workspace"). Omit cwd so catalog detection stays
  // valid; callers with a project pass an explicit /workspace path.
  const detectContext = normalizeAgentCatalogDetectContext(context);
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

/** Explicit non-empty cwd only. Blank/missing must not become process.cwd(). */
function resolveAgentCatalogCwd(context?: DetectContext): string | undefined {
  const cwd = context?.cwd?.trim();
  return cwd || undefined;
}

function normalizeAgentCatalogDetectContext(context?: DetectContext): DetectContext | undefined {
  if (!context) return undefined;
  const cwd = resolveAgentCatalogCwd(context);
  if (cwd) {
    return context.cwd === cwd ? context : { ...context, cwd };
  }
  if (!('cwd' in context)) return context;
  const { cwd: _omit, ...rest } = context;
  return Object.keys(rest).length > 0 ? rest : undefined;
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
  const workspace = resolveAgentCatalogCwd(context) ?? '';
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
