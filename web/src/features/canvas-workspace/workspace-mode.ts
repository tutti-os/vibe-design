import type {
  FileSurfaceMode,
  PendingWorkspaceTransition,
  WorkspaceFileTab,
  WorkspaceModeByTabKey,
} from './canvas-workspace-types';

export function defaultModeForTab(_tab: WorkspaceFileTab | null): FileSurfaceMode {
  return 'preview';
}

export function setModeForTab(
  current: WorkspaceModeByTabKey,
  key: string,
  mode: FileSurfaceMode,
): WorkspaceModeByTabKey {
  return { ...current, [key]: mode };
}

export function removeModeForTab(current: WorkspaceModeByTabKey, key: string): WorkspaceModeByTabKey {
  if (!(key in current)) {
    return current;
  }

  const next = { ...current };
  delete next[key];
  return next;
}
