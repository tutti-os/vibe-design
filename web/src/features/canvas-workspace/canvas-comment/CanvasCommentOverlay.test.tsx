// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasCommentOverlay } from './CanvasCommentOverlay';
import type { CanvasPreviewComment } from './canvas-comment-types';

function savedComment(overrides: Partial<CanvasPreviewComment> = {}): CanvasPreviewComment {
  return {
    id: 'comment-1',
    projectId: 'project-1',
    filePath: 'landing.html',
    targetId: 'hero',
    selector: '[data-vd-id="hero"]',
    label: 'Hero',
    text: 'Hero',
    htmlHint: '<section data-vd-id="hero">',
    position: { x: 120, y: 80, width: 200, height: 80 },
    note: 'Tighten this section',
    createdAt: 1,
    updatedAt: 1,
    status: 'open',
    selectionKind: 'element',
    ...overrides,
  } as CanvasPreviewComment;
}

describe('CanvasCommentOverlay', () => {
  it('keeps the saved marker layer clipped to the preview frame above canvas content', () => {
    render(
      <CanvasCommentOverlay
        activeTarget={null}
        hoveredTarget={null}
        savedComments={[savedComment()]}
        frameLayout={{ width: 1280, height: 800, scale: 0.5, active: true }}
        scale={0.5}
        onOpenSavedComment={vi.fn()}
      />,
    );

    const overlay = screen.getByTestId('canvas-comment-overlay');

    expect(overlay.className).toContain('z-[60]');
    expect(overlay.className).toContain('overflow-hidden');
    expect(overlay.className).not.toContain('overflow-visible');
  });

  it('clamps saved comment markers inside the top-right frame bounds', () => {
    render(
      <CanvasCommentOverlay
        activeTarget={null}
        hoveredTarget={null}
        savedComments={[
          savedComment({
            position: { x: 1278, y: 0, width: 30, height: 20 },
          }),
        ]}
        frameLayout={{ width: 1280, height: 800, scale: 0.5, active: true }}
        scale={0.5}
        onOpenSavedComment={vi.fn()}
      />,
    );

    const marker = screen.getByTestId('canvas-comment-saved-marker');

    expect(marker.getAttribute('data-preview-side')).toBe('left');
    expect(marker.style.right).toBe('14px');
    expect(marker.style.top).toBe('14px');
  });

  it('does not let the collapsed preview pill push a right-edge marker icon out of view', () => {
    render(
      <CanvasCommentOverlay
        activeTarget={null}
        hoveredTarget={null}
        savedComments={[
          savedComment({
            position: { x: 1200, y: 20, width: 70, height: 40 },
          }),
        ]}
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        scale={1}
        onOpenSavedComment={vi.fn()}
      />,
    );

    const marker = screen.getByTestId('canvas-comment-saved-marker');
    const preview = screen.getByTestId('canvas-comment-saved-marker-preview');

    expect(marker.getAttribute('data-preview-side')).toBe('left');
    expect(preview.getAttribute('data-state')).toBe('collapsed');
    expect(preview.className).toContain('w-0');
    expect(preview.className).not.toContain('-mr-7');
    expect(preview.className).not.toContain('pr-10');
  });

  it('clamps saved comment markers inside the bottom-left frame bounds', () => {
    render(
      <CanvasCommentOverlay
        activeTarget={null}
        hoveredTarget={null}
        savedComments={[
          savedComment({
            position: { x: -40, y: 799, width: 10, height: 20 },
          }),
        ]}
        frameLayout={{ width: 1280, height: 800, scale: 0.5, active: true }}
        scale={0.5}
        onOpenSavedComment={vi.fn()}
      />,
    );

    const marker = screen.getByTestId('canvas-comment-saved-marker');

    expect(marker.getAttribute('data-preview-side')).toBe('right');
    expect(marker.style.left).toBe('14px');
    expect(marker.style.top).toBe('786px');
  });
});
