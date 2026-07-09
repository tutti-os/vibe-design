export const tuttiManagedAgentProviders = [
  "claude-code",
  "codex",
  "cursor",
  "tutti-agent",
  "opencode",
  "hermes",
  "openclaw",
] as const;

export type TuttiManagedAgentProvider = (typeof tuttiManagedAgentProviders)[number];

export function toDaemonAgentProviderId(kitProviderId: string): string {
  const normalized = kitProviderId.trim().toLowerCase();
  if (normalized === "claude") return "claude-code";
  if (normalized === "nexight") return "tutti-agent";
  return normalized;
}

export function toKitAgentProviderId(daemonProviderId: string): string {
  const normalized = daemonProviderId.trim().toLowerCase();
  if (normalized === "claude-code") return "claude";
  if (normalized === "tutti-agent") return "nexight";
  return normalized.replace(/[^a-z0-9_.-]/g, "");
}

export function displayNameForAgentProvider(provider: string, fallback?: string | null): string {
  const trimmed = fallback?.trim();
  if (trimmed) return trimmed;
  const kitId = toKitAgentProviderId(provider);
  if (kitId === "claude") return "Claude Code";
  if (kitId === "codex") return "Codex";
  if (kitId === "cursor") return "Cursor";
  if (kitId === "opencode") return "OpenCode";
  if (kitId === "nexight") return "Tutti Agent";
  if (kitId === "hermes") return "Hermes";
  if (kitId === "openclaw") return "OpenClaw";
  return kitId
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function hiddenManagedAgentProviders(input: {
  enableCursorAgent?: boolean;
  enableOpenCodeAgent?: boolean;
}): ReadonlySet<TuttiManagedAgentProvider> {
  const hidden = new Set<TuttiManagedAgentProvider>();
  // Workspace apps cannot read desktop preferences with app-server tokens; only hide
  // when preferences were loaded and explicitly disabled.
  if (input.enableCursorAgent === false) hidden.add("cursor");
  if (input.enableOpenCodeAgent === false) hidden.add("opencode");
  return hidden;
}

export function listVisibleManagedAgentProviders(input: {
  enableCursorAgent?: boolean;
  enableOpenCodeAgent?: boolean;
}): TuttiManagedAgentProvider[] {
  const hidden = hiddenManagedAgentProviders(input);
  return tuttiManagedAgentProviders.filter((provider) => !hidden.has(provider));
}
