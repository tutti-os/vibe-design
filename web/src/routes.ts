export type VibeDesignRoute =
  | { kind: 'dashboard' }
  | { kind: 'project'; projectId: string };

export const DEFAULT_ROUTE: VibeDesignRoute = { kind: 'dashboard' };

export function isProjectId(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}
