export type WorkspaceFileKind = 'html' | 'image' | 'text' | 'unsupported';
export type FileSurfaceMode = 'preview' | 'comment';

export interface WorkspaceFile {
  name: string;
  path: string;
  kind: WorkspaceFileKind;
  mime: string;
  size?: number;
  mtime?: number;
  updatedAt?: number;
  contents?: string;
  url?: string;
}

export interface WorkspaceFileTab {
  kind: 'file';
  key: string;
  path: string;
  name: string;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceFileTab[];
  activeTabKey: string | null;
}

export interface WorkspaceModeByTabKey {
  [tabKey: string]: FileSurfaceMode | undefined;
}

export type PendingWorkspaceTransition =
  | { kind: 'activate-tab'; key: string | null }
  | { kind: 'close-tab'; key: string }
  | { kind: 'set-mode'; key: string; mode: FileSurfaceMode };
