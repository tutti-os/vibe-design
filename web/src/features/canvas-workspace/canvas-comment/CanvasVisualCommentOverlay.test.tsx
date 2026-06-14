// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasVisualCommentOverlay } from './CanvasVisualCommentOverlay';
import type { CanvasCommentAttachment, CanvasVisualCommentTarget } from './canvas-comment-types';

describe('CanvasVisualCommentOverlay', () => {
  it('waits for a completed visual mark before rendering the comment popup', () => {
    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-ui.svg'}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByTestId('canvas-visual-comment-mark-surface')).toBeTruthy();
    expect(screen.queryByTestId('canvas-visual-comment-toolbar')).toBeNull();
    expect(screen.queryByPlaceholderText('Describe the issue or suggestion...')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to agent' })).toBeNull();
    expect(screen.queryByTestId('canvas-visual-comment-tweaks')).toBeNull();
    expect(screen.queryAllByTestId('canvas-visual-comment-swatch')).toHaveLength(0);

    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 32, clientY: 48 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 80, clientY: 92 });

    const dialog = screen.getByTestId('canvas-visual-comment-toolbar');
    expect(dialog.textContent).toContain('Mark up');
    expect(screen.getByPlaceholderText('Describe the issue or suggestion...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to agent' })).toBeTruthy();
  });

  it('positions the comment popup outside the completed visual mark', () => {
    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-ui.svg'}
        onSend={vi.fn()}
      />,
    );

    const surface = screen.getByTestId('canvas-visual-comment-mark-surface');
    fireEvent.pointerDown(surface, { clientX: 450, clientY: 250 });
    fireEvent.pointerMove(surface, { clientX: 950, clientY: 500 });
    fireEvent.pointerUp(surface, { clientX: 950, clientY: 500 });

    const toolbar = screen.getByTestId('canvas-visual-comment-toolbar');
    expect(toolbar.style.left).toBe('calc(50% - 522px)');
    expect(toolbar.style.top).toBe('262px');
    expect(toolbar.style.transform).toBe('');
  });

  it('keeps only one active visual mark for the current comment', async () => {
    const onSend = vi.fn();

    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-current.svg'}
        onSend={onSend}
      />,
    );

    const surface = screen.getByTestId('canvas-visual-comment-mark-surface');
    fireEvent.pointerDown(surface, { clientX: 32, clientY: 48 });
    fireEvent.pointerUp(surface, { clientX: 80, clientY: 92 });
    expect(screen.getByTestId('canvas-visual-comment-mark-count').textContent).toContain('1 mark');

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 220 });
    fireEvent.pointerUp(surface, { clientX: 260, clientY: 300 });
    expect(screen.getByTestId('canvas-visual-comment-mark-count').textContent).toContain('1 mark');

    fireEvent.change(screen.getByLabelText('Visual comment note'), { target: { value: 'Evaluate this region' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    const [[attachments]] = onSend.mock.calls as [[CanvasCommentAttachment[]]];
    expect(attachments[0]).toMatchObject({
      pagePosition: { x: 200, y: 220, width: 60, height: 80 },
      markKind: 'click',
      comment: 'Evaluate this region',
    });
  });

  it('matches Claude Design styling for the visual comment popup', () => {
    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-ui.svg'}
        onSend={vi.fn()}
      />,
    );

    const surface = screen.getByTestId('canvas-visual-comment-mark-surface');
    fireEvent.pointerDown(surface, { clientX: 450, clientY: 250 });
    fireEvent.pointerMove(surface, { clientX: 950, clientY: 500 });
    fireEvent.pointerUp(surface, { clientX: 950, clientY: 500 });

    const toolbar = screen.getByTestId('canvas-visual-comment-toolbar');
    const toolbarContent = toolbar.querySelector('[data-slot="card-content"]');
    const note = screen.getByLabelText('Visual comment note');
    const sendButton = screen.getByRole('button', { name: 'Send to agent' });
    const addButton = screen.getByRole('button', { name: 'Add comment' });

    expect(screen.queryByRole('button', { name: 'Undo visual mark' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redo visual mark' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear visual marks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close mark up' })).toBeTruthy();
    expect(toolbar.className).toContain('rounded-[var(--project-radius-lg)]');
    expect(toolbar.className).toContain('shadow-[var(--project-shadow-popover)]');
    expect((toolbarContent as HTMLElement | null)?.style.padding).toBe('10px');
    expect(toolbarContent?.className).toContain('space-y-1.5');
    expect(toolbarContent?.className).not.toContain('px-2.5');
    expect(toolbarContent?.className).not.toContain('py-2');
    expect(toolbarContent?.className).not.toContain('p-3.5');
    expect(note.className).toContain('min-h-[56px]');
    expect(note.className).toContain('border-[var(--border-1)]');
    expect(note.className).not.toMatch(/(^|\s)(focus-visible:)?border-\[var\(--state-danger\)\]/);
    expect(sendButton.className).toContain('project-primary-button');
    expect(addButton.className).toContain('project-secondary-ghost-button');
  });

  it('lets the visual mark popup height follow the comment input height', () => {
    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-ui.svg'}
        onSend={vi.fn()}
      />,
    );

    const surface = screen.getByTestId('canvas-visual-comment-mark-surface');
    fireEvent.pointerDown(surface, { clientX: 450, clientY: 250 });
    fireEvent.pointerMove(surface, { clientX: 950, clientY: 500 });
    fireEvent.pointerUp(surface, { clientX: 950, clientY: 500 });

    const note = screen.getByLabelText('Visual comment note') as HTMLTextAreaElement;
    Object.defineProperty(note, 'scrollHeight', { configurable: true, value: 124 });

    fireEvent.change(note, { target: { value: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5' } });

    expect(note.style.height).toBe('124px');
    expect(note.className).toContain('max-h-[180px]');
    expect(note.className).toContain('overflow-y-auto');
  });

  it('keeps the visual comment popup inside the visible viewport', () => {
    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        viewportBounds={{ width: 520, height: 360, scrollLeft: 0, scrollTop: 0 }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-ui.svg'}
        onSend={vi.fn()}
      />,
    );

    const surface = screen.getByTestId('canvas-visual-comment-mark-surface');
    fireEvent.pointerDown(surface, { clientX: 900, clientY: 650 });
    fireEvent.pointerMove(surface, { clientX: 1060, clientY: 730 });
    fireEvent.pointerUp(surface, { clientX: 1060, clientY: 730 });

    const toolbar = screen.getByTestId('canvas-visual-comment-toolbar');
    expect(toolbar.style.left).toBe('calc(50% - 452px)');
    expect(toolbar.style.top).toBe('178px');
  });

  it('saves one visual mark and sends the next one directly', async () => {
    const onSend = vi.fn();
    const onSave = vi.fn<(_target: CanvasVisualCommentTarget, _note: string) => Promise<void>>(
      async () => undefined,
    );
    let uploadIndex = 0;
    const uploadScreenshot = vi.fn<(dataUrl: string) => Promise<string>>(async () => {
      uploadIndex += 1;
      return `screenshots/visual-${uploadIndex}.svg`;
    });

    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 0.5, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={uploadScreenshot}
        onSave={onSave}
        onSend={onSend}
      />,
    );

    const surface = screen.getByTestId('canvas-visual-comment-mark-surface');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 16,
      width: 640,
      height: 400,
      right: 740,
      bottom: 416,
      x: 100,
      y: 16,
      toJSON: () => ({}),
    } as DOMRect);

    expect(surface.style.left).toBe('50%');
    expect(surface.style.top).toBe('0px');
    expect(surface.style.width).toBe('1280px');
    expect(surface.style.height).toBe('800px');
    expect(surface.style.transform).toBe('translateX(-50%) scale(0.5)');
    expect(surface.style.transformOrigin).toBe('top center');
    expect(surface.style.visibility).toBe('visible');

    fireEvent.pointerDown(surface, { clientX: 116, clientY: 40 });
    fireEvent.pointerMove(surface, { clientX: 190, clientY: 81 });
    fireEvent.pointerUp(surface, { clientX: 190, clientY: 81 });
    fireEvent.change(screen.getByLabelText('Visual comment note'), { target: { value: 'Adjust this area' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('canvas-visual-comment-toolbar')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    expect(uploadScreenshot).toHaveBeenCalledOnce();

    fireEvent.pointerDown(surface, { clientX: 220, clientY: 140 });
    fireEvent.pointerMove(surface, { clientX: 310, clientY: 180 });
    fireEvent.pointerUp(surface, { clientX: 310, clientY: 180 });
    fireEvent.change(screen.getByLabelText('Visual comment note'), { target: { value: 'Adjust second area' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(uploadScreenshot).toHaveBeenCalledTimes(2);
    const compositedDataUrls = uploadScreenshot.mock.calls.map((call) => call[0]);
    expect(compositedDataUrls.every((dataUrl) => /^data:image\/svg\+xml;charset=utf-8,/.test(dataUrl))).toBe(true);
    expect(decodeURIComponent(compositedDataUrls[0]!.replace('data:image/svg+xml;charset=utf-8,', ''))).toContain('<rect');
    const [[savedTarget, savedNote]] = onSave.mock.calls;
    expect(savedTarget).toMatchObject({
      selectionKind: 'visual',
      filePath: 'landing.html',
      targetId: expect.stringMatching(/^visual-mark-/),
      selector: 'visual-mark',
      label: 'Marked region',
      text: '',
      position: { x: 32, y: 48, width: 148, height: 82 },
      htmlHint: '',
      markKind: 'click',
      screenshotPath: 'screenshots/visual-1.svg',
      intent: 'Adjust this area',
    });
    expect(savedNote).toBe('Adjust this area');
    const [[attachments]] = onSend.mock.calls as [[CanvasCommentAttachment[]]];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      source: 'visual-mark',
      selectionKind: 'visual',
      filePath: 'landing.html',
      order: 1,
      comment: 'Adjust second area',
      screenshotPath: 'screenshots/visual-2.svg',
      intent: 'Adjust second area',
    });
  });

  it('saves the current visual mark as a preview comment without sending it', async () => {
    const onSend = vi.fn();
    const onSave = vi.fn(async () => undefined);
    const uploadScreenshot = vi.fn<(dataUrl: string) => Promise<string>>(
      async () => 'screenshots/visual-save.svg',
    );

    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={uploadScreenshot}
        onSave={onSave}
        onSend={onSend}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 32, clientY: 48 });
    fireEvent.pointerMove(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 80, clientY: 92 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 80, clientY: 92 });
    fireEvent.change(screen.getByLabelText('Visual comment note'), { target: { value: 'Track this issue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'landing.html',
        targetId: expect.stringMatching(/^visual-mark-/),
        selector: 'visual-mark',
        label: 'Marked region',
        text: '',
        position: { x: 32, y: 48, width: 48, height: 44 },
        htmlHint: '',
        selectionKind: 'visual',
        markKind: 'click',
        screenshotPath: 'screenshots/visual-save.svg',
        intent: 'Track this issue',
      }),
      'Track this issue',
    );
    expect(uploadScreenshot).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-visual-comment-toolbar')).toBeNull();
  });

  it('uses box marks only before sending', async () => {
    const onSend = vi.fn();
    const uploadScreenshot = vi.fn<(dataUrl: string) => Promise<string>>(
      async () => 'screenshots/visual-box.svg',
    );

    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={uploadScreenshot}
        onSend={onSend}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 20, clientY: 24 });
    fireEvent.pointerMove(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 60, clientY: 64 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 90, clientY: 96 });
    expect(screen.getByTestId('canvas-visual-comment-mark-count').textContent).toContain('1 mark');
    expect(screen.queryByRole('button', { name: 'Pen mark tool' })).toBeNull();

    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 120, clientY: 124 });
    fireEvent.pointerMove(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 160, clientY: 164 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 190, clientY: 196 });
    expect(screen.getByTestId('canvas-visual-comment-mark-count').textContent).toContain('1 mark');

    fireEvent.change(screen.getByLabelText('Visual comment note'), { target: { value: 'Follow this sketch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    const [[attachments]] = onSend.mock.calls as [[CanvasCommentAttachment[]]];
    expect(attachments[0]).toMatchObject({
      selectionKind: 'visual',
      source: 'visual-mark',
      markKind: 'click',
      screenshotPath: 'screenshots/visual-box.svg',
      comment: 'Follow this sketch',
    });
    expect(uploadScreenshot.mock.calls[0]?.[0]).not.toBe('data:image/png;base64,c2NyZWVu');
  });

  it('clears visual marks before sending', () => {
    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-clear.svg'}
        onSend={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 32, clientY: 48 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 80, clientY: 92 });
    expect(screen.getByTestId('canvas-visual-comment-mark-count').textContent).toContain('1 mark');

    fireEvent.click(screen.getByRole('button', { name: 'Clear visual marks' }));

    expect(screen.queryByTestId('canvas-visual-comment-toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to agent' })).toBeNull();
  });

  it('does not send visual attachments when no screenshot upload is available', async () => {
    const onSend = vi.fn();

    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        onSend={onSend}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 32, clientY: 48 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 80, clientY: 92 });
    fireEvent.change(screen.getByLabelText('Visual comment note'), { target: { value: 'Adjust this area' } });

    expect((screen.getByRole('button', { name: 'Send to agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('serializes only the latest box mark', async () => {
    const onSend = vi.fn();

    render(
      <CanvasVisualCommentOverlay
        filePath="landing.html"
        frameLayout={{ width: 1280, height: 800, scale: 1, active: true }}
        requestScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,c2NyZWVu',
          width: 1280,
          height: 800,
        })}
        uploadScreenshot={async () => 'screenshots/visual-mixed.svg'}
        onSend={onSend}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 32, clientY: 48 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 80, clientY: 92 });
    fireEvent.pointerDown(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 20, clientY: 24 });
    fireEvent.pointerUp(screen.getByTestId('canvas-visual-comment-mark-surface'), { clientX: 90, clientY: 96 });
    fireEvent.change(screen.getByLabelText('Visual comment note'), { target: { value: 'Combine these changes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    const [[attachments]] = onSend.mock.calls as [[CanvasCommentAttachment[]]];
    expect(attachments[0]).toMatchObject({
      pagePosition: { x: 20, y: 24, width: 70, height: 72 },
      markKind: 'click',
    });
  });
});
