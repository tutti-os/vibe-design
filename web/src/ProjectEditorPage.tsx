import { useService } from '@tutti-os/infra/di';
import React from 'react';
import { ChatPane } from './components/ChatPane';
import {
  CanvasWorkspace,
  type CanvasCommentAttachment,
  type CanvasCommentStatus,
  type CanvasPreviewComment,
  type CanvasPreviewScreenshot,
  type CanvasPreviewScreenshotRequester,
  type WorkspaceFile,
  type WorkspaceTabsState,
} from './features/canvas-workspace';
import type { CanvasPreviewCommentTarget } from './features/canvas-workspace/canvas-comment/canvas-comment-types';
import type { FileOpEntry } from './runtime/file-ops';
import { consumeInitialProjectPrompt, consumeInitialProjectSkills } from './initial-project-prompt';
import { useServiceSnapshot } from './hooks/use-service-snapshot';
import { IChatSessionService } from './services/chat-session/chat-session-service.interface';
import type { ChatSessionSnapshot, SendTurnInput } from './services/chat-session/chat-session-types';
import { IChatTimelineService } from './services/chat-timeline/chat-timeline-service.interface';
import type { ChatTimelineSnapshot, GeneratedFileEntry } from './services/chat-timeline/chat-timeline-types';
import type {
  ChatComposerAgentAvailability,
  ChatComposerAgentModelCatalogEntry,
  ChatComposerDesignSystem,
  ChatComposerDesignSystemPickerState,
} from './components/ChatComposer';
import { IContextPickerService } from './services/context-picker/context-picker-service.interface';
import type { ContextPickerSnapshot } from './services/context-picker/context-picker-types';
import type { ProjectEditorInitialData } from './project-editor-data';
import { IDesignFileService } from './services/design-files/design-file-service.interface';
import { IProjectService } from './services/projects/project-service.interface';
import { IPreviewCommentService } from './services/preview-comments/preview-comment-service.interface';
import type { PreviewCommentSnapshot } from './services/preview-comments/preview-comment-types';
import type { ChatAttachment, ProjectFile } from './types';
import { useTranslation } from './i18n';

const CHAT_PANEL_MIN_WIDTH = 360;
const CHAT_PANEL_MAX_WIDTH = 600;
const CHAT_PANEL_DEFAULT_WIDTH = 500;
const CHAT_PANEL_COMPACT_WIDTH = 360;
const CHAT_PANEL_DEFAULT_WIDTH_CSS = `clamp(${CHAT_PANEL_DEFAULT_WIDTH}px, 29vw, ${CHAT_PANEL_MAX_WIDTH}px)`;
const CHAT_PANEL_KEYBOARD_STEP = 24;
const PROJECT_EDITOR_COMPACT_WIDTH = 1540;
const PROJECT_PREVIEW_COVER_NAME = 'cover.svg';
const DESIGN_STYLE_UPLOAD_FILE_NAME = 'design.md';


export function ProjectEditorPage({ projectId, initialData }: { projectId: string; initialData?: ProjectEditorInitialData }) {
  const { locale, t } = useTranslation();
  const designFiles = useService(IDesignFileService);
  const projects = useService(IProjectService);
  const timeline = useService(IChatTimelineService);
  const session = useService(IChatSessionService);
  const previewComments = useService(IPreviewCommentService);
  const timelineSnapshot = useServiceSnapshot<ChatTimelineSnapshot>(timeline);
  const sessionSnapshot = useServiceSnapshot<ChatSessionSnapshot>(session);
  const previewCommentSnapshot = useServiceSnapshot<PreviewCommentSnapshot>(previewComments);
  const activeConversationId = timelineSnapshot.activeConversationId;
  const [chatPanelWidth, setChatPanelWidth] = React.useState<number | null>(null);
  const [resizingChatPanel, setResizingChatPanel] = React.useState(false);
  const resizeStateRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const editorLayoutRef = React.useRef<HTMLElement | null>(null);
  const compactEditorLayout = useElementMaxWidth(editorLayoutRef, PROJECT_EDITOR_COMPACT_WIDTH);
  const [files, setFiles] = React.useState<WorkspaceFile[]>(() => initialData?.files ?? []);
  const [agentAvailability, setAgentAvailability] = React.useState<ChatComposerAgentAvailability[]>(
    () => initialData?.agentAvailability ?? [],
  );
  const [agentModelCatalog, setAgentModelCatalog] = React.useState<ChatComposerAgentModelCatalogEntry[]>([]);
  const [stagedCommentAttachments, setStagedCommentAttachments] = React.useState<CanvasCommentAttachment[]>([]);
  const [commentPanelOpen, setCommentPanelOpen] = React.useState(false);
  const [autoOpenFileRequest, setAutoOpenFileRequest] = React.useState<{ path: string; revision: number } | null>(null);
  const [autoOpenCommentRequest, setAutoOpenCommentRequest] = React.useState<{ id: string; revision: number } | null>(null);
  const [projectTitle, setProjectTitle] = React.useState<string | null>(initialData?.project.title ?? null);
  const pendingCanvasSaveNamesRef = React.useRef(new Map<string, number>());
  const filesRef = React.useRef(files);
  const previewScreenshotRequesterRef = React.useRef<CanvasPreviewScreenshotRequester | null>(null);
  const loadedPreviewCommentsRef = React.useRef<{ projectId: string; service: typeof previewComments } | null>(null);
  const refreshFilesRequestRef = React.useRef(0);
  const observedGeneratedFileEventKeysRef = React.useRef<Set<string> | null>(null);
  const observedCompletedRunKeysRef = React.useRef<Set<string> | null>(null);
  const initialTabs = initialData?.project.tabsState ?? { tabs: [], activeTabKey: null };
  const [workspaceTabsState, setWorkspaceTabsState] = React.useState<WorkspaceTabsState>(initialTabs);
  const effectiveChatPanelWidth = chatPanelWidth ?? (compactEditorLayout ? CHAT_PANEL_COMPACT_WIDTH : null);
  const chatPanelColumn = effectiveChatPanelWidth ? `${effectiveChatPanelWidth}px` : CHAT_PANEL_DEFAULT_WIDTH_CSS;
  const chatPanelAriaWidth = effectiveChatPanelWidth ?? CHAT_PANEL_DEFAULT_WIDTH;
  const [activeDesignSystemId, setActiveDesignSystemId] = React.useState<string | null>(
    initialData?.project.designSystemId ?? null,
  );
  const [designSystems, setDesignSystems] = React.useState<ChatComposerDesignSystem[]>([]);
  const [importedDesignStyle, setImportedDesignStyle] = React.useState<ChatComposerDesignSystem | null>(null);
  const [designSystemsLocale, setDesignSystemsLocale] = React.useState<string | null>(null);
  const [designSystemPickerState, setDesignSystemPickerState] =
    React.useState<ChatComposerDesignSystemPickerState>('idle');
  const [designSystemPickerError, setDesignSystemPickerError] = React.useState<string | null>(null);
  const designSystemRequestRef = React.useRef(0);
  const activeDesignSystem = React.useMemo(
    () =>
      resolveActiveDesignSystem(activeDesignSystemId, mergedDesignSystems(designSystems, importedDesignStyle), {
        category: t('projectEditor.designSystemFallback.category'),
        summary: t('projectEditor.designSystemFallback.summary'),
        title: t('projectEditor.designSystemFallback.title'),
      }),
    [activeDesignSystemId, designSystems, importedDesignStyle, t],
  );
  const activeWorkspaceFilePath = React.useMemo(
    () => activeFilePathFromTabsState(workspaceTabsState),
    [workspaceTabsState],
  );
  const activeFilePreviewComments = React.useMemo(
    () =>
      activeWorkspaceFilePath
        ? previewCommentSnapshot.comments.filter((comment) => comment.filePath === activeWorkspaceFilePath)
        : [],
    [activeWorkspaceFilePath, previewCommentSnapshot.comments],
  );

  React.useEffect(() => {
    if (!resizingChatPanel) return;

    function handlePointerMove(event: PointerEvent): void {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const nextWidth = resizeState.startWidth + event.clientX - resizeState.startX;
      setChatPanelWidth(clampChatPanelWidth(nextWidth));
    }

    function handlePointerUp(): void {
      resizeStateRef.current = null;
      setResizingChatPanel(false);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingChatPanel]);

  const handleTabsStateChange = React.useCallback(
    (tabsState: WorkspaceTabsState) => {
      setWorkspaceTabsState(tabsState);
      void projects.updateProjectTabsState(projectId, tabsState).catch(() => undefined);
    },
    [projectId, projects],
  );
  const loadDesignSystems = React.useCallback(async () => {
    if (
      designSystemPickerState === 'loading' ||
      (designSystemPickerState === 'ready' && designSystemsLocale === locale)
    ) {
      return;
    }

    const requestId = designSystemRequestRef.current + 1;
    const requestedLocale = locale;
    designSystemRequestRef.current = requestId;
    setDesignSystemPickerState('loading');
    setDesignSystemPickerError(null);

    try {
      const nextDesignSystems = await fetchOfficialDesignSystems(
        locale,
        t('projectEditor.errors.designSystemsLoad'),
        t('projectEditor.designSystemFallback.category'),
      );
      if (designSystemRequestRef.current !== requestId) return;
      setDesignSystems(nextDesignSystems);
      setDesignSystemsLocale(requestedLocale);
      setDesignSystemPickerState('ready');
    } catch {
      if (designSystemRequestRef.current !== requestId) return;
      setDesignSystems([]);
      setDesignSystemsLocale(null);
      setDesignSystemPickerState('error');
      setDesignSystemPickerError(t('projectEditor.errors.designSystemsLoad'));
    }
  }, [designSystemPickerState, designSystemsLocale, locale, t]);
  const handleOpenDesignSystemPicker = React.useCallback(() => {
    void loadDesignSystems();
  }, [loadDesignSystems]);
  const handleSelectDesignSystem = React.useCallback(
    async (designSystemId: string | null) => {
      const updatedProject = await projects.updateProjectDesignSystem(projectId, designSystemId);
      setActiveDesignSystemId(updatedProject.designSystemId ?? designSystemId ?? null);
    },
    [projectId, projects],
  );
  const handleImportDesignStyleFile = React.useCallback(
    async (file: File) => {
      const importedDesignSystem = await saveUploadedDesignStyleFile(file, activeDesignSystem, {
        category: t('projectEditor.importedDesignStyle.category'),
        importError: t('projectEditor.errors.designStyleImport'),
        summary: t('projectEditor.importedDesignStyle.summary'),
        title: t('projectEditor.importedDesignStyle.title'),
      });
      setDesignSystems((currentDesignSystems) =>
        upsertDesignSystem(currentDesignSystems, importedDesignSystem),
      );
      setImportedDesignStyle(importedDesignSystem);
      const updatedProject = await projects.updateProjectDesignSystem(projectId, importedDesignSystem.id);
      setActiveDesignSystemId(updatedProject.designSystemId ?? importedDesignSystem.id);
      return importedDesignSystem;
    },
    [activeDesignSystem, projectId, projects, t],
  );
  const handleInstallAgent = React.useCallback(async (agentId: string) => {
    if (agentId !== 'claude') {
      throw new Error(`Unsupported agent installer: ${agentId}`);
    }

    const nextAvailability = await installClaudeCodeAgent();
    setAgentAvailability(nextAvailability);
    const installedAgent = nextAvailability.find((agent) => agent.id === agentId);
    if (!installedAgent?.available) {
      throw new Error(installedAgent?.unavailableReason ?? 'Claude Code installation could not be verified.');
    }
  }, []);
  const handleRenameProject = React.useCallback(
    async (nextTitle: string) => {
      const updatedProject = await projects.updateProjectTitle(projectId, nextTitle);
      setProjectTitle(updatedProject.title);
    },
    [projectId, projects],
  );
  const handleFileContentChange = React.useCallback(
    (file: WorkspaceFile, content: string) => {
      markPendingCanvasSave(pendingCanvasSaveNamesRef.current, file.name);
      void designFiles.saveFileContent(file.name, content).catch(() => {
        consumePendingCanvasSave(pendingCanvasSaveNamesRef.current, file.name);
      });
    },
    [designFiles],
  );
  const refreshProjectFiles = React.useCallback(async () => {
    const requestId = refreshFilesRequestRef.current + 1;
    refreshFilesRequestRef.current = requestId;

    try {
      const projectFiles = await designFiles.listFiles();
      const currentFiles = filesRef.current;
      const nextFiles = await Promise.all(
        projectFiles.map(async (file) => {
          const kind = workspaceFileKind(file.kind);
          const content = shouldReadWorkspaceFileContent(kind)
            ? await designFiles.readFileContent(file.name).catch(() => '')
            : undefined;
          return workspaceFileFromProjectFile(file, content, designFiles.fileUrl(file.name), currentFiles);
        }),
      );
      if (refreshFilesRequestRef.current !== requestId) return;
      setFiles(nextFiles);
    } catch {
      // Keep the current canvas snapshot; chat/run state owns visible failure messaging.
    }
  }, [designFiles]);
  const requestCanvasOpen = React.useCallback((path: string) => {
    setAutoOpenFileRequest((currentRequest) => ({
      path,
      revision: (currentRequest?.revision ?? 0) + 1,
    }));
  }, []);
  const handleOpenGeneratedFile = React.useCallback(
    (generatedFile: GeneratedFileEntry) => {
      const file = findWorkspaceFileByGeneratedEntry(files, generatedFile);
      if (!file) return;

      requestCanvasOpen(file.path);
    },
    [files, requestCanvasOpen],
  );
  const handleOpenFileOp = React.useCallback(
    (op: FileOpEntry) => {
      const file = findWorkspaceFileByFileOp(files, op);
      if (!file) return;

      requestCanvasOpen(file.path);
    },
    [files, requestCanvasOpen],
  );
  const handleOpenAttachment = React.useCallback(
    (attachment: ChatAttachment) => {
      const file = findWorkspaceFileByAttachment(files, attachment);
      if (!file) return;

      requestCanvasOpen(file.path);
    },
    [files, requestCanvasOpen],
  );
  const handleSavePreviewComment = React.useCallback(
    (target: CanvasPreviewCommentTarget, note: string) => {
      return previewComments.upsert({ target, note });
    },
    [previewComments],
  );
  const handleDeletePreviewComment = React.useCallback(
    (commentId: string) => {
      return previewComments.delete(commentId);
    },
    [previewComments],
  );
  const handlePatchPreviewCommentStatus = React.useCallback(
    (commentId: string, status: CanvasCommentStatus) => {
      return previewComments.patchStatus(commentId, status).then(() => undefined);
    },
    [previewComments],
  );
  const handleOpenPreviewComment = React.useCallback(
    (comment: CanvasPreviewComment) => {
      requestCanvasOpen(comment.filePath);
      setAutoOpenCommentRequest((currentRequest) => ({
        id: comment.id,
        revision: (currentRequest?.revision ?? 0) + 1,
      }));
    },
    [requestCanvasOpen],
  );
  const handleUploadPreviewScreenshot = React.useCallback(
    async (dataUrl: string) => {
      const file = fileFromDataUrl(dataUrl, `visual-comment-${visualCommentDateSuffix(Date.now())}`);
      const [attachment] = await designFiles.uploadFiles([file]);
      if (!attachment?.path) {
        throw new Error(t('projectEditor.errors.visualCommentUpload'));
      }
      return attachment.path;
    },
    [designFiles, t],
  );
  const handleSendPreviewComments = React.useCallback(
    async (comments: CanvasPreviewComment[], agentId: string) => {
      const attachments = await buildScreenshotPreviewCommentAttachments({
        comments,
        requestScreenshot: previewScreenshotRequesterRef.current,
        uploadScreenshot: handleUploadPreviewScreenshot,
      });
      try {
        await session.sendTurn({
          draft: '',
          displayDraft: previewCommentDisplayDraft(attachments),
          files: [],
          agentId,
          commentAttachments: attachments,
        });
        setStagedCommentAttachments([]);
        setCommentPanelOpen(false);
      } catch {
        setCommentPanelOpen(false);
        setStagedCommentAttachments(attachments);
        throw new Error(t('projectEditor.errors.previewCommentsSend'));
      }
    },
    [handleUploadPreviewScreenshot, session, t],
  );
  const handleSendCommentAttachments = React.useCallback(
    (attachments: CanvasCommentAttachment[]) => {
      void session
        .sendTurn({
          draft: '',
          displayDraft: previewCommentDisplayDraft(attachments),
          files: [],
          commentAttachments: attachments,
        })
        .then(() => setStagedCommentAttachments([]))
        .catch(() => setStagedCommentAttachments(attachments));
    },
    [session],
  );
  const handleUploadPreviewCoverScreenshot = React.useCallback(
    async (screenshot: CanvasPreviewScreenshot) => {
      const coverSvg = previewCoverSvgFromScreenshot(screenshot);
      markPendingCanvasSave(pendingCanvasSaveNamesRef.current, PROJECT_PREVIEW_COVER_NAME);
      try {
        const file = await designFiles.saveFileContent(PROJECT_PREVIEW_COVER_NAME, coverSvg);
        return file.path ?? file.name;
      } catch (error) {
        consumePendingCanvasSave(pendingCanvasSaveNamesRef.current, PROJECT_PREVIEW_COVER_NAME);
        throw error;
      }
    },
    [designFiles],
  );
  const handleClearSentCommentAttachments = React.useCallback((sentAttachments: CanvasCommentAttachment[]) => {
    setStagedCommentAttachments((currentAttachments) =>
      currentAttachments === sentAttachments ? [] : currentAttachments,
    );
  }, []);

  function startChatPanelResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const measuredWidth = measureChatPanelWidth(editorLayoutRef.current);
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: measuredWidth ?? chatPanelWidth ?? CHAT_PANEL_DEFAULT_WIDTH,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizingChatPanel(true);
  }

  function resizeChatPanelWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const currentWidth = chatPanelWidth ?? measureChatPanelWidth(editorLayoutRef.current) ?? CHAT_PANEL_DEFAULT_WIDTH;
    setChatPanelWidth((width) =>
      clampChatPanelWidth((width ?? currentWidth) + direction * CHAT_PANEL_KEYBOARD_STEP),
    );
  }

  React.useEffect(() => {
    return designFiles.subscribe((event) => {
      if (event.type === 'uploaded') {
        void refreshProjectFiles();
        return;
      }

      const kind = workspaceFileKind(event.file.kind);
      const workspaceFile = workspaceFileFromProjectFile(
        event.file,
        shouldReadWorkspaceFileContent(kind) ? event.content : undefined,
        designFiles.fileUrl(event.file.name),
        filesRef.current,
      );
      const savedExistingFile = filesRef.current.some(
        (file) => file.path === workspaceFile.path || file.name === event.file.name,
      );
      const wasCanvasInitiatedSave = consumePendingCanvasSave(pendingCanvasSaveNamesRef.current, event.file.name);
      setFiles((currentFiles) => upsertWorkspaceFile(currentFiles, workspaceFile));
      if (wasCanvasInitiatedSave || savedExistingFile) return;
      requestCanvasOpen(workspaceFile.path);
    });
  }, [designFiles, refreshProjectFiles, requestCanvasOpen]);

  React.useEffect(() => {
    filesRef.current = files;
  }, [files]);

  React.useEffect(() => {
    const currentKeys = generatedFileEventKeys(timelineSnapshot.messages);
    const observedKeys = observedGeneratedFileEventKeysRef.current;
    if (!observedKeys) {
      observedGeneratedFileEventKeysRef.current = new Set(currentKeys);
      return;
    }

    let hasNewGeneratedFile = false;
    for (const key of currentKeys) {
      if (observedKeys.has(key)) continue;
      observedKeys.add(key);
      hasNewGeneratedFile = true;
    }

    if (hasNewGeneratedFile) {
      void refreshProjectFiles();
    }
  }, [refreshProjectFiles, timelineSnapshot.messages]);

  React.useEffect(() => {
    const currentKeys = completedRunKeys(timelineSnapshot.messages);
    const observedKeys = observedCompletedRunKeysRef.current;
    if (!observedKeys) {
      observedCompletedRunKeysRef.current = new Set(currentKeys);
      return;
    }

    let hasNewCompletedRun = false;
    for (const key of currentKeys) {
      if (observedKeys.has(key)) continue;
      observedKeys.add(key);
      hasNewCompletedRun = true;
    }

    if (hasNewCompletedRun) {
      void refreshProjectFiles();
    }
  }, [refreshProjectFiles, timelineSnapshot.messages]);

  React.useEffect(() => {
    setStagedCommentAttachments([]);
  }, [activeConversationId]);

  React.useEffect(() => {
    let canceled = false;
    void fetchAgentModelCatalog()
      .then((catalog) => {
        if (!canceled) {
          setAgentModelCatalog(catalog);
        }
      })
      .catch(() => {
        if (!canceled) {
          setAgentModelCatalog([]);
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  React.useEffect(() => {
    const loadedPreviewComments = loadedPreviewCommentsRef.current;
    if (loadedPreviewComments?.projectId === projectId && loadedPreviewComments.service === previewComments) {
      return;
    }
    loadedPreviewCommentsRef.current = { projectId, service: previewComments };
    void previewComments.load().catch(() => {
      if (loadedPreviewCommentsRef.current?.projectId === projectId) {
        loadedPreviewCommentsRef.current = null;
      }
    });
  }, [previewComments, projectId]);

  React.useEffect(() => {
    if (!activeDesignSystemId) return;
    if (designSystemPickerState === 'loading') return;
    if (
      designSystemPickerState === 'ready' &&
      designSystemsLocale === locale &&
      designSystems.some((designSystem) => designSystem.id === activeDesignSystemId)
    ) {
      return;
    }

    void loadDesignSystems();
  }, [
    activeDesignSystemId,
    designSystemPickerState,
    designSystems,
    designSystemsLocale,
    loadDesignSystems,
    locale,
  ]);

  return (
    <main className="project-editor-page min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex h-screen min-w-[1040px] flex-col overflow-hidden">
        <section
          ref={editorLayoutRef}
          className={`relative grid min-h-0 flex-1 overflow-hidden${
            resizingChatPanel ? ' cursor-col-resize select-none' : ''
          }`}
          data-testid="project-editor-layout"
          style={{
            gridTemplateColumns: `${chatPanelColumn} minmax(0, 1fr)`,
          }}
        >
          <ChatPanel
            projectId={projectId}
            projectTitle={projectTitle}
            agentAvailability={agentAvailability}
            agentModelCatalog={agentModelCatalog}
            commentAttachments={stagedCommentAttachments}
            previewComments={activeFilePreviewComments}
            commentPanelOpen={commentPanelOpen}
            startingRun={sessionSnapshot.startingRun}
            queuedTurns={sessionSnapshot.queuedTurns}
            onClearSentCommentAttachments={handleClearSentCommentAttachments}
            onClosePreviewCommentsPanel={() => setCommentPanelOpen(false)}
            onSendPreviewComments={handleSendPreviewComments}
            onDeletePreviewComment={handleDeletePreviewComment}
            onOpenPreviewComment={handleOpenPreviewComment}
            onPatchPreviewCommentStatus={handlePatchPreviewCommentStatus}
            files={files}
            onOpenAttachment={handleOpenAttachment}
            onOpenGeneratedFile={handleOpenGeneratedFile}
            onOpenFileOp={handleOpenFileOp}
            activeDesignSystem={activeDesignSystem}
            designSystems={mergedDesignSystems(designSystems, importedDesignStyle)}
            designSystemPickerState={designSystemPickerState}
            designSystemPickerError={designSystemPickerError}
            onOpenDesignSystemPicker={handleOpenDesignSystemPicker}
            onSelectDesignSystem={handleSelectDesignSystem}
            onImportDesignStyleFile={handleImportDesignStyleFile}
            onInstallAgent={handleInstallAgent}
            onRenameProject={handleRenameProject}
          />
          <div
            role="separator"
            aria-label={t('projectEditor.resizeChatPanel')}
            aria-orientation="vertical"
            aria-valuemin={CHAT_PANEL_MIN_WIDTH}
            aria-valuemax={CHAT_PANEL_MAX_WIDTH}
            aria-valuenow={chatPanelAriaWidth}
            tabIndex={0}
            className="group absolute inset-y-0 z-20 flex w-3 -translate-x-1/2 cursor-col-resize items-stretch justify-center outline-none"
            style={{ left: chatPanelColumn }}
            onPointerDown={startChatPanelResize}
            onKeyDown={resizeChatPanelWithKeyboard}
          >
            <span className="my-2 w-px rounded-full bg-transparent" />
          </div>
          <InitialProjectPromptStarter
            projectId={projectId}
            hasExistingMessages={timelineSnapshot.messages.length > 0}
            onSendTurn={(draft) => void session.sendTurn({ draft, files: [] })}
          />
          <CanvasWorkspace
            files={files}
            initialTabs={initialTabs}
            title={t('projectEditor.canvasTitle')}
            autoOpenFilePath={autoOpenFileRequest?.path ?? null}
            autoOpenFileRevision={autoOpenFileRequest?.revision ?? 0}
            autoOpenCommentId={autoOpenCommentRequest?.id ?? null}
            autoOpenCommentRevision={autoOpenCommentRequest?.revision ?? 0}
            previewComments={previewCommentSnapshot.comments}
            commentsPanelOpen={commentPanelOpen}
            onOpenPreviewCommentsPanel={() => setCommentPanelOpen(true)}
            onClosePreviewCommentsPanel={() => setCommentPanelOpen(false)}
            onSavePreviewComment={handleSavePreviewComment}
            onSendCommentAttachments={handleSendCommentAttachments}
            onPreviewScreenshotRequesterChange={(requester) => {
              previewScreenshotRequesterRef.current = requester;
            }}
            uploadPreviewCoverScreenshot={handleUploadPreviewCoverScreenshot}
            uploadPreviewScreenshot={handleUploadPreviewScreenshot}
            onTabsStateChange={handleTabsStateChange}
            onFileContentChange={handleFileContentChange}
          />
        </section>
      </div>
    </main>
  );
}

async function fetchOfficialDesignSystems(
  locale: string,
  loadErrorMessage: string,
  fallbackCategory: string,
): Promise<ChatComposerDesignSystem[]> {
  const response = await fetch(`/api/design-systems?locale=${encodeURIComponent(locale)}`);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(loadErrorMessage);
  }

  return readDesignSystems(data, fallbackCategory).filter((designSystem) => designSystem.source === 'built-in');
}

async function saveUploadedDesignStyleFile(
  file: File,
  activeDesignSystem: ChatComposerDesignSystem | null,
  text: {
    category: string;
    importError: string;
    summary: string;
    title: string;
  },
): Promise<ChatComposerDesignSystem & { source: 'user' }> {
  const body = await file.text();
  const existingUserDesignSystemId =
    activeDesignSystem && isUserDesignSystemId(activeDesignSystem.id) ? activeDesignSystem.id : null;
  const response = await fetch(
    existingUserDesignSystemId
      ? `/api/design-systems/${encodeURIComponent(existingUserDesignSystemId)}`
      : '/api/design-systems',
    {
      method: existingUserDesignSystemId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: existingUserDesignSystemId ? activeDesignSystem?.title ?? text.title : text.title,
        category: text.category,
        summary: text.summary,
        body,
        status: 'draft',
      }),
    },
  );
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readApiErrorMessage(data) ?? text.importError);
  }

  const designSystem = readDesignSystem(isRecord(data) ? data.designSystem : null, text.category);
  if (!designSystem || designSystem.source !== 'user') {
    throw new Error(text.importError);
  }
  return { ...designSystem, source: 'user' };
}

async function installClaudeCodeAgent(): Promise<ChatComposerAgentAvailability[]> {
  const response = await fetch('/api/agents/claude/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readApiErrorMessage(data) ?? 'Claude Code installation failed.');
  }

  return readAgentAvailability(data);
}

async function fetchAgentModelCatalog(): Promise<ChatComposerAgentModelCatalogEntry[]> {
  const response = await fetch('/api/agents/models');
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return [];
  }

  return readAgentModelCatalog(data);
}

function readAgentModelCatalog(data: unknown): ChatComposerAgentModelCatalogEntry[] {
  const value = isRecord(data) ? data.agents : null;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isAgentId(item.id) || typeof item.label !== 'string' || !Array.isArray(item.models)) {
      return [];
    }

    const models = item.models.flatMap((model) => {
      if (!isRecord(model) || typeof model.id !== 'string' || typeof model.label !== 'string') {
        return [];
      }
      return [
        {
          id: model.id,
          label: model.label,
          ...(typeof model.description === 'string' && model.description.trim()
            ? { description: model.description }
            : {}),
        },
      ];
    });

    return [{ agentId: item.id, label: item.label, models }];
  });
}

function isAgentId(value: unknown): value is 'codex' | 'claude' {
  return value === 'codex' || value === 'claude';
}

function readAgentAvailability(data: unknown): ChatComposerAgentAvailability[] {
  const value = isRecord(data) ? data.agentAvailability : null;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string') {
      return [];
    }

    return [{
      id: item.id,
      label: item.label,
      available: item.available === true,
      ...(isAgentAuthState(item.authState) ? { authState: item.authState } : {}),
      ...(typeof item.supported === 'boolean' ? { supported: item.supported } : {}),
      ...(typeof item.unavailableReason === 'string' ? { unavailableReason: item.unavailableReason } : {}),
    }];
  });
}

function isAgentAuthState(value: unknown): value is NonNullable<ChatComposerAgentAvailability['authState']> {
  return value === 'ok' || value === 'missing' || value === 'expired' || value === 'unknown';
}

function readApiErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const error = isRecord(data.error) ? data.error : null;
  return typeof error?.message === 'string' && error.message.trim() ? error.message : null;
}

function resolveActiveDesignSystem(
  designSystemId: string | null,
  designSystems: ChatComposerDesignSystem[],
  fallback: Pick<ChatComposerDesignSystem, 'category' | 'summary' | 'title'>,
): ChatComposerDesignSystem | null {
  if (!designSystemId) return null;
  return (
    designSystems.find((designSystem) => designSystem.id === designSystemId) ?? {
      id: designSystemId,
      title: fallback.title,
      category: fallback.category,
      summary: fallback.summary,
      swatches: [],
    }
  );
}

function upsertDesignSystem(
  designSystems: ChatComposerDesignSystem[],
  designSystem: ChatComposerDesignSystem,
): ChatComposerDesignSystem[] {
  const existingIndex = designSystems.findIndex((candidate) => candidate.id === designSystem.id);
  if (existingIndex === -1) return [designSystem, ...designSystems];

  return designSystems.map((candidate, index) => (index === existingIndex ? designSystem : candidate));
}

function mergedDesignSystems(
  designSystems: ChatComposerDesignSystem[],
  designSystem: ChatComposerDesignSystem | null,
): ChatComposerDesignSystem[] {
  return designSystem ? upsertDesignSystem(designSystems, designSystem) : designSystems;
}

function splitDesignStyleUploadFiles(files: SendTurnInput['files']): {
  designStyleFile: File | null;
  turnFiles: File[];
} {
  const designStyleFiles = files.filter(isDesignStyleUploadFile);
  return {
    designStyleFile: designStyleFiles.at(-1) ?? null,
    turnFiles: files.filter((file) => !isDesignStyleUploadFile(file)),
  };
}

function isDesignStyleUploadFile(file: File): boolean {
  return file.name.trim().toLowerCase() === DESIGN_STYLE_UPLOAD_FILE_NAME;
}

function isUserDesignSystemId(id: string): boolean {
  return id.startsWith('user:');
}

function readDesignSystems(
  data: unknown,
  fallbackCategory: string,
): Array<ChatComposerDesignSystem & { source: 'built-in' | 'user' }> {
  const value = isRecord(data) ? data.designSystems : null;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const designSystem = readDesignSystem(item, fallbackCategory);
    return designSystem ? [designSystem] : [];
  });
}

function readDesignSystem(
  value: unknown,
  fallbackCategory: string,
): (ChatComposerDesignSystem & { source: 'built-in' | 'user' }) | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  return {
    id: value.id,
    title: value.title,
    category: typeof value.category === 'string' ? value.category : fallbackCategory,
    summary: typeof value.summary === 'string' ? value.summary : '',
    swatches: Array.isArray(value.swatches)
      ? value.swatches.filter((swatch): swatch is string => typeof swatch === 'string')
      : [],
    source: value.source === 'user' ? 'user' : 'built-in',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampChatPanelWidth(width: number): number {
  return Math.min(CHAT_PANEL_MAX_WIDTH, Math.max(CHAT_PANEL_MIN_WIDTH, Math.round(width)));
}

function measureChatPanelWidth(layout: HTMLElement | null): number | null {
  const chatPanel = layout?.querySelector<HTMLElement>('[data-testid="project-chat-panel"]');
  const width = chatPanel?.getBoundingClientRect().width ?? 0;
  return width > 0 ? clampChatPanelWidth(width) : null;
}

function activeFilePathFromTabsState(tabsState: WorkspaceTabsState): string | null {
  const activeTabKey = tabsState.activeTabKey;
  if (!activeTabKey) return null;

  const activeTab = tabsState.tabs.find((tab) => tab.key === activeTabKey || `file:${tab.path}` === activeTabKey);
  return activeTab?.path ?? null;
}

function useElementMaxWidth(ref: React.RefObject<HTMLElement | null>, maxWidth: number): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateMatches = () => {
      const width = element.getBoundingClientRect().width;
      setMatches(width > 0 && width <= maxWidth);
    };

    updateMatches();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMatches);
    if (resizeObserver) {
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener('resize', updateMatches);
    return () => {
      window.removeEventListener('resize', updateMatches);
    };
  }, [maxWidth, ref]);

  return matches;
}

function workspaceFileFromProjectFile(
  file: ProjectFile,
  content: string | undefined,
  url: string | null = null,
  currentFiles: WorkspaceFile[] = [],
): WorkspaceFile {
  const existingPath = currentFiles.find((candidate) => candidate.name === file.name)?.path;
  return {
    name: file.name,
    path: existingPath ?? file.name,
    kind: workspaceFileKind(file.kind),
    mime: file.mime,
    size: file.size,
    mtime: file.mtime,
    updatedAt: file.updatedAt,
    ...(content === undefined ? {} : { contents: content }),
    ...(url ? { url } : {}),
  };
}

function workspaceFileKind(kind: ProjectFile['kind']): WorkspaceFile['kind'] {
  if (kind === 'html') return 'html';
  if (kind === 'image') return 'image';
  if (kind === 'text' || kind === 'code') return 'text';
  return 'unsupported';
}

function shouldReadWorkspaceFileContent(kind: WorkspaceFile['kind']): boolean {
  if (kind === 'html') return true;
  if (kind === 'text') return true;
  return false;
}

function upsertWorkspaceFile(files: WorkspaceFile[], file: WorkspaceFile): WorkspaceFile[] {
  const index = files.findIndex((candidate) => candidate.path === file.path || candidate.name === file.name);
  if (index < 0) return [...files, file];
  return files.map((candidate, candidateIndex) =>
    candidateIndex === index ? { ...file, path: candidate.path } : candidate,
  );
}

function markPendingCanvasSave(pendingSaveNames: Map<string, number>, name: string): void {
  pendingSaveNames.set(name, (pendingSaveNames.get(name) ?? 0) + 1);
}

function consumePendingCanvasSave(pendingSaveNames: Map<string, number>, name: string): boolean {
  const count = pendingSaveNames.get(name) ?? 0;
  if (count <= 0) return false;
  if (count === 1) {
    pendingSaveNames.delete(name);
  } else {
    pendingSaveNames.set(name, count - 1);
  }
  return true;
}

function findWorkspaceFileByGeneratedEntry(
  files: WorkspaceFile[],
  generatedFile: GeneratedFileEntry,
): WorkspaceFile | null {
  const generatedPath = normalizeWorkspacePath(generatedFile.name);

  return files.find((file) => {
    const filePath = normalizeWorkspacePath(file.path);
    const fileName = normalizeWorkspacePath(file.name);

    return (
      generatedPath === filePath ||
      generatedPath === fileName ||
      (filePath.length > 0 && generatedPath.endsWith(`/${filePath}`)) ||
      (fileName.length > 0 && generatedPath.endsWith(`/${fileName}`))
    );
  }) ?? null;
}

function findWorkspaceFileByFileOp(files: WorkspaceFile[], op: FileOpEntry): WorkspaceFile | null {
  const opPath = normalizeWorkspacePath(op.path);
  const opFullPath = normalizeWorkspacePath(op.fullPath);

  return files.find((file) => {
    const filePath = normalizeWorkspacePath(file.path);
    const fileName = normalizeWorkspacePath(file.name);

    return (
      opPath === filePath ||
      opPath === fileName ||
      opFullPath === filePath ||
      opFullPath === fileName ||
      (filePath.length > 0 && opFullPath.endsWith(`/${filePath}`)) ||
      (fileName.length > 0 && opFullPath.endsWith(`/${fileName}`))
    );
  }) ?? null;
}

function findWorkspaceFileByAttachment(files: WorkspaceFile[], attachment: ChatAttachment): WorkspaceFile | null {
  const attachmentPath = normalizeWorkspacePath(attachment.path);
  const attachmentName = normalizeWorkspacePath(attachment.name);

  return files.find((file) => {
    const filePath = normalizeWorkspacePath(file.path);
    const fileName = normalizeWorkspacePath(file.name);

    return (
      attachmentPath === filePath ||
      attachmentPath === fileName ||
      attachmentName === filePath ||
      attachmentName === fileName ||
      (filePath.length > 0 && attachmentPath.endsWith(`/${filePath}`)) ||
      (fileName.length > 0 && attachmentPath.endsWith(`/${fileName}`))
    );
  }) ?? null;
}

function generatedFileEventKeys(messages: ChatTimelineSnapshot['messages']): string[] {
  const keys: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.events)) continue;
    message.events.forEach((event, index) => {
      if (event.type !== 'generated_file') return;
      keys.push(`${message.id}:${event.eventId ?? index}:${event.name}`);
    });
    message.blocks.forEach((block, blockIndex) => {
      if (block.kind !== 'generated-files') return;
      block.files.forEach((file, fileIndex) => {
        keys.push(`${message.id}:block:${blockIndex}:${fileIndex}:${file.name}`);
      });
    });
  }
  return keys;
}

function completedRunKeys(messages: ChatTimelineSnapshot['messages']): string[] {
  const keys: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.runId) continue;
    if (
      message.runStatus !== 'succeeded' &&
      message.runStatus !== 'failed' &&
      message.runStatus !== 'canceled'
    ) {
      continue;
    }
    keys.push(`${message.id}:${message.runId}:${message.runStatus}`);
  }
  return keys;
}

async function buildScreenshotPreviewCommentAttachments({
  comments,
  requestScreenshot,
  uploadScreenshot,
}: {
  comments: CanvasPreviewComment[];
  requestScreenshot: CanvasPreviewScreenshotRequester | null;
  uploadScreenshot(dataUrl: string): Promise<string>;
}): Promise<CanvasCommentAttachment[]> {
  if (comments.length === 0) return [];

  const sharedScreenshotPath = comments.some((comment) => !previewCommentScreenshotPath(comment))
    ? await uploadSharedPreviewCommentScreenshot({ comments, requestScreenshot, uploadScreenshot })
    : null;

  return comments.map((comment, index) => ({
    id: comment.id,
    order: index + 1,
    filePath: comment.filePath,
    targetId: comment.targetId,
    selector: comment.selector,
    label: comment.label,
    comment: comment.note,
    currentText: comment.text,
    pagePosition: { ...comment.position },
    htmlHint: comment.htmlHint,
    ...(comment.style ? { style: { ...comment.style } } : {}),
    source: 'visual-mark' as const,
    selectionKind: 'visual' as const,
    screenshotPath: previewCommentScreenshotPath(comment) ?? sharedScreenshotPath ?? undefined,
    markKind: comment.selectionKind === 'visual' && comment.markKind ? comment.markKind : 'click',
    intent: 'Apply the saved preview comment using the attached screenshot.',
  }));
}

async function uploadSharedPreviewCommentScreenshot({
  comments,
  requestScreenshot,
  uploadScreenshot,
}: {
  comments: CanvasPreviewComment[];
  requestScreenshot: CanvasPreviewScreenshotRequester | null;
  uploadScreenshot(dataUrl: string): Promise<string>;
}): Promise<string> {
  const screenshot = await requestPreviewCommentScreenshot(requestScreenshot, comments);
  return uploadScreenshot(previewCommentScreenshotSvgFromScreenshot(screenshot, comments));
}

function previewCommentScreenshotPath(comment: CanvasPreviewComment): string | null {
  const screenshotPath = comment.screenshotPath?.trim();
  return screenshotPath || null;
}

async function requestPreviewCommentScreenshot(
  requestScreenshot: CanvasPreviewScreenshotRequester | null,
  comments: CanvasPreviewComment[],
): Promise<CanvasPreviewScreenshot> {
  if (requestScreenshot) {
    try {
      return await requestScreenshot();
    } catch {
      // Keep the comments send path on screenshot attachments even if the live preview bridge is unavailable.
    }
  }

  return fallbackPreviewCommentScreenshot(comments);
}

function fallbackPreviewCommentScreenshot(comments: CanvasPreviewComment[]): CanvasPreviewScreenshot {
  const rightEdge = comments.reduce((max, comment) => Math.max(max, comment.position.x + comment.position.width), 0);
  const bottomEdge = comments.reduce((max, comment) => Math.max(max, comment.position.y + comment.position.height), 0);
  const width = Math.max(320, Math.ceil(rightEdge + 48));
  const height = Math.max(240, Math.ceil(bottomEdge + 48));
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    '<text x="16" y="28" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#0f172a">Preview comment screenshot unavailable</text>',
    '<text x="16" y="50" font-family="system-ui, sans-serif" font-size="12" fill="#475569">Marked comment positions are preserved below.</text>',
    '</svg>',
  ].join('');

  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}

function previewCommentScreenshotSvgFromScreenshot(
  screenshot: CanvasPreviewScreenshot,
  comments: CanvasPreviewComment[],
): string {
  const width = Number.isFinite(screenshot.width) && screenshot.width > 0 ? Math.round(screenshot.width) : 1;
  const height = Number.isFinite(screenshot.height) && screenshot.height > 0 ? Math.round(screenshot.height) : 1;
  const commentMarks = comments
    .map((comment, index) => previewCommentScreenshotMarkSvg(comment, index + 1, width, height))
    .join('');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeSvgAttribute(screenshot.dataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
    commentMarks,
    '</svg>',
  ].join('');

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function previewCommentScreenshotMarkSvg(
  comment: CanvasPreviewComment,
  order: number,
  width: number,
  height: number,
): string {
  const x = clampSvgCoordinate(comment.position.x, 0, width);
  const y = clampSvgCoordinate(comment.position.y, 0, height);
  const rectWidth = clampSvgCoordinate(comment.position.width, 1, width - x);
  const rectHeight = clampSvgCoordinate(comment.position.height, 1, height - y);
  const markerX = clampSvgCoordinate(x + rectWidth, 18, width - 18);
  const markerY = clampSvgCoordinate(y, 18, height - 18);
  const label = escapeSvgText(String(order));

  return [
    `<rect x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}" rx="8" fill="none" stroke="#2563eb" stroke-width="4"/>`,
    `<circle cx="${markerX}" cy="${markerY}" r="16" fill="#2563eb" stroke="#ffffff" stroke-width="3"/>`,
    `<text x="${markerX}" y="${markerY + 5}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${label}</text>`,
  ].join('');
}

function clampSvgCoordinate(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeWorkspacePath(path: string | undefined): string {
  return path?.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '') ?? '';
}

function previewCoverSvgFromScreenshot(screenshot: CanvasPreviewScreenshot): string {
  const width = Number.isFinite(screenshot.width) && screenshot.width > 0 ? Math.round(screenshot.width) : 1;
  const height = Number.isFinite(screenshot.height) && screenshot.height > 0 ? Math.round(screenshot.height) : 1;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeSvgAttribute(screenshot.dataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
    '</svg>',
  ].join('');
}

function fileFromDataUrl(dataUrl: string, baseName: string): File {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Visual comment screenshot is invalid.');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const parameters = match[2] ?? '';
  const payload = match[3] ?? '';
  const blobPart = parameters.split(';').includes('base64')
    ? bytesFromBase64(payload)
    : decodeURIComponent(payload);
  return new File([blobPart], `${baseName}.${extensionForMimeType(mimeType)}`, { type: mimeType });
}

function visualCommentDateSuffix(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function bytesFromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/svg+xml') return 'svg';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/png') return 'png';
  return 'bin';
}

function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function InitialProjectPromptStarter({
  projectId,
  hasExistingMessages,
  onSendTurn,
}: {
  projectId: string;
  hasExistingMessages: boolean;
  onSendTurn: (draft: string) => void;
}) {
  const context = useService(IContextPickerService);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    const prompt = consumeInitialProjectPrompt(projectId);
    const skillIds = consumeInitialProjectSkills(projectId);
    // Only replay the dashboard handoff to kick off a brand-new project. If the
    // conversation already has messages (reload or revisit), clear the stale
    // handoff without replaying so we never double-send the first turn.
    if (!prompt || hasExistingMessages) {
      return;
    }

    void (async () => {
      // Re-apply the skills picked on the dashboard so the project's first run
      // includes them (the project owns a fresh context picker instance).
      for (const skillId of skillIds) {
        try {
          await context.selectSkill(skillId);
        } catch {
          // Best-effort: a skill that no longer exists is simply skipped.
        }
      }
      onSendTurn(prompt);
    })();
  }, [projectId, hasExistingMessages, onSendTurn, context]);

  return null;
}

function ChatPanel({
  projectId,
  projectTitle,
  agentAvailability,
  agentModelCatalog,
  activeDesignSystem,
  designSystems,
  designSystemPickerState,
  designSystemPickerError,
  commentAttachments,
  previewComments,
  commentPanelOpen,
  startingRun,
  queuedTurns,
  files,
  onOpenDesignSystemPicker,
  onSelectDesignSystem,
  onImportDesignStyleFile,
  onInstallAgent,
  onRenameProject,
  onClearSentCommentAttachments,
  onClosePreviewCommentsPanel,
  onSendPreviewComments,
  onDeletePreviewComment,
  onOpenPreviewComment,
  onPatchPreviewCommentStatus,
  onOpenAttachment,
  onOpenGeneratedFile,
  onOpenFileOp,
}: {
  projectId: string;
  projectTitle: string | null;
  agentAvailability: ChatComposerAgentAvailability[];
  agentModelCatalog: ChatComposerAgentModelCatalogEntry[];
  activeDesignSystem: ChatComposerDesignSystem | null;
  designSystems: ChatComposerDesignSystem[];
  designSystemPickerState: ChatComposerDesignSystemPickerState;
  designSystemPickerError: string | null;
  commentAttachments: CanvasCommentAttachment[];
  previewComments: CanvasPreviewComment[];
  commentPanelOpen: boolean;
  startingRun: boolean;
  queuedTurns: ChatSessionSnapshot['queuedTurns'];
  files: WorkspaceFile[];
  onOpenDesignSystemPicker: () => void | Promise<void>;
  onSelectDesignSystem: (designSystemId: string | null) => void | Promise<void>;
  onImportDesignStyleFile: (file: File) => Promise<ChatComposerDesignSystem>;
  onInstallAgent: (agentId: string) => void | Promise<void>;
  onRenameProject: (title: string) => void | Promise<void>;
  onOpenAttachment?: (attachment: ChatAttachment) => void;
  onClearSentCommentAttachments: (sentAttachments: CanvasCommentAttachment[]) => void;
  onClosePreviewCommentsPanel: () => void;
  onSendPreviewComments: (comments: CanvasPreviewComment[], agentId: string) => void | Promise<void>;
  onDeletePreviewComment: (commentId: string) => void | Promise<void>;
  onOpenPreviewComment: (comment: CanvasPreviewComment) => void | Promise<void>;
  onPatchPreviewCommentStatus: (commentId: string, status: CanvasCommentStatus) => void | Promise<void>;
  onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
  onOpenFileOp?: (op: FileOpEntry) => void;
}) {
  const timeline = useService(IChatTimelineService);
  const context = useService(IContextPickerService);
  const session = useService(IChatSessionService);
  const snapshot = useServiceSnapshot<ChatTimelineSnapshot>(timeline);
  const contextSnapshot = useServiceSnapshot<ContextPickerSnapshot>(context);

  return (
    <aside
      data-testid="project-chat-panel"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--background)]"
    >
      <div className="vibe-design-chat-ui flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ChatPane
          projectId={projectId}
          projectTitle={projectTitle}
          snapshot={snapshot}
          designFiles={files}
          contextSnapshot={contextSnapshot}
          contextSearch={(query) => context.search(query)}
          contextSelect={(item) => context.selectResult(item)}
          contextRemove={(kind, id) => context.removeSelection(kind, id)}
          agentAvailability={agentAvailability}
          agentModelCatalog={agentModelCatalog}
          activeDesignSystem={activeDesignSystem}
          designSystems={designSystems}
          designSystemPickerState={designSystemPickerState}
          designSystemPickerError={designSystemPickerError}
          commentAttachments={commentAttachments}
          previewComments={previewComments}
          commentPanelOpen={commentPanelOpen}
          startingRun={startingRun}
          queuedTurns={queuedTurns}
          onOpenDesignSystemPicker={onOpenDesignSystemPicker}
          onSelectDesignSystem={onSelectDesignSystem}
          onInstallAgent={onInstallAgent}
          onClosePreviewCommentsPanel={onClosePreviewCommentsPanel}
          onSendPreviewComments={onSendPreviewComments}
          onDeletePreviewComment={onDeletePreviewComment}
          onOpenPreviewComment={onOpenPreviewComment}
          onPatchPreviewCommentStatus={onPatchPreviewCommentStatus}
          onRenameProject={(_projectId, title) => onRenameProject(title)}
          onSend={async (input) => {
            const sentCommentAttachments = input.commentAttachments ?? [];
            const { designStyleFile, turnFiles } = splitDesignStyleUploadFiles(input.files);
            if (designStyleFile) {
              await onImportDesignStyleFile(designStyleFile);
            }
            const shouldSendTurn =
              input.draft.trim().length > 0 ||
              turnFiles.length > 0 ||
              (input.attachments?.length ?? 0) > 0 ||
              sentCommentAttachments.length > 0 ||
              contextSnapshot.selectedSkills.length > 0 ||
              contextSnapshot.selectedDesignFiles.length > 0;
            if (!shouldSendTurn) return;
            await session.sendTurn({
              ...input,
              files: turnFiles,
              ...(input.draft.trim().length === 0 && sentCommentAttachments.length > 0
                ? { displayDraft: previewCommentDisplayDraft(sentCommentAttachments) }
                : {}),
            });
            if (sentCommentAttachments.length > 0) {
              onClearSentCommentAttachments(sentCommentAttachments);
            }
          }}
          onStop={() => session.stopActiveRun()}
          onAnswerToolQuestion={(toolUseId, content) => session.answerToolQuestion(toolUseId, content)}
          onDeleteQueuedTurn={(queueId) => session.deleteQueuedTurn(queueId)}
          onSendQueuedTurnNext={(queueId) => session.sendQueuedTurnNext(queueId)}
          onOpenAttachment={onOpenAttachment}
          onOpenGeneratedFile={onOpenGeneratedFile}
          onOpenFileOp={onOpenFileOp}
          onCreateConversation={() => timeline.createConversation()}
          onSelectConversation={(conversationId) => timeline.selectConversation(conversationId)}
          onRenameConversation={(conversationId, title) => timeline.renameConversation(conversationId, title)}
          onDeleteConversation={(conversationId) => timeline.deleteConversation(conversationId)}
        />
      </div>
    </aside>
  );
}

function previewCommentDisplayDraft(attachments: readonly CanvasCommentAttachment[]): string {
  return attachments
    .map((attachment, index) => {
      const comment = attachment.comment.trim();
      const message = comment || attachment.label.trim() || attachment.targetId.trim();
      return attachments.length === 1 ? message : `${index + 1}. ${message}`;
    })
    .filter((message) => message.length > 0)
    .join('\n');
}
