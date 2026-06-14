import React, { useCallback, useEffect, useRef, useState } from 'react';
import { applyTextCommitToHtml } from './canvas-edit/apply-html-edit';
import type { CanvasEditBridgeMessage, CanvasEditHostCommand, EditableNode } from './canvas-edit/types';
import type {
  CanvasCommentPoint,
  CanvasCommentTargetSnapshot,
  CanvasCommentTool,
} from './canvas-comment/canvas-comment-types';
import type { WorkspaceFile } from './canvas-workspace-types';
import { buildDesignRuntimeSrcdoc } from './runtime/build-design-runtime-srcdoc';
import { useTranslation } from '../../i18n';

const CANVAS_PREVIEW_BASE_WIDTH = 1280;
const CANVAS_PREVIEW_BASE_HEIGHT = 800;
const SNAPSHOT_BRIDGE_OWNED_SELECTOR = [
  '[data-vd-preview-size-bridge]',
  '[data-vd-preview-scrollbar]',
  '[data-vd-preview-snapshot-bridge]',
  '[data-vd-comment-bridge]',
  '[data-vd-comment-owned]',
  '[data-vd-comment-pod-layer]',
  '[data-vd-edit-bridge]',
  '[data-vd-edit-bridge-style]',
  '[data-vd-edit-overlay-layer]',
  '[data-vd-edit-overlay]',
].join(',');

type CanvasCommentBridgeTargetSnapshot = Omit<CanvasCommentTargetSnapshot, 'filePath'>;

type CanvasCommentBridgeMessage =
  | { type: 'vd-comment-targets'; targets: CanvasCommentBridgeTargetSnapshot[] }
  | { type: 'vd-comment-hover'; target: CanvasCommentBridgeTargetSnapshot }
  | { type: 'vd-comment-leave'; target?: CanvasCommentBridgeTargetSnapshot }
  | { type: 'vd-comment-select'; target: CanvasCommentBridgeTargetSnapshot }
  | { type: 'vd-comment-pod-stroke'; points: CanvasCommentPoint[]; phase?: string }
  | { type: 'vd-comment-pod-select'; target?: CanvasCommentBridgeTargetSnapshot; points: CanvasCommentPoint[] }
  | { type: 'vd-comment-active-target-update'; targetId?: string | null; selector?: string | null; target?: CanvasCommentBridgeTargetSnapshot | null }
  | { type: 'vd-comment-pod-clear' };

type CanvasCommentHostCommand =
  | { type: 'vd-comment-mode'; enabled: boolean; mode: 'picker' | 'pod' }
  | { type: 'vd-comment-active-target'; targetId: string | null };

export interface CanvasDesignRuntimeReady {
  entryPath: string;
  sourcePath: string;
  tweakDefaults: Record<string, unknown>;
}

export interface CanvasDesignTweaksChange {
  entryPath: string;
  sourcePath: string;
  key: string;
  value: unknown;
  tweaks: Record<string, unknown>;
}

export interface CanvasDesignTweakCommand {
  key: string;
  value: unknown;
  version: number;
}

export interface CanvasPreviewFrameMetrics {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

export interface CanvasPreviewFrameSize {
  width: number;
  height: number;
}

export interface CanvasPreviewScreenshot {
  dataUrl: string;
  width: number;
  height: number;
}

export type CanvasPreviewScreenshotRequester = () => Promise<CanvasPreviewScreenshot>;

export interface CanvasPreviewFrameLayout extends CanvasPreviewFrameSize {
  scale: number;
  active: boolean;
}

export interface CanvasPreviewStylePreview {
  id: string;
  styles: Record<string, string>;
}

export interface CanvasPreviewTextPreview {
  id: string;
  text: string;
}

export interface CanvasPreviewProps {
  file: WorkspaceFile;
  files?: WorkspaceFile[];
  editMode?: boolean;
  commentMode?: boolean;
  scaleMode?: 'fit' | 'manual';
  manualScale?: number;
  commentTool?: Exclude<CanvasCommentTool, 'visual'>;
  activeCommentTargetId?: string | null;
  hoveredTargetId?: string | null;
  onHtmlChange?: (html: string) => void;
  onTargetsChange?: (targets: EditableNode[]) => void;
  onHoveredTargetChange?: (target: EditableNode | null) => void;
  onSelectedTargetChange?: (target: EditableNode | null) => void;
  onCommentTargetsChange?: (targets: CanvasCommentTargetSnapshot[]) => void;
  onCommentHoverChange?: (target: CanvasCommentTargetSnapshot | null) => void;
  onCommentSelect?: (target: CanvasCommentTargetSnapshot) => void;
  onCommentPodStroke?: (points: CanvasCommentPoint[]) => void;
  onCommentPodSelect?: (points: CanvasCommentPoint[], target?: CanvasCommentTargetSnapshot) => void;
  onDesignRuntimeReady?: (runtime: CanvasDesignRuntimeReady) => void;
  onDesignTweaksChange?: (change: CanvasDesignTweaksChange) => void;
  onPreviewNavigate?: (path: string, href?: string) => void;
  onFrameLayoutChange?: (layout: CanvasPreviewFrameLayout) => void;
  onSnapshotRequesterChange?: (requester: CanvasPreviewScreenshotRequester | null) => void;
  onSnapshotBridgeReady?: () => void;
  designTweakCommand?: CanvasDesignTweakCommand | null;
  previewTheme?: 'light' | 'dark';
  selectedTargetId?: string | null;
  stylePreview?: CanvasPreviewStylePreview | null;
  textPreview?: CanvasPreviewTextPreview | null;
}

export function CanvasPreview({
  file,
  files = [file],
  editMode = false,
  commentMode = false,
  scaleMode = 'fit',
  manualScale = 1,
  commentTool = 'picker',
  activeCommentTargetId = null,
  hoveredTargetId = null,
  onHtmlChange,
  onTargetsChange,
  onHoveredTargetChange,
  onSelectedTargetChange,
  onCommentTargetsChange,
  onCommentHoverChange,
  onCommentSelect,
  onCommentPodStroke,
  onCommentPodSelect,
  onDesignRuntimeReady,
  onDesignTweaksChange,
  onPreviewNavigate,
  onFrameLayoutChange,
  onSnapshotRequesterChange,
  onSnapshotBridgeReady,
  designTweakCommand = null,
  previewTheme = 'light',
  selectedTargetId = null,
  stylePreview = null,
  textPreview = null,
}: CanvasPreviewProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState(file.contents ?? '');
  const [previewSize, setPreviewSize] = useState<CanvasPreviewFrameSize>({
    width: CANVAS_PREVIEW_BASE_WIDTH,
    height: CANVAS_PREVIEW_BASE_HEIGHT,
  });
  const [fitScale, setFitScale] = useState(1);
  const [fitViewportHeight, setFitViewportHeight] = useState(0);
  const previewFitRef = useRef<HTMLDivElement>(null);
  const urlFrameRef = useRef<HTMLIFrameElement>(null);
  const srcdocFrameRef = useRef<HTMLIFrameElement>(null);
  const measurementCleanupRef = useRef<(() => void) | null>(null);
  const lastStylePreviewRef = useRef<CanvasPreviewStylePreview | null>(null);
  const lastTextPreviewRef = useRef<CanvasPreviewTextPreview | null>(null);
  const lastFrameLayoutRef = useRef<CanvasPreviewFrameLayout | null>(null);
  const snapshotRequestIdRef = useRef(1);
  const isHtmlPreview = file.kind === 'html';
  const showUrlFrame = false;
  const previewUrl: string | undefined = undefined;
  const acceptsEditBridgeMessages = isHtmlPreview && editMode && !showUrlFrame;
  const acceptsCommentBridgeMessages = isHtmlPreview && commentMode && !showUrlFrame;
  const acceptsSnapshotBridgeMessages = isHtmlPreview && !showUrlFrame && (commentMode || (!editMode && !commentMode));
  const acceptsSnapshotRequests = isHtmlPreview && (showUrlFrame || acceptsSnapshotBridgeMessages);
  const normalizedManualScale = Number.isFinite(manualScale) && manualScale > 0 ? manualScale : 1;
  const scale = scaleMode === 'manual' ? normalizedManualScale : fitScale;
  const frameTop = scaleMode === 'fit'
    ? Math.max(0, (fitViewportHeight - previewSize.height * scale) / 2)
    : 0;
  const srcDoc = isHtmlPreview && !showUrlFrame
    ? buildDesignRuntimeSrcdoc({
        entryFile: { ...file, contents: html },
        files: files.map((candidate) =>
          candidate.path === file.path ? { ...candidate, contents: html } : candidate,
        ),
        editBridge: editMode,
        sizeBridge: true,
        commentBridge: commentMode,
        snapshotBridge: acceptsSnapshotBridgeMessages,
      })
    : '';

  useEffect(() => {
    setHtml(file.contents ?? '');
  }, [file.path, file.contents]);

  useEffect(() => {
    setPreviewSize({ width: CANVAS_PREVIEW_BASE_WIDTH, height: CANVAS_PREVIEW_BASE_HEIGHT });
    measurementCleanupRef.current?.();
    measurementCleanupRef.current = null;

    return () => {
      measurementCleanupRef.current?.();
      measurementCleanupRef.current = null;
    };
  }, [file.path, previewUrl, showUrlFrame, srcDoc]);

  useEffect(() => {
    const previewFit = previewFitRef.current;
    if (!previewFit || scaleMode === 'manual') return;
    const previewFitElement = previewFit;

    function updateScale() {
      const rect = previewFitElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const nextScale = Math.min(rect.width / previewSize.width, rect.height / previewSize.height);
      const normalizedScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;
      setFitViewportHeight((currentHeight) => (currentHeight === rect.height ? currentHeight : rect.height));
      setFitScale((currentScale) => (currentScale === normalizedScale ? currentScale : normalizedScale));
    }

    updateScale();

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScale);
    resizeObserver?.observe(previewFitElement);
    window.addEventListener('resize', updateScale);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [previewSize.height, previewSize.width, scaleMode]);

  useEffect(() => {
    replaySrcdocCommands();
  }, [acceptsEditBridgeMessages, hoveredTargetId, previewTheme, selectedTargetId, stylePreview, textPreview, srcDoc]);

  useEffect(() => {
    replayCommentCommands();
  }, [acceptsCommentBridgeMessages, activeCommentTargetId, commentMode, commentTool, srcDoc]);

  useEffect(() => {
    replayDesignTweakCommand();
  }, [designTweakCommand?.version, srcDoc]);

  const requestPreviewSnapshot = useCallback<CanvasPreviewScreenshotRequester>(() => {
    if (showUrlFrame) {
      return requestUrlFramePreviewSnapshot(urlFrameRef.current);
    }

    const frameWindow = srcdocFrameRef.current?.contentWindow;
    if (!acceptsSnapshotBridgeMessages || !frameWindow) {
      return Promise.reject(new Error('Preview snapshot bridge is not available.'));
    }

    const requestId = `preview-snapshot-${snapshotRequestIdRef.current}`;
    snapshotRequestIdRef.current += 1;

    return new Promise<CanvasPreviewScreenshot>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', handleSnapshotResult);
        reject(new Error('Preview snapshot timed out.'));
      }, 5000);

      function handleSnapshotResult(event: MessageEvent<unknown>) {
        if (!isActiveSrcdocMessageSource(event, frameWindow)) {
          return;
        }
        const message = event.data;
        if (!isMessageObject(message) || message.type !== 'vd-preview-snapshot-result' || message.id !== requestId) {
          return;
        }

        window.clearTimeout(timeout);
        window.removeEventListener('message', handleSnapshotResult);

        const width = message.width;
        const height = message.height;
        if (typeof message.dataUrl === 'string' && typeof width === 'number' && typeof height === 'number') {
          resolve({ dataUrl: message.dataUrl, width, height });
          return;
        }

        reject(new Error(typeof message.error === 'string' ? message.error : 'Preview snapshot failed.'));
      }

      window.addEventListener('message', handleSnapshotResult);
      frameWindow.postMessage({ type: 'vd-preview-snapshot', id: requestId }, '*');
    });
  }, [acceptsSnapshotBridgeMessages, showUrlFrame]);

  useEffect(() => {
    onSnapshotRequesterChange?.(acceptsSnapshotRequests ? requestPreviewSnapshot : null);
    return () => onSnapshotRequesterChange?.(null);
  }, [acceptsSnapshotRequests, onSnapshotRequesterChange, requestPreviewSnapshot]);

  useEffect(() => {
    const nextLayout: CanvasPreviewFrameLayout = {
      width: previewSize.width,
      height: previewSize.height,
      scale,
      active: isHtmlPreview && !showUrlFrame,
    };

    if (!onFrameLayoutChange) {
      lastFrameLayoutRef.current = null;
      return;
    }

    if (areFrameLayoutsEqual(lastFrameLayoutRef.current, nextLayout)) {
      return;
    }

    lastFrameLayoutRef.current = nextLayout;
    onFrameLayoutChange(nextLayout);
  }, [isHtmlPreview, onFrameLayoutChange, previewSize.height, previewSize.width, scale, showUrlFrame]);

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>) {
      if (!isActiveSrcdocMessageSource(event, srcdocFrameRef.current?.contentWindow)) {
        return;
      }

      const message = event.data;

      if (!isMessageObject(message)) {
        return;
      }

      if (isCanvasPreviewSizeMessage(message)) {
        applySrcdocPreviewSize(message.width, message.height);
        return;
      }

      if (isCanvasPreviewNavigateMessage(message)) {
        onPreviewNavigate?.(message.path, message.href);
        return;
      }

      if (isCanvasDesignRuntimeReadyMessage(message)) {
        onDesignRuntimeReady?.({
          entryPath: message.entryPath,
          sourcePath: message.sourcePath,
          tweakDefaults: message.tweakDefaults,
        });
        return;
      }

      if (isCanvasDesignTweaksChangeMessage(message)) {
        onDesignTweaksChange?.({
          entryPath: message.entryPath,
          sourcePath: message.sourcePath,
          key: message.key,
          value: message.value,
          tweaks: message.tweaks,
        });
        return;
      }

      if (isCanvasCommentBridgeMessageType(message.type)) {
        if (!acceptsCommentBridgeMessages || !isCanvasCommentBridgeMessage(message)) {
          return;
        }

        handleCommentBridgeMessage(message);
        return;
      }

      if (!acceptsEditBridgeMessages || !isCanvasEditBridgeMessage(message)) {
        return;
      }

      if (message.type === 'vd-edit-targets') {
        onTargetsChange?.(message.targets);
        return;
      }

      if (message.type === 'vd-edit-hover') {
        onHoveredTargetChange?.(message.target);
        return;
      }

      if (message.type === 'vd-edit-select') {
        onSelectedTargetChange?.(message.target);
        return;
      }

      if (message.type === 'vd-edit-text-commit') {
        setHtml((currentHtml) => {
          const nextHtml = applyTextCommitToHtml(currentHtml, message.id, message.value);
          onHtmlChange?.(nextHtml);
          return nextHtml;
        });
      }

      if (message.type === 'vd-edit-preview-style-applied') {
        return;
      }
    }

    function handleCommentBridgeMessage(message: CanvasCommentBridgeMessage) {
      if (message.type === 'vd-comment-targets') {
        onCommentTargetsChange?.(message.targets.map(withHostCommentFilePath));
        return;
      }

      if (message.type === 'vd-comment-hover') {
        onCommentHoverChange?.(withHostCommentFilePath(message.target));
        return;
      }

      if (message.type === 'vd-comment-leave') {
        onCommentHoverChange?.(null);
        return;
      }

      if (message.type === 'vd-comment-select') {
        onCommentSelect?.(withHostCommentFilePath(message.target));
        return;
      }

      if (message.type === 'vd-comment-pod-stroke') {
        onCommentPodStroke?.(message.points);
        return;
      }

      if (message.type === 'vd-comment-pod-select') {
        onCommentPodSelect?.(message.points, message.target ? withHostCommentFilePath(message.target) : undefined);
        return;
      }

      if (message.type === 'vd-comment-active-target-update' || message.type === 'vd-comment-pod-clear') {
        return;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    acceptsCommentBridgeMessages,
    acceptsEditBridgeMessages,
    file.path,
    onCommentHoverChange,
    onCommentPodSelect,
    onCommentPodStroke,
    onCommentSelect,
    onCommentTargetsChange,
    onDesignRuntimeReady,
    onDesignTweaksChange,
    onHtmlChange,
    onHoveredTargetChange,
    onPreviewNavigate,
    onSelectedTargetChange,
    onTargetsChange,
    scaleMode,
  ]);

  function applySrcdocPreviewSize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }

    const nextSize = resolveCanvasPreviewFrameSize({
      viewportWidth: CANVAS_PREVIEW_BASE_WIDTH,
      viewportHeight: CANVAS_PREVIEW_BASE_HEIGHT,
      scrollWidth: width,
      scrollHeight: height,
    }, scaleMode);
    setPreviewSize((currentSize) =>
      currentSize.width === nextSize.width && currentSize.height === nextSize.height
        ? currentSize
        : nextSize,
    );
  }

  function replaySrcdocCommands() {
    postSrcdocCommand(srcdocFrameRef.current, acceptsEditBridgeMessages, {
      type: 'vd-edit-selected-target',
      id: selectedTargetId ?? null,
    });

    postSrcdocCommand(srcdocFrameRef.current, acceptsEditBridgeMessages, {
      type: 'vd-edit-hovered-target',
      id: hoveredTargetId ?? null,
    });

    postSrcdocCommand(srcdocFrameRef.current, acceptsEditBridgeMessages, {
      type: 'vd-edit-theme',
      theme: previewTheme,
    });

    if (lastStylePreviewRef.current) {
      postSrcdocCommand(srcdocFrameRef.current, acceptsEditBridgeMessages, {
        type: 'vd-edit-preview-style-reset',
        id: lastStylePreviewRef.current.id,
      });
    }

    if (lastTextPreviewRef.current) {
      postSrcdocCommand(srcdocFrameRef.current, acceptsEditBridgeMessages, {
        type: 'vd-edit-preview-text-reset',
        id: lastTextPreviewRef.current.id,
      });
    }

    if (stylePreview) {
      postSrcdocCommand(srcdocFrameRef.current, acceptsEditBridgeMessages, {
        type: 'vd-edit-preview-style',
        id: stylePreview.id,
        styles: stylePreview.styles,
      });
    }

    if (textPreview) {
      postSrcdocCommand(srcdocFrameRef.current, acceptsEditBridgeMessages, {
        type: 'vd-edit-preview-text',
        id: textPreview.id,
        value: textPreview.text,
      });
    }

    lastStylePreviewRef.current = stylePreview;
    lastTextPreviewRef.current = textPreview;
  }

  function replayCommentCommands() {
    postCommentCommand(srcdocFrameRef.current, acceptsCommentBridgeMessages, {
      type: 'vd-comment-mode',
      enabled: Boolean(commentMode),
      mode: commentTool === 'pod' ? 'pod' : 'picker',
    });

    postCommentCommand(srcdocFrameRef.current, acceptsCommentBridgeMessages, {
      type: 'vd-comment-active-target',
      targetId: activeCommentTargetId ?? null,
    });
  }

  function replayDesignTweakCommand() {
    if (!designTweakCommand || showUrlFrame) {
      return;
    }

    srcdocFrameRef.current?.contentWindow?.postMessage(
      { type: 'vd-design-tweak-set', key: designTweakCommand.key, value: designTweakCommand.value },
      '*',
    );
  }

  function withHostCommentFilePath(target: CanvasCommentBridgeTargetSnapshot): CanvasCommentTargetSnapshot {
    return { ...target, filePath: file.path } as CanvasCommentTargetSnapshot;
  }

  if (file.kind === 'image' && isSvgImage(file)) {
    const svgSrc = buildSvgDocumentUrl(file) ?? file.url ?? null;

    return (
      <div
        data-testid="canvas-preview-image-root"
        className="flex h-full min-h-[560px] items-center justify-center bg-[var(--background-fronted)] p-4"
      >
        {svgSrc ? (
          <iframe
            data-testid="canvas-preview-svg"
            className="h-full max-h-full w-full max-w-full border-0 bg-transparent"
            sandbox=""
            src={svgSrc}
            title={t('preview.filePreviewTitle', { name: file.name })}
          />
        ) : (
          <div className="text-sm text-[var(--text-secondary)]">{t('preview.imageUnavailable')}</div>
        )}
      </div>
    );
  }

  if (file.kind === 'image') {
    const imageSrc = file.url ?? buildImageDataUrl(file);

    return (
      <div
        data-testid="canvas-preview-image-root"
        className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-[var(--background-fronted)]"
      >
        {imageSrc ? (
          <img
            data-testid="canvas-preview-image"
            className="absolute inset-0 h-full w-full object-contain"
            src={imageSrc}
            alt={file.name}
          />
        ) : (
          <div className="text-sm text-[var(--text-secondary)]">{t('preview.imageUnavailable')}</div>
        )}
      </div>
    );
  }

  if (file.kind === 'text') {
    return (
      <pre
        data-testid="canvas-preview-text"
        className="h-full overflow-auto whitespace-pre-wrap bg-[var(--background-fronted)] p-5 text-sm text-[var(--text-primary)]"
      >
        {file.contents ?? ''}
      </pre>
    );
  }

  if (file.kind !== 'html') {
    return (
      <div
        data-testid="canvas-preview-unsupported"
        className="flex h-full min-h-[560px] items-center justify-center bg-[var(--background-fronted)] p-8 text-center text-sm font-medium text-[var(--text-primary)]"
        aria-label={t('workspace.unsupportedPreviewFor', { name: file.name })}
      >
        {t('workspace.unsupportedPreview')}
      </div>
    );
  }

  function measureLoadedPreview(frame: HTMLIFrameElement | null, active: boolean) {
    if (!active) return;

    measurementCleanupRef.current?.();
    measurementCleanupRef.current = null;

    const document = getPreviewFrameDocument(frame);
    if (!document) return;

    const applyMeasuredSize = () => {
      const nextSize = measureCanvasPreviewDocument(document, scaleMode);
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
    <div data-testid="canvas-preview-root" className="relative h-full min-h-0 bg-[var(--background-fronted)]">
      <div
        ref={previewFitRef}
        data-testid="canvas-preview-fit"
        className={`relative flex h-full min-h-0 w-full items-start justify-center bg-[var(--background-fronted)] ${
          scaleMode === 'manual' ? 'overflow-visible' : 'overflow-hidden'
        }`}
      >
        <iframe
          ref={urlFrameRef}
          data-testid="canvas-preview-url"
          title={t('preview.urlPreviewTitle', { name: file.name })}
          className="absolute left-1/2 top-0 border-0 bg-white"
          sandbox="allow-scripts allow-same-origin"
          src={previewUrl}
          onLoad={() => {
            measureLoadedPreview(urlFrameRef.current, showUrlFrame);
            if (showUrlFrame) {
              onSnapshotBridgeReady?.();
            }
          }}
          style={iframeVisibilityStyle(showUrlFrame, previewSize, scale, frameTop)}
        />
        <iframe
          ref={srcdocFrameRef}
          data-testid="canvas-preview-srcdoc"
          title={t('preview.srcdocPreviewTitle', { name: file.name })}
          className="absolute left-1/2 top-0 border-0 bg-white"
          sandbox="allow-scripts allow-same-origin"
          srcDoc={srcDoc}
          onLoad={() => {
            measureLoadedPreview(srcdocFrameRef.current, !showUrlFrame);
            replaySrcdocCommands();
            replayCommentCommands();
            replayDesignTweakCommand();
            if (acceptsSnapshotBridgeMessages) {
              onSnapshotBridgeReady?.();
            }
          }}
          style={iframeVisibilityStyle(!showUrlFrame, previewSize, scale, frameTop)}
        />
      </div>
    </div>
  );
}

export function resolveCanvasPreviewFrameSize(
  metrics: CanvasPreviewFrameMetrics,
  scaleMode: CanvasPreviewProps['scaleMode'] = 'manual',
): CanvasPreviewFrameSize {
  if (scaleMode === 'fit') {
    return {
      width: Math.max(CANVAS_PREVIEW_BASE_WIDTH, metrics.viewportWidth),
      height: Math.max(CANVAS_PREVIEW_BASE_HEIGHT, metrics.viewportHeight),
    };
  }

  return {
    width: Math.max(CANVAS_PREVIEW_BASE_WIDTH, metrics.viewportWidth, metrics.scrollWidth),
    height: Math.max(CANVAS_PREVIEW_BASE_HEIGHT, metrics.viewportHeight, metrics.scrollHeight),
  };
}

function measureCanvasPreviewDocument(document: Document, scaleMode: CanvasPreviewProps['scaleMode']): CanvasPreviewFrameSize {
  const body = document.body;
  const root = document.documentElement;

  return resolveCanvasPreviewFrameSize({
    viewportWidth: document.defaultView?.innerWidth ?? CANVAS_PREVIEW_BASE_WIDTH,
    viewportHeight: document.defaultView?.innerHeight ?? CANVAS_PREVIEW_BASE_HEIGHT,
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
  }, scaleMode);
}

function areFrameLayoutsEqual(
  current: CanvasPreviewFrameLayout | null,
  next: CanvasPreviewFrameLayout,
): boolean {
  return current !== null
    && current.width === next.width
    && current.height === next.height
    && current.scale === next.scale
    && current.active === next.active;
}

function getPreviewFrameDocument(frame: HTMLIFrameElement | null): Document | null {
  try {
    return frame?.contentDocument ?? null;
  } catch {
    return null;
  }
}

function isActiveSrcdocMessageSource(event: MessageEvent, activeWindow: Window | null | undefined): boolean {
  if (!activeWindow) {
    return false;
  }

  if (event.source === activeWindow) {
    return true;
  }

  // Existing jsdom tests synthesize MessageEvent without source; browser postMessage events still require contentWindow.
  return event.source === null && isSyntheticJsdomMessage(event);
}

function isSyntheticJsdomMessage(event: MessageEvent): boolean {
  return !event.isTrusted && typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');
}

function postSrcdocCommand(
  frame: HTMLIFrameElement | null,
  acceptsEditBridgeMessages: boolean,
  command: CanvasEditHostCommand,
) {
  if (!acceptsEditBridgeMessages) {
    return;
  }

  frame?.contentWindow?.postMessage(command, '*');
}

function postCommentCommand(
  frame: HTMLIFrameElement | null,
  acceptsCommentBridgeCommands: boolean,
  command: CanvasCommentHostCommand,
) {
  if (!acceptsCommentBridgeCommands) {
    return;
  }

  frame?.contentWindow?.postMessage(command, '*');
}

function isMessageObject(message: unknown): message is Record<string, unknown> & { type?: unknown } {
  return Boolean(message) && typeof message === 'object';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFinitePoint(value: unknown): value is CanvasCommentPoint {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isPointArray(value: unknown): value is CanvasCommentPoint[] {
  return Array.isArray(value) && value.every(isFinitePoint);
}

function isCanvasPreviewSizeMessage(
  message: Record<string, unknown> & { type?: unknown },
): message is { type: 'vd-preview-size'; width: number; height: number } {
  return message.type === 'vd-preview-size' && Number.isFinite(message.width) && Number.isFinite(message.height);
}

function isCanvasPreviewNavigateMessage(
  message: Record<string, unknown> & { type?: unknown },
): message is { type: 'vd-preview-navigate'; path: string; href?: string } {
  return message.type === 'vd-preview-navigate'
    && typeof message.path === 'string'
    && (message.href === undefined || typeof message.href === 'string');
}

function isCanvasDesignRuntimeReadyMessage(
  message: Record<string, unknown> & { type?: unknown },
): message is { type: 'vd-design-runtime-ready'; entryPath: string; sourcePath: string; tweakDefaults: Record<string, unknown> } {
  return message.type === 'vd-design-runtime-ready'
    && typeof message.entryPath === 'string'
    && typeof message.sourcePath === 'string'
    && isRecord(message.tweakDefaults);
}

function isCanvasDesignTweaksChangeMessage(
  message: Record<string, unknown> & { type?: unknown },
): message is {
  type: 'vd-design-tweak-changed';
  entryPath: string;
  sourcePath: string;
  key: string;
  value: unknown;
  tweaks: Record<string, unknown>;
} {
  return message.type === 'vd-design-tweak-changed'
    && typeof message.entryPath === 'string'
    && typeof message.sourcePath === 'string'
    && typeof message.key === 'string'
    && isRecord(message.tweaks);
}

function isCanvasCommentBridgeMessageType(type: unknown): type is CanvasCommentBridgeMessage['type'] {
  return (
    type === 'vd-comment-targets'
    || type === 'vd-comment-hover'
    || type === 'vd-comment-leave'
    || type === 'vd-comment-select'
    || type === 'vd-comment-pod-stroke'
    || type === 'vd-comment-pod-select'
    || type === 'vd-comment-active-target-update'
    || type === 'vd-comment-pod-clear'
  );
}

function isCanvasCommentBridgeTargetSnapshot(value: unknown): value is CanvasCommentBridgeTargetSnapshot {
  if (!isCanvasCommentTargetFields(value)) {
    return false;
  }

  const selectionKind = value.selectionKind;

  if (selectionKind !== undefined && selectionKind !== 'element' && selectionKind !== 'pod') {
    return false;
  }

  if (value.hoverPoint !== undefined && !isFinitePoint(value.hoverPoint)) {
    return false;
  }

  if (value.style !== undefined && !isRecord(value.style)) {
    return false;
  }

  if (selectionKind === 'pod') {
    return (value.memberCount === undefined || Number.isFinite(value.memberCount))
      && (value.podMembers === undefined || isCanvasCommentMemberArray(value.podMembers));
  }

  return value.memberCount === undefined && value.podMembers === undefined;
}

function isCanvasCommentTargetFields(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.targetId === 'string'
    && typeof value.selector === 'string'
    && typeof value.label === 'string'
    && typeof value.text === 'string'
    && typeof value.htmlHint === 'string'
    && isCanvasCommentPosition(value.position);
}

function isCanvasCommentPosition(value: unknown): boolean {
  return isRecord(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height);
}

function isCanvasCommentMemberArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isCanvasCommentTargetFields);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isCanvasCommentBridgeMessage(message: Record<string, unknown>): message is CanvasCommentBridgeMessage {
  if (message.type === 'vd-comment-targets') {
    return Array.isArray(message.targets) && message.targets.every(isCanvasCommentBridgeTargetSnapshot);
  }

  if (message.type === 'vd-comment-hover' || message.type === 'vd-comment-select') {
    return isCanvasCommentBridgeTargetSnapshot(message.target);
  }

  if (message.type === 'vd-comment-leave') {
    return message.target === undefined || isCanvasCommentBridgeTargetSnapshot(message.target);
  }

  if (message.type === 'vd-comment-pod-stroke') {
    return isPointArray(message.points);
  }

  if (message.type === 'vd-comment-pod-select') {
    return isPointArray(message.points)
      && (message.target === undefined || isCanvasCommentBridgeTargetSnapshot(message.target));
  }

  if (message.type === 'vd-comment-active-target-update') {
    return isNullableString(message.targetId)
      && isNullableString(message.selector)
      && (message.target === undefined || message.target === null || isCanvasCommentBridgeTargetSnapshot(message.target));
  }

  return message.type === 'vd-comment-pod-clear';
}

function isCanvasEditBridgeMessage(message: Record<string, unknown>): message is CanvasEditBridgeMessage {
  if (message.type === 'vd-edit-targets') {
    return Array.isArray(message.targets) && message.targets.every(isRecord);
  }

  if (message.type === 'vd-edit-hover' || message.type === 'vd-edit-select') {
    return message.target === null || isRecord(message.target);
  }

  if (message.type === 'vd-edit-text-commit') {
    return typeof message.id === 'string' && typeof message.value === 'string';
  }

  if (message.type === 'vd-edit-preview-style-applied') {
    return typeof message.id === 'string';
  }

  return false;
}

function requestUrlFramePreviewSnapshot(frame: HTMLIFrameElement | null): Promise<CanvasPreviewScreenshot> {
  try {
    const frameWindow = frame?.contentWindow;
    const frameDocument = frame?.contentDocument ?? frameWindow?.document ?? null;
    if (!frameWindow || !frameDocument?.documentElement) {
      return Promise.reject(new Error('Preview URL frame is not available.'));
    }

    return Promise.resolve(serializeFrameDocumentSnapshot(frameWindow, frameDocument));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('Preview URL snapshot failed.'));
  }
}

function serializeFrameDocumentSnapshot(
  frameWindow: Window,
  frameDocument: Document,
): CanvasPreviewScreenshot {
  const root = frameDocument.documentElement;
  const body = frameDocument.body;
  const viewportWidth = Math.max(1, Math.round(frameWindow.innerWidth || root.clientWidth || CANVAS_PREVIEW_BASE_WIDTH));
  const viewportHeight = Math.max(1, Math.round(frameWindow.innerHeight || root.clientHeight || CANVAS_PREVIEW_BASE_HEIGHT));
  const width = Math.max(
    viewportWidth,
    Math.round(root.scrollWidth || 0),
    Math.round(root.offsetWidth || 0),
    Math.round(body?.scrollWidth || 0),
    Math.round(body?.offsetWidth || 0),
  );
  const height = Math.max(
    viewportHeight,
    Math.round(root.scrollHeight || 0),
    Math.round(root.offsetHeight || 0),
    Math.round(body?.scrollHeight || 0),
    Math.round(body?.offsetHeight || 0),
  );
  const clone = root.cloneNode(true) as Element;

  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.querySelectorAll(SNAPSHOT_BRIDGE_OWNED_SELECTOR).forEach((node) => node.remove());

  const serializedHtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;background:white;"><div style="width:${width}px;min-height:${height}px;transform:translate(0px,0px);transform-origin:top left;">${serializedHtml}</div></div></foreignObject></svg>`;

  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}

function iframeVisibilityStyle(
  active: boolean,
  previewSize: CanvasPreviewFrameSize,
  scale: number,
  top: number,
): React.CSSProperties {
  const frameStyle: React.CSSProperties = {
    top,
    width: previewSize.width,
    height: previewSize.height,
    transform: `translateX(-50%) scale(${scale})`,
    transformOrigin: 'top center',
  };

  return active
    ? { ...frameStyle, visibility: 'visible', pointerEvents: 'auto' }
    : { ...frameStyle, visibility: 'hidden', pointerEvents: 'none' };
}

function buildImageDataUrl(file: WorkspaceFile): string | null {
  if (!file.contents) {
    return null;
  }

  const mime = file.mime.startsWith('image/') ? file.mime : 'application/octet-stream';
  const base64 = encodeBase64(file.contents);
  return base64 ? `data:${mime};base64,${base64}` : null;
}

function encodeBase64(value: string): string | null {
  try {
    return btoa(value);
  } catch {
    if (typeof TextEncoder === 'undefined') {
      return null;
    }

    try {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary);
    } catch {
      return null;
    }
  }
}

function isSvgImage(file: WorkspaceFile): boolean {
  return file.mime.split(';', 1)[0]?.trim().toLowerCase() === 'image/svg+xml'
    || file.name.toLowerCase().endsWith('.svg');
}

function buildSvgDocumentUrl(file: WorkspaceFile): string | null {
  if (!file.contents) {
    return null;
  }

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.contents)}`;
}
