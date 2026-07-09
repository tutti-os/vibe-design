import {
  displayNameForAgentProvider,
  listVisibleManagedAgentProviders,
  toDaemonAgentProviderId,
  toKitAgentProviderId,
  tuttiManagedAgentProviders,
  type TuttiManagedAgentProvider,
} from "./agent-provider-id.js";

export type TuttiAgentProviderAuthState = "ok" | "missing" | "expired" | "unknown";

export interface TuttiAgentProviderCatalogModel {
  id: string;
  label: string;
  description?: string;
}

export interface TuttiAgentProviderCatalogEntry {
  provider: string;
  daemonProvider: TuttiManagedAgentProvider | string;
  displayName: string;
  available: boolean;
  authState: TuttiAgentProviderAuthState;
  executablePath: string;
  version: string;
  configDir?: string;
  models: TuttiAgentProviderCatalogModel[];
  defaultModelId?: string;
  reason?: string;
}

export interface TuttiAgentProviderCatalogResult {
  capturedAt: string | null;
  defaultProvider: string | null;
  providers: TuttiAgentProviderCatalogEntry[];
}

export interface TuttiDesktopPreferencesSnapshot {
  defaultAgentProvider?: string | null;
  enableCursorAgent?: boolean;
  enableOpenCodeAgent?: boolean;
}

export interface TuttiDaemonClientOptions {
  apiBaseUrl?: string;
  appId?: string;
  appServerToken?: string;
  tuttiCliPath?: string;
  workspaceId?: string;
  requestTimeoutMs?: number;
  runTuttiCli?: TuttiCliJsonRunner;
}

export type TuttiCliJsonRunner = (
  args: string[],
  options: { cwd?: string; maxBuffer: number; timeoutMs: number },
) => Promise<unknown>;

export interface TuttiAgentProviderDaemonStatus {
  provider: string;
  availability?: {
    status?: string | null;
    reasonCode?: string | null;
  } | null;
  auth?: {
    status?: string | null;
  } | null;
  cli?: {
    binaryPath?: string | null;
    installed?: boolean;
    version?: string | null;
  } | null;
  adapter?: {
    binaryPath?: string | null;
    installed?: boolean;
    version?: string | null;
  } | null;
  configuration?: Record<string, unknown> | null;
  defaults?: Record<string, unknown> | null;
  modelCatalog?: Record<string, unknown> | null;
  models?: unknown;
  availableModels?: unknown;
  modelOptions?: unknown;
  defaultModelId?: unknown;
  defaultModel?: unknown;
}

function readEnv(options: TuttiDaemonClientOptions) {
  return {
    apiBaseUrl: options.apiBaseUrl?.trim() || process.env.TUTTI_API_BASE_URL?.trim() || "",
    appId: options.appId?.trim() || process.env.TUTTI_APP_ID?.trim() || "",
    appServerToken: options.appServerToken?.trim() || process.env.TUTTI_APP_SERVER_TOKEN?.trim() || "",
    tuttiCliPath: options.tuttiCliPath?.trim() || process.env.TUTTI_CLI?.trim() || "",
    workspaceId: options.workspaceId?.trim() || process.env.TUTTI_WORKSPACE_ID?.trim() || "",
    requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
  };
}

function workspaceAppDaemonPath(
  env: ReturnType<typeof readEnv>,
  suffix: string,
): string | null {
  if (!env.apiBaseUrl || !env.appServerToken || !env.workspaceId || !env.appId) {
    return null;
  }
  const encodedWorkspaceId = encodeURIComponent(env.workspaceId);
  const encodedAppId = encodeURIComponent(env.appId);
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/v1/workspaces/${encodedWorkspaceId}/apps/${encodedAppId}${normalizedSuffix}`;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function unwrapDaemonPayload(value: unknown): Record<string, unknown> {
  const record = toRecord(value);
  if (!record) return {};
  const nested = toRecord(record.value);
  return nested ?? record;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function queryTuttiDesktopPreferences(
  options: TuttiDaemonClientOptions = {},
): Promise<TuttiDesktopPreferencesSnapshot | null> {
  const env = readEnv(options);
  const workspacePath = workspaceAppDaemonPath(env, "/preferences/agent");
  if (workspacePath) {
    const payload = await fetchJson(
      new URL(workspacePath, env.apiBaseUrl).toString(),
      {
        headers: {
          Authorization: `Bearer ${env.appServerToken}`,
          Accept: "application/json",
        },
      },
      env.requestTimeoutMs,
    );
    const record = unwrapDaemonPayload(payload);
    if (Object.keys(record).length > 0) {
      return {
        defaultAgentProvider: readString(record.defaultAgentProvider),
        enableCursorAgent:
          typeof record.enableCursorAgent === "boolean"
            ? record.enableCursorAgent
            : undefined,
        enableOpenCodeAgent:
          typeof record.enableOpenCodeAgent === "boolean"
            ? record.enableOpenCodeAgent
            : undefined,
      };
    }
  }

  if (!env.apiBaseUrl || !env.appServerToken) return null;
  const payload = await fetchJson(
    new URL("/v1/preferences/desktop", env.apiBaseUrl).toString(),
    {
      headers: {
        Authorization: `Bearer ${env.appServerToken}`,
        Accept: "application/json",
      },
    },
    env.requestTimeoutMs,
  );
  const record = unwrapDaemonPayload(payload);
  const preferences = toRecord(record.preferences) ?? record;
  return {
    defaultAgentProvider: readString(preferences.defaultAgentProvider),
    enableCursorAgent:
      typeof preferences.enableCursorAgent === "boolean"
        ? preferences.enableCursorAgent
        : undefined,
    enableOpenCodeAgent:
      typeof preferences.enableOpenCodeAgent === "boolean"
        ? preferences.enableOpenCodeAgent
        : undefined,
  };
}

export async function queryTuttiAgentProviderStatuses(
  providerIds: readonly string[],
  options: TuttiDaemonClientOptions = {},
): Promise<{ capturedAt: string | null; defaultProvider: string | null; providers: TuttiAgentProviderDaemonStatus[] } | null> {
  if (providerIds.length === 0) return null;
  const env = readEnv(options);
  const workspacePath = workspaceAppDaemonPath(env, "/agent-providers/status");
  if (workspacePath) {
    const url = new URL(workspacePath, env.apiBaseUrl);
    for (const providerId of providerIds) {
      url.searchParams.append("providers", providerId);
    }
    const payload = await fetchJson(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${env.appServerToken}`,
          Accept: "application/json",
        },
      },
      env.requestTimeoutMs,
    );
    const record = unwrapDaemonPayload(payload);
    const providers = Array.isArray(record.providers)
      ? record.providers.flatMap((item): TuttiAgentProviderDaemonStatus[] => {
          const status = toRecord(item);
          const provider = readString(status?.provider);
          if (!provider || !status) return [];
          return [{ ...status, provider }];
        })
      : [];
    if (providers.length > 0) {
      return {
        capturedAt: readString(record.capturedAt) ?? null,
        defaultProvider: readString(record.defaultProvider) ?? null,
        providers,
      };
    }
  }

  if (env.apiBaseUrl && env.appServerToken) {
    const url = new URL("/v1/agent-providers/status", env.apiBaseUrl);
    for (const providerId of providerIds) {
      url.searchParams.append("providers", providerId);
    }
    const payload = await fetchJson(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${env.appServerToken}`,
          Accept: "application/json",
        },
      },
      env.requestTimeoutMs,
    );
    const record = unwrapDaemonPayload(payload);
    const providers = Array.isArray(record.providers)
      ? record.providers.flatMap((item): TuttiAgentProviderDaemonStatus[] => {
          const status = toRecord(item);
          const provider = readString(status?.provider);
          if (!provider || !status) return [];
          return [{ ...status, provider }];
        })
      : [];
    if (providers.length > 0) {
      return {
        capturedAt: readString(record.capturedAt) ?? null,
        defaultProvider: readString(record.defaultProvider) ?? null,
        providers,
      };
    }
  }

  if (!env.tuttiCliPath) return null;
  const payload = await runTuttiCliJson(
    ["agent", "providers"],
    options,
  );
  const record = unwrapDaemonPayload(payload);
  const availability = Array.isArray(record.providers) ? record.providers : [];
  const providers = availability.flatMap((item): TuttiAgentProviderDaemonStatus[] => {
    const status = toRecord(item);
    if (!status) return [];
    const provider = readString(status.provider);
    if (!provider) return [];
    const cliStatus = readString(status.status)?.toLowerCase();
    const available = cliStatus === "available" || cliStatus === "ready";
    return [{
      provider,
      availability: {
        status: available ? "ready" : cliStatus ?? "unknown",
        reasonCode: readString(status.detail) ?? undefined,
      },
      cli: {
        binaryPath: readString(status.detail),
        installed: available,
      },
    }];
  });
  return {
    capturedAt: null,
    defaultProvider: readString(record.defaultProvider) ?? null,
    providers: providers.filter((status) =>
      providerIds.includes(status.provider),
    ),
  };
}

export async function queryTuttiAgentProviderComposerOptions(
  provider: TuttiManagedAgentProvider | string,
  options: TuttiDaemonClientOptions & { cwd?: string } = {},
): Promise<unknown | null> {
  const env = readEnv(options);
  const requestBody = {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(env.workspaceId ? { workspaceId: env.workspaceId } : {}),
    settings: {},
  };
  const workspacePath = workspaceAppDaemonPath(
    env,
    `/agent-providers/${encodeURIComponent(provider)}/composer-options`,
  );
  if (workspacePath) {
    const payload = await fetchJson(
      new URL(workspacePath, env.apiBaseUrl).toString(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.appServerToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
      env.requestTimeoutMs,
    );
    const record = unwrapDaemonPayload(payload);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  if (env.apiBaseUrl && env.appServerToken) {
    const payload = await fetchJson(
      new URL(`/v1/agent-providers/${encodeURIComponent(provider)}/composer-options`, env.apiBaseUrl).toString(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.appServerToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
      env.requestTimeoutMs,
    );
    return unwrapDaemonPayload(payload);
  }

  if (!env.tuttiCliPath) return null;
  const args = ["agent", "composer-options", "--provider", provider];
  if (options.cwd) args.push("--cwd", options.cwd);
  if (env.workspaceId) args.push("--workspace-id", env.workspaceId);
  const payload = await runTuttiCliJson(args, options);
  return unwrapDaemonPayload(payload);
}

export async function runTuttiCliJson(
  args: string[],
  options: TuttiDaemonClientOptions = {},
): Promise<unknown | null> {
  const env = readEnv(options);
  if (options.runTuttiCli) {
    try {
      return await options.runTuttiCli(["--json", ...args], {
        maxBuffer: 1024 * 1024,
        timeoutMs: env.requestTimeoutMs,
      });
    } catch {
      return null;
    }
  }
  if (!env.tuttiCliPath) return null;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync(env.tuttiCliPath, ["--json", ...args], {
      timeout: env.requestTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const text = String(stdout ?? "").trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

export function authStateFromTuttiAgentProvider(status: string | null | undefined): TuttiAgentProviderAuthState {
  if (status === "authenticated") return "ok";
  if (status === "required") return "missing";
  if (status === "expired") return "expired";
  return "unknown";
}

export function unavailableReasonFromTuttiAgentProvider(status: TuttiAgentProviderDaemonStatus): string {
  const displayName = displayNameForAgentProvider(status.provider);
  switch (status.availability?.status) {
    case "not_installed":
      return `${displayName} is not installed or not discoverable.`;
    case "auth_required":
      return `${displayName} is installed but authentication is missing.`;
    case "unsupported":
      return status.availability.reasonCode ?? `${displayName} is not supported on this machine.`;
    default:
      return status.availability?.reasonCode ?? `${displayName} is not available.`;
  }
}

export function parseDaemonStatusModels(
  status: TuttiAgentProviderDaemonStatus,
): TuttiAgentProviderCatalogModel[] | undefined {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const catalog = toRecord(status.modelCatalog);
  const rawModels =
    (Array.isArray(status.models) ? status.models : undefined)
    ?? (Array.isArray(status.availableModels) ? status.availableModels : undefined)
    ?? (Array.isArray(status.modelOptions) ? status.modelOptions : undefined)
    ?? readArray(root, "models", "availableModels", "modelOptions")
    ?? readArray(configuration, "models", "availableModels", "modelOptions")
    ?? readArray(catalog, "models", "availableModels", "modelOptions");
  if (!rawModels?.length) return undefined;

  const models: TuttiAgentProviderCatalogModel[] = [];
  const seen = new Set<string>();
  for (const entry of rawModels) {
    const record = toRecord(entry);
    if (!record) continue;
    if (record.hidden === true || record.visibility === "hide") continue;
    const id = readString(record.id) ?? readString(record.model) ?? readString(record.slug) ?? readString(record.value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      label:
        readString(record.label)
        ?? readString(record.displayName)
        ?? readString(record.display_name)
        ?? readString(record.name)
        ?? id,
      ...(readString(record.description) ? { description: readString(record.description) } : {}),
    });
  }
  return models.length ? models : undefined;
}

function readArray(record: Record<string, unknown> | undefined, ...keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

export function parseDaemonDefaultModelId(status: TuttiAgentProviderDaemonStatus): string | undefined {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const defaults = toRecord(status.defaults);
  const catalog = toRecord(status.modelCatalog);
  return readString(status.defaultModelId)
    ?? readString(status.defaultModel)
    ?? readString(root?.defaultModelId)
    ?? readString(root?.defaultModel)
    ?? readString(configuration?.defaultModelId)
    ?? readString(configuration?.defaultModel)
    ?? readString(defaults?.modelId)
    ?? readString(defaults?.model)
    ?? readString(catalog?.defaultModelId)
    ?? readString(catalog?.defaultModel);
}

export function listCatalogProviderIds(preferences: TuttiDesktopPreferencesSnapshot | null): TuttiManagedAgentProvider[] {
  return listVisibleManagedAgentProviders({
    enableCursorAgent: preferences?.enableCursorAgent,
    enableOpenCodeAgent: preferences?.enableOpenCodeAgent,
  });
}

export function normalizeDefaultProviderId(
  defaultProvider: string | null | undefined,
  preferences: TuttiDesktopPreferencesSnapshot | null,
): string | null {
  const candidate = readString(defaultProvider) ?? readString(preferences?.defaultAgentProvider);
  if (!candidate) return null;
  return toKitAgentProviderId(candidate);
}

export function isManagedDaemonProvider(provider: string): provider is TuttiManagedAgentProvider {
  return (tuttiManagedAgentProviders as readonly string[]).includes(provider);
}

export function kitProviderMatchesDaemonProvider(kitProvider: string, daemonProvider: string): boolean {
  return toDaemonAgentProviderId(kitProvider) === daemonProvider.trim().toLowerCase();
}
