// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasPreview, resolveCanvasPreviewFrameSize, type CanvasPreviewFrameLayout } from './CanvasPreview';
import type { EditableNode } from './canvas-edit/types';
import type { CanvasCommentTargetSnapshot } from './canvas-comment/canvas-comment-types';
import type { WorkspaceFile } from './canvas-workspace-types';

function htmlFile(contents: string): WorkspaceFile {
  return {
    name: 'landing.html',
    path: 'landing.html',
    kind: 'html',
    mime: 'text/html',
    contents,
  };
}

function runtimeFiles(): WorkspaceFile[] {
  return [
    htmlFile('<!doctype html><html><body><div id="root"></div><script type="text/babel" src="app.jsx"></script></body></html>'),
    {
      name: 'app.jsx',
      path: 'app.jsx',
      kind: 'text',
      mime: 'text/javascript',
      contents: 'function App() { return <VDDesignCanvas />; }',
    },
  ];
}

function editableNode(overrides: Partial<EditableNode> = {}): EditableNode {
  return {
    id: 'hero-title',
    kind: 'text',
    label: 'Hero',
    tagName: 'h1',
    className: 'hero-title',
    text: 'Hero',
    rect: { x: 0, y: 0, width: 120, height: 32 },
    fields: { text: 'Hero' },
    attributes: { 'data-vd-id': 'hero-title' },
    styles: {},
    isLayoutContainer: false,
    depth: 0,
    classList: ['hero-title'],
    selector: 'h1.hero-title',
    editable: true,
    childCount: 0,
    ...overrides,
  };
}

function commentTarget(
  overrides: Partial<Omit<CanvasCommentTargetSnapshot, 'filePath'>> = {},
): Omit<CanvasCommentTargetSnapshot, 'filePath'> {
  return {
    targetId: 'hero',
    selector: '[data-vd-id="hero"]',
    label: 'Hero',
    text: 'Hero copy',
    position: { x: 1, y: 2, width: 120, height: 32 },
    htmlHint: '<main data-vd-id="hero">',
    selectionKind: 'element',
    ...overrides,
  };
}

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('CanvasPreview', () => {
  it('fits html previews into the canvas frame with a desktop viewport baseline', () => {
    render(<CanvasPreview file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')} />);

    const fit = screen.getByTestId('canvas-preview-fit');
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc');

    expect(fit.className).toContain('overflow-hidden');
    expect(fit.className).toContain('min-h-0');
    expect(srcdocFrame.style.width).toBe('1280px');
    expect(srcdocFrame.style.height).toBe('800px');
    expect(srcdocFrame.style.transform).toContain('scale(');
    expect(srcdocFrame.className).not.toContain('min-h-[560px]');
  });

  it('vertically centers fitted html previews when the fitted frame is shorter than the viewport', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('data-testid') === 'canvas-preview-fit') {
        return rect(1280, 1000);
      }

      return rect(0, 0);
    });

    try {
      render(<CanvasPreview file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')} />);

      await waitFor(() => {
        expect(screen.getByTestId('canvas-preview-srcdoc').style.top).toBe('100px');
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('uses manual scale without hiding overflow when an interaction mode owns scrolling', () => {
    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')}
        scaleMode="manual"
        manualScale={1.25}
      />,
    );

    const fit = screen.getByTestId('canvas-preview-fit');
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc');

    expect(fit.className).toContain('overflow-visible');
    expect(fit.className).not.toContain('overflow-hidden');
    expect(srcdocFrame.style.top).toBe('0px');
    expect(srcdocFrame.style.transform).toBe('translateX(-50%) scale(1.25)');
  });

  it('keeps fitted html previews at the desktop viewport while manual previews expand to the document size', () => {
    expect(
      resolveCanvasPreviewFrameSize({
        viewportWidth: 1280,
        viewportHeight: 800,
        scrollWidth: 1440,
        scrollHeight: 1800,
      }, 'fit'),
    ).toEqual({ width: 1280, height: 800 });

    expect(
      resolveCanvasPreviewFrameSize({
        viewportWidth: 1280,
        viewportHeight: 800,
        scrollWidth: 1440,
        scrollHeight: 1800,
      }, 'manual'),
    ).toEqual({ width: 1440, height: 1800 });
  });

  it('keeps fitted previews at the desktop viewport size when srcdoc content is taller', async () => {
    render(<CanvasPreview file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')} />);

    dispatchSrcdocMessage({ type: 'vd-preview-size', width: 1180, height: 1040 });

    await waitFor(() => {
      expect(screen.getByTestId('canvas-preview-srcdoc').style.height).toBe('800px');
    });
    expect(screen.getByTestId('canvas-preview-srcdoc').style.width).toBe('1280px');
  });

  it('updates the manual iframe size from srcdoc size bridge messages', async () => {
    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')}
        scaleMode="manual"
        manualScale={1}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-preview-size', width: 1440, height: 1040 });

    await waitFor(() => {
      expect(screen.getByTestId('canvas-preview-srcdoc').style.height).toBe('1040px');
      expect(screen.getByTestId('canvas-preview-srcdoc').style.width).toBe('1440px');
    });
  });

  it('does not repeatedly emit identical frame layout through inline callbacks', async () => {
    const onLayout = vi.fn();

    function InlineFrameLayoutHarness() {
      const [, setLayout] = React.useState<CanvasPreviewFrameLayout | null>(null);
      const [, setRevision] = React.useState(0);

      return (
        <div>
          <button type="button" onClick={() => setRevision((revision) => revision + 1)}>
            Rerender
          </button>
          <CanvasPreview
            file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')}
            onFrameLayoutChange={(layout) => {
              onLayout(layout);
              setLayout((currentLayout) => {
                if (
                  currentLayout
                  && currentLayout.width === layout.width
                  && currentLayout.height === layout.height
                  && currentLayout.scale === layout.scale
                  && currentLayout.active === layout.active
                ) {
                  return currentLayout;
                }

                return layout;
              });
            }}
          />
        </div>
      );
    }

    render(<InlineFrameLayoutHarness />);

    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Rerender' }));

    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1));
  });

  it('renders the srcdoc iframe when edit mode is enabled', () => {
    render(<CanvasPreview file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')} editMode />);

    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc');

    expect(srcdocFrame).toBeTruthy();
    expect(srcdocFrame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(srcdocFrame.getAttribute('srcdoc')).toContain('data-vd-edit-bridge');
    expect(srcdocFrame.getAttribute('style')).toContain('visibility: visible');
  });

  it('renders srcdoc and exposes a snapshot requester when edit mode is disabled and a file URL exists', () => {
    const onSnapshotRequesterChange = vi.fn();

    render(
      <CanvasPreview
        file={{ ...htmlFile('<main>Hero</main>'), url: '/raw/landing.html' }}
        editMode={false}
        onSnapshotRequesterChange={onSnapshotRequesterChange}
      />,
    );

    const urlFrame = screen.getByTestId('canvas-preview-url');
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc');
    const srcdoc = srcdocFrame.getAttribute('srcdoc') ?? '';

    expect(urlFrame.getAttribute('src')).toBeNull();
    expect(urlFrame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(urlFrame.getAttribute('style')).toContain('visibility: hidden');
    expect(srcdocFrame.getAttribute('style')).toContain('visibility: visible');
    expect(srcdoc).toContain('<main>Hero</main>');
    expect(srcdoc).toContain('data-vd-preview-snapshot-bridge');
    expect(onSnapshotRequesterChange).toHaveBeenCalledWith(expect.any(Function));
  });

  it('refreshes the srcdoc iframe when the file content changes without changing the file URL', () => {
    const originalFile: WorkspaceFile = {
      ...htmlFile('<main><h1 style="color: rgb(17, 24, 39)">Hero</h1></main>'),
      url: '/raw/landing.html',
      mtime: 1,
      updatedAt: 1,
      size: 60,
    };
    const { rerender } = render(<CanvasPreview file={originalFile} editMode={false} />);

    const originalSrcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';

    rerender(
      <CanvasPreview
        file={{
          ...originalFile,
          contents: '<main><h1 style="color: rgb(220, 38, 38)">Hero</h1></main>',
          mtime: 2,
          updatedAt: 2,
          size: 61,
        }}
        editMode={false}
      />,
    );

    const nextSrcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(nextSrcdoc).not.toBe(originalSrcdoc);
    expect(nextSrcdoc).toContain('rgb(220, 38, 38)');
  });

  it('exposes the snapshot requester for html srcdoc previews without comment mode', () => {
    const onSnapshotRequesterChange = vi.fn();

    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')}
        onSnapshotRequesterChange={onSnapshotRequesterChange}
      />,
    );

    const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<script data-vd-preview-snapshot-bridge');
    expect(onSnapshotRequesterChange).toHaveBeenCalledWith(expect.any(Function));
  });

  it('does not inject the snapshot bridge while inspecting html', () => {
    const onSnapshotRequesterChange = vi.fn();

    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')}
        editMode
        onSnapshotRequesterChange={onSnapshotRequesterChange}
      />,
    );

    const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).not.toContain('<script data-vd-preview-snapshot-bridge');
    expect(onSnapshotRequesterChange).toHaveBeenCalledWith(null);
  });

  it('inlines sibling JSX files into the active srcdoc preview', () => {
    const [entryFile, ...allFiles] = runtimeFiles();

    render(<CanvasPreview file={entryFile} files={[entryFile, ...allFiles]} />);

    const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('data-vd-source="app.jsx"');
    expect(srcdoc).toContain('function App()');
    expect(srcdoc).not.toContain('src="app.jsx"');
  });

  it('injects an anchor navigation blocker into srcdoc previews', () => {
    render(
      <CanvasPreview
        file={htmlFile('<main><a href="about.html">About</a></main>')}
        files={[
          htmlFile('<main><a href="about.html">About</a></main>'),
          {
            name: 'about.html',
            path: 'about.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main>About</main>',
          },
        ]}
      />,
    );

    const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('data-vd-preview-navigation-bridge');
    expect(srcdoc).toContain('event.preventDefault();');
    expect(srcdoc).not.toContain("window.parent.postMessage({ type: 'vd-preview-navigate'");
  });

  it('uses the srcdoc runtime when full runtime files exist even if the file has a URL', () => {
    const [entryFile, ...allFiles] = runtimeFiles();

    render(
      <CanvasPreview
        file={{ ...entryFile, url: '/api/projects/demo/files/index.html' }}
        files={[entryFile, ...allFiles]}
        editMode={false}
      />,
    );

    const urlFrame = screen.getByTestId('canvas-preview-url');
    expect(urlFrame.getAttribute('src')).toBeNull();
    expect(urlFrame.getAttribute('style')).toContain('visibility: hidden');

    const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('data-vd-source="app.jsx"');
    expect(srcdoc).toContain('function App()');
  });

  it('uses srcdoc with the comment bridge when comment mode is active even if the html file has a URL', () => {
    render(
      <CanvasPreview
        file={{ ...htmlFile('<main data-vd-id="hero">Hero</main>'), url: '/raw/landing.html' }}
        commentMode
      />,
    );

    const urlFrame = screen.getByTestId('canvas-preview-url');
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc');
    const srcdoc = srcdocFrame.getAttribute('srcdoc') ?? '';

    expect(urlFrame.getAttribute('src')).toBeNull();
    expect(urlFrame.getAttribute('style')).toContain('visibility: hidden');
    expect(srcdocFrame.getAttribute('style')).toContain('visibility: visible');
    expect(srcdoc).toContain('data-vd-comment-bridge');
    expect(srcdoc).toContain('data-vd-preview-snapshot-bridge');
    expect(srcdoc).toContain('vd-comment-mode');
    expect(srcdoc).toContain('<main data-vd-id="hero">Hero</main>');
  });

  it('applies a vd-edit-text-commit message back into the current HTML', () => {
    const onHtmlChange = vi.fn();
    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Old title</h1></main>')}
        editMode
        onHtmlChange={onHtmlChange}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-edit-text-commit', id: 'hero-title', value: 'New title' });

    expect(onHtmlChange).toHaveBeenCalledWith('<main><h1 data-vd-id="hero-title">New title</h1></main>');
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('New title');
  });

  it('forwards hover and select bridge messages to the provided callbacks', () => {
    const onHoveredTargetChange = vi.fn();
    const onSelectedTargetChange = vi.fn();
    const hoverTarget = editableNode({ id: 'hover-title', label: 'Hover title' });
    const selectedTarget = editableNode({ id: 'selected-title', label: 'Selected title' });

    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Hero</h1></main>')}
        editMode
        onHoveredTargetChange={onHoveredTargetChange}
        onSelectedTargetChange={onSelectedTargetChange}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-edit-hover', target: hoverTarget });
    dispatchSrcdocMessage({ type: 'vd-edit-select', target: selectedTarget });
    dispatchSrcdocMessage({ type: 'vd-edit-hover', target: null });
    dispatchSrcdocMessage({ type: 'vd-edit-select', target: null });

    expect(onHoveredTargetChange).toHaveBeenNthCalledWith(1, hoverTarget);
    expect(onHoveredTargetChange).toHaveBeenNthCalledWith(2, null);
    expect(onSelectedTargetChange).toHaveBeenNthCalledWith(1, selectedTarget);
    expect(onSelectedTargetChange).toHaveBeenNthCalledWith(2, null);
  });

  it('forwards editable target inventory messages to the provided callback', () => {
    const onTargetsChange = vi.fn();
    const targets = [
      editableNode({ id: 'hero-title', label: 'Hero title' }),
      editableNode({ id: 'hero-copy', label: 'Hero copy', tagName: 'p' }),
    ];

    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Hero</h1><p data-vd-id="hero-copy">Copy</p></main>')}
        editMode
        onTargetsChange={onTargetsChange}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-edit-targets', targets });

    expect(onTargetsChange).toHaveBeenCalledWith(targets);
  });

  it('posts selected-target and preview-style commands to the srcdoc iframe', () => {
    const { rerender } = render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Hero</h1></main>')}
        editMode
        selectedTargetId={null}
        stylePreview={null}
      />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');

    rerender(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Hero</h1></main>')}
        editMode
        selectedTargetId="hero-title"
        stylePreview={{ id: 'hero-title', styles: { color: '#111111', 'font-size': '18px' } }}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-edit-selected-target', id: 'hero-title' }, '*');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'vd-edit-preview-style', id: 'hero-title', styles: { color: '#111111', 'font-size': '18px' } },
      '*',
    );
  });

  it('posts preview-text commands to the srcdoc iframe', () => {
    const { rerender } = render(
      <CanvasPreview
        file={htmlFile('<main><p data-vd-id="hero-copy">Old copy</p></main>')}
        editMode
        selectedTargetId="hero-copy"
        textPreview={null}
      />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');

    rerender(
      <CanvasPreview
        file={htmlFile('<main><p data-vd-id="hero-copy">Old copy</p></main>')}
        editMode
        selectedTargetId="hero-copy"
        textPreview={{ id: 'hero-copy', text: 'Draft copy' }}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'vd-edit-preview-text', id: 'hero-copy', value: 'Draft copy' },
      '*',
    );

    postMessage.mockClear();

    rerender(
      <CanvasPreview
        file={htmlFile('<main><p data-vd-id="hero-copy">Old copy</p></main>')}
        editMode
        selectedTargetId="hero-copy"
        textPreview={null}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-edit-preview-text-reset', id: 'hero-copy' }, '*');
  });

  it('posts theme preview commands to the srcdoc iframe', () => {
    const { rerender } = render(
      <CanvasPreview file={htmlFile('<main><h1>Hero</h1></main>')} editMode previewTheme="light" />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');

    rerender(<CanvasPreview file={htmlFile('<main><h1>Hero</h1></main>')} editMode previewTheme="dark" />);

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-edit-theme', theme: 'dark' }, '*');

    postMessage.mockClear();
    fireEvent.load(srcdocFrame);

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-edit-theme', theme: 'dark' }, '*');
  });

  it('posts comment mode and active target commands to the srcdoc iframe and replays them on load', () => {
    const { rerender } = render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        commentMode
        commentTool="picker"
        activeCommentTargetId={null}
      />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');

    rerender(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        commentMode
        commentTool="pod"
        activeCommentTargetId="hero"
      />,
    );

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-comment-mode', enabled: true, mode: 'pod' }, '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-comment-active-target', targetId: 'hero' }, '*');

    postMessage.mockClear();
    fireEvent.load(srcdocFrame);

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-comment-mode', enabled: true, mode: 'pod' }, '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-comment-active-target', targetId: 'hero' }, '*');
  });

  it('forwards design runtime ready and tweak change messages to the provided callbacks', () => {
    const onDesignRuntimeReady = vi.fn();
    const onDesignTweaksChange = vi.fn();

    render(
      <CanvasPreview
        file={htmlFile('<main>Hero</main>')}
        onDesignRuntimeReady={onDesignRuntimeReady}
        onDesignTweaksChange={onDesignTweaksChange}
      />,
    );

    dispatchSrcdocMessage({
      type: 'vd-design-runtime-ready',
      entryPath: 'index.html',
      sourcePath: 'app.jsx',
      tweakDefaults: { primaryColor: '#F26B3F' },
    });
    dispatchSrcdocMessage({
      type: 'vd-design-tweak-changed',
      entryPath: 'index.html',
      sourcePath: 'app.jsx',
      key: 'primaryColor',
      value: '#111111',
      tweaks: { primaryColor: '#111111' },
    });

    expect(onDesignRuntimeReady).toHaveBeenCalledWith({
      entryPath: 'index.html',
      sourcePath: 'app.jsx',
      tweakDefaults: { primaryColor: '#F26B3F' },
    });
    expect(onDesignTweaksChange).toHaveBeenCalledWith({
      entryPath: 'index.html',
      sourcePath: 'app.jsx',
      key: 'primaryColor',
      value: '#111111',
      tweaks: { primaryColor: '#111111' },
    });
  });

  it('posts design tweak commands to the srcdoc iframe', () => {
    const { rerender } = render(
      <CanvasPreview file={htmlFile('<main>Hero</main>')} designTweakCommand={null} />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');

    rerender(
      <CanvasPreview
        file={htmlFile('<main>Hero</main>')}
        designTweakCommand={{ key: 'primaryColor', value: '#111111', version: 1 }}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-design-tweak-set', key: 'primaryColor', value: '#111111' }, '*');
  });

  it('does not post comment commands for ordinary srcdoc previews', () => {
    const { rerender } = render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        activeCommentTargetId={null}
      />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');

    rerender(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        activeCommentTargetId="hero"
      />,
    );
    fireEvent.load(srcdocFrame);

    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'vd-comment-mode' }), '*');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'vd-comment-active-target' }), '*');
  });

  it('replays selected-target and preview-style commands when the srcdoc iframe loads', () => {
    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Hero</h1></main>')}
        editMode
        selectedTargetId="hero-title"
        stylePreview={{ id: 'hero-title', styles: { color: '#111111' } }}
      />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');

    fireEvent.load(srcdocFrame);

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-edit-selected-target', id: 'hero-title' }, '*');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'vd-edit-preview-style', id: 'hero-title', styles: { color: '#111111' } },
      '*',
    );
  });

  it('resets the previous preview style before clearing it', () => {
    const { rerender } = render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Hero</h1></main>')}
        editMode
        selectedTargetId="hero-title"
        stylePreview={{ id: 'hero-title', styles: { color: '#111111' } }}
      />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');
    postMessage.mockClear();

    rerender(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Hero</h1></main>')}
        editMode
        selectedTargetId="hero-title"
        stylePreview={null}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith({ type: 'vd-edit-preview-style-reset', id: 'hero-title' }, '*');
  });

  it('replays selected-target and preview-style commands after a text commit rebuilds srcdoc HTML', async () => {
    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Old title</h1></main>')}
        editMode
        selectedTargetId="hero-title"
        stylePreview={{ id: 'hero-title', styles: { color: '#111111' } }}
      />,
    );
    const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
    const postMessage = vi.spyOn(srcdocFrame.contentWindow!, 'postMessage');
    postMessage.mockClear();

    dispatchSrcdocMessage({ type: 'vd-edit-text-commit', id: 'hero-title', value: 'New title' });

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({ type: 'vd-edit-selected-target', id: 'hero-title' }, '*');
    });
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'vd-edit-preview-style', id: 'hero-title', styles: { color: '#111111' } },
      '*',
    );
  });

  it('ignores bridge-shaped messages from unrelated windows', () => {
    const onHtmlChange = vi.fn();
    const onHoveredTargetChange = vi.fn();
    const onSelectedTargetChange = vi.fn();
    const hoverTarget = editableNode({ id: 'hover-title', label: 'Hover title' });
    const selectedTarget = editableNode({ id: 'selected-title', label: 'Selected title' });

    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Old title</h1></main>')}
        editMode
        onHtmlChange={onHtmlChange}
        onHoveredTargetChange={onHoveredTargetChange}
        onSelectedTargetChange={onSelectedTargetChange}
      />,
    );

    dispatchWindowMessage({ type: 'vd-edit-hover', target: hoverTarget }, window);
    dispatchWindowMessage({ type: 'vd-edit-select', target: selectedTarget }, window);
    dispatchWindowMessage({ type: 'vd-edit-text-commit', id: 'hero-title', value: 'New title' }, window);

    expect(onHoveredTargetChange).not.toHaveBeenCalled();
    expect(onSelectedTargetChange).not.toHaveBeenCalled();
    expect(onHtmlChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('Old title');
  });

  it('forwards comment target messages with the host file path', () => {
    const onCommentTargetsChange = vi.fn();
    const onCommentHoverChange = vi.fn();
    const onCommentSelect = vi.fn();
    const target = commentTarget();

    render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        commentMode
        onCommentTargetsChange={onCommentTargetsChange}
        onCommentHoverChange={onCommentHoverChange}
        onCommentSelect={onCommentSelect}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-comment-targets', targets: [target] });
    dispatchSrcdocMessage({ type: 'vd-comment-hover', target });
    dispatchSrcdocMessage({ type: 'vd-comment-leave', target });
    dispatchSrcdocMessage({ type: 'vd-comment-select', target });

    expect(onCommentTargetsChange).toHaveBeenCalledWith([{ ...target, filePath: 'landing.html' }]);
    expect(onCommentHoverChange).toHaveBeenNthCalledWith(1, { ...target, filePath: 'landing.html' });
    expect(onCommentHoverChange).toHaveBeenNthCalledWith(2, null);
    expect(onCommentSelect).toHaveBeenCalledWith({ ...target, filePath: 'landing.html' });
  });

  it('forwards pod stroke points and select targets with the host file path', () => {
    const onCommentPodStroke = vi.fn();
    const onCommentPodSelect = vi.fn();
    const points = [{ x: 1, y: 2 }, { x: 8, y: 13 }];
    const podTarget = commentTarget({
      selectionKind: 'pod',
      targetId: 'pod:1-2_8-13',
      selector: 'pod',
      label: 'Pod: Hero',
      memberCount: 1,
      podMembers: [
        {
          targetId: 'hero',
          selector: '[data-vd-id="hero"]',
          label: 'Hero',
          text: 'Hero copy',
          position: { x: 1, y: 2, width: 120, height: 32 },
          htmlHint: '<main data-vd-id="hero">',
        },
      ],
    });

    render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        commentMode
        onCommentPodStroke={onCommentPodStroke}
        onCommentPodSelect={onCommentPodSelect}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-comment-pod-stroke', points });
    dispatchSrcdocMessage({ type: 'vd-comment-pod-select', points, target: podTarget });

    expect(onCommentPodStroke).toHaveBeenCalledWith(points);
    expect(onCommentPodSelect).toHaveBeenCalledWith(points, { ...podTarget, filePath: 'landing.html' });
  });

  it('ignores comment-shaped messages from unrelated windows', () => {
    const onCommentTargetsChange = vi.fn();
    const onCommentHoverChange = vi.fn();
    const onCommentSelect = vi.fn();
    const onCommentPodStroke = vi.fn();
    const onCommentPodSelect = vi.fn();
    const target = commentTarget();
    const points = [{ x: 1, y: 2 }];

    render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        commentMode
        onCommentTargetsChange={onCommentTargetsChange}
        onCommentHoverChange={onCommentHoverChange}
        onCommentSelect={onCommentSelect}
        onCommentPodStroke={onCommentPodStroke}
        onCommentPodSelect={onCommentPodSelect}
      />,
    );

    dispatchWindowMessage({ type: 'vd-comment-targets', targets: [target] }, window);
    dispatchWindowMessage({ type: 'vd-comment-hover', target }, window);
    dispatchWindowMessage({ type: 'vd-comment-select', target }, window);
    dispatchWindowMessage({ type: 'vd-comment-pod-stroke', points }, window);
    dispatchWindowMessage({ type: 'vd-comment-pod-select', points }, window);

    expect(onCommentTargetsChange).not.toHaveBeenCalled();
    expect(onCommentHoverChange).not.toHaveBeenCalled();
    expect(onCommentSelect).not.toHaveBeenCalled();
    expect(onCommentPodStroke).not.toHaveBeenCalled();
    expect(onCommentPodSelect).not.toHaveBeenCalled();
  });

  it('ignores same-frame comment messages when comment mode is disabled', () => {
    const onCommentTargetsChange = vi.fn();
    const onCommentHoverChange = vi.fn();
    const onCommentSelect = vi.fn();
    const onCommentPodStroke = vi.fn();
    const onCommentPodSelect = vi.fn();
    const target = commentTarget();
    const points = [{ x: 1, y: 2 }];

    render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        onCommentTargetsChange={onCommentTargetsChange}
        onCommentHoverChange={onCommentHoverChange}
        onCommentSelect={onCommentSelect}
        onCommentPodStroke={onCommentPodStroke}
        onCommentPodSelect={onCommentPodSelect}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-comment-targets', targets: [target] });
    dispatchSrcdocMessage({ type: 'vd-comment-hover', target });
    dispatchSrcdocMessage({ type: 'vd-comment-select', target });
    dispatchSrcdocMessage({ type: 'vd-comment-pod-stroke', points });
    dispatchSrcdocMessage({ type: 'vd-comment-pod-select', points });

    expect(onCommentTargetsChange).not.toHaveBeenCalled();
    expect(onCommentHoverChange).not.toHaveBeenCalled();
    expect(onCommentSelect).not.toHaveBeenCalled();
    expect(onCommentPodStroke).not.toHaveBeenCalled();
    expect(onCommentPodSelect).not.toHaveBeenCalled();
  });

  it('ignores malformed same-frame bridge messages without throwing', () => {
    const onCommentTargetsChange = vi.fn();
    const onCommentHoverChange = vi.fn();
    const onCommentPodStroke = vi.fn();
    const onTargetsChange = vi.fn();
    const onHtmlChange = vi.fn();

    render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        editMode
        commentMode
        onCommentTargetsChange={onCommentTargetsChange}
        onCommentHoverChange={onCommentHoverChange}
        onCommentPodStroke={onCommentPodStroke}
        onTargetsChange={onTargetsChange}
        onHtmlChange={onHtmlChange}
      />,
    );

    expect(() => {
      dispatchSrcdocMessage({ type: 'vd-comment-targets', targets: null });
      dispatchSrcdocMessage({ type: 'vd-comment-hover', target: null });
      dispatchSrcdocMessage({ type: 'vd-comment-pod-stroke', points: null });
      dispatchSrcdocMessage({ type: 'vd-edit-targets', targets: null });
      dispatchSrcdocMessage({ type: 'vd-edit-text-commit', id: null, value: null });
    }).not.toThrow();

    expect(onCommentTargetsChange).not.toHaveBeenCalled();
    expect(onCommentHoverChange).not.toHaveBeenCalled();
    expect(onCommentPodStroke).not.toHaveBeenCalled();
    expect(onTargetsChange).not.toHaveBeenCalled();
    expect(onHtmlChange).not.toHaveBeenCalled();
  });

  it('ignores comment target messages with invalid target snapshots', () => {
    const onCommentTargetsChange = vi.fn();
    const onCommentSelect = vi.fn();

    render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        commentMode
        onCommentTargetsChange={onCommentTargetsChange}
        onCommentSelect={onCommentSelect}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-comment-select', target: {} });
    dispatchSrcdocMessage({ type: 'vd-comment-targets', targets: [commentTarget(), {}] });
    dispatchSrcdocMessage({
      type: 'vd-comment-select',
      target: { ...commentTarget(), selectionKind: 'visual' },
    });

    expect(onCommentSelect).not.toHaveBeenCalled();
    expect(onCommentTargetsChange).not.toHaveBeenCalled();
  });

  it('forwards valid pod target messages with valid pod members', () => {
    const onCommentSelect = vi.fn();
    const podMember = {
      targetId: 'member-title',
      selector: '[data-vd-id="member-title"]',
      label: 'Member title',
      text: 'Member copy',
      position: { x: 2, y: 4, width: 80, height: 20 },
      htmlHint: '<h1 data-vd-id="member-title">',
    };
    const podTarget = commentTarget({
      selectionKind: 'pod',
      targetId: 'pod:1-2_8-13',
      selector: 'pod',
      label: 'Pod selection',
      memberCount: 1,
      podMembers: [podMember],
    });

    render(
      <CanvasPreview
        file={htmlFile('<main data-vd-id="hero">Hero</main>')}
        commentMode
        onCommentSelect={onCommentSelect}
      />,
    );

    dispatchSrcdocMessage({ type: 'vd-comment-select', target: podTarget });

    expect(onCommentSelect).toHaveBeenCalledWith({ ...podTarget, filePath: 'landing.html' });
  });

  it('renders non-html files as a text preview', () => {
    render(
      <CanvasPreview
        file={{
          name: 'notes.txt',
          path: 'notes.txt',
          kind: 'text',
          mime: 'text/plain',
          contents: 'Warm neutrals + graphite accents',
        }}
      />,
    );

    expect(screen.getByTestId('canvas-preview-text').textContent).toBe('Warm neutrals + graphite accents');
  });

  it('renders image files as an image preview', () => {
    render(
      <CanvasPreview
        file={{
          name: 'hero.png',
          path: 'hero.png',
          kind: 'image',
          mime: 'image/png',
          url: '/api/projects/demo-project/files/hero.png',
          contents: 'PNG source should not render as text',
        }}
      />,
    );

    const image = screen.getByTestId('canvas-preview-image') as HTMLImageElement;

    expect(screen.getByTestId('canvas-preview-image-root').className).toContain('overflow-hidden');
    expect(screen.getByTestId('canvas-preview-image-root').className).toContain('min-h-0');
    expect(image.getAttribute('src')).toBe('/api/projects/demo-project/files/hero.png');
    expect(image.getAttribute('alt')).toBe('hero.png');
    expect(image.className).toContain('absolute');
    expect(image.className).toContain('inset-0');
    expect(image.className).toContain('h-full');
    expect(image.className).toContain('w-full');
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
    expect(screen.queryByTestId('canvas-preview-text')).toBeNull();
  });

  it('renders svg images as a document preview so nested svg image references are preserved', () => {
    render(
      <CanvasPreview
        file={{
          name: 'cover.svg',
          path: 'cover.svg',
          kind: 'image',
          mime: 'image/svg+xml; charset=utf-8',
          url: '/api/projects/demo-project/files/cover.svg',
        }}
      />,
    );

    const frame = screen.getByTestId('canvas-preview-svg') as HTMLIFrameElement;

    expect(frame.getAttribute('src')).toBe('/api/projects/demo-project/files/cover.svg');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(screen.queryByTestId('canvas-preview-image')).toBeNull();
    expect(screen.queryByTestId('canvas-preview-text')).toBeNull();
  });

  it('renders image file contents as a data URL when no file URL exists', () => {
    render(
      <CanvasPreview
        file={{
          name: 'hero.png',
          path: 'hero.png',
          kind: 'image',
          mime: 'image/png',
          contents: 'image-bytes',
        }}
      />,
    );

    expect(screen.getByTestId('canvas-preview-image').getAttribute('src')).toBe('data:image/png;base64,aW1hZ2UtYnl0ZXM=');
    expect(screen.queryByTestId('canvas-preview-text')).toBeNull();
  });
});

function dispatchSrcdocMessage(data: unknown) {
  const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
  const source = srcdocFrame.contentWindow;

  if (!source) {
    throw new Error('Expected jsdom to create an iframe contentWindow');
  }

  dispatchWindowMessage(data, source);
}

function dispatchWindowMessage(data: unknown, source: MessageEventSource | null) {
  fireEvent(
    window,
    new MessageEvent('message', {
      data,
      source,
    }),
  );
}
