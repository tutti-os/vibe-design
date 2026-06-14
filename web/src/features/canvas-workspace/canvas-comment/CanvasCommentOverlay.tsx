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
      className={`pointer-events-none absolute z-10 overflow-visible ${frameLayout ? '' : 'inset-0'}`}
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
        return (
          <Button
            key={comment.id}
            type="button"
            data-testid="canvas-comment-saved-marker"
            aria-label={`Open saved comment for ${comment.label}`}
            aria-pressed={selected}
            size="icon-xs"
            variant="secondary"
            className={`group/comment-marker pointer-events-auto absolute items-start justify-start overflow-hidden border-0 bg-transparent p-0 text-[var(--text-primary)] shadow-none transition-[width,background-color,border-color,color,box-shadow] duration-200 ease-out hover:bg-transparent active:bg-transparent ${previewExpanded ? 'h-auto min-h-7 w-fit max-w-[320px] rounded-lg' : 'h-7 w-7 rounded-full'} ${
              selected ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background-fronted)]' : ''
            }`}
            style={markerStyle(comment, targetScale)}
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
              className={`pointer-events-none -ml-7 min-w-0 w-fit max-w-[320px] overflow-hidden rounded-md ${singleLinePreview ? 'rounded-l-full' : 'rounded-l-md'} border border-[var(--border-1)] bg-[var(--background-fronted)] py-[5px] pl-10 pr-3 text-left text-[var(--text-primary)] opacity-0 shadow-[var(--project-shadow-raised)] transition-opacity duration-200 ease-out whitespace-normal break-words ${
                previewExpanded ? 'opacity-100' : 'opacity-0'
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

function markerStyle(comment: CanvasPreviewComment, scale: number): React.CSSProperties {
  return {
    left: (comment.position.x + comment.position.width) * scale,
    top: comment.position.y * scale,
    transform: 'translate(-14px, -14px)',
  };
}
