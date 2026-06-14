import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tutti-os/ui-system/components';
import {
  DeleteIcon,
  DirectoryIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  ImageFileIcon,
  RefreshIcon,
  UploadIcon,
} from '@tutti-os/ui-system/icons';
import type { LiveArtifactWorkspaceEntry, ProjectFile, ProjectFileKind } from '../types';
import { type TranslateFn, useTranslation } from '../i18n';
import { LiveArtifactBadges } from './LiveArtifactBadges';

export interface DesignFilesPanelProps {
  projectId: string;
  files: ProjectFile[];
  liveArtifacts: LiveArtifactWorkspaceEntry[];
  onRefreshFiles: () => Promise<void> | void;
  onOpenFile: (name: string) => void;
  onOpenLiveArtifact: (tabId: LiveArtifactWorkspaceEntry['tabId']) => void;
  onRenameFile: (from: string, to: string) => Promise<ProjectFile | null> | ProjectFile | null;
  onDeleteFile: (name: string) => void;
  onDeleteFiles: (names: string[]) => Promise<void> | void;
  onUpload: () => void;
  onUploadFiles: (files: File[]) => void;
  onPaste: () => void;
  onNewSketch: () => void;
  uploadError?: string | null;
  onPluginFolderAgentAction?: (path: string, action: PluginFolderAgentAction) => Promise<void> | void;
  activePluginActionPaths?: Set<string>;
  hiddenPluginActionPaths?: Set<string>;
}

export type PluginFolderAgentAction =
  | { kind: 'install-to-plugins'; path: string; pluginName: string }
  | { kind: 'publish-repo'; path: string; repoUrl?: string }
  | { kind: 'vibe-design-pr'; path: string; prTitle: string };

export type DesignFilesGroupMode = 'kind' | 'modified';
export type ModifiedSection = 'today' | 'yesterday' | 'previous7Days' | 'previous30Days' | 'older';
export type SortKey = 'name' | 'kind' | 'mtime';
export type SortDir = 'asc' | 'desc';

export const VIEW_STATE_KEY_PREFIX = 'od:design-files:view-state:v1:';
export const DEFAULT_SORT_KEY: SortKey = 'mtime';
export const DEFAULT_SORT_DIR: SortDir = 'desc';
export const DEFAULT_PAGE_SIZE: number | 'all' = 30;
export const PAGE_SIZE_OPTIONS = [15, 30, 45, 60, 'all'] as const;

interface PersistedViewState {
  groupMode?: DesignFilesGroupMode;
  sortKey?: SortKey;
  sortDir?: SortDir;
  pageSize?: number | 'all';
  kindFilter?: ProjectFileKind[];
}

interface DirectoryRow {
  type: 'directory';
  name: string;
  path: string;
}

interface FileRow {
  type: 'file';
  file: ProjectFile;
}

interface FileSection {
  id: string;
  label: string;
  rows: FileRow[];
}

interface PluginFolderRow {
  path: string;
  pluginName: string;
  fileCount: number;
  updatedAt: number;
}

const PROJECT_FILE_KINDS: ProjectFileKind[] = [
  'html',
  'image',
  'video',
  'audio',
  'sketch',
  'text',
  'code',
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'binary',
];

const MODIFIED_ORDER: ModifiedSection[] = [
  'today',
  'yesterday',
  'previous7Days',
  'previous30Days',
  'older',
];

export function readViewState(projectId: string): PersistedViewState {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(VIEW_STATE_KEY_PREFIX + projectId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return normalizeViewState(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function writeViewState(projectId: string, state: PersistedViewState): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(VIEW_STATE_KEY_PREFIX + projectId, JSON.stringify(state));
  } catch {
    // Storage can be unavailable or full; view state persistence is best effort.
  }
}

export function DesignFilesPanel({
  projectId,
  files,
  liveArtifacts,
  onRefreshFiles,
  onOpenFile,
  onOpenLiveArtifact,
  onRenameFile,
  onDeleteFile,
  onDeleteFiles,
  onUpload,
  onUploadFiles,
  onPaste,
  onNewSketch,
  uploadError = null,
  onPluginFolderAgentAction,
  activePluginActionPaths = new Set(),
  hiddenPluginActionPaths = new Set(),
}: DesignFilesPanelProps) {
  const { locale, t } = useTranslation();
  const savedViewState = useMemo(() => readViewState(projectId), [projectId]);
  const [groupMode, setGroupMode] = useState<DesignFilesGroupMode>(
    savedViewState.groupMode ?? 'kind',
  );
  const [sortKey, setSortKey] = useState<SortKey>(savedViewState.sortKey ?? DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(savedViewState.sortDir ?? DEFAULT_SORT_DIR);
  const [pageSize, setPageSize] = useState<number | 'all'>(
    savedViewState.pageSize ?? DEFAULT_PAGE_SIZE,
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [currentDir, setCurrentDir] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ name: string; draft: string } | null>(null);
  const [deletingSelectedFiles, setDeletingSelectedFiles] = useState(false);
  const deleteSelectedFilesInFlight = useRef(false);
  const [kindFilter, setKindFilter] = useState<Set<ProjectFileKind>>(
    () => new Set(savedViewState.kindFilter ?? []),
  );
  const currentDirIsAvailable = currentDir === '' || directoryExists(files, currentDir);
  const effectiveDir = currentDirIsAvailable ? currentDir : '';

  const { directories, filesAtCurrentDir } = useMemo(
    () => partitionCurrentDirectory(files, effectiveDir),
    [effectiveDir, files],
  );
  const sortedFiles = useMemo(
    () => sortFiles(filterFilesByKind(filesAtCurrentDir, kindFilter), sortKey, sortDir),
    [filesAtCurrentDir, kindFilter, sortDir, sortKey],
  );
  const directoryRows = useMemo<DirectoryRow[]>(
    () => directories.map((directory): DirectoryRow => ({ ...directory, type: 'directory' })),
    [directories],
  );
  const pluginFolders = useMemo(() => findPluginFolders(files), [files]);

  const totalRows = sortedFiles.length;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const safePageIndex = safePageFor(pageIndex, pageSize, totalRows);
  const fileRows = useMemo<FileRow[]>(() => {
    const pageFiles =
      pageSize === 'all'
        ? sortedFiles
        : sortedFiles.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);
    return pageFiles.map((file): FileRow => ({ type: 'file', file }));
  }, [pageSize, safePageIndex, sortedFiles]);
  const sections = groupFileRows(fileRows, groupMode, t);
  const pageInfo = formatPageInfo(safePageIndex, pageSize, totalRows, t);
  const selectedFilesInCurrentView = sortedFiles
    .filter((file) => selectedFiles.has(file.name))
    .map((file) => file.name);
  const hasVisibleRows = directoryRows.length > 0 || fileRows.length > 0;

  useEffect(() => {
    const nextViewState = readViewState(projectId);
    setGroupMode(nextViewState.groupMode ?? 'kind');
    setSortKey(nextViewState.sortKey ?? DEFAULT_SORT_KEY);
    setSortDir(nextViewState.sortDir ?? DEFAULT_SORT_DIR);
    setPageSize(nextViewState.pageSize ?? DEFAULT_PAGE_SIZE);
    setKindFilter(new Set(nextViewState.kindFilter ?? []));
    setPageIndex(0);
    setCurrentDir('');
    setSelectedFiles(new Set());
    setRenaming(null);
    setDeletingSelectedFiles(false);
    deleteSelectedFilesInFlight.current = false;
  }, [projectId]);

  useEffect(() => {
    if (currentDir !== '' && !currentDirIsAvailable) {
      setCurrentDir('');
      setPageIndex(0);
      setRenaming(null);
    }
  }, [currentDir, currentDirIsAvailable]);

  useEffect(() => {
    if (pageIndex !== safePageIndex) setPageIndex(safePageIndex);
  }, [pageIndex, safePageIndex]);

  useEffect(() => {
    const availableFileNames = new Set(files.map((file) => file.name));
    setSelectedFiles((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const fileName of current) {
        if (availableFileNames.has(fileName)) {
          next.add(fileName);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [files]);

  function persist(nextState: PersistedViewState): void {
    writeViewState(projectId, {
      groupMode,
      sortKey,
      sortDir,
      pageSize,
      kindFilter: Array.from(kindFilter),
      ...nextState,
    });
  }

  function updateGroupMode(nextMode: DesignFilesGroupMode): void {
    setGroupMode(nextMode);
    persist({ groupMode: nextMode });
  }

  function updateSortKey(nextSortKey: SortKey): void {
    setSortKey(nextSortKey);
    setPageIndex(0);
    persist({ sortKey: nextSortKey });
  }

  function updateSortDir(nextSortDir: SortDir): void {
    setSortDir(nextSortDir);
    setPageIndex(0);
    persist({ sortDir: nextSortDir });
  }

  function updatePageSize(nextPageSize: number | 'all'): void {
    setPageSize(nextPageSize);
    setPageIndex(0);
    persist({ pageSize: nextPageSize });
  }

  function updateKindFilter(kind: ProjectFileKind): void {
    const nextKindFilter = new Set(kindFilter);
    if (nextKindFilter.has(kind)) {
      nextKindFilter.delete(kind);
    } else {
      nextKindFilter.add(kind);
    }
    setKindFilter(nextKindFilter);
    setSelectedFiles(new Set());
    setPageIndex(0);
    persist({ kindFilter: Array.from(nextKindFilter) });
  }

  function toggleSelected(name: string): void {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function startRename(fileName: string, draftName: string): void {
    setRenaming({ name: fileName, draft: draftName });
  }

  async function saveRename(fileName: string): Promise<void> {
    const nextName = resolveRenameTarget(fileName, renaming?.draft ?? '');
    if (!nextName) return;
    if (nextName === fileName) {
      setRenaming(null);
      return;
    }

    try {
      const renamedFile = await onRenameFile(fileName, nextName);
      if (renamedFile) setRenaming(null);
    } catch {
      // Parent-owned rename failures keep the inline editor open for correction or retry.
    }
  }

  async function deleteSelectedFiles(): Promise<void> {
    if (deleteSelectedFilesInFlight.current || selectedFilesInCurrentView.length === 0) return;

    deleteSelectedFilesInFlight.current = true;
    setDeletingSelectedFiles(true);
    try {
      await onDeleteFiles(selectedFilesInCurrentView);
    } catch {
      // Parent-owned delete failures keep selection intact so the user can retry.
    } finally {
      deleteSelectedFilesInFlight.current = false;
      setDeletingSelectedFiles(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <section aria-label={t('files.title')}>
          <header>
            <div>
              <h2>{t('files.title')}</h2>
              <p>{t('files.description')}</p>
            </div>
            <div>
              <Button type="button" variant="secondary" onClick={onRefreshFiles}>
                <RefreshIcon size={14} aria-hidden />
                {t('files.actions.refresh')}
              </Button>
              <Button type="button" variant="secondary" onClick={onUpload}>
                <UploadIcon size={14} aria-hidden />
                {t('files.actions.upload')}
              </Button>
              {/*
                Native file inputs are required for browser file chooser access; the visible
                upload trigger remains the UI-system Button above.
              */}
              <input
                type="file"
                multiple
                aria-label={t('files.actions.uploadFiles')}
                hidden
                onChange={(event) => {
                  const uploadFiles = Array.from(event.currentTarget.files ?? []);
                  if (uploadFiles.length > 0) onUploadFiles(uploadFiles);
                  event.currentTarget.value = '';
                }}
              />
              <Button type="button" variant="secondary" onClick={onPaste}>
                {t('files.actions.paste')}
              </Button>
              <Button type="button" variant="secondary" onClick={onNewSketch}>
                {t('files.actions.newSketch')}
              </Button>
            </div>
          </header>

          {uploadError ? <p role="alert">{uploadError}</p> : null}

          {files.length > 0 ? (
            <div>
              <div role="group" aria-label={t('files.groupBy')}>
                <Button
                  type="button"
                  variant={groupMode === 'kind' ? 'default' : 'secondary'}
                  aria-pressed={groupMode === 'kind'}
                  onClick={() => updateGroupMode('kind')}
                >
                  {t('files.columns.kind')}
                </Button>
                <Button
                  type="button"
                  variant={groupMode === 'modified' ? 'default' : 'secondary'}
                  aria-pressed={groupMode === 'modified'}
                  onClick={() => updateGroupMode('modified')}
                >
                  {t('files.columns.modified')}
                </Button>
              </div>

              <label>
                {t('files.sortBy')}
                <Select
                  value={sortKey}
                  onValueChange={(value: string) => updateSortKey(value as SortKey)}
                >
                  <SelectTrigger aria-label={t('files.sortBy')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mtime">{t('files.columns.modified')}</SelectItem>
                    <SelectItem value="name">{t('files.columns.name')}</SelectItem>
                    <SelectItem value="kind">{t('files.columns.kind')}</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label>
                {t('files.sortDirection')}
                <Select
                  value={sortDir}
                  onValueChange={(value: string) => updateSortDir(value as SortDir)}
                >
                  <SelectTrigger aria-label={t('files.sortDirection')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">{t('files.sortDirections.descending')}</SelectItem>
                    <SelectItem value="asc">{t('files.sortDirections.ascending')}</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label>
                {t('files.pageSize')}
                <Select
                  value={String(pageSize)}
                  onValueChange={(value: string) => updatePageSize(parsePageSize(value))}
                >
                  <SelectTrigger aria-label={t('files.pageSize')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={String(option)} value={String(option)}>
                        {option === 'all' ? t('common.all') : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div role="group" aria-label={t('files.filterByKind')}>
                {PROJECT_FILE_KINDS.map((kind) => (
                  <label key={kind}>
                    <Checkbox
                      aria-label={t('files.filterKind', { kind: projectFileKindLabel(kind, t) })}
                      checked={kindFilter.has(kind)}
                      onCheckedChange={() => updateKindFilter(kind)}
                    />
                    {t('files.kindFiles', { kind: projectFileKindLabel(kind, t) })}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {effectiveDir ? (
            <nav aria-label={t('files.folderBreadcrumb')}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCurrentDir('');
                  setPageIndex(0);
                  setSelectedFiles(new Set());
                }}
              >
                {t('files.rootFolder')}
              </Button>
              <span aria-current="page">{effectiveDir}</span>
            </nav>
          ) : null}

          {selectedFilesInCurrentView.length > 0 ? (
            <Button
              type="button"
              variant="destructive"
              disabled={deletingSelectedFiles}
              onClick={() => {
                void deleteSelectedFiles();
              }}
            >
              <DeleteIcon size={14} aria-hidden />
              {t('files.actions.deleteSelected')}
            </Button>
          ) : null}

          {hasVisibleRows ? (
            <>
              <div aria-label={t('files.list')}>
                <div>
                  <span>{t('files.columns.name')}</span>
                  <span>{t('files.columns.kind')}</span>
                  <span>{t('files.columns.modified')}</span>
                  <span>{t('files.columns.size')}</span>
                </div>

                {directoryRows.map((directory) => (
                  <div key={directory.path} data-testid={`design-directory-row-${directory.path}`}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setCurrentDir(directory.path);
                        setPageIndex(0);
                        setSelectedFiles(new Set());
                      }}
                      aria-label={t('files.actions.openFolder', { name: directory.name })}
                    >
                      <DirectoryIcon size={16} aria-hidden />
                      {directory.name}
                    </Button>
                    <Badge variant="secondary">{t('files.folder')}</Badge>
                  </div>
                ))}

                {sections.map((section) => (
                  <section key={section.id} aria-label={section.label}>
                    <h3>{section.label}</h3>
                    {section.rows.map(({ file }) => (
                      <FileRowView
                        key={file.name}
                        file={file}
                        displayName={displayNameForFile(file.name, effectiveDir)}
                        selected={selectedFiles.has(file.name)}
                        renaming={renaming?.name === file.name ? renaming : null}
                        onOpenFile={onOpenFile}
                        onDeleteFile={onDeleteFile}
                        onStartRename={startRename}
                        onRenameDraftChange={(draft) => setRenaming({ name: file.name, draft })}
                        onCancelRename={() => setRenaming(null)}
                        onSaveRename={saveRename}
                        onToggleSelected={toggleSelected}
                        t={t}
                        locale={locale}
                      />
                    ))}
                  </section>
                ))}
              </div>

              <footer>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={t('files.pagination.previousAria')}
                  disabled={safePageIndex === 0}
                  onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
                >
                  {t('files.pagination.previous')}
                </Button>
                <span>{pageInfo}</span>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={t('files.pagination.nextAria')}
                  disabled={safePageIndex >= totalPages - 1}
                  onClick={() => setPageIndex(Math.min(totalPages - 1, safePageIndex + 1))}
                >
                  {t('files.pagination.next')}
                </Button>
              </footer>
            </>
          ) : files.length === 0 ? (
            <p>{t('files.empty.noFiles')}</p>
          ) : (
            <p>{t('files.empty.noMatches')}</p>
          )}

          <LiveArtifactBadges artifacts={liveArtifacts} onOpenLiveArtifact={onOpenLiveArtifact} />

          {onPluginFolderAgentAction ? (
            <PluginActionsSection
              folders={pluginFolders}
              activePaths={activePluginActionPaths}
              hiddenPaths={hiddenPluginActionPaths}
              onPluginFolderAgentAction={onPluginFolderAgentAction}
              t={t}
            />
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

function PluginActionsSection({
  folders,
  activePaths,
  hiddenPaths,
  onPluginFolderAgentAction,
  t,
}: {
  folders: PluginFolderRow[];
  activePaths: Set<string>;
  hiddenPaths: Set<string>;
  onPluginFolderAgentAction: (path: string, action: PluginFolderAgentAction) => Promise<void> | void;
  t: TranslateFn;
}) {
  const visibleFolders = folders.filter((folder) => !hiddenPaths.has(folder.path));
  if (visibleFolders.length === 0) return null;

  return (
    <section aria-label={t('files.pluginActions.title')}>
      <h3>{t('files.pluginActions.title')}</h3>
      {visibleFolders.map((folder) => {
        const busy = activePaths.has(folder.path);
        return (
          <Card key={folder.path} data-testid={`design-plugin-folder-${folder.path}`}>
            <CardContent>
              <p>{folder.pluginName}</p>
              <p>
                {t('files.pluginActions.description', { count: folder.fileCount })}
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                aria-label={t('files.actions.installPlugin', { name: folder.pluginName })}
                onClick={() => {
                  void Promise.resolve(
                    onPluginFolderAgentAction(folder.path, {
                      kind: 'install-to-plugins',
                      path: folder.path,
                      pluginName: folder.pluginName,
                    }),
                  ).catch(() => undefined);
                }}
              >
                {t('files.actions.addToMyPlugins')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                aria-label={t('files.actions.publishRepoAria', { name: folder.pluginName })}
                onClick={() => {
                  void Promise.resolve(
                    onPluginFolderAgentAction(folder.path, {
                      kind: 'publish-repo',
                      path: folder.path,
                    }),
                  ).catch(() => undefined);
                }}
              >
                {t('files.actions.publishRepo')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                aria-label={t('files.actions.vibeDesignPrAria', { name: folder.pluginName })}
                onClick={() => {
                  void Promise.resolve(
                    onPluginFolderAgentAction(folder.path, {
                      kind: 'vibe-design-pr',
                      path: folder.path,
                      prTitle: `Add ${folder.pluginName} to Vibe Design`,
                    }),
                  ).catch(() => undefined);
                }}
              >
                {t('files.actions.vibeDesignPr')}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function FileRowView({
  file,
  displayName,
  selected,
  renaming,
  onOpenFile,
  onDeleteFile,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onSaveRename,
  onToggleSelected,
  t,
  locale,
}: {
  file: ProjectFile;
  displayName: string;
  selected: boolean;
  renaming: { name: string; draft: string } | null;
  onOpenFile: (name: string) => void;
  onDeleteFile: (name: string) => void;
  onStartRename: (name: string, draftName: string) => void;
  onRenameDraftChange: (draft: string) => void;
  onCancelRename: () => void;
  onSaveRename: (name: string) => Promise<void> | void;
  onToggleSelected: (name: string) => void;
  t: TranslateFn;
  locale: string;
}) {
  return (
    <div data-testid={`design-file-row-${file.name}`}>
      <span>
        <Checkbox
          aria-label={t('files.select', { name: file.name })}
          checked={selected}
          onCheckedChange={() => onToggleSelected(file.name)}
        />
      </span>
      {renaming ? (
        <span>
          <Input
            aria-label={t('files.newNameFor', { name: file.name })}
            value={renaming.draft}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onRenameDraftChange(event.target.value)}
          />
          <Button
            type="button"
            size="xs"
            aria-label={t('files.actions.saveRename', { name: file.name })}
            onClick={() => {
              void onSaveRename(file.name);
            }}
          >
            {t('files.actions.saveRename', { name: displayName })}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            aria-label={t('files.actions.cancelRename', { name: file.name })}
            onClick={onCancelRename}
          >
            {t('files.actions.cancelRename', { name: displayName })}
          </Button>
        </span>
      ) : (
        <Button
          type="button"
          variant="ghost"
          aria-label={file.name}
          onClick={() => onOpenFile(file.name)}
        >
          {iconForKind(file.kind)}
          <span>{displayName}</span>
        </Button>
      )}
      <span>{projectFileKindLabel(file.kind, t)}</span>
      <span>{formatDate(file.mtime, locale)}</span>
      <span>{formatSize(file.size)}</span>
      <span>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          aria-label={t('files.actions.rename', { name: file.name })}
          onClick={() => onStartRename(file.name, displayName)}
        >
          {t('files.actions.rename', { name: displayName })}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="destructive"
          aria-label={t('files.actions.delete', { name: file.name })}
          onClick={() => onDeleteFile(file.name)}
        >
          {t('files.actions.delete', { name: displayName })}
        </Button>
      </span>
    </div>
  );
}

function normalizeViewState(record: Record<string, unknown>): PersistedViewState {
  return {
    groupMode: isGroupMode(record.groupMode) ? record.groupMode : undefined,
    sortKey: isSortKey(record.sortKey) ? record.sortKey : undefined,
    sortDir: isSortDir(record.sortDir) ? record.sortDir : undefined,
    pageSize: isPageSize(record.pageSize) ? record.pageSize : undefined,
    kindFilter: Array.isArray(record.kindFilter)
      ? record.kindFilter.filter(isProjectFileKind)
      : undefined,
  };
}

function isGroupMode(value: unknown): value is DesignFilesGroupMode {
  return value === 'kind' || value === 'modified';
}

function isSortKey(value: unknown): value is SortKey {
  return value === 'name' || value === 'kind' || value === 'mtime';
}

function isSortDir(value: unknown): value is SortDir {
  return value === 'asc' || value === 'desc';
}

function isPageSize(value: unknown): value is number | 'all' {
  return value === 'all' || PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number]);
}

function isProjectFileKind(value: unknown): value is ProjectFileKind {
  return typeof value === 'string' && PROJECT_FILE_KINDS.includes(value as ProjectFileKind);
}

function parsePageSize(value: string): number | 'all' {
  if (value === 'all') return 'all';
  const parsed = Number(value);
  return isPageSize(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

function filterFilesByKind(files: ProjectFile[], kindFilter: ReadonlySet<ProjectFileKind>): ProjectFile[] {
  if (kindFilter.size === 0) return files;
  return files.filter((file) => kindFilter.has(file.kind));
}

function displayNameForFile(fileName: string, currentDir: string): string {
  const prefix = currentDir ? `${currentDir}/` : '';
  if (prefix && fileName.startsWith(prefix)) return fileName.slice(prefix.length);
  return fileName;
}

function resolveRenameTarget(fileName: string, draftName: string): string {
  const trimmedDraft = draftName.trim();
  if (!trimmedDraft || trimmedDraft.includes('/')) return trimmedDraft;
  const slashIndex = fileName.lastIndexOf('/');
  if (slashIndex === -1) return trimmedDraft;
  return `${fileName.slice(0, slashIndex + 1)}${trimmedDraft}`;
}

function directoryExists(files: ProjectFile[], currentDir: string): boolean {
  const prefix = `${currentDir}/`;
  return files.some((file) => file.name.startsWith(prefix));
}

function safePageFor(pageIndex: number, pageSize: number | 'all', totalRows: number): number {
  if (pageSize === 'all' || totalRows === 0) return 0;
  return Math.min(pageIndex, Math.max(0, Math.ceil(totalRows / pageSize) - 1));
}

function partitionCurrentDirectory(files: ProjectFile[], currentDir: string) {
  const directoryMap = new Map<string, DirectoryRow>();
  const filesAtCurrentDir: ProjectFile[] = [];
  const prefix = currentDir ? `${currentDir}/` : '';

  for (const file of files) {
    if (!file.name.startsWith(prefix)) continue;
    const relativeName = file.name.slice(prefix.length);
    if (!relativeName) continue;

    const slashIndex = relativeName.indexOf('/');
    if (slashIndex === -1) {
      filesAtCurrentDir.push(file);
      continue;
    }

    const segment = relativeName.slice(0, slashIndex);
    const path = prefix ? `${prefix}${segment}` : segment;
    if (!directoryMap.has(path)) {
      directoryMap.set(path, { type: 'directory', name: segment, path });
    }
  }

  return {
    directories: Array.from(directoryMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    filesAtCurrentDir,
  };
}

function findPluginFolders(files: ProjectFile[]): PluginFolderRow[] {
  const rows = new Map<string, PluginFolderRow>();

  for (const file of files) {
    const parts = file.name.split('/');
    if (parts.length < 2) continue;

    const root = parts[0]!;
    if (file.name !== `${root}/vibe-design.json`) continue;

    const folderFiles = files.filter((candidate) => candidate.name.startsWith(`${root}/`));
    rows.set(root, {
      path: root,
      pluginName: root,
      fileCount: folderFiles.length,
      updatedAt: Math.max(...folderFiles.map((candidate) => candidate.mtime)),
    });
  }

  return Array.from(rows.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}

function sortFiles(files: ProjectFile[], sortKey: SortKey, sortDir: SortDir): ProjectFile[] {
  const sign = sortDir === 'asc' ? 1 : -1;
  return [...files].sort((left, right) => {
    const primary = compareByKey(left, right, sortKey);
    if (primary !== 0) return primary * sign;
    return left.name.localeCompare(right.name);
  });
}

function compareByKey(left: ProjectFile, right: ProjectFile, sortKey: SortKey): number {
  if (sortKey === 'mtime') return left.mtime - right.mtime;
  if (sortKey === 'kind') return left.kind.localeCompare(right.kind);
  return left.name.localeCompare(right.name);
}

function groupFileRows(rows: FileRow[], groupMode: DesignFilesGroupMode, t: TranslateFn): FileSection[] {
  if (groupMode === 'modified') {
    const groups = new Map<ModifiedSection, FileRow[]>();
    for (const row of rows) {
      const section = getModifiedSection(row.file.mtime);
      groups.set(section, [...(groups.get(section) ?? []), row]);
    }
    return MODIFIED_ORDER.flatMap((section) => {
      const sectionRows = groups.get(section);
      return sectionRows ? [{ id: section, label: modifiedSectionLabel(section, t), rows: sectionRows }] : [];
    });
  }

  const groups = new Map<ProjectFileKind, FileRow[]>();
  for (const row of rows) {
    groups.set(row.file.kind, [...(groups.get(row.file.kind) ?? []), row]);
  }
  return Array.from(groups.entries()).map(([kind, sectionRows]) => ({
    id: kind,
    label: projectFileKindLabel(kind, t),
    rows: sectionRows,
  }));
}

function projectFileKindLabel(kind: ProjectFileKind, t: TranslateFn): string {
  if (kind === 'audio') return t('files.kinds.audio');
  if (kind === 'binary') return t('files.kinds.binary');
  if (kind === 'code') return t('files.kinds.code');
  if (kind === 'document') return t('files.kinds.document');
  if (kind === 'html') return t('files.kinds.html');
  if (kind === 'image') return t('files.kinds.image');
  if (kind === 'pdf') return t('files.kinds.pdf');
  if (kind === 'presentation') return t('files.kinds.presentation');
  if (kind === 'sketch') return t('files.kinds.sketch');
  if (kind === 'spreadsheet') return t('files.kinds.spreadsheet');
  if (kind === 'text') return t('files.kinds.text');
  return t('files.kinds.video');
}

function modifiedSectionLabel(section: ModifiedSection, t: TranslateFn): string {
  if (section === 'today') return t('files.modifiedSections.today');
  if (section === 'yesterday') return t('files.modifiedSections.yesterday');
  if (section === 'previous7Days') return t('files.modifiedSections.previous7Days');
  if (section === 'previous30Days') return t('files.modifiedSections.previous30Days');
  return t('files.modifiedSections.older');
}

function getModifiedSection(mtime: number): ModifiedSection {
  const now = new Date();
  const today = startOfDay(now);
  const modified = startOfDay(new Date(mtime));
  const ageInDays = Math.floor((today.getTime() - modified.getTime()) / 86_400_000);

  if (ageInDays <= 0) return 'today';
  if (ageInDays === 1) return 'yesterday';
  if (ageInDays <= 7) return 'previous7Days';
  if (ageInDays <= 30) return 'previous30Days';
  return 'older';
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatPageInfo(pageIndex: number, pageSize: number | 'all', totalRows: number, t: TranslateFn): string {
  if (totalRows === 0) return t('files.pageInfo', { start: 0, end: 0, total: 0 });
  if (pageSize === 'all') return t('files.pageInfo', { start: 1, end: totalRows, total: totalRows });
  const start = pageIndex * pageSize + 1;
  const end = Math.min(totalRows, start + pageSize - 1);
  return t('files.pageInfo', { start, end, total: totalRows });
}

function iconForKind(kind: ProjectFileKind) {
  if (kind === 'image') return <ImageFileIcon size={16} aria-hidden />;
  if (kind === 'code' || kind === 'html') return <FileCodeIcon size={16} aria-hidden />;
  if (kind === 'text' || kind === 'document' || kind === 'pdf') {
    return <FileTextIcon size={16} aria-hidden />;
  }
  return <FileIcon size={16} aria-hidden />;
}

function formatDate(mtime: number, locale: string): string {
  return new Date(mtime).toLocaleDateString(locale);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
