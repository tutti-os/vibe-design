import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

import type { DetectContext } from '@tutti-os/agent-acp-kit';
import {
  loadTuttiAgentCatalog,
  loadTuttiAgentComposerOptions,
  resolveTuttiCliCommand,
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
  loaders: {
    loadCatalog?: typeof loadTuttiAgentCatalog;
    loadComposerOptions?: typeof loadTuttiAgentComposerOptions;
  } = {},
): Promise<AgentProviderSnapshot[]> {
  const cwd = resolveAgentCatalogCwd(context);
  const detectContext = context?.cwd === cwd ? context : { ...context, cwd };
  const providers = await runtime.detect(detectContext);
  const snapshotRuntime: typeof localAgentRuntime = {
    cancel: (runId) => runtime.cancel(runId),
    detect: async () => providers,
    listProviders: () => runtime.listProviders(),
    run: (input) => runtime.run(input),
  };
  const catalog = await (loaders.loadCatalog ?? loadTuttiAgentCatalog)({ runtime: snapshotRuntime, cwd, detectContext });
  const byProvider = new Map(providers.map((provider) => [provider.provider, provider]));
  const runTuttiCli = catalog.cliContract === 'agent-id'
    ? createCatalogReusingCliRunner(catalog)
    : undefined;
  return Promise.all(catalog.agents.map(async (agent) => {
    const provider = byProvider.get(agent.providerId);
    const supported = agent.runtimeSupported && agent.availability.status === 'available';
    let composer: Awaited<ReturnType<typeof loadTuttiAgentComposerOptions>> | null = null;
    let composerFailureReason = '';
    if (supported) {
      try {
        composer = await (loaders.loadComposerOptions ?? loadTuttiAgentComposerOptions)({
          runtime: snapshotRuntime,
          agentTargetId: agent.agentTargetId,
          cwd,
          detectContext,
          ...(runTuttiCli ? { runTuttiCli } : {}),
        });
      } catch (error) {
        composerFailureReason = error instanceof Error && error.message.trim()
          ? `Agent composer options could not be loaded: ${error.message.trim()}`
          : 'Agent composer options could not be loaded.';
      }
    }
    return {
      agentTargetId: agent.agentTargetId,
      providerId: agent.providerId,
      label: agent.displayName,
      supported: supported && !composerFailureReason,
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
      ...(composerFailureReason || agent.availability.detail
        ? { reason: composerFailureReason || agent.availability.detail }
        : {}),
    };
  }));
}

function resolveAgentCatalogCwd(context?: DetectContext): string {
  return context?.cwd?.trim()
    || context?.env?.TUTTI_WORKSPACE_ROOT?.trim()
    || context?.env?.VIBE_WORKSPACE_ROOT?.trim()
    || process.env.TUTTI_WORKSPACE_ROOT?.trim()
    || process.env.VIBE_WORKSPACE_ROOT?.trim()
    || process.cwd();
}

function createCatalogReusingCliRunner(
  catalog: Awaited<ReturnType<typeof loadTuttiAgentCatalog>>,
): NonNullable<Parameters<typeof loadTuttiAgentComposerOptions>[0]['runTuttiCli']> {
  return async (args, options) => {
    if (args[1] === 'agent' && args[2] === 'list') {
      return {
        schemaVersion: 1,
        defaultAgentTargetId: catalog.defaultAgentTargetId,
        agents: catalog.agents.map((agent) => ({
          id: agent.agentTargetId,
          provider: agent.providerId,
          name: agent.displayName,
          availability: agent.availability,
        })),
      };
    }
    const command = resolveTuttiCliCommand({ env: options.env });
    if (!command) throw new Error('Tutti CLI command is not configured.');
    return await new Promise((resolve, reject) => {
      execFile(command, args, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        encoding: 'utf8',
        env: options.env,
        maxBuffer: options.maxBuffer,
        ...(options.signal ? { signal: options.signal } : {}),
        timeout: options.timeoutMs,
      }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout || '{}'));
        } catch {
          reject(new Error('Tutti CLI returned invalid JSON.'));
        }
      });
    });
  };
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
