import React from 'react';
import { Button } from '@tutti-os/ui-system/components';
import { ChatIcon, EditIcon } from '@tutti-os/ui-system/icons';
import type { CanvasCommentTargetSnapshot, CanvasPreviewComment } from './canvas-comment-types';

export interface CanvasCommentOverlayFrameLayout {
  width: number;
  height: number;
  scale: number;
  active: boolean;
}

export interface CanvasCommentOverlayProps {
  activeTarget: CanvasCommentTargetSnapshot | null;
  hoveredTarget: CanvasCommentTargetSnapshot | null;
  savedComments: CanvasPreviewComment[];
  selectedSavedCommentId?: string | null;
  scale: number;
  frameLayout?: CanvasCommentOverlayFrameLayout | null;
  onOpenSavedComment(comment: CanvasPreviewComment): void;
}

export function CanvasCommentOverlay({
  activeTarget,
  frameLayout = null,
  hoveredTarget,
  savedComments,
  selectedSavedCommentId = null,
  scale,
  onOpenSavedComment,
}: CanvasCommentOverlayProps) {
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const targetScale = frameLayout ? 1 : normalizedScale;
  const hasVisibleContent = savedComments.length > 0 || Boolean(activeTarget) || Boolean(hoveredTarget);
  const overlayHidden = frameLayout ? !frameLayout.active || !hasVisibleContent : !hasVisibleContent;
  const [expandedPreviewCommentId, setExpandedPreviewCommentId] = React.useState<string | null>(null);

  function collapsePreview(commentId: string): void {
    setExpandedPreviewCommentId((currentId) => (currentId === commentId ? null : currentId));
  }

  return (
    <div
      data-testid="canvas-comment-overlay"
      className={`pointer-events-none absolute z-[60] overflow-hidden ${frameLayout ? '' : 'inset-0'}`}
      style={frameLayout ? frameLayoutStyle(frameLayout) : undefined}
      aria-hidden={overlayHidden}
    >
      {hoveredTarget && hoveredTarget.targetId !== activeTarget?.targetId ? (
        <TargetBox
          target={hoveredTarget}
          scale={targetScale}
          testId="canvas-comment-hover-target"
          className="border-[var(--border-focus)] bg-[color-mix(in_srgb,var(--background-fronted)_72%,transparent)]"
        />
      ) : null}
      {activeTarget ? (
        <TargetBox
          target={activeTarget}
          scale={targetScale}
          testId="canvas-comment-active-target"
          className="border-[var(--primary)] bg-[var(--project-primary-alpha-10)]"
        />
      ) : null}
      {savedComments.map((comment) => {
        const selected = comment.id === selectedSavedCommentId;
        const previewExpanded = comment.id === expandedPreviewCommentId;
        const previewText = comment.note.trim();
        const singleLinePreview = isSingleLinePreviewText(previewText);
        const frameWidth = frameLayout ? frameLayout.width : null;
        const openLeft = shouldOpenPreviewLeft(comment, targetScale, frameWidth);
        return (
          <Button
            key={comment.id}
            type="button"
            data-testid="canvas-comment-saved-marker"
            data-preview-side={openLeft ? 'left' : 'right'}
            aria-label={`Open saved comment for ${comment.label}`}
            aria-pressed={selected}
            size="icon-xs"
            variant="secondary"
            className={`group/comment-marker pointer-events-auto absolute z-20 items-start overflow-hidden border-0 bg-transparent p-0 text-[var(--text-primary)] shadow-none transition-[width,background-color,border-color,color,box-shadow] duration-200 ease-out hover:bg-transparent active:bg-transparent ${openLeft ? 'flex-row-reverse justify-end' : 'justify-start'} ${previewExpanded ? 'h-auto min-h-7 w-fit max-w-[320px] rounded-lg' : 'h-7 w-7 rounded-full'} ${
              selected ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background-fronted)]' : ''
            }`}
            style={markerStyle(comment, targetScale, openLeft, frameLayout)}
            onMouseEnter={() => setExpandedPreviewCommentId(comment.id)}
            onMouseLeave={() => collapsePreview(comment.id)}
            onFocus={() => setExpandedPreviewCommentId(comment.id)}
            onBlur={() => collapsePreview(comment.id)}
            onClick={() => onOpenSavedComment(comment)}
          >
            <span
              aria-hidden="true"
              data-marker-icon={comment.selectionKind === 'visual' ? 'mark' : 'comment'}
              className="relative z-10 flex h-7 w-7 min-w-7 items-center justify-center rounded-full border-2 border-[var(--background-fronted)] bg-[var(--project-comment-marker-bg)] text-[var(--text-inverted)] shadow-[var(--project-shadow-raised)]"
            >
              {comment.selectionKind === 'visual' ? <EditIcon size={13} /> : <ChatIcon size={13} />}
            </span>
            <span
              aria-hidden="true"
              data-testid="canvas-comment-saved-marker-preview"
              data-state={previewExpanded ? 'expanded' : 'collapsed'}
              className={`pointer-events-none min-w-0 overflow-hidden rounded-md bg-[var(--background-fronted)] text-left text-[var(--text-primary)] shadow-[var(--project-shadow-raised)] transition-opacity duration-200 ease-out whitespace-normal break-words ${
                previewExpanded
                  ? `w-fit max-w-[320px] ${previewSpacingClass(openLeft)} ${previewRoundedClass(openLeft, singleLinePreview)} border border-[var(--border-1)] py-[5px] opacity-100`
                  : 'w-0 max-w-0 border-0 px-0 py-0 opacity-0'
              }`}
            >
              <span className="block max-h-16 overflow-hidden text-[11px] font-normal leading-4 text-[var(--text-secondary)]">
                {previewText}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function isSingleLinePreviewText(text: string): boolean {
  return !/[\r\n]/.test(text) && text.length <= 28;
}

function frameLayoutStyle(layout: CanvasCommentOverlayFrameLayout): React.CSSProperties {
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

function TargetBox({
  className,
  scale,
  target,
  testId,
}: {
  className: string;
  scale: number;
  target: CanvasCommentTargetSnapshot;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`absolute rounded-md border-2 ${className}`}
      style={targetBoxStyle(target, scale)}
    >
    </div>
  );
}

function targetBoxStyle(target: CanvasCommentTargetSnapshot, scale: number): React.CSSProperties {
  return {
    left: target.position.x * scale,
    top: target.position.y * scale,
    width: Math.max(target.position.width * scale, 1),
    height: Math.max(target.position.height * scale, 1),
  };
}

// The preview pill expands away from the marker icon. When the commented
// element sits near the right edge of the frame, opening rightward clamps the
// `w-fit` pill against the container edge, collapsing it to a sliver that wraps
// CJK text one glyph per line. In that case anchor by the right edge instead so
// the pill grows leftward into the available space.
const COMMENT_PREVIEW_MIN_SPACE = 240;

function shouldOpenPreviewLeft(
  comment: CanvasPreviewComment,
  scale: number,
  frameWidth: number | null,
): boolean {
  if (frameWidth == null) return false;
  const anchorX = (comment.position.x + comment.position.width) * scale;
  const spaceRight = frameWidth * scale - anchorX;
  return spaceRight < COMMENT_PREVIEW_MIN_SPACE && anchorX > spaceRight;
}

function previewSpacingClass(openLeft: boolean): string {
  return openLeft ? '-mr-7 pr-10 pl-3' : '-ml-7 pl-10 pr-3';
}

function previewRoundedClass(openLeft: boolean, singleLine: boolean): string {
  if (openLeft) return singleLine ? 'rounded-r-full' : 'rounded-r-md';
  return singleLine ? 'rounded-l-full' : 'rounded-l-md';
}

function markerStyle(
  comment: CanvasPreviewComment,
  scale: number,
  openLeft: boolean,
  frameLayout: CanvasCommentOverlayFrameLayout | null,
): React.CSSProperties {
  const markerRadius = 14;
  const frameWidth = frameLayout ? frameLayout.width * scale : null;
  const frameHeight = frameLayout ? frameLayout.height * scale : null;
  const top = clampMarkerCenter(comment.position.y * scale, frameHeight, markerRadius);
  const anchorX = clampMarkerCenter((comment.position.x + comment.position.width) * scale, frameWidth, markerRadius);
  if (openLeft && frameWidth != null) {
    return {
      right: frameWidth - anchorX,
      top,
      transform: 'translate(14px, -14px)',
    };
  }
  return {
    left: anchorX,
    top,
    transform: 'translate(-14px, -14px)',
  };
}

function clampMarkerCenter(value: number, frameSize: number | null, markerRadius: number): number {
  if (frameSize == null) {
    return value;
  }

  return clampNumber(value, markerRadius, Math.max(markerRadius, frameSize - markerRadius));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
