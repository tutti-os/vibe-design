import React, { useMemo, useState } from 'react';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { ChevronLeft, ChevronRight, MonitorSmartphone } from 'lucide-react';
import { Badge, Button, toast } from '@tutti-os/ui-system/components';
import {
  AddIcon,
  ChatIcon,
  CloseIcon,
  DownloadIcon,
  EyeIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  EditIcon,
  ImageFileIcon,
  MinimizeIcon,
  RestoreIcon,
} from '@tutti-os/ui-system/icons';
import { cn } from '@tutti-os/ui-system/utils';
import {
  CanvasPreview,
  type CanvasPreviewFrameLayout,
  type CanvasPreviewScreenshot,
  type CanvasPreviewScreenshotRequester,
} from './CanvasPreview';
import { CanvasCommentOverlay } from './canvas-comment/CanvasCommentOverlay';
import { CanvasCommentPopover } from './canvas-comment/CanvasCommentPopover';
import { CanvasVisualCommentOverlay } from './canvas-comment/CanvasVisualCommentOverlay';
import type {
  CanvasCommentAttachment,
  CanvasCommentPoint,
  CanvasCommentTarget,
  CanvasCommentTargetSnapshot,
  CanvasCommentTool,
  CanvasVisualMarkCommentAttachment,
  CanvasPreviewComment,
  CanvasPreviewCommentTarget,
  CanvasVisualCommentTarget,
} from './canvas-comment/canvas-comment-types';
import { buildCanvasCommentAttachments, canvasCommentTargetFromSnapshot } from './canvas-comment/comment-attachment-model';
import { closeWorkspaceTab, fileTabKey, normalizeWorkspaceTabsState, openWorkspaceFileTab } from './canvas-workspace-tabs';
import type {
  FileSurfaceMode,
  PendingWorkspaceTransition,
  WorkspaceFile,
  WorkspaceTabsState,
} from './canvas-workspace-types';
import { buildDesignRuntimeSrcdoc } from './runtime/build-design-runtime-srcdoc';
import {
  defaultModeForTab,
  removeModeForTab,
  setModeForTab,
} from './workspace-mode';
import { type TranslateFn, useTranslation } from '../../i18n';
import { downloadFileFromUrl } from '../../utils/download-file';

export const DESIGN_FILES_TAB = '__design_files__';

const DESIGN_FILES_LIST_DEFAULT_WIDTH = 560;
const DESIGN_FILES_LIST_MIN_WIDTH = 360;
const DESIGN_FILES_PREVIEW_MIN_WIDTH = 480;
const DESIGN_FILES_SEPARATOR_WIDTH = 1;
const DESIGN_FILES_COMPACT_WIDTH = 1200;
const DESIGN_FILES_RESIZE_STEP = 24;
const INTERACTIVE_PREVIEW_MIN_SCALE = 0.1;
const INTERACTIVE_PREVIEW_MAX_SCALE = 2;
const INTERACTIVE_PREVIEW_SCALE_STEP = 0.1;
const HTML_PREVIEW_COVER_CAPTURE_DELAY_MS = 1000;
const COMMENT_SAVE_SCREENSHOT_TIMEOUT_MS = 350;
const COMMENT_RESTORE_POINT_RADIUS_PX = 12;
const TOOLBAR_PRESENCE_TRANSITION_MS = 140;

function FolderFilledIcon({
  size = 14,
  ...props
}: React.SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8.92969 2C9.42628 2.00008 9.91537 2.12381 10.3525 2.35938C10.7897 2.59498 11.1624 2.93486 11.4355 3.34961H11.4346L12.2393 4.54004L12.2451 4.5498C12.3371 4.68949 12.4627 4.8042 12.6104 4.88281C12.7579 4.96136 12.9227 5.00158 13.0898 5H20C20.7957 5 21.5585 5.3163 22.1211 5.87891C22.6837 6.44152 23 7.20435 23 8V19C23 19.7957 22.6837 20.5585 22.1211 21.1211C21.5585 21.6837 20.7957 22 20 22H4C3.20435 22 2.44152 21.6837 1.87891 21.1211C1.3163 20.5585 1 19.7957 1 19V5C1 4.20435 1.3163 3.44152 1.87891 2.87891C2.44152 2.3163 3.20435 2 4 2H8.92969Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ToolbarPresence({
  visible,
  className,
  children,
}: {
  visible: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = React.useState(visible);
  const [entered, setEntered] = React.useState(visible);
  const [contentWidth, setContentWidth] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    if (!mounted) return;
    const element = contentRef.current;
    if (!element) return;

    const measure = () => {
      setContentWidth(Math.ceil(element.scrollWidth));
    };

    measure();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resizeObserver?.observe(element);
    return () => resizeObserver?.disconnect();
  }, [mounted, children]);

  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      const enterFrame = window.requestAnimationFrame(() => setEntered(true));
      return () => window.cancelAnimationFrame(enterFrame);
    }

    setEntered(false);
    const exitTimer = window.setTimeout(() => setMounted(false), TOOLBAR_PRESENCE_TRANSITION_MS);
    return () => window.clearTimeout(exitTimer);
  }, [visible]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      aria-hidden={!visible}
      className={cn('grid shrink-0 overflow-hidden', className)}
      style={toolbarPresenceStyle(entered, contentWidth)}
    >
      <div ref={contentRef} className="flex min-w-max items-center overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export interface CanvasWorkspaceProps {
  files: WorkspaceFile[];
  title?: string;
  initialTabs?: WorkspaceTabsState;
  autoOpenFilePath?: string | null;
  autoOpenFileRevision?: number;
  autoOpenCommentId?: string | null;
  autoOpenCommentRevision?: number;
  previewComments?: CanvasPreviewComment[];
  commentsPanelOpen?: boolean;
  onLoadPreviewComments?: () => void | Promise<void>;
  onOpenPreviewCommentsPanel?: () => void;
  onClosePreviewCommentsPanel?: () => void;
  onSavePreviewComment?: (target: CanvasPreviewCommentTarget, note: string) => Promise<CanvasPreviewComment | null>;
  onSendCommentAttachments?: (attachments: CanvasCommentAttachment[]) => void;
  requestPreviewScreenshot?: CanvasPreviewScreenshotRequester;
  onPreviewScreenshotRequesterChange?: (requester: CanvasPreviewScreenshotRequester | null) => void;
  uploadPreviewCoverScreenshot?: (screenshot: CanvasPreviewScreenshot) => Promise<string>;
  uploadPreviewScreenshot?: (dataUrl: string) => Promise<string>;
  onCommentModeChange?: (active: boolean) => void;
  onTabsStateChange?: (tabsState: WorkspaceTabsState) => void;
  onFileContentChange?: (file: WorkspaceFile, content: string) => void;
}

export function CanvasWorkspace({
  files,
  title,
  initialTabs = { tabs: [], activeTabKey: null },
  autoOpenFilePath = null,
  autoOpenFileRevision = 0,
  autoOpenCommentId = null,
  autoOpenCommentRevision = 0,
  previewComments,
  commentsPanelOpen = false,
  onLoadPreviewComments,
  onOpenPreviewCommentsPanel,
  onClosePreviewCommentsPanel,
  onSavePreviewComment,
  onSendCommentAttachments,
  requestPreviewScreenshot,
  onPreviewScreenshotRequesterChange,
  uploadPreviewCoverScreenshot,
  uploadPreviewScreenshot,
  onCommentModeChange,
  onTabsStateChange,
  onFileContentChange,
}: CanvasWorkspaceProps) {
  const { t } = useTranslation();
  const workspaceTitle = title ?? t('workspace.defaultTitle');
  const [tabsState, setTabsState] = useState<WorkspaceTabsState>(() => normalizeWorkspaceTabsState(initialTabs));
  const [modeByTabKey, setModeByTabKey] = useState<Record<string, FileSurfaceMode | undefined>>({});
  const previewTheme = 'light';
  const [fileContentsByPath, setFileContentsByPath] = useState<Record<string, string>>({});
  const incomingFileContentsByPath = useMemo(() => readWorkspaceFileContentsByPath(files), [files]);
  const baseFileContentsByPathRef = React.useRef<Record<string, string>>(incomingFileContentsByPath);
  const reconciledFileContentsByPath = useMemo(
    () =>
      reconcileFileContentOverrides(
        fileContentsByPath,
        baseFileContentsByPathRef.current,
        incomingFileContentsByPath,
      ),
    [fileContentsByPath, incomingFileContentsByPath],
  );
  const [activeCommentTarget, setActiveCommentTarget] = useState<CanvasCommentTargetSnapshot | null>(null);
  const [hoveredCommentTarget, setHoveredCommentTarget] = useState<CanvasCommentTargetSnapshot | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentTool, setCommentTool] = useState<CanvasCommentTool>('picker');
  const [savedComments, setSavedComments] = useState<CanvasPreviewComment[]>([]);
  const [selectedSavedCommentId, setSelectedSavedCommentId] = useState<string | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [nextCommentId, setNextCommentId] = useState(1);
  const [commentFrameLayout, setCommentFrameLayout] = useState<CanvasPreviewFrameLayout | null>(null);
  const [interactionViewportBounds, setInteractionViewportBounds] = useState<CanvasInteractionViewportBounds | null>(null);
  const [interactivePreviewScale, setInteractivePreviewScale] = useState(1);
  const [interactivePreviewScaleMode, setInteractivePreviewScaleMode] = useState<'auto' | 'manual'>('auto');
  const [previewSnapshotRequester, setPreviewSnapshotRequester] = useState<CanvasPreviewScreenshotRequester | null>(null);
  const [previewCoverCaptureRevision, setPreviewCoverCaptureRevision] = useState(0);
  const [selectedDesignFilePath, setSelectedDesignFilePath] = useState<string | null>(null);
  const [showDesignFilesWhenEmpty, setShowDesignFilesWhenEmpty] = useState(false);
  const interactionViewportRef = React.useRef<HTMLDivElement | null>(null);
  const tabStripRef = React.useRef<HTMLDivElement | null>(null);
  const activeTabRef = React.useRef<HTMLElement | null>(null);
  const [tabStripHovered, setTabStripHovered] = useState(false);
  const [tabStripScrollState, setTabStripScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const savedHtmlPreviewScreenshotKeysRef = React.useRef<Map<string, 'pending' | 'saved'>>(new Map());
  const consumedAutoOpenFileRequestRef = React.useRef<string | null>(null);
  const activeTab = useMemo(
    () => tabsState.tabs.find((tab) => tab.key === tabsState.activeTabKey) ?? null,
    [tabsState.activeTabKey, tabsState.tabs],
  );
  const effectiveFiles = useMemo(() => {
    if (Object.keys(reconciledFileContentsByPath).length === 0) {
      return files;
    }

    return files.map((file) =>
      file.path in reconciledFileContentsByPath
        ? { ...file, contents: reconciledFileContentsByPath[file.path] }
        : file,
    );
  }, [reconciledFileContentsByPath, files]);

  const activeFile = useMemo(() => {
    return effectiveFiles.find((candidate) => candidate.path === activeTab?.path) ?? null;
  }, [activeTab?.path, effectiveFiles]);
  const activeMode = activeTab ? modeByTabKey[activeTab.key] ?? defaultModeForTab(activeTab) : null;
  const supportsHtmlSurfaceModes = activeFile?.kind === 'html';
  const canCommentActiveFile = supportsHtmlSurfaceModes;
  const isCommentMode = canCommentActiveFile && activeMode === 'comment';
  const usesManualPreviewLayout = supportsHtmlSurfaceModes && (activeMode === 'preview' || activeMode === 'comment');
  const isInteractivePreviewMode = isCommentMode;
  const shouldShowEmptyCanvas = !activeFile && effectiveFiles.length === 0 && !showDesignFilesWhenEmpty;
  const isDesignFilesActive = tabsState.activeTabKey === null && !shouldShowEmptyCanvas;
  const selectedDesignFile =
    effectiveFiles.find((candidate) => candidate.path === selectedDesignFilePath) ?? null;
  const displayedComments = previewComments ?? savedComments;
  const usesLocalCommentStore = previewComments === undefined;
  const canSavePreviewComment = usesLocalCommentStore || Boolean(onSavePreviewComment);
  const bridgePreviewScreenshotRequester = requestPreviewScreenshot ? null : previewSnapshotRequester;
  const automaticPreviewScreenshotRequester = requestPreviewScreenshot ?? bridgePreviewScreenshotRequester;
  const handleManualPreviewFrameLayoutChange = React.useCallback((layout: CanvasPreviewFrameLayout) => {
    setCommentFrameLayout(layout);
  }, [activeMode]);
  const updateTabStripScrollState = React.useCallback(() => {
    const strip = tabStripRef.current;
    if (!strip) {
      setTabStripScrollState((current) =>
        current.canScrollLeft || current.canScrollRight ? { canScrollLeft: false, canScrollRight: false } : current,
      );
      return;
    }

    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    const nextScrollState = {
      canScrollLeft: maxScrollLeft > 1 && strip.scrollLeft > 1,
      canScrollRight: maxScrollLeft > 1 && strip.scrollLeft < maxScrollLeft - 1,
    };
    setTabStripScrollState((current) =>
      current.canScrollLeft === nextScrollState.canScrollLeft && current.canScrollRight === nextScrollState.canScrollRight
        ? current
        : nextScrollState,
    );
  }, []);
  const scrollWorkspaceTabs = React.useCallback(
    (direction: 'left' | 'right') => {
      const strip = tabStripRef.current;
      if (!strip) {
        return;
      }
      const delta = Math.max(Math.round(strip.clientWidth * 0.75), 120);
      strip.scrollLeft += direction === 'left' ? -delta : delta;
      updateTabStripScrollState();
    },
    [updateTabStripScrollState],
  );
  const showTabStripScrollControls = React.useCallback(() => {
    setTabStripHovered(true);
    updateTabStripScrollState();
  }, [updateTabStripScrollState]);
  const activeManualFrameLayout = usesManualPreviewLayout
    ? commentFrameLayout ?? { width: 1280, height: 800, scale: interactivePreviewScale, active: true }
    : null;
  const activeFileComments = useMemo(
    () => displayedComments.filter((comment) => comment.filePath === activeFile?.path && comment.status !== 'attached'),
    [activeFile?.path, displayedComments],
  );
  const activeFileCommentCount = activeFileComments.length;
  const selectedVisualComment = useMemo(
    () =>
      isCommentMode && commentTool === 'visual' && selectedSavedCommentId
        ? activeFileComments.find(
            (comment) => comment.id === selectedSavedCommentId && comment.selectionKind === 'visual',
          ) ?? null
        : null,
    [activeFileComments, commentTool, isCommentMode, selectedSavedCommentId],
  );

  React.useEffect(() => {
    onTabsStateChange?.(tabsState);
  }, [onTabsStateChange, tabsState]);

  // Keep the active tab visible when many tabs overflow the strip horizontally.
  React.useEffect(() => {
    const activeTab = activeTabRef.current;
    if (typeof activeTab?.scrollIntoView === 'function') {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    updateTabStripScrollState();
  }, [tabsState.activeTabKey, tabsState.tabs.length, updateTabStripScrollState]);

  React.useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) {
      return undefined;
    }

    updateTabStripScrollState();
    strip.addEventListener('scroll', updateTabStripScrollState);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateTabStripScrollState);
    resizeObserver?.observe(strip);
    window.addEventListener('resize', updateTabStripScrollState);

    return () => {
      strip.removeEventListener('scroll', updateTabStripScrollState);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateTabStripScrollState);
    };
  }, [tabsState.tabs.length, updateTabStripScrollState]);

  // Translate vertical mouse-wheel scrolling into horizontal scrolling so the
  // tab strip stays reachable with a regular mouse (not just a trackpad swipe).
  React.useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) {
      return undefined;
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.shiftKey) {
        return;
      }
      const canScroll = strip.scrollWidth > strip.clientWidth;
      if (!canScroll) {
        return;
      }
      // Only hijack vertical-dominant gestures; let native horizontal
      // (trackpad) scrolling pass through untouched.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      strip.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    strip.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      strip.removeEventListener('wheel', handleWheel);
    };
  }, []);

  React.useEffect(() => {
    onCommentModeChange?.(Boolean(isCommentMode));
  }, [isCommentMode, onCommentModeChange]);

  React.useEffect(() => {
    baseFileContentsByPathRef.current = incomingFileContentsByPath;
    if (reconciledFileContentsByPath !== fileContentsByPath) {
      setFileContentsByPath(reconciledFileContentsByPath);
    }
  }, [fileContentsByPath, incomingFileContentsByPath, reconciledFileContentsByPath]);

  React.useEffect(() => {
    if (!autoOpenFilePath) return;
    const requestKey = `${autoOpenFileRevision}:${autoOpenFilePath}`;
    if (consumedAutoOpenFileRequestRef.current === requestKey) return;
    const file = files.find((candidate) => candidate.path === autoOpenFilePath);
    if (!file) return;

    consumedAutoOpenFileRequestRef.current = requestKey;
    setTabsState((state) => openWorkspaceFileTab(state, file));
    clearCommentSession();
  }, [autoOpenFilePath, autoOpenFileRevision, files]);

  React.useEffect(() => {
    if (!autoOpenCommentId) return;
    const comment = displayedComments.find((candidate) => candidate.id === autoOpenCommentId && candidate.status !== 'attached');
    if (!comment) return;
    const file = files.find((candidate) => candidate.path === comment.filePath || candidate.name === comment.filePath);
    if (!file) return;

    const tabKey = fileTabKey(file.path);
    setTabsState((state) => openWorkspaceFileTab(state, file));
    setModeByTabKey((state) => setModeForTab(state, tabKey, 'comment'));
    setCommentTool(commentToolForSavedComment(comment));
    setShowDesignFilesWhenEmpty(false);
    setSelectedDesignFilePath(file.path);

    if (comment.selectionKind === 'visual') {
      setActiveCommentTarget(null);
      setHoveredCommentTarget(null);
      setSelectedSavedCommentId(comment.id);
      setCommentDraft('');
      return;
    }

    const target = savedCommentToTargetSnapshot(comment);
    if (!target) {
      clearCommentSession();
      return;
    }

    setActiveCommentTarget(target);
    setHoveredCommentTarget(null);
    setSelectedSavedCommentId(comment.id);
    setCommentDraft(comment.note);
  }, [autoOpenCommentId, autoOpenCommentRevision, displayedComments, files]);

  React.useEffect(() => {
    if (selectedDesignFilePath && !selectedDesignFile) {
      setSelectedDesignFilePath(null);
    }
  }, [selectedDesignFile, selectedDesignFilePath]);

  React.useEffect(() => {
    setCommentFrameLayout(null);
    setInteractivePreviewScale(1);
    setInteractivePreviewScaleMode('auto');
  }, [activeFile?.path]);

  React.useEffect(() => {
    if (!isCommentMode) return;
    void onLoadPreviewComments?.();
  }, [activeFile?.path, isCommentMode, onLoadPreviewComments]);

  function openPreviewCommentsPanel(): void {
    void onLoadPreviewComments?.();
    onOpenPreviewCommentsPanel?.();
  }

  React.useEffect(() => {
    if (!activeFile || activeFile.kind !== 'html' || activeMode !== 'preview' || !uploadPreviewCoverScreenshot) {
      return;
    }

    const requestScreenshot = automaticPreviewScreenshotRequester;
    if (!requestScreenshot) {
      return;
    }

    const screenshotKey = htmlPreviewScreenshotKey(activeFile);
    if (savedHtmlPreviewScreenshotKeysRef.current.has(screenshotKey)) {
      return;
    }

    let cancelled = false;
    savedHtmlPreviewScreenshotKeysRef.current.set(screenshotKey, 'pending');

    const captureTimer = window.setTimeout(() => {
      void requestScreenshot()
        .then((screenshot) => {
          if (cancelled) return undefined;
          return uploadPreviewCoverScreenshot(screenshot);
        })
        .then(() => {
          if (!cancelled) {
            savedHtmlPreviewScreenshotKeysRef.current.set(screenshotKey, 'saved');
          }
        })
        .catch(() => {
          if (!cancelled) {
            savedHtmlPreviewScreenshotKeysRef.current.delete(screenshotKey);
          }
        });
    }, HTML_PREVIEW_COVER_CAPTURE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(captureTimer);
      if (savedHtmlPreviewScreenshotKeysRef.current.get(screenshotKey) === 'pending') {
        savedHtmlPreviewScreenshotKeysRef.current.delete(screenshotKey);
      }
    };
  }, [activeFile, activeMode, automaticPreviewScreenshotRequester, previewCoverCaptureRevision, uploadPreviewCoverScreenshot]);

  React.useLayoutEffect(() => {
    const viewport = interactionViewportRef.current;
    if (!viewport || !usesManualPreviewLayout) {
      setInteractionViewportBounds(null);
      return;
    }

    const updateViewportBounds = () => {
      setInteractionViewportBounds(readCanvasInteractionViewportBounds(viewport));
    };

    updateViewportBounds();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewportBounds);
    resizeObserver?.observe(viewport);
    return () => resizeObserver?.disconnect();
  }, [usesManualPreviewLayout]);

  React.useEffect(() => {
    if (!usesManualPreviewLayout || interactivePreviewScaleMode !== 'auto') {
      return;
    }

    if (!interactionViewportBounds || interactionViewportBounds.width <= 0) {
      return;
    }

    const nextScale = resolveInteractivePreviewAutoScale(activeManualFrameLayout, interactionViewportBounds);
    setInteractivePreviewScale((currentScale) => (currentScale === nextScale ? currentScale : nextScale));
  }, [
    activeFile?.path,
    activeManualFrameLayout?.width,
    activeManualFrameLayout?.height,
    interactionViewportBounds?.width,
    interactivePreviewScaleMode,
    usesManualPreviewLayout,
  ]);

  function clearCommentSession() {
    setActiveCommentTarget(null);
    setHoveredCommentTarget(null);
    setCommentDraft('');
    setSelectedSavedCommentId(null);
    setSavingComment(false);
  }

  function showDesignFilesNow() {
    setTabsState((state) => ({ ...state, activeTabKey: null }));
    setShowDesignFilesWhenEmpty(true);
    clearCommentSession();
  }

  function activateTabNow(key: string) {
    setTabsState((state) => ({ ...state, activeTabKey: key }));
    clearCommentSession();
  }

  function closeTabNow(key: string) {
    setTabsState((state) => closeWorkspaceTab(state, key));
    setModeByTabKey((state) => removeModeForTab(state, key));
    clearCommentSession();
  }

  function setFileModeNow(key: string, mode: FileSurfaceMode) {
    setModeByTabKey((state) => setModeForTab(state, key, mode));
    clearCommentSession();
  }

  function runTransition(transition: PendingWorkspaceTransition) {
    if (transition.kind === 'activate-tab') {
      if (transition.key === null) {
        showDesignFilesNow();
        return;
      }

      activateTabNow(transition.key);
      return;
    }

    if (transition.kind === 'close-tab') {
      closeTabNow(transition.key);
      return;
    }

    if (transition.kind === 'set-mode') {
      setFileModeNow(transition.key, transition.mode);
    }
  }

  function attemptTransition(next: PendingWorkspaceTransition) {
    runTransition(next);
    return true;
  }

  function showDesignFiles() {
    attemptTransition({ kind: 'activate-tab', key: null });
  }

  function openFile(file: WorkspaceFile) {
    setTabsState((state) => openWorkspaceFileTab(state, file));
    setShowDesignFilesWhenEmpty(false);
    setSelectedDesignFilePath(file.path);
    clearCommentSession();
  }

  function handlePreviewNavigate(path: string) {
    if (activeMode !== 'preview') {
      return;
    }

    const file = findWorkspaceFileByPath(effectiveFiles, path);
    if (!file || file.kind !== 'html') {
      return;
    }

    const tabKey = fileTabKey(file.path);
    setTabsState((state) => openWorkspaceFileTab(state, file));
    setModeByTabKey((state) => setModeForTab(state, tabKey, 'preview'));
    setShowDesignFilesWhenEmpty(false);
    setSelectedDesignFilePath(file.path);
    clearCommentSession();
  }

  function activateTab(key: string) {
    if (key === tabsState.activeTabKey) {
      return;
    }

    attemptTransition({ kind: 'activate-tab', key });
  }

  function closeTab(key: string) {
    const shouldGuard = key === tabsState.activeTabKey;

    if (shouldGuard) {
      attemptTransition({ kind: 'close-tab', key });
      return;
    }

    closeTabNow(key);
  }

  function setActiveFileMode(mode: FileSurfaceMode) {
    if (!activeTab || (mode === 'comment' && !canCommentActiveFile)) {
      return;
    }

    if (commentsPanelOpen) {
      onClosePreviewCommentsPanel?.();
    }

    if (mode === activeMode) {
      if (mode === 'preview') {
        requestPreviewCoverCapture();
      }
      return;
    }

    if (attemptTransition({ kind: 'set-mode', key: activeTab.key, mode }) && mode === 'preview') {
      requestPreviewCoverCapture();
    }
  }

  function setCommentModeWithTool(tool: CanvasCommentTool) {
    if (!activeTab || !canCommentActiveFile) {
      return;
    }

    if (commentsPanelOpen) {
      onClosePreviewCommentsPanel?.();
    }

    if (activeMode === 'comment') {
      if (tool !== commentTool) {
        setCommentTool(tool);
        clearCommentSession();
      }
      return;
    }

    if (attemptTransition({ kind: 'set-mode', key: activeTab.key, mode: 'comment' })) {
      setCommentTool(tool);
    }
  }

  function handleHtmlChange(html: string) {
    if (!activeFile) {
      return;
    }

    setFileContentsByPath((currentContents) => ({ ...currentContents, [activeFile.path]: html }));
    onFileContentChange?.(activeFile, html);
  }

  function handleCommentSelect(target: CanvasCommentTargetSnapshot) {
    if (commentTool !== 'picker') {
      return;
    }
    if (isFreePinCommentTarget(target)) {
      return;
    }
    const existingComment = findRestorableCommentForTarget(target);
    if (existingComment) {
      handleOpenSavedComment(existingComment);
      return;
    }
    setActiveCommentTarget(newCommentTargetSnapshot(target));
    setHoveredCommentTarget(null);
    setSelectedSavedCommentId(null);
    setCommentDraft('');
  }

  function handleOpenSavedComment(comment: CanvasPreviewComment) {
    if (comment.selectionKind === 'visual') {
      setCommentTool('visual');
      setActiveCommentTarget(null);
      setHoveredCommentTarget(null);
      setSelectedSavedCommentId(comment.id);
      setCommentDraft('');
      return;
    }

    const target = savedCommentToTargetSnapshot(comment);

    if (!target) {
      return;
    }

    setCommentTool(commentToolForSavedComment(comment));
    setActiveCommentTarget(target);
    setSelectedSavedCommentId(comment.id);
    setCommentDraft(comment.note);
  }

  async function handleSaveCommentDraft() {
    const note = commentDraft.trim();

    if (!activeCommentTarget || !note || savingComment) {
      return;
    }

    const target = await targetWithSavedCommentScreenshot(canvasCommentTargetFromSnapshot(activeCommentTarget));

    if (onSavePreviewComment) {
      setSavingComment(true);
      try {
        const savedComment = await onSavePreviewComment(target, note);
        if (usesLocalCommentStore && savedComment) {
          setSavedComments((currentComments) => [
            savedComment,
            ...currentComments.filter((comment) => comment.id !== savedComment.id),
          ]);
        }
        setCommentDraft('');
        setActiveCommentTarget(null);
        setSelectedSavedCommentId(null);
      } catch {
        // Keep the draft open; the service snapshot owns error presentation.
      } finally {
        setSavingComment(false);
      }
      return;
    }

    if (!usesLocalCommentStore) {
      return;
    }

    if (selectedSavedCommentId) {
      const normalizedTarget = target;

      setSavedComments((currentComments) =>
        currentComments.map((comment) =>
          comment.id === selectedSavedCommentId
            ? {
                ...normalizedTarget,
                id: comment.id,
                projectId: comment.projectId,
                note,
                status: comment.status,
                createdAt: comment.createdAt,
                updatedAt: Date.now(),
              }
            : comment,
        ),
      );
    } else {
      const id = `comment-${nextCommentId}`;
      const now = Date.now();
      const savedComment: CanvasPreviewComment = {
        ...target,
        id,
        projectId: 'local-project',
        note,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };

      setSavedComments((currentComments) => [...currentComments, savedComment]);
      setNextCommentId((value) => value + 1);
    }

    setCommentDraft('');
    setActiveCommentTarget(null);
    setSelectedSavedCommentId(null);
  }

  async function handleSendCommentDraft() {
    const note = commentDraft.trim();

    if (!activeCommentTarget || !note || savingComment) {
      return;
    }

    if (!onSendCommentAttachments) {
      void handleSaveCommentDraft();
      return;
    }

    const target = canvasCommentTargetFromSnapshot(activeCommentTarget);
    const attachments = uploadPreviewScreenshot
      ? await buildScreenshotCommentAttachments({
          target,
          note,
          requestScreenshot: requestVisualScreenshot,
          uploadScreenshot: uploadPreviewScreenshot,
        })
      : buildCanvasCommentAttachments({ target, notes: [note] });
    onSendCommentAttachments(attachments);
    setCommentDraft('');
    setActiveCommentTarget(null);
    setSelectedSavedCommentId(null);
  }

  function handleCommentPodStroke(_points: CanvasCommentPoint[]) {
    // The iframe bridge owns transient selection drawing; Workspace opens the completed target.
  }

  function handleCommentPodSelect(_points: CanvasCommentPoint[], target?: CanvasCommentTargetSnapshot) {
    if ((commentTool !== 'picker' && commentTool !== 'pod') || !target) {
      return;
    }
    const existingComment = findRestorableCommentForTarget(target);
    if (existingComment) {
      handleOpenSavedComment(existingComment);
      return;
    }
    setActiveCommentTarget(newCommentTargetSnapshot(target));
    setHoveredCommentTarget(null);
    setSelectedSavedCommentId(null);
    setCommentDraft('');
  }

  function findRestorableCommentForTarget(target: CanvasCommentTargetSnapshot): CanvasPreviewComment | null {
    const selectionKind = target.selectionKind ?? 'element';
    const draftTarget = newCommentTargetSnapshot(target);
    return activeFileComments.find((comment) => {
      if (comment.selectionKind !== selectionKind) return false;
      if (comment.targetId === draftTarget.targetId) return true;
      return targetPointsAreClose(comment, target);
    }) ?? null;
  }

  function handleSnapshotRequesterChange(requester: CanvasPreviewScreenshotRequester | null) {
    setPreviewSnapshotRequester(() => requester);
    onPreviewScreenshotRequesterChange?.(requester);
  }

  function requestPreviewCoverCapture() {
    setPreviewCoverCaptureRevision((revision) => revision + 1);
  }

  function zoomInteractivePreview(direction: 1 | -1) {
    setInteractivePreviewScaleMode('manual');
    setInteractivePreviewScale((currentScale) =>
      clampNumber(
        roundScale(currentScale + direction * INTERACTIVE_PREVIEW_SCALE_STEP),
        INTERACTIVE_PREVIEW_MIN_SCALE,
        INTERACTIVE_PREVIEW_MAX_SCALE,
      ),
    );
  }

  function resetInteractivePreviewZoom() {
    setInteractivePreviewScaleMode('auto');
    setInteractivePreviewScale(resolveInteractivePreviewAutoScale(activeManualFrameLayout, interactionViewportBounds));
  }

  function handleInteractionViewportScroll(event: React.UIEvent<HTMLDivElement>) {
    setInteractionViewportBounds(readCanvasInteractionViewportBounds(event.currentTarget));
  }

  function requestVisualScreenshot(): Promise<CanvasPreviewScreenshot> {
    if (requestPreviewScreenshot) {
      return requestPreviewScreenshot();
    }
    if (previewSnapshotRequester) {
      return previewSnapshotRequester();
    }
    return Promise.resolve(fallbackVisualScreenshot(activeFile?.path ?? 'preview', commentFrameLayout));
  }

  function handleSendVisualCommentAttachments(attachments: CanvasCommentAttachment[]) {
    onSendCommentAttachments?.(attachments);
  }

  async function handleSaveVisualComment(target: CanvasVisualCommentTarget, note: string) {
    if (onSavePreviewComment) {
      const savedComment = await onSavePreviewComment(target, note);
      if (usesLocalCommentStore && savedComment) {
        setSavedComments((currentComments) => [
          savedComment,
          ...currentComments.filter((comment) => comment.id !== savedComment.id),
        ]);
      }
      return;
    }

    if (!usesLocalCommentStore) {
      return;
    }

    const id = `comment-${nextCommentId}`;
    const now = Date.now();
    setSavedComments((currentComments) => [
      ...currentComments,
      {
        ...target,
        id,
        projectId: 'local-project',
        note,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setNextCommentId((value) => value + 1);
  }

  async function targetWithSavedCommentScreenshot(target: CanvasCommentTarget): Promise<CanvasCommentTarget> {
    if (target.screenshotPath || !uploadPreviewScreenshot) {
      return target;
    }

    try {
      const screenshot = await withTimeout(requestVisualScreenshot(), COMMENT_SAVE_SCREENSHOT_TIMEOUT_MS);
      const screenshotPath = await uploadPreviewScreenshot(commentTargetScreenshotDataUrl(screenshot, target.position));
      return { ...target, screenshotPath };
    } catch {
      return target;
    }
  }

  function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Timed out while capturing comment screenshot.')), timeoutMs);
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  return (
    <section aria-label={workspaceTitle} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--project-workspace-bg)] text-[12px]">
      <div
        className="relative flex min-h-10 items-center gap-2 pl-2 pr-4"
        onFocusCapture={showTabStripScrollControls}
        onMouseEnter={showTabStripScrollControls}
        onMouseLeave={() => setTabStripHovered(false)}
        onMouseMove={showTabStripScrollControls}
        onPointerEnter={showTabStripScrollControls}
        onPointerMove={showTabStripScrollControls}
      >
        <div ref={tabStripRef} role="tablist" aria-label={t('workspace.tabs')} className="vd-tab-strip flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <Button
            ref={isDesignFilesActive ? (activeTabRef as React.Ref<HTMLButtonElement>) : undefined}
            role="tab"
            aria-selected={isDesignFilesActive}
            className={cn(
              'box-border h-7 min-h-7 shrink-0 gap-1.5 rounded-md border border-transparent px-2.5 text-[12px] font-medium shadow-none',
              isDesignFilesActive
                ? 'border-[var(--border-1)] bg-[var(--background)] text-[var(--text-primary)] hover:bg-[var(--background)]'
                : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--background)] hover:text-[var(--text-primary)]',
            )}
            size="sm"
            type="button"
            variant="chrome"
            onClick={showDesignFiles}
          >
            <FolderFilledIcon size={14} />
            {t('workspace.designFiles')}
          </Button>
          {tabsState.tabs.map((tab) => {
            const selected = tabsState.activeTabKey === tab.key;

            return (
              <span
                key={tab.key}
                ref={selected ? (activeTabRef as React.Ref<HTMLSpanElement>) : undefined}
                data-testid={`workspace-file-tab-${tab.path}`}
                className={cn(
                  'group flex h-7 min-h-7 max-w-60 shrink-0 items-center overflow-hidden rounded-md border border-transparent shadow-none',
                  selected
                    ? 'border-[var(--border-1)] bg-[var(--background)] text-[var(--text-primary)]'
                    : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--background)] hover:text-[var(--text-primary)]',
                )}
              >
                <Button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn(
                    'h-full min-w-0 flex-1 gap-1.5 rounded-none border-0 bg-transparent pl-2.5 pr-0.5 text-[12px] shadow-none hover:bg-transparent active:bg-transparent',
                    selected ? 'font-medium text-[var(--text-primary)]' : 'font-normal text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
                  )}
                  size="sm"
                  variant="chrome"
                  onClick={() => activateTab(tab.key)}
                >
                  {tab.name.endsWith('.html') ? <FileCodeIcon size={12} /> : <FileIcon size={12} />}
                  <span className="truncate">{tab.name}</span>
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="chrome"
                  aria-label={t('workspace.actions.closeTab', { name: tab.name })}
                  className="h-5 w-6 min-w-6 justify-start pl-0.5 pr-2 hover:!bg-transparent active:!bg-transparent"
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    closeTab(tab.key);
                  }}
                >
                  <CloseIcon size={10} />
                </Button>
              </span>
            );
          })}
        </div>
        {tabStripHovered && tabStripScrollState.canScrollLeft ? (
          <Button
            aria-label={t('workspace.actions.scrollTabsLeft')}
            className="absolute left-2 top-1/2 z-10 h-6 min-h-6 w-6 min-w-6 -translate-y-1/2 rounded-full border border-[var(--border-1)] bg-[var(--background-fronted)] p-0 text-[var(--text-secondary)] shadow-[var(--project-shadow-raised)] hover:bg-[var(--background)] hover:text-[var(--text-primary)]"
            data-testid="workspace-tab-scroll-left"
            size="icon-sm"
            type="button"
            variant="chrome"
            onClick={() => scrollWorkspaceTabs('left')}
          >
            <ChevronLeft size={14} aria-hidden />
          </Button>
        ) : null}
        {tabStripHovered && tabStripScrollState.canScrollRight ? (
          <Button
            aria-label={t('workspace.actions.scrollTabsRight')}
            className="absolute right-4 top-1/2 z-10 h-6 min-h-6 w-6 min-w-6 -translate-y-1/2 rounded-full border border-[var(--border-1)] bg-[var(--background-fronted)] p-0 text-[var(--text-secondary)] shadow-[var(--project-shadow-raised)] hover:bg-[var(--background)] hover:text-[var(--text-primary)]"
            data-testid="workspace-tab-scroll-right"
            size="icon-sm"
            type="button"
            variant="chrome"
            onClick={() => scrollWorkspaceTabs('right')}
          >
            <ChevronRight size={14} aria-hidden />
          </Button>
        ) : null}
      </div>

      {activeFile ? (
        <div className="relative grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden bg-[var(--project-workspace-bg)] pb-3 pr-3">
          <main
            data-testid="active-file-surface"
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--project-radius-dialog)] border border-[var(--border-1)] bg-[var(--background-fronted)] shadow-none"
          >
            {supportsHtmlSurfaceModes ? (
              <div className="flex h-12 items-center justify-between border-b border-[var(--border-1)] bg-[var(--background-fronted)] px-3">
                <div role="tablist" aria-label={t('workspace.surfaceMode')} className="flex min-w-0 items-center gap-1">
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={!commentsPanelOpen && activeMode === 'preview'}
                    className={cn(
                      'h-7 rounded-md px-2 transition-[background-color,border-color,color,box-shadow]',
                      !commentsPanelOpen && activeMode === 'preview'
                        ? 'bg-[var(--project-input-bg)] hover:bg-[var(--project-input-hover-bg)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--project-input-hover-bg)]',
                    )}
                    style={modeTabTextStyle(!commentsPanelOpen && activeMode === 'preview')}
                    size="sm"
                    variant="chrome"
                    onClick={() => setActiveFileMode('preview')}
                  >
                    <MonitorSmartphone size={14} />
                    {t('workspace.modes.preview')}
                  </Button>
                  <ToolbarPresence visible={canCommentActiveFile}>
                    <Button
                      type="button"
                      role="tab"
                      aria-selected={!commentsPanelOpen && isCommentMode}
                      className={cn(
                        'h-7 rounded-md border px-2 text-[12px] font-medium shadow-none transition-[background-color,border-color,color,box-shadow]',
                        !commentsPanelOpen && isCommentMode
                          ? 'border-[var(--border-2)] bg-[var(--project-input-bg)] text-[var(--text-primary)] hover:bg-[var(--project-input-hover-bg)]'
                          : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--project-input-hover-bg)]',
                      )}
                      style={modeTabTextStyle(!commentsPanelOpen && isCommentMode)}
                      size="sm"
                      variant="chrome"
                      onClick={() => setCommentModeWithTool('picker')}
                    >
                      <EditIcon size={14} />
                      {t('workspace.modes.markUp')}
                    </Button>
                  </ToolbarPresence>
                  <ToolbarPresence visible={canCommentActiveFile}>
                    <Button
                      type="button"
                      role="tab"
                      aria-selected={commentsPanelOpen}
                      size="sm"
                      variant="chrome"
                      className={cn(
                        'h-7 rounded-md border px-2 text-[12px] font-medium shadow-none transition-[background-color,border-color,color,box-shadow]',
                        commentsPanelOpen
                          ? 'border-transparent bg-[var(--project-comment-marker-bg)] text-white hover:bg-[var(--project-comment-marker-bg)] active:bg-[var(--project-comment-marker-bg)]'
                          : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--project-input-hover-bg)]',
                      )}
                      onClick={openPreviewCommentsPanel}
                    >
                      <ChatIcon size={14} />
                      {activeFileCommentCount > 0
                        ? t('workspace.actions.commentsWithCount', { count: activeFileCommentCount })
                        : t('workspace.modes.comments')}
                    </Button>
                  </ToolbarPresence>
                </div>
                <div className="flex items-center gap-2">
                  <ToolbarPresence visible={usesManualPreviewLayout} className="ml-1">
                    <div
                      role="toolbar"
                      aria-label={t('workspace.zoomControls')}
                      className="flex items-center gap-1 pl-2"
                    >
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="chrome"
                        aria-label={t('workspace.actions.zoomOut')}
                        disabled={interactivePreviewScale <= INTERACTIVE_PREVIEW_MIN_SCALE}
                        onClick={() => zoomInteractivePreview(-1)}
                      >
                        <MinimizeIcon size={14} />
                      </Button>
                      <span
                        data-testid="canvas-preview-zoom-level"
                        className="min-w-12 text-center text-xs tabular-nums text-[var(--text-secondary)]"
                      >
                        {Math.round(interactivePreviewScale * 100)}%
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="chrome"
                        aria-label={t('workspace.actions.zoomIn')}
                        disabled={interactivePreviewScale >= INTERACTIVE_PREVIEW_MAX_SCALE}
                        onClick={() => zoomInteractivePreview(1)}
                      >
                        <AddIcon size={14} />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="chrome"
                        aria-label={t('workspace.actions.resetZoom')}
                        disabled={interactivePreviewScaleMode === 'auto'}
                        onClick={resetInteractivePreviewZoom}
                      >
                        <RestoreIcon size={14} />
                      </Button>
                    </div>
                  </ToolbarPresence>
                </div>
              </div>
            ) : null}
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-6">
              <div
                ref={interactionViewportRef}
                data-testid="canvas-preview-interaction-viewport"
                className={`relative h-full min-w-0 max-w-full ${
                  usesManualPreviewLayout ? 'overflow-auto bg-[var(--background-fronted)]' : 'overflow-hidden'
                }`}
                onScroll={isInteractivePreviewMode ? handleInteractionViewportScroll : undefined}
              >
                <div
                  data-testid="canvas-preview-interaction-content"
                  className={usesManualPreviewLayout ? 'relative mx-auto' : 'relative h-full'}
                  style={interactivePreviewContentStyle(
                    activeManualFrameLayout,
                    interactivePreviewScale,
                    usesManualPreviewLayout,
                    interactionViewportBounds,
                  )}
                >
                    <CanvasPreview
                      file={activeFile}
                      files={effectiveFiles}
                      scaleMode={usesManualPreviewLayout ? 'manual' : 'fit'}
                      manualScale={interactivePreviewScale}
                      previewTheme={previewTheme}
                      onHtmlChange={handleHtmlChange}
                      onPreviewNavigate={handlePreviewNavigate}
                      onFrameLayoutChange={usesManualPreviewLayout ? handleManualPreviewFrameLayoutChange : undefined}
                      onSnapshotRequesterChange={handleSnapshotRequesterChange}
                      onSnapshotBridgeReady={requestPreviewScreenshot ? undefined : requestPreviewCoverCapture}
                      {...(isCommentMode
                        ? {
                            commentMode: commentTool !== 'visual',
                            commentTool: commentTool === 'visual' ? 'picker' : commentTool,
                            activeCommentTargetId: activeCommentTarget?.targetId ?? null,
                            onCommentHoverChange: setHoveredCommentTarget,
                            onCommentSelect: handleCommentSelect,
                            onCommentPodStroke: handleCommentPodStroke,
                            onCommentPodSelect: handleCommentPodSelect,
                          }
                        : {})}
                    />
                    {isCommentMode ? (
                      <>
                        <CanvasCommentOverlay
                          activeTarget={activeCommentTarget}
                          frameLayout={activeManualFrameLayout}
                          hoveredTarget={hoveredCommentTarget}
                          savedComments={activeFileComments}
                          selectedSavedCommentId={selectedSavedCommentId}
                          scale={activeManualFrameLayout?.scale ?? 1}
                          onOpenSavedComment={handleOpenSavedComment}
                        />
                        {activeCommentTarget ? (
                          <div className="absolute z-[80]" style={commentPopoverStyle(activeCommentTarget, activeManualFrameLayout, interactionViewportBounds)}>
                            <CanvasCommentPopover
                              target={activeCommentTarget}
                              draft={commentDraft}
                              saving={savingComment}
                              canSave={canSavePreviewComment}
                              canSend={canSavePreviewComment}
                              onDraftChange={setCommentDraft}
                              onClose={clearCommentSession}
                              onSave={() => void handleSaveCommentDraft()}
                              onSend={handleSendCommentDraft}
                            />
                          </div>
                        ) : null}
                        {commentTool === 'visual' && activeFile ? (
                          <CanvasVisualCommentOverlay
                            filePath={activeFile.path}
                            frameLayout={activeManualFrameLayout}
                            viewportBounds={interactionViewportBounds}
                            requestScreenshot={requestVisualScreenshot}
                            uploadScreenshot={uploadPreviewScreenshot}
                            openedComment={selectedVisualComment}
                            onSave={handleSaveVisualComment}
                            onSend={handleSendVisualCommentAttachments}
                            onCloseOpenedComment={() => setSelectedSavedCommentId(null)}
                          />
                        ) : null}
                      </>
                    ) : null}
                </div>
              </div>
            </div>
          </main>

        </div>
      ) : shouldShowEmptyCanvas ? (
        <main className="relative min-h-0 flex-1 overflow-hidden bg-[var(--project-workspace-bg)] pb-3 pr-3">
          <div
            data-testid="canvas-empty-card"
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--project-radius-dialog)] border border-[var(--border-1)] bg-[var(--background-fronted)] shadow-none"
          >
            <CanvasEmptySurface />
          </div>
          <div data-testid="canvas-workspace-empty" className="sr-only">
            {t('workspace.empty.noFilesSentence')}
          </div>
        </main>
      ) : (
        <div className="min-h-0 flex-1 bg-[var(--project-workspace-bg)] pb-3 pr-3">
          <DesignFilesSurface
            files={effectiveFiles}
            selectedFile={selectedDesignFile}
            onSelectFile={(file) => setSelectedDesignFilePath(file.path)}
            onOpenFile={openFile}
          />
        </div>
      )}
    </section>
  );
}

function DesignFilesSurface({
  files,
  selectedFile,
  onSelectFile,
  onOpenFile,
}: {
  files: WorkspaceFile[];
  selectedFile: WorkspaceFile | null;
  onSelectFile: (file: WorkspaceFile) => void;
  onOpenFile: (file: WorkspaceFile) => void;
}) {
  const { t } = useTranslation();
  const { folders, pages, components } = useMemo(() => groupDesignFiles(files), [files]);
  const surfaceRef = React.useRef<HTMLElement | null>(null);
  const resizeStateRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const [listPaneWidth, setListPaneWidth] = React.useState(DESIGN_FILES_LIST_DEFAULT_WIDTH);
  const [resizingListPane, setResizingListPane] = React.useState(false);
  const compactSurface = useElementMaxWidth(surfaceRef, DESIGN_FILES_COMPACT_WIDTH);

  React.useEffect(() => {
    if (!resizingListPane) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(event: PointerEvent): void {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      setListPaneWidth(clampDesignFilesListWidth(
        resizeState.startWidth + event.clientX - resizeState.startX,
        surfaceRef.current,
      ));
    }

    function handlePointerUp(): void {
      resizeStateRef.current = null;
      setResizingListPane(false);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizingListPane]);

  function startListPaneResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: listPaneWidth,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizingListPane(true);
  }

  function resizeListPaneWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    setListPaneWidth((width) =>
      clampDesignFilesListWidth(
        width + direction * DESIGN_FILES_RESIZE_STEP,
        surfaceRef.current,
      ),
    );
  }

  return (
    <main
      ref={surfaceRef}
      data-testid="design-files-surface"
      className={`grid h-full min-h-0 overflow-hidden rounded-[var(--project-radius-dialog)] border border-[var(--border-1)] bg-[var(--background-fronted)] shadow-none${
        resizingListPane ? ' cursor-col-resize select-none' : ''
      }`}
    >
      <div
        data-testid="design-files-body"
        className="grid min-h-0 overflow-hidden"
        style={{
          gridTemplateColumns: compactSurface
            ? `minmax(0, 1fr) ${DESIGN_FILES_SEPARATOR_WIDTH}px minmax(0, 1fr)`
            : `${listPaneWidth}px ${DESIGN_FILES_SEPARATOR_WIDTH}px minmax(${DESIGN_FILES_PREVIEW_MIN_WIDTH}px, 1fr)`,
        }}
      >
        <section className="flex min-h-0 flex-col bg-[var(--background-fronted)]">
          <div aria-label={t('files.title')} className="min-h-0 flex-1 overflow-auto pt-3">
            <DesignFileListSection
              label={t('workspace.designFilesPanel.folders')}
              files={folders}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
            />
            <DesignFileListSection
              separated
              label={t('workspace.designFilesPanel.pages')}
              files={pages}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
            />
            <DesignFileListSection
              separated
              label={t('workspace.designFilesPanel.components')}
              files={components}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
            />
          </div>
        </section>

        <div
          role="separator"
          aria-label={t('workspace.designFilesPanel.resizePreview')}
          aria-orientation="vertical"
          aria-valuemin={DESIGN_FILES_LIST_MIN_WIDTH}
          aria-valuemax={maxDesignFilesListWidth(surfaceRef.current) ?? undefined}
          aria-valuenow={listPaneWidth}
          tabIndex={0}
          className="group relative h-full w-px cursor-col-resize bg-[var(--border-1)] outline-none transition-colors before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 hover:bg-[var(--text-secondary)] focus-visible:bg-[var(--text-primary)]"
          onPointerDown={startListPaneResize}
          onKeyDown={resizeListPaneWithKeyboard}
        />

        <DesignFileDetail files={files} selectedFile={selectedFile} onOpenFile={onOpenFile} />
      </div>

      <div data-testid="canvas-workspace-empty" className="sr-only">
        Choose a file to preview.
      </div>
    </main>
  );
}

function CanvasEmptySurface() {
  const { t } = useTranslation();

  return (
    <div
      className="relative grid min-h-[560px] flex-1 place-items-center overflow-hidden p-8"
      style={{
        backgroundImage: 'radial-gradient(color-mix(in srgb, var(--text-secondary) 14%, transparent) 1px, transparent 1px)',
        backgroundSize: '17px 17px',
      }}
    >
      <div className="w-full max-w-[690px]">
        <div className="mb-4 flex items-center justify-center">
          <img
            src="/assets/brand/vibedesign.png"
            alt=""
            aria-hidden="true"
            className="size-8 object-contain"
            draggable={false}
          />
        </div>
        <div className="text-center">
          <div className="text-[var(--project-font-title)] font-semibold text-[var(--text-primary)]">{t('workspace.empty.noFilesTitle')}</div>
          <div className="mx-auto mt-1 max-w-md text-[var(--project-font-meta)] leading-5 text-[var(--text-secondary)]">
            {t('workspace.empty.noFilesDescription')}
          </div>
        </div>
      </div>
    </div>
  );
}

function clampDesignFilesListWidth(width: number, surface: HTMLElement | null): number {
  const maxWidth = maxDesignFilesListWidth(surface);
  const roundedWidth = Math.round(width);
  const upperBound = maxWidth ?? Number.POSITIVE_INFINITY;

  return Math.min(upperBound, Math.max(DESIGN_FILES_LIST_MIN_WIDTH, roundedWidth));
}

function maxDesignFilesListWidth(surface: HTMLElement | null): number | null {
  const surfaceWidth = surface?.getBoundingClientRect().width ?? 0;
  if (surfaceWidth <= 0) return null;

  return Math.max(
    DESIGN_FILES_LIST_MIN_WIDTH,
    Math.floor(surfaceWidth - DESIGN_FILES_PREVIEW_MIN_WIDTH - DESIGN_FILES_SEPARATOR_WIDTH),
  );
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
    resizeObserver?.observe(element);
    window.addEventListener('resize', updateMatches);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateMatches);
    };
  }, [maxWidth, ref]);

  return matches;
}

function targetForCommentSave(
  target: CanvasCommentTargetSnapshot,
  commentId: string | null,
): CanvasCommentTarget {
  const normalizedTarget = canvasCommentTargetFromSnapshot(target);
  return commentId ? ({ ...normalizedTarget, id: commentId } as unknown as CanvasCommentTarget) : normalizedTarget;
}

function savedCommentToTargetSnapshot(comment: CanvasPreviewComment): CanvasCommentTargetSnapshot | null {
  const baseTarget = {
    filePath: comment.filePath,
    targetId: comment.targetId,
    selector: comment.selector,
    label: comment.label,
    text: comment.text,
    position: comment.position,
    htmlHint: comment.htmlHint,
    style: comment.style,
    hoverPoint: comment.hoverPoint,
    screenshotPath: comment.screenshotPath,
  };

  if (comment.selectionKind === 'visual') {
    return null;
  }

  if (comment.selectionKind === 'pod') {
    return {
      ...baseTarget,
      selectionKind: 'pod',
      memberCount: comment.memberCount,
      podMembers: comment.podMembers,
    };
  }

  return { ...baseTarget, selectionKind: 'element' };
}

function isFreePinCommentTarget(target: CanvasCommentTargetSnapshot): boolean {
  return target.selector === 'pin' && target.targetId.startsWith('pin-');
}

function newCommentTargetSnapshot(target: CanvasCommentTargetSnapshot): CanvasCommentTargetSnapshot {
  const point = target.hoverPoint;
  if (!point) {
    return target;
  }
  return {
    ...target,
    targetId: `${target.targetId}@${Math.round(point.x)}-${Math.round(point.y)}`,
  };
}

function targetPointsAreClose(comment: CanvasPreviewComment, target: CanvasCommentTargetSnapshot): boolean {
  const commentPoint = comment.hoverPoint ?? pointFromCommentTargetId(comment.targetId);
  if (!commentPoint || !target.hoverPoint) return false;
  if (baseCommentTargetId(comment.targetId) !== target.targetId) return false;
  return pointDistance(commentPoint, target.hoverPoint) <= COMMENT_RESTORE_POINT_RADIUS_PX;
}

function baseCommentTargetId(targetId: string): string {
  const pointSuffixIndex = targetId.lastIndexOf('@');
  return pointSuffixIndex > 0 ? targetId.slice(0, pointSuffixIndex) : targetId;
}

function pointFromCommentTargetId(targetId: string): CanvasCommentPoint | null {
  const pointSuffixIndex = targetId.lastIndexOf('@');
  if (pointSuffixIndex < 1) {
    return null;
  }
  const suffix = targetId.slice(pointSuffixIndex + 1);
  const match = /^(-?\d+)-(-?\d+)$/.exec(suffix);
  if (!match) {
    return null;
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function pointDistance(a: CanvasCommentPoint, b: CanvasCommentPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function commentToolForSavedComment(comment: CanvasPreviewComment): CanvasCommentTool {
  if (comment.selectionKind === 'visual') return 'visual';
  if (comment.selectionKind === 'pod') return 'pod';
  return 'picker';
}

function fallbackVisualScreenshot(filePath: string, frameLayout: CanvasPreviewFrameLayout | null): CanvasPreviewScreenshot {
  const width = Math.max(1, Math.round(frameLayout?.width ?? 1280));
  const height = Math.max(1, Math.round(frameLayout?.height ?? 800));
  const escapedFilePath = escapeXmlText(filePath);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="Canvas"/><text x="24" y="40" font-family="system-ui, sans-serif" font-size="16" fill="CanvasText">${escapedFilePath}</text></svg>`;

  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}

async function buildScreenshotCommentAttachments(input: {
  target: CanvasCommentTarget;
  note: string;
  requestScreenshot: () => Promise<CanvasPreviewScreenshot>;
  uploadScreenshot: (dataUrl: string) => Promise<string>;
}): Promise<CanvasVisualMarkCommentAttachment[]> {
  const [baseAttachment] = buildCanvasCommentAttachments({ target: input.target, notes: [input.note] });
  if (!baseAttachment) {
    return [];
  }

  const screenshot = await input.requestScreenshot();
  const screenshotPath = await input.uploadScreenshot(commentTargetScreenshotDataUrl(screenshot, baseAttachment.pagePosition));

  return [
    {
      id: baseAttachment.id,
      order: baseAttachment.order,
      source: 'visual-mark',
      selectionKind: 'visual',
      filePath: baseAttachment.filePath,
      targetId: baseAttachment.targetId,
      selector: baseAttachment.selector,
      label: baseAttachment.label,
      comment: baseAttachment.comment,
      currentText: baseAttachment.currentText,
      pagePosition: baseAttachment.pagePosition,
      htmlHint: baseAttachment.htmlHint,
      ...(baseAttachment.style ? { style: { ...baseAttachment.style } } : {}),
      markKind: 'click',
      screenshotPath,
      intent: baseAttachment.comment,
    },
  ];
}

function commentTargetScreenshotDataUrl(
  screenshot: CanvasPreviewScreenshot,
  position: CanvasVisualMarkCommentAttachment['pagePosition'],
): string {
  const width = Math.max(1, Math.round(screenshot.width));
  const height = Math.max(1, Math.round(screenshot.height));
  const marker = clampPositionToScreenshot(position, width, height);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeXmlText(screenshot.dataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
    `<rect x="${marker.x}" y="${marker.y}" width="${marker.width}" height="${marker.height}" rx="8" fill="#2563eb" fill-opacity="0.12" stroke="#2563eb" stroke-width="2" stroke-dasharray="6 4"/>`,
    `<circle cx="${marker.x + 10}" cy="${marker.y + 10}" r="8" fill="#2563eb"/>`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function clampPositionToScreenshot(
  position: CanvasVisualMarkCommentAttachment['pagePosition'],
  width: number,
  height: number,
): CanvasVisualMarkCommentAttachment['pagePosition'] {
  const x = clampNumber(Math.round(position.x), 0, Math.max(0, width - 1));
  const y = clampNumber(Math.round(position.y), 0, Math.max(0, height - 1));
  const right = clampNumber(Math.round(position.x + position.width), x + 1, width);
  const bottom = clampNumber(Math.round(position.y + position.height), y + 1, height);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function htmlPreviewScreenshotKey(file: WorkspaceFile): string {
  return [
    file.path,
    file.kind,
    file.mime,
    file.size ?? '',
    file.mtime ?? '',
    file.updatedAt ?? '',
    file.url ?? '',
    file.contents ?? '',
  ].join('\u0000');
}

function interactivePreviewContentStyle(
  frameLayout: CanvasPreviewFrameLayout | null,
  scale: number,
  active: boolean,
  viewportBounds: CanvasInteractionViewportBounds | null,
): React.CSSProperties | undefined {
  if (!active) return undefined;

  const width = Math.max(1, Math.round((frameLayout?.width ?? 1280) * scale));
  const height = Math.max(1, Math.round((frameLayout?.height ?? 800) * scale));
  const verticalMargin = viewportBounds
    ? Math.max(0, Math.round((viewportBounds.height - height) / 2))
    : 0;

  return {
    width,
    height,
    marginTop: verticalMargin,
    marginBottom: verticalMargin,
  };
}

function resolveInteractivePreviewAutoScale(
  frameLayout: CanvasPreviewFrameLayout | null,
  viewportBounds: CanvasInteractionViewportBounds | null,
): number {
  // Preview and mark-up use the same fit-to-width auto scale so switching modes
  // does not change the canvas' apparent size.
  const frameWidth = frameLayout?.width ?? 1280;
  const viewportWidth = viewportBounds?.width ?? frameWidth;
  if (!Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return 1;
  }

  return clampNumber(floorScale(Math.min(1, viewportWidth / frameWidth)), INTERACTIVE_PREVIEW_MIN_SCALE, 1);
}

function modeTabTextStyle(active: boolean): React.CSSProperties | undefined {
  return active
    ? { backgroundColor: 'var(--project-input-bg)', color: 'var(--text-primary)' }
    : { color: 'var(--text-secondary)' };
}

function toolbarPresenceStyle(entered: boolean, contentWidth: number | null): React.CSSProperties {
  return {
    width: entered ? contentWidth ?? 'auto' : 0,
    opacity: entered ? 1 : 0,
    transform: entered ? 'translateX(0)' : 'translateX(4px)',
    transformOrigin: 'right center',
    transition: [
      `width ${TOOLBAR_PRESENCE_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      `opacity ${TOOLBAR_PRESENCE_TRANSITION_MS - 20}ms ease-out`,
      `transform ${TOOLBAR_PRESENCE_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    ].join(', '),
    pointerEvents: entered ? undefined : 'none',
  };
}

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

function floorScale(value: number): number {
  return Math.floor(value * 1000) / 1000;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function commentPopoverStyle(
  target: CanvasCommentTargetSnapshot,
  frameLayout: CanvasPreviewFrameLayout | null,
  viewportBounds: CanvasInteractionViewportBounds | null,
): React.CSSProperties {
  const margin = 12;
  const popoverWidth = 320;
  const popoverHeight = 150;
  const edge = 12;
  if (frameLayout) {
    const frameWidth = frameLayout.width * frameLayout.scale;
    const frameLeft = Math.round(frameWidth / 2);
    const targetLeft = target.position.x * frameLayout.scale;
    const targetRight = (target.position.x + target.position.width) * frameLayout.scale;
    const targetTop = target.position.y * frameLayout.scale;
    const targetBottom = (target.position.y + target.position.height) * frameLayout.scale;
    const placement = floatingPopoverPlacement({
      targetLeft,
      targetRight,
      targetTop,
      targetBottom,
      popoverWidth,
      popoverHeight,
      margin,
      edge,
      fallbackWidth: frameWidth,
      viewportBounds,
    });
    return {
      left: `calc(50% - ${frameLeft}px + ${placement.x}px)`,
      top: placement.y,
    };
  }

  const targetLeft = target.position.x;
  const targetRight = target.position.x + target.position.width;
  const targetTop = target.position.y;
  const targetBottom = target.position.y + target.position.height;
  const placement = floatingPopoverPlacement({
    targetLeft,
    targetRight,
    targetTop,
    targetBottom,
    popoverWidth,
    popoverHeight,
    margin,
    edge,
    fallbackWidth: Math.max(targetRight + popoverWidth + margin, popoverWidth + edge * 2),
    viewportBounds,
  });
  return {
    left: placement.x,
    top: placement.y,
  };
}

function floatingPopoverPlacement(input: {
  targetLeft: number;
  targetRight: number;
  targetTop: number;
  targetBottom: number;
  popoverWidth: number;
  popoverHeight: number;
  margin: number;
  edge: number;
  fallbackWidth: number;
  viewportBounds: CanvasInteractionViewportBounds | null;
}): { x: number; y: number } {
  const visibleLeft = input.viewportBounds?.scrollLeft ?? 0;
  const visibleTop = input.viewportBounds?.scrollTop ?? 0;
  const visibleWidth = input.viewportBounds?.width ?? input.fallbackWidth;
  const visibleHeight = input.viewportBounds?.height ?? Math.max(input.targetBottom + input.popoverHeight + input.margin, input.popoverHeight + input.edge * 2);
  const minX = visibleLeft + input.edge;
  const maxX = Math.max(minX, visibleLeft + visibleWidth - input.popoverWidth - input.edge);
  const minY = visibleTop + input.edge;
  const maxY = Math.max(minY, visibleTop + visibleHeight - input.popoverHeight - input.edge);
  const rightX = Math.round(input.targetRight + input.margin);
  const leftX = Math.round(input.targetLeft - input.margin - input.popoverWidth);
  const centeredX = Math.round(input.targetLeft + (input.targetRight - input.targetLeft) / 2 - input.popoverWidth / 2);
  const sideY = Math.round(input.targetTop + input.margin);
  const belowY = Math.round(input.targetBottom + input.margin);
  const aboveY = Math.round(input.targetTop - input.margin - input.popoverHeight);
  const preferredX = rightX + input.popoverWidth <= maxX + input.edge
    ? rightX
    : leftX >= minX - input.edge
      ? leftX
      : centeredX;
  const preferredY = sideY <= maxY
    ? sideY
    : belowY <= maxY
      ? belowY
      : aboveY >= minY
        ? aboveY
        : sideY;

  return {
    x: Math.round(clampNumber(preferredX, minX, maxX)),
    y: Math.round(clampNumber(preferredY, minY, maxY)),
  };
}

function readCanvasInteractionViewportBounds(viewport: HTMLDivElement): CanvasInteractionViewportBounds | null {
  const rect = viewport.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    scrollLeft: Math.max(0, Math.round(viewport.scrollLeft)),
    scrollTop: Math.max(0, Math.round(viewport.scrollTop)),
  };
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function DesignFileSectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 py-0 text-[10px] font-semibold tracking-[0.14em] text-[var(--text-secondary)]">
      {label}
    </div>
  );
}

function DesignFileListSection({
  label,
  files,
  separated = false,
  selectedFile,
  onSelectFile,
  onOpenFile,
}: {
  label: string;
  files: WorkspaceFile[];
  separated?: boolean;
  selectedFile: WorkspaceFile | null;
  onSelectFile: (file: WorkspaceFile) => void;
  onOpenFile: (file: WorkspaceFile) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className={separated ? 'border-t border-[var(--border-1)] pt-3' : undefined}>
      <DesignFileSectionLabel label={label} />
      <div>
        {files.length > 0 ? (
          files.map((file) => (
            <DesignFileRow
              key={file.path}
              file={file}
              selected={selectedFile?.path === file.path}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
            />
          ))
        ) : (
          <div className="px-3 text-[11px] leading-[32px] text-[var(--text-secondary)]">{t('workspace.empty.noFiles')}</div>
        )}
      </div>
    </section>
  );
}

function DesignFileRow({
  file,
  selected,
  onSelectFile,
  onOpenFile,
}: {
  file: WorkspaceFile;
  selected: boolean;
  onSelectFile: (file: WorkspaceFile) => void;
  onOpenFile: (file: WorkspaceFile) => void;
}) {
  const { t } = useTranslation();

  return (
    <Button
      type="button"
      aria-label={file.name}
      variant="ghost"
      className={`!mx-0 grid h-auto min-h-11 w-full grid-cols-[28px_1fr] justify-start gap-2 !rounded-none border-b border-transparent px-3 py-1.5 text-left ${
        selected
          ? 'bg-[var(--project-input-bg)] text-[var(--text-primary)] hover:bg-[var(--project-input-hover-bg)]'
          : 'text-[var(--text-primary)] hover:bg-[var(--project-input-hover-bg)]'
      }`}
      onClick={() => onSelectFile(file)}
      onDoubleClick={() => onOpenFile(file)}
    >
      <span
        className={`flex size-6 items-center justify-center rounded-sm border ${
          selected
            ? 'border-[var(--border-2)] bg-[var(--background-fronted)]'
            : 'border-[var(--border-1)] bg-[var(--background-panel)]'
        }`}
      >
        {iconForWorkspaceFile(file, 14)}
      </span>
      <span className="min-w-0 self-center">
        <span className="block truncate text-[12px] font-medium leading-4 text-[var(--text-primary)]">
          {file.name}
        </span>
        <span className="block truncate text-[11px] leading-4 text-[var(--text-secondary)]">
          {workspaceFileKindLabel(file, t)}
        </span>
      </span>
    </Button>
  );
}

function DesignFileDetail({
  files,
  selectedFile,
  onOpenFile,
}: {
  files: WorkspaceFile[];
  selectedFile: WorkspaceFile | null;
  onOpenFile: (file: WorkspaceFile) => void;
}) {
  const { t } = useTranslation();

  if (!selectedFile) {
    return (
      <aside className="flex min-h-0 flex-col items-center justify-center bg-[var(--background-fronted)] p-8 text-center">
        <span className="mb-4 flex size-10 items-center justify-center rounded-md border border-[var(--border-1)] bg-[var(--background-fronted)] text-[var(--text-secondary)]">
          <EyeIcon size={18} />
        </span>
        <div className="text-[14px] font-semibold text-[var(--text-primary)]">{t('workspace.empty.selectFile')}</div>
        <div className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
          {t('workspace.empty.selectFileDescription')}
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-testid="design-file-detail"
      className="grid min-h-0 grid-rows-[minmax(0,auto)_auto] gap-6 bg-[var(--background-fronted)] p-6"
    >
      <div className="flex min-h-0 items-center justify-center">
        <div
          data-testid="design-file-preview-frame"
          className="mx-auto aspect-[8/5] w-full max-w-[820px] overflow-hidden rounded-[var(--project-radius-lg)] border border-[var(--border-1)] bg-[var(--background-fronted)] shadow-none"
        >
          <DesignFilePreview file={selectedFile} files={files} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[640px] shrink-0 text-center">
        <div className="flex justify-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-2"
            aria-label={t('workspace.actions.openFile', { name: selectedFile.name })}
            onClick={() => onOpenFile(selectedFile)}
          >
            <EyeIcon size={14} />
            {t('chat.previewComments.open')}
          </Button>
          {selectedFile.url ? (
            <Button asChild size="sm" variant="secondary" className="gap-2">
              <a
                href={selectedFile.url}
                download={selectedFile.name}
                aria-label={t('artifacts.downloadAria', { title: selectedFile.name })}
                onClick={(event) => {
                  event.preventDefault();
                  void downloadFileFromUrl(selectedFile.url!, selectedFile.name)
                    .then((saved) => {
                      if (saved) {
                        toast.success(t('artifacts.downloadStarted', { title: selectedFile.name }));
                      }
                    })
                    .catch(() => toast.error(t('artifacts.downloadFailed', { title: selectedFile.name })));
                }}
              >
                <DownloadIcon size={14} />
                {t('artifacts.download')}
              </a>
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex max-w-full flex-col gap-1">
          <div className="truncate text-lg font-semibold text-[var(--text-primary)]">{selectedFile.name}</div>
          <div className="text-[12px] text-[var(--text-secondary)]">{workspaceFileKindLabel(selectedFile, t)}</div>
          <div className="text-[12px] text-[var(--text-secondary)]">
            {workspaceFileSizeLabel(selectedFile)} · {selectedFile.mime}
          </div>
          <div className="truncate text-[12px] text-[var(--text-secondary)]">{selectedFile.path}</div>
        </div>
      </div>
    </aside>
  );
}

function DesignFilePreview({ file, files }: { file: WorkspaceFile; files: WorkspaceFile[] }) {
  if (file.kind === 'html') {
    return <HtmlDesignFilePreview file={file} files={files} />;
  }

  if (file.kind === 'image' && file.url) {
    return (
      <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-[var(--background-fronted)]">
        <img src={file.url} alt={file.name} className="absolute inset-0 h-full w-full object-contain" />
      </div>
    );
  }

  if (file.kind === 'text') {
    return <CodeDesignFilePreview file={file} />;
  }

  return <UnsupportedDesignFilePreview file={file} />;
}

function UnsupportedDesignFilePreview({ file }: { file: WorkspaceFile }) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="design-file-unsupported-preview"
      className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 bg-[var(--background-fronted)] p-8 text-center"
      aria-label={t('workspace.unsupportedPreviewFor', { name: file.name })}
    >
      <span className="flex size-10 items-center justify-center rounded-md border border-[var(--border-1)] bg-[var(--background-fronted)] text-[var(--text-secondary)]">
        <FileIcon size={18} />
      </span>
      <div className="text-[14px] font-semibold text-[var(--text-primary)]">{t('workspace.unsupportedPreview')}</div>
    </div>
  );
}

function CodeDesignFilePreview({ file }: { file: WorkspaceFile }) {
  const { t } = useTranslation();
  const editorHostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const editorHost = editorHostRef.current;
    if (!editorHost) return;

    const editorView = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: file.contents ?? '',
        extensions: [
          basicSetup,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          codeMirrorPreviewTheme,
          ...codeMirrorLanguageExtensions(file),
        ],
      }),
    });

    return () => {
      editorView.destroy();
    };
  }, [file]);

  return (
    <div className="grid h-full min-h-[420px] grid-rows-[auto_minmax(0,1fr)] bg-[var(--background-fronted)] text-left">
      <div className="flex h-9 items-center justify-between border-b border-[var(--border-1)] px-3 text-xs text-[var(--text-secondary)]">
        <span className="truncate font-medium text-[var(--text-primary)]">{codePreviewLanguageLabel(file, t)}</span>
        <span className="truncate">{file.mime}</span>
      </div>
      <div
        ref={editorHostRef}
        data-testid="design-file-code-preview"
        aria-label={t('workspace.codePreviewFor', { name: file.name })}
        className="min-h-0 overflow-hidden"
      />
    </div>
  );
}

const codeMirrorPreviewTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--background-fronted)',
    color: 'var(--text-primary)',
    fontSize: '12px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
  '.cm-content': {
    padding: '14px 0',
    minHeight: '100%',
  },
  '.cm-line': {
    padding: '0 14px 0 8px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--background-panel)',
    color: 'var(--text-secondary)',
    borderRightColor: 'var(--border-1)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--transparency-hover)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
});

function codeMirrorLanguageExtensions(file: WorkspaceFile): Extension[] {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (file.mime === 'text/html' || extension === 'html' || extension === 'htm') {
    return [html()];
  }

  if (
    file.mime.includes('javascript') ||
    extension === 'js' ||
    extension === 'jsx' ||
    extension === 'mjs' ||
    extension === 'cjs'
  ) {
    return [javascript({ jsx: extension === 'jsx' })];
  }

  if (
    file.mime.includes('typescript') ||
    extension === 'ts' ||
    extension === 'tsx'
  ) {
    return [javascript({ jsx: extension === 'tsx', typescript: true })];
  }

  if (file.mime === 'text/css' || extension === 'css') {
    return [css()];
  }

  if (file.mime === 'application/json' || extension === 'json') {
    return [json()];
  }

  if (file.mime === 'text/markdown' || extension === 'md' || extension === 'markdown') {
    return [markdown()];
  }

  return [];
}

function codePreviewLanguageLabel(file: WorkspaceFile, t: ReturnType<typeof useTranslation>['t']): string {
  const extension = file.name.split('.').pop()?.toUpperCase();
  return extension ? t('workspace.sourceWithExtension', { extension }) : t('workspace.source');
}

const HTML_DESIGN_PREVIEW_WIDTH = 1280;
const HTML_DESIGN_PREVIEW_HEIGHT = 800;

export interface HtmlDesignPreviewMetrics {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

export interface HtmlDesignPreviewSize {
  width: number;
  height: number;
}

interface CanvasInteractionViewportBounds {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

export function resolveHtmlDesignPreviewSize(metrics: HtmlDesignPreviewMetrics): HtmlDesignPreviewSize {
  return {
    width: Math.max(HTML_DESIGN_PREVIEW_WIDTH, metrics.viewportWidth),
    height: Math.max(HTML_DESIGN_PREVIEW_HEIGHT, metrics.viewportHeight),
  };
}

function HtmlDesignFilePreview({ file, files }: { file: WorkspaceFile; files: WorkspaceFile[] }) {
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const measurementCleanupRef = React.useRef<(() => void) | null>(null);
  const [previewSize, setPreviewSize] = React.useState<HtmlDesignPreviewSize>({
    width: HTML_DESIGN_PREVIEW_WIDTH,
    height: HTML_DESIGN_PREVIEW_HEIGHT,
  });
  const [scale, setScale] = React.useState(1);
  const srcDoc = React.useMemo(
    () =>
      buildDesignRuntimeSrcdoc({
        entryFile: file,
        files,
        editBridge: false,
        sizeBridge: true,
        scrollbarBridge: true,
      }),
    [file, files],
  );

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previewContainer = container;

    function updateScale() {
      const rect = previewContainer.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nextScale = Math.min(
        rect.width / previewSize.width,
        rect.height / previewSize.height,
      );
      setScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
    }

    updateScale();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScale);
    resizeObserver?.observe(previewContainer);
    window.addEventListener('resize', updateScale);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [previewSize.height, previewSize.width]);

  React.useEffect(() => {
    setPreviewSize({
      width: HTML_DESIGN_PREVIEW_WIDTH,
      height: HTML_DESIGN_PREVIEW_HEIGHT,
    });
    return () => {
      measurementCleanupRef.current?.();
      measurementCleanupRef.current = null;
    };
  }, [file.path, file.contents]);

  function measureLoadedPreview() {
    measurementCleanupRef.current?.();
    measurementCleanupRef.current = null;

    const document = iframeRef.current?.contentDocument;
    if (!document) return;

    const applyMeasuredSize = () => {
      const nextSize = measureHtmlDesignPreviewDocument(document);
      setPreviewSize((currentSize) =>
        currentSize.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize,
      );
    };

    applyMeasuredSize();

    const mutationObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(applyMeasuredSize);
    mutationObserver?.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    const timers = [
      window.setTimeout(applyMeasuredSize, 100),
      window.setTimeout(applyMeasuredSize, 500),
    ];

    measurementCleanupRef.current = () => {
      mutationObserver?.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }

  return (
    <div
      ref={containerRef}
      data-testid="design-file-preview-fit"
      className="relative h-full min-h-0 w-full overflow-hidden bg-[var(--background-fronted)]"
    >
      <iframe
        ref={iframeRef}
        data-testid="design-file-preview-srcdoc"
        title={t('workspace.designFilePreviewTitle', { name: file.name })}
        className="absolute left-0 top-0 border-0 bg-white shadow-soft"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={srcDoc}
        onLoad={measureLoadedPreview}
        style={{
          width: previewSize.width,
          height: previewSize.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

function measureHtmlDesignPreviewDocument(document: Document): HtmlDesignPreviewSize {
  const body = document.body;
  const root = document.documentElement;
  return resolveHtmlDesignPreviewSize({
    viewportWidth: document.defaultView?.innerWidth ?? HTML_DESIGN_PREVIEW_WIDTH,
    viewportHeight: document.defaultView?.innerHeight ?? HTML_DESIGN_PREVIEW_HEIGHT,
    scrollWidth: Math.max(
      root.scrollWidth,
      root.offsetWidth,
      body?.scrollWidth ?? 0,
      body?.offsetWidth ?? 0,
    ),
    scrollHeight: Math.max(
      root.scrollHeight,
      root.offsetHeight,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
    ),
  });
}

function groupDesignFiles(files: WorkspaceFile[]): {
  folders: WorkspaceFile[];
  pages: WorkspaceFile[];
  components: WorkspaceFile[];
} {
  return {
    folders: [],
    pages: files.filter((file) => file.kind === 'html'),
    components: files.filter((file) => file.kind !== 'html'),
  };
}

function readWorkspaceFileContentsByPath(files: WorkspaceFile[]): Record<string, string> {
  const contentsByPath: Record<string, string> = {};
  for (const file of files) {
    if (typeof file.contents === 'string') {
      contentsByPath[file.path] = file.contents;
    }
  }
  return contentsByPath;
}

function reconcileFileContentOverrides(
  overrides: Record<string, string>,
  previousBaseContents: Record<string, string>,
  incomingBaseContents: Record<string, string>,
): Record<string, string> {
  let changed = false;
  const nextOverrides = { ...overrides };

  for (const [path, overrideContent] of Object.entries(overrides)) {
    if (!(path in incomingBaseContents)) {
      delete nextOverrides[path];
      changed = true;
      continue;
    }

    const incomingContent = incomingBaseContents[path];
    const previousContent = previousBaseContents[path];
    if (incomingContent === overrideContent || (previousContent !== undefined && incomingContent !== previousContent)) {
      delete nextOverrides[path];
      changed = true;
    }
  }

  return changed ? nextOverrides : overrides;
}

function iconForWorkspaceFile(file: WorkspaceFile, size: number) {
  if (file.kind === 'html') return <FileCodeIcon size={size} />;
  if (file.kind === 'image') return <ImageFileIcon size={size} />;
  if (file.kind === 'text') return <FileTextIcon size={size} />;
  return <FileIcon size={size} />;
}

function workspaceFileKindLabel(file: WorkspaceFile, t: TranslateFn): string {
  if (file.kind === 'html') return t('workspace.fileKinds.html');
  if (file.kind === 'image') return t('workspace.fileKinds.image');
  if (file.kind === 'text') return t('workspace.fileKinds.text');
  return t('workspace.fileKinds.resource');
}

function workspaceFileSizeLabel(file: WorkspaceFile): string {
  const contentBytes = typeof file.size === 'number'
    ? file.size
    : new TextEncoder().encode(file.contents ?? '').length;
  if (contentBytes === 0) return '0 B';
  if (contentBytes < 1024) return `${contentBytes} B`;
  if (contentBytes < 1024 * 1024) return `${(contentBytes / 1024).toFixed(1)} KB`;
  return `${(contentBytes / 1024 / 1024).toFixed(1)} MB`;
}

function findWorkspaceFileByPath(files: WorkspaceFile[], path: string): WorkspaceFile | null {
  const normalizedPath = normalizeWorkspaceFilePath(path);
  return files.find((file) => normalizeWorkspaceFilePath(file.path) === normalizedPath) ?? null;
}

function normalizeWorkspaceFilePath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+/g, '/');
}
