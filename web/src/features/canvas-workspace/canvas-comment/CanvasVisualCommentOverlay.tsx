import React from 'react';
import { Badge, Button, Card, CardContent } from '@tutti-os/ui-system/components';
import {
  ChatIcon,
  CloseIcon,
  DeleteIcon,
} from '@tutti-os/ui-system/icons';
import { ProjectSecondaryButton } from '../../../components/ProjectSecondaryButton';
import { useTranslation } from '../../../i18n';
import { AutoSizingCommentTextarea, estimateCommentTextareaHeight } from './AutoSizingCommentTextarea';
import type {
  CanvasCommentPoint,
  CanvasCommentPosition,
  CanvasPreviewComment,
  CanvasVisualCommentTarget,
  CanvasVisualMarkCommentAttachment,
} from './canvas-comment-types';

export interface CanvasVisualCommentScreenshot {
  dataUrl: string;
  width: number;
  height: number;
}

export interface CanvasVisualCommentFrameLayout {
  width: number;
  height: number;
  scale: number;
  active: boolean;
}

export interface CanvasVisualCommentViewportBounds {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface CanvasVisualCommentOverlayProps {
  filePath: string;
  frameLayout?: CanvasVisualCommentFrameLayout | null;
  viewportBounds?: CanvasVisualCommentViewportBounds | null;
  requestScreenshot(): Promise<CanvasVisualCommentScreenshot>;
  uploadScreenshot?(dataUrl: string): Promise<string>;
  openedComment?: CanvasPreviewComment | null;
  onSave?(target: CanvasVisualCommentTarget, note: string): void | Promise<void>;
  onSend(attachments: CanvasVisualMarkCommentAttachment[]): void;
  onCloseOpenedComment?(): void;
}

interface VisualBoxMark {
  id: string;
  kind: 'box';
  position: CanvasCommentPosition;
}

type VisualMark = VisualBoxMark;

interface DraftBoxMark {
  kind: 'box';
  start: CanvasCommentPoint;
  end: CanvasCommentPoint;
}

type DraftMark = DraftBoxMark;

let nextVisualMarkId = 1;

const VISUAL_COMMENT_POPUP_WIDTH = 320;
const VISUAL_COMMENT_POPUP_HEIGHT = 170;
const VISUAL_COMMENT_POPUP_MARGIN = 12;
const VISUAL_COMMENT_POPUP_EDGE = 12;

export function CanvasVisualCommentOverlay({
  filePath,
  frameLayout = null,
  viewportBounds = null,
  requestScreenshot,
  uploadScreenshot,
  openedComment = null,
  onSave,
  onSend,
  onCloseOpenedComment,
}: CanvasVisualCommentOverlayProps) {
  const { t } = useTranslation();
  const [marks, setMarks] = React.useState<VisualMark[]>([]);
  const [draftMark, setDraftMark] = React.useState<DraftMark | null>(null);
  const [note, setNote] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const openedVisualComment = openedComment?.selectionKind === 'visual' ? openedComment : null;
  const openedVisualMark = openedVisualComment ? visualMarkFromOpenedComment(openedVisualComment) : null;
  const hasCurrentComment = marks.length > 0 && note.trim().length > 0;
  const showOpenedComment = Boolean(openedVisualComment && openedVisualMark && marks.length === 0 && note.trim().length === 0 && !draftMark && !sending);
  const showCommentPopup = marks.length > 0 || note.trim().length > 0 || sending || showOpenedComment;
  const canAddComment = Boolean(uploadScreenshot && onSave) && hasCurrentComment && !sending;
  const canSend = Boolean(uploadScreenshot) && hasCurrentComment && !sending;
  const surfaceStyle = frameLayout ? frameLayoutStyle(frameLayout) : undefined;
  const popupHeight = visualCommentPopupHeightForNote(showOpenedComment ? openedVisualComment?.note ?? '' : note);
  const toolbarStyle = showOpenedComment && openedVisualMark
    ? visualCommentToolbarStyle([openedVisualMark], frameLayout, viewportBounds, popupHeight)
    : visualCommentToolbarStyle(marks, frameLayout, viewportBounds, popupHeight);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    onCloseOpenedComment?.();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointFromPointerEvent(event, frameLayout);
    setDraftMark({ kind: 'box', start: point, end: point });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!draftMark) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromPointerEvent(event, frameLayout);
    setDraftMark((currentDraft) => {
      if (!currentDraft) return currentDraft;
      return { ...currentDraft, end: point };
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!draftMark) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const point = pointFromPointerEvent(event, frameLayout);
    const completedMark = completeDraftMark(draftMark, point);
    setDraftMark(null);
    if (!completedMark) return;
    setMarks([completedMark]);
  }

  function handleClear() {
    setMarks([]);
    setDraftMark(null);
  }

  async function buildVisualCommentAttachment(order: number): Promise<CanvasVisualMarkCommentAttachment | null> {
    const intent = note.trim();
    if (!intent || marks.length === 0 || !uploadScreenshot) return null;

    const screenshot = await requestScreenshot();
    const compositedDataUrl = composeVisualCommentDataUrl(screenshot, marks);
    const screenshotPath = await uploadScreenshot(compositedDataUrl);
    return visualAttachmentFromMarks({
      filePath,
      label: t('visualComment.markedRegion'),
      marks,
      note: intent,
      order,
      screenshotPath,
      screenshotSize: screenshot,
    });
  }

  function clearCurrentVisualComment() {
    setMarks([]);
    setDraftMark(null);
    setNote('');
  }

  async function handleAddComment() {
    if (!canAddComment) return;

    setSending(true);
    try {
      const attachment = await buildVisualCommentAttachment(1);
      if (!attachment) return;
      await onSave?.(visualTargetFromAttachment(attachment, t('visualComment.markedRegion')), attachment.comment);
      clearCurrentVisualComment();
    } catch {
      // Keep the mark and note in place so the user can retry after a snapshot/upload failure.
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    if (!canSend) return;

    setSending(true);
    try {
      const currentAttachment = hasCurrentComment
        ? await buildVisualCommentAttachment(1)
        : null;
      if (!currentAttachment) return;
      onSend([currentAttachment]);
      clearCurrentVisualComment();
    } catch {
      // Keep the mark and note in place so the user can retry after a snapshot/upload failure.
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      data-testid="canvas-visual-comment-overlay"
      className="absolute inset-0 z-20 flex flex-col pointer-events-none"
    >
      <div
        data-testid="canvas-visual-comment-mark-surface"
        className={`pointer-events-auto absolute cursor-crosshair ${frameLayout ? '' : 'inset-0'}`}
        style={surfaceStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <svg className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          {openedVisualMark ? renderOpenedVisualMark(openedVisualMark) : null}
          {marks.map((mark) => renderVisualMark(mark))}
          {draftMark ? renderDraftMark(draftMark) : null}
        </svg>
      </div>

      {showCommentPopup ? (
        <Card
          data-testid={showOpenedComment ? 'canvas-visual-comment-opened-card' : 'canvas-visual-comment-toolbar'}
          className="pointer-events-auto absolute w-[320px] max-w-[calc(100%-32px)] rounded-[var(--project-radius-lg)] border-[var(--border-1)] bg-[var(--background-fronted)] shadow-[var(--project-shadow-popover)]"
          style={toolbarStyle}
          size="sm"
        >
          {showOpenedComment && openedVisualComment ? (
            <div data-slot="card-content" className="space-y-1.5" style={{ padding: 10 }}>
              <div className="flex h-6 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{t('visualComment.title')}</span>
                  <Badge variant="secondary" className="max-w-44 truncate">
                    {openedVisualComment.label || openedVisualComment.targetId}
                  </Badge>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="chrome"
                  aria-label={t('visualComment.actions.closeOpened')}
                  onClick={() => onCloseOpenedComment?.()}
                >
                  <CloseIcon size={14} />
                </Button>
              </div>
              <div
                data-testid="canvas-visual-comment-opened-note"
                className="min-h-[56px] rounded-[var(--project-radius-md)] border border-[var(--border-1)] bg-[var(--project-input-bg)] px-3 py-2 text-[var(--project-font-body)] leading-5 text-[var(--text-primary)]"
              >
                {openedVisualComment.note}
              </div>
            </div>
          ) : (
            <div data-slot="card-content" className="space-y-1.5" style={{ padding: 10 }}>
              <div className="flex h-6 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{t('visualComment.title')}</span>
                  <span
                    data-testid="canvas-visual-comment-mark-count"
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    {t(marks.length === 1 ? 'visualComment.markCount' : 'visualComment.markCountPlural', { count: marks.length })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="chrome"
                    aria-label={t('visualComment.actions.clearMarks')}
                    disabled={marks.length === 0 && !draftMark}
                    onClick={handleClear}
                  >
                    <DeleteIcon size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="chrome"
                    aria-label={t('visualComment.actions.closeMarkUp')}
                    disabled={marks.length === 0 && note.trim().length === 0}
                    onClick={handleClear}
                  >
                    <CloseIcon size={14} />
                  </Button>
                </div>
              </div>

              <label className="block">
                <span className="sr-only">{t('visualComment.note')}</span>
                <AutoSizingCommentTextarea
                  ariaLabel={t('visualComment.note')}
                  placeholder={t('visualComment.placeholder')}
                  value={note}
                  onChange={setNote}
                />
              </label>

              <div className="flex items-center justify-end gap-2">
                <ProjectSecondaryButton
                  type="button"
                  disabled={!canAddComment}
                  className="h-7 px-2.5"
                  onClick={() => void handleAddComment()}
                >
                  {t('visualComment.actions.addComment')}
                </ProjectSecondaryButton>
                <Button
                  type="button"
                  size="sm"
                  className="project-primary-button h-7 rounded-[var(--project-radius-md)] px-2.5 text-[var(--project-font-meta)] font-medium"
                  disabled={!canSend}
                  aria-label={t('visualComment.actions.sendToAgent')}
                  onClick={() => void handleSend()}
                >
                  <ChatIcon size={14} />
                  {t('visualComment.actions.sendToAgent')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function frameLayoutStyle(layout: CanvasVisualCommentFrameLayout): React.CSSProperties {
  return {
    left: '50%',
    top: 0,
    width: layout.width,
    height: layout.height,
    transform: `translateX(-50%) scale(${layout.scale})`,
    transformOrigin: 'top center',
    visibility: layout.active ? 'visible' : 'hidden',
  };
}

function visualCommentToolbarStyle(
  marks: VisualMark[],
  frameLayout: CanvasVisualCommentFrameLayout | null,
  viewportBounds: CanvasVisualCommentViewportBounds | null,
  popupHeight = VISUAL_COMMENT_POPUP_HEIGHT,
): React.CSSProperties {
  if (marks.length === 0) {
    return {
      left: '50%',
      top: '22%',
      transform: 'translateX(-50%)',
    };
  }

  const bounds = boundsForMarks(marks);

  if (!frameLayout) {
    return visualCommentToolbarStyleInFrame(bounds, {
      width: Math.max(bounds.x + bounds.width + VISUAL_COMMENT_POPUP_WIDTH + VISUAL_COMMENT_POPUP_MARGIN, 1),
      height: Math.max(bounds.y + bounds.height + popupHeight + VISUAL_COMMENT_POPUP_MARGIN, 1),
      scale: 1,
      leftPrefix: '',
      viewportBounds,
      popupHeight,
    });
  }

  const frameWidth = frameLayout.width * frameLayout.scale;
  return visualCommentToolbarStyleInFrame(bounds, {
    width: frameWidth,
    height: frameLayout.height * frameLayout.scale,
    scale: frameLayout.scale,
    leftPrefix: `calc(50% - ${Math.round(frameWidth / 2)}px + `,
    viewportBounds,
    popupHeight,
  });
}

function visualCommentToolbarStyleInFrame(
  bounds: CanvasCommentPosition,
  frame: {
    width: number;
    height: number;
    scale: number;
    leftPrefix: string;
    viewportBounds: CanvasVisualCommentViewportBounds | null;
    popupHeight: number;
  },
): React.CSSProperties {
  const targetLeft = bounds.x * frame.scale;
  const targetTop = bounds.y * frame.scale;
  const targetRight = (bounds.x + bounds.width) * frame.scale;
  const targetBottom = (bounds.y + bounds.height) * frame.scale;
  const targetCenterX = targetLeft + (targetRight - targetLeft) / 2;
  const visibleLeft = frame.viewportBounds?.scrollLeft ?? 0;
  const visibleTop = frame.viewportBounds?.scrollTop ?? 0;
  const visibleWidth = frame.viewportBounds?.width ?? frame.width;
  const visibleHeight = frame.viewportBounds?.height ?? frame.height;
  const minX = visibleLeft + VISUAL_COMMENT_POPUP_EDGE;
  const maxX = Math.max(minX, visibleLeft + visibleWidth - VISUAL_COMMENT_POPUP_WIDTH - VISUAL_COMMENT_POPUP_EDGE);
  const minY = visibleTop + VISUAL_COMMENT_POPUP_EDGE;
  const maxY = Math.max(minY, visibleTop + visibleHeight - frame.popupHeight - VISUAL_COMMENT_POPUP_EDGE);
  const sideTop = clampNumber(Math.round(targetTop + VISUAL_COMMENT_POPUP_MARGIN), minY, maxY);
  const rightX = Math.round(targetRight + VISUAL_COMMENT_POPUP_MARGIN);

  if (rightX + VISUAL_COMMENT_POPUP_WIDTH <= maxX + VISUAL_COMMENT_POPUP_EDGE) {
    return visualCommentToolbarPlacement(frame.leftPrefix, clampNumber(rightX, minX, maxX), sideTop);
  }

  const leftX = Math.round(targetLeft - VISUAL_COMMENT_POPUP_MARGIN - VISUAL_COMMENT_POPUP_WIDTH);

  if (leftX >= minX - VISUAL_COMMENT_POPUP_EDGE) {
    return visualCommentToolbarPlacement(frame.leftPrefix, clampNumber(leftX, minX, maxX), sideTop);
  }

  const centeredX = clampNumber(
    Math.round(targetCenterX - VISUAL_COMMENT_POPUP_WIDTH / 2),
    minX,
    maxX,
  );
  const belowY = Math.round(targetBottom + VISUAL_COMMENT_POPUP_MARGIN);

  if (belowY <= maxY) {
    return visualCommentToolbarPlacement(frame.leftPrefix, centeredX, belowY);
  }

  const aboveY = Math.round(targetTop - VISUAL_COMMENT_POPUP_MARGIN - frame.popupHeight);

  if (aboveY >= minY) {
    return visualCommentToolbarPlacement(frame.leftPrefix, centeredX, aboveY);
  }

  const fallbackX = frame.width - targetRight >= targetLeft
    ? clampNumber(rightX, minX, maxX)
    : clampNumber(leftX, minX, maxX);

  return visualCommentToolbarPlacement(frame.leftPrefix, Math.round(fallbackX), sideTop);
}

function visualCommentPopupHeightForNote(note: string): number {
  return VISUAL_COMMENT_POPUP_HEIGHT + estimateCommentTextareaHeight(note) - 56;
}

function visualCommentToolbarPlacement(leftPrefix: string, x: number, y: number): React.CSSProperties {
  return {
    left: leftPrefix ? `${leftPrefix}${Math.round(x)}px)` : Math.round(x),
    top: Math.round(y),
  };
}

function visualTargetFromAttachment(attachment: CanvasVisualMarkCommentAttachment, defaultLabel: string): CanvasVisualCommentTarget {
  return {
    filePath: attachment.filePath,
    targetId: attachment.targetId,
    selector: attachment.selector,
    label: attachment.label,
    text: attachment.currentText,
    position: { ...attachment.pagePosition },
    htmlHint: attachment.htmlHint,
    ...(attachment.style ? { style: { ...attachment.style } } : {}),
    selectionKind: 'visual',
    ...(attachment.screenshotPath ? { screenshotPath: attachment.screenshotPath } : {}),
    markKind: attachment.markKind,
    ...(attachment.intent ? { intent: attachment.intent } : {}),
  };
}

function visualMarkFromOpenedComment(comment: CanvasPreviewComment): VisualBoxMark {
  return {
    id: `${comment.id}-opened-mark`,
    kind: 'box',
    position: comment.position,
  };
}

function pointFromPointerEvent(
  event: React.PointerEvent<HTMLElement>,
  frameLayout: CanvasVisualCommentFrameLayout | null,
): CanvasCommentPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  const scale = frameLayout && frameLayout.width > 0 && rect.width > 0
    ? rect.width / frameLayout.width
    : frameLayout && frameLayout.scale > 0
      ? frameLayout.scale
      : 1;
  const maxWidth = frameLayout?.width ?? rect.width;
  const maxHeight = frameLayout?.height ?? rect.height;

  return {
    x: clampNumber(roundNonNegative((event.clientX - rect.left) / scale), 0, maxWidth),
    y: clampNumber(roundNonNegative((event.clientY - rect.top) / scale), 0, maxHeight),
  };
}

function completeDraftMark(draftMark: DraftMark, endPoint: CanvasCommentPoint): VisualMark | null {
  const id = `visual-mark-${nextVisualMarkId}`;
  nextVisualMarkId += 1;

  return {
    id,
    kind: 'box',
    position: positionFromPoints(draftMark.start, endPoint),
  };
}

function visualAttachmentFromMarks(input: {
  filePath: string;
  label: string;
  marks: VisualMark[];
  note: string;
  order: number;
  screenshotPath: string;
  screenshotSize: { width: number; height: number };
}): CanvasVisualMarkCommentAttachment {
  const pagePosition = clampPositionToSize(boundsForMarks(input.marks), input.screenshotSize);
  const targetId = `visual-mark-${stableVisualHash(`${input.filePath}:${input.note}:${JSON.stringify(pagePosition)}`)}`;

  return {
    id: targetId,
    order: input.order,
    source: 'visual-mark',
    selectionKind: 'visual',
    filePath: input.filePath,
    targetId,
    selector: 'visual-mark',
    label: input.label,
    comment: input.note,
    currentText: '',
    pagePosition,
    htmlHint: '',
    markKind: markKindForMarks(input.marks),
    screenshotPath: input.screenshotPath,
    intent: input.note,
  };
}

function renderVisualMark(mark: VisualMark): React.ReactNode {
  return (
    <rect
      key={mark.id}
      x={mark.position.x}
      y={mark.position.y}
      width={mark.position.width}
      height={mark.position.height}
      rx="6"
      fill="var(--primary)"
      fillOpacity="0.12"
      stroke="var(--primary)"
      strokeWidth="2"
      strokeDasharray="6 4"
    />
  );
}

function renderOpenedVisualMark(mark: VisualBoxMark): React.ReactNode {
  return (
    <rect
      key={mark.id}
      x={mark.position.x}
      y={mark.position.y}
      width={mark.position.width}
      height={mark.position.height}
      rx="6"
      fill="var(--primary)"
      fillOpacity="0.16"
      stroke="var(--primary)"
      strokeWidth="3"
    />
  );
}

function renderDraftMark(draftMark: DraftMark): React.ReactNode {
  const position = positionFromPoints(draftMark.start, draftMark.end);
  return (
    <rect
      x={position.x}
      y={position.y}
      width={position.width}
      height={position.height}
      rx="6"
      fill="var(--primary)"
      fillOpacity="0.08"
      stroke="var(--primary)"
      strokeWidth="2"
    />
  );
}

function boundsForMarks(marks: VisualMark[]): CanvasCommentPosition {
  const positions = marks.map((mark) => mark.position);
  const left = Math.min(...positions.map((position) => position.x));
  const top = Math.min(...positions.map((position) => position.y));
  const right = Math.max(...positions.map((position) => position.x + position.width));
  const bottom = Math.max(...positions.map((position) => position.y + position.height));

  return {
    x: roundNonNegative(left),
    y: roundNonNegative(top),
    width: Math.max(1, roundNonNegative(right - left)),
    height: Math.max(1, roundNonNegative(bottom - top)),
  };
}

function positionFromPoints(...points: CanvasCommentPoint[]): CanvasCommentPosition {
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));

  return {
    x: roundNonNegative(left),
    y: roundNonNegative(top),
    width: Math.max(1, roundNonNegative(right - left)),
    height: Math.max(1, roundNonNegative(bottom - top)),
  };
}

function markKindForMarks(_marks: VisualMark[]): CanvasVisualMarkCommentAttachment['markKind'] {
  return 'click';
}

function roundNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function clampPositionToSize(
  position: CanvasCommentPosition,
  size: { width: number; height: number },
): CanvasCommentPosition {
  const width = Number.isFinite(size.width) && size.width > 0 ? Math.round(size.width) : position.x + position.width;
  const height = Number.isFinite(size.height) && size.height > 0 ? Math.round(size.height) : position.y + position.height;
  const x = clampNumber(position.x, 0, Math.max(width - 1, 0));
  const y = clampNumber(position.y, 0, Math.max(height - 1, 0));
  const right = clampNumber(position.x + position.width, x + 1, width);
  const bottom = clampNumber(position.y + position.height, y + 1, height);
  return {
    x,
    y,
    width: Math.max(1, roundNonNegative(right - x)),
    height: Math.max(1, roundNonNegative(bottom - y)),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function composeVisualCommentDataUrl(
  screenshot: CanvasVisualCommentScreenshot,
  marks: VisualMark[],
): string {
  const width = Number.isFinite(screenshot.width) && screenshot.width > 0 ? Math.round(screenshot.width) : 1;
  const height = Number.isFinite(screenshot.height) && screenshot.height > 0 ? Math.round(screenshot.height) : 1;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeSvgAttribute(screenshot.dataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
    '<g fill="none" stroke="#2563eb" stroke-linecap="round" stroke-linejoin="round">',
    ...marks.map((mark) => visualMarkSvg(mark)),
    '</g>',
    '</svg>',
  ].join('');

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function visualMarkSvg(mark: VisualMark): string {
  const position = mark.position;
  return [
    `<rect x="${position.x}" y="${position.y}" width="${position.width}" height="${position.height}"`,
    ' rx="6" fill="#2563eb" fill-opacity="0.12" stroke="#2563eb" stroke-width="2" stroke-dasharray="6 4"/>',
  ].join('');
}

function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stableVisualHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
