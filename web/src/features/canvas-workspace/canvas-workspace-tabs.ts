import type { WorkspaceFileTab, WorkspaceTabsState } from './canvas-workspace-types';

export type TabDropEdge = 'before' | 'after';

export interface WorkspaceFileTabInput {
  path: string;
  name: string;
}

export function fileTabKey(path: string): string {
  return `file:${path}`;
}

export function normalizeWorkspaceTabsState(state: WorkspaceTabsState): WorkspaceTabsState {
  const tabs: WorkspaceFileTab[] = [];
  const seenPaths = new Set<string>();
  let activeTabKey = state.activeTabKey;

  for (const tab of state.tabs) {
    const key = fileTabKey(tab.path);
    if (!seenPaths.has(tab.path)) {
      seenPaths.add(tab.path);
      tabs.push({ kind: 'file', key, path: tab.path, name: tab.name });
    }

    if (state.activeTabKey === tab.key || state.activeTabKey === key) {
      activeTabKey = key;
    }
  }

  if (activeTabKey !== null && !tabs.some((tab) => tab.key === activeTabKey)) {
    activeTabKey = null;
  }

  return { tabs, activeTabKey };
}

export function openWorkspaceFileTab(state: WorkspaceTabsState, file: WorkspaceFileTabInput): WorkspaceTabsState {
  const normalizedState = normalizeWorkspaceTabsState(state);
  const key = fileTabKey(file.path);
  const nextTab: WorkspaceFileTab = { kind: 'file', key, path: file.path, name: file.name };
  const tabs = normalizedState.tabs.map((tab) => (tab.path === file.path ? nextTab : tab));
  if (tabs.some((tab) => tab.key === key)) return { tabs, activeTabKey: key };

  return { tabs: [...normalizedState.tabs, nextTab], activeTabKey: key };
}

export function closeWorkspaceTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index < 0) return state;

  const tabs = state.tabs.filter((tab) => tab.key !== key);
  if (state.activeTabKey !== key) return { tabs, activeTabKey: state.activeTabKey };

  const fallback = tabs[Math.max(0, index - 1)] ?? tabs[0] ?? null;
  return { tabs, activeTabKey: fallback?.key ?? null };
}

export function reorderWorkspaceTabs(
  state: WorkspaceTabsState,
  fromKey: string,
  toKey: string,
  edge: TabDropEdge,
): WorkspaceTabsState {
  if (fromKey === toKey) return state;

  const tabs = [...state.tabs];
  const fromIndex = tabs.findIndex((tab) => tab.key === fromKey);
  const toIndex = tabs.findIndex((tab) => tab.key === toKey);
  if (fromIndex < 0 || toIndex < 0) return state;

  const [moved] = tabs.splice(fromIndex, 1);
  const targetIndex = tabs.findIndex((tab) => tab.key === toKey);
  const insertAt = edge === 'before' ? targetIndex : targetIndex + 1;
  tabs.splice(insertAt, 0, moved);

  return { ...state, tabs };
}
