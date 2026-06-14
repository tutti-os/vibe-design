// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasPropertyInspector } from './CanvasPropertyInspector';

function renderInspector(overrides: Partial<React.ComponentProps<typeof CanvasPropertyInspector>> = {}) {
  const props: React.ComponentProps<typeof CanvasPropertyInspector> = {
    activeTargetSelector: 'section.toolbar',
    activeTargetTitle: 'section.toolbar',
    canRedo: false,
    canSave: false,
    canUndo: false,
    editCount: 0,
    elementType: 'generic',
    error: null,
    onCancel: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onStyleChange: vi.fn(),
    onTextChange: vi.fn(),
    onUndo: vi.fn(),
    selected: true,
    selectedTargetId: 'toolbar',
    styleDraft: {
      height: '68.5',
      positionType: 'static',
      width: '1314',
    },
    targetList: [],
    textDraft: '',
    ...overrides,
  };

  render(<CanvasPropertyInspector {...props} />);
  return props;
}

describe('CanvasPropertyInspector', () => {
  it('does not emit a style change when an unchanged size input blurs', () => {
    const onStyleChange = vi.fn();
    renderInspector({ onStyleChange });

    fireEvent.blur(screen.getByLabelText('Width'));

    expect(onStyleChange).not.toHaveBeenCalled();
  });
});
