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
    conversationId: 'conversation-1',
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
