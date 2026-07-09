import type { DetectContext, LocalAgentRuntime } from "@tutti-os/agent-acp-kit-base";
import { modelsFromTuttiComposerOptions } from "./composer-options-models.js";
import {
  displayNameForAgentProvider,
  toDaemonAgentProviderId,
  toKitAgentProviderId,
} from "./agent-provider-id.js";
import {
  authStateFromTuttiAgentProvider,
  kitProviderMatchesDaemonProvider,
  normalizeDefaultProviderId,
  parseDaemonDefaultModelId,
  parseDaemonStatusModels,
  queryTuttiAgentProviderComposerOptions,
  queryTuttiAgentProviderStatuses,
  queryTuttiDesktopPreferences,
  unavailableReasonFromTuttiAgentProvider,
  type TuttiAgentProviderCatalogEntry,
  type TuttiAgentProviderCatalogModel,
  type TuttiAgentProviderCatalogResult,
  type TuttiAgentProviderDaemonStatus,
  type TuttiCliJsonRunner,
  type TuttiDaemonClientOptions,
} from "./tutti-daemon-client.js";

export type {
  TuttiAgentProviderCatalogEntry,
  TuttiAgentProviderCatalogModel,
  TuttiAgentProviderCatalogResult,
  TuttiCliJsonRunner,
  TuttiDaemonClientOptions,
} from "./tutti-daemon-client.js";

export {
  displayNameForAgentProvider,
  toDaemonAgentProviderId,
  toKitAgentProviderId,
} from "./agent-provider-id.js";

export interface ResolveTuttiAgentProviderCatalogInput {
  runtime: LocalAgentRuntime;
  detectContext?: DetectContext;
  daemon?: TuttiDaemonClientOptions;
  workspaceCwd?: string;
  includeComposerModels?: boolean;
}

type KitDetection = Awaited<ReturnType<LocalAgentRuntime["detect"]>>[number];

export async function resolveTuttiAgentProviderCatalog(
  input: ResolveTuttiAgentProviderCatalogInput,
): Promise<TuttiAgentProviderCatalogResult> {
  const daemonOptions = input.daemon ?? {};
  const includeComposerModels = input.includeComposerModels !== false;
  const preferences = await queryTuttiDesktopPreferences(daemonOptions);
  const [daemonSnapshot, kitDetections] = await Promise.all([
    queryTuttiAgentProviderStatuses([], daemonOptions),
    input.runtime.detect(input.detectContext),
  ]);

  const kitByProvider = new Map(
    kitDetections.map((detection) => [detection.provider, detection]),
  );

  let providers: TuttiAgentProviderCatalogEntry[];
  if (daemonSnapshot?.providers?.length) {
    providers = daemonSnapshot.providers.map((status) =>
      mergeDaemonAndKitStatus(
        status,
        kitByProvider.get(toKitAgentProviderId(status.provider)),
      ),
    );
  } else {
    providers = buildKitFallbackCatalog(kitDetections);
  }

  if (includeComposerModels) {
    const composerOptions = {
      ...daemonOptions,
      ...(input.workspaceCwd ? { cwd: input.workspaceCwd } : {}),
    };
    providers = await enrichCatalogWithComposerModels(providers, {
      ...composerOptions,
    });
  }

  return {
    capturedAt: daemonSnapshot?.capturedAt ?? null,
    defaultProvider: normalizeDefaultProviderId(
      daemonSnapshot?.defaultProvider,
      preferences,
    ),
    providers,
  };
}

function mergeDaemonAndKitStatus(
  daemonStatus: TuttiAgentProviderDaemonStatus,
  kitDetection: KitDetection | undefined,
): TuttiAgentProviderCatalogEntry {
  const kitProvider = toKitAgentProviderId(daemonStatus.provider);
  const kitResult = kitDetection?.result ?? null;
  const available = daemonStatus.availability?.status === "ready";
  const reason = available ? undefined : unavailableReasonFromTuttiAgentProvider(daemonStatus);
  const daemonModels = parseDaemonStatusModels(daemonStatus);
  const kitModels = (kitResult?.models ?? []).map((model) => ({
    id: model.id,
    label: model.label,
    ...("description" in model && typeof model.description === "string"
      ? { description: model.description }
      : {}),
  }));

  const defaultModelId = parseDaemonDefaultModelId(daemonStatus);
  return {
    provider: kitProvider,
    daemonProvider: daemonStatus.provider,
    displayName: displayNameForAgentProvider(
      daemonStatus.provider,
      kitDetection?.displayName,
    ),
    available,
    authState: authStateFromTuttiAgentProvider(daemonStatus.auth?.status),
    executablePath:
      daemonStatus.cli?.binaryPath
      ?? daemonStatus.adapter?.binaryPath
      ?? kitResult?.executablePath
      ?? "",
    version:
      daemonStatus.cli?.version
      ?? kitResult?.version
      ?? (available ? "" : "not-installed"),
    configDir: kitResult?.configDir,
    models: daemonModels?.length ? daemonModels : kitModels,
    ...(defaultModelId ? { defaultModelId } : {}),
    ...(reason ? { reason } : {}),
  };
}

function buildKitFallbackCatalog(
  kitDetections: KitDetection[],
): TuttiAgentProviderCatalogEntry[] {
  return kitDetections.map((detection) => {
    const available = Boolean(detection.result && detection.result.supported !== false);
    const reason = available
      ? undefined
      : detection.result?.unsupportedReason
        ?? `${displayNameForAgentProvider(detection.provider, detection.displayName)} is not installed or not discoverable.`;
    return {
      provider: detection.provider,
      daemonProvider: toDaemonAgentProviderId(detection.provider),
      displayName: displayNameForAgentProvider(
        detection.provider,
        detection.displayName,
      ),
      available,
      authState: detection.result?.authState ?? "unknown",
      executablePath: detection.result?.executablePath ?? "",
      version: detection.result?.version ?? "not-installed",
      configDir: detection.result?.configDir,
      models: (detection.result?.models ?? []).map((model) => ({
        id: model.id,
        label: model.label,
      })),
      ...(reason ? { reason } : {}),
    };
  });
}

async function enrichCatalogWithComposerModels(
  providers: TuttiAgentProviderCatalogEntry[],
  options: TuttiDaemonClientOptions & { cwd?: string },
): Promise<TuttiAgentProviderCatalogEntry[]> {
  return Promise.all(
    providers.map(async (provider) => {
      if (!provider.available) return provider;
      const composer = await queryTuttiAgentProviderComposerOptions(
        String(provider.daemonProvider),
        options,
      );
      if (!composer) return provider;
      const { models, defaultModelId } = modelsFromTuttiComposerOptions(composer);
      if (!models.length) return provider;
      return {
        ...provider,
        models,
        ...(defaultModelId ?? provider.defaultModelId
          ? { defaultModelId: defaultModelId ?? provider.defaultModelId }
          : {}),
      };
    }),
  );
}

export function findCatalogProvider(
  providers: readonly TuttiAgentProviderCatalogEntry[],
  provider: string,
): TuttiAgentProviderCatalogEntry | undefined {
  const normalized = provider.trim().toLowerCase();
  return providers.find(
    (entry) =>
      entry.provider === normalized
      || kitProviderMatchesDaemonProvider(entry.provider, normalized)
      || entry.daemonProvider === normalized,
  );
}
