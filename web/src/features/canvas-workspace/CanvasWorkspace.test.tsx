// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasWorkspace, resolveHtmlDesignPreviewSize } from './CanvasWorkspace';
import type { CanvasCommentAttachment, CanvasPreviewComment } from './canvas-comment/canvas-comment-types';
import type { EditableNode } from './canvas-edit/types';
import type { WorkspaceFile, WorkspaceTabsState } from './canvas-workspace-types';

const files: WorkspaceFile[] = [
  {
    name: 'landing.html',
    path: 'landing.html',
    kind: 'html',
    mime: 'text/html',
    contents: '<main><h1 data-vd-id="hero">Hero</h1></main>',
  },
  {
    name: 'notes.txt',
    path: 'notes.txt',
    kind: 'text',
    mime: 'text/plain',
    contents: 'Notes',
  },
];

const runtimeFiles: WorkspaceFile[] = [
  {
    name: 'index.html',
    path: 'index.html',
    kind: 'html',
    mime: 'text/html',
    contents:
      '<!doctype html><html><body><div id="root"></div><script type="text/babel" src="app.jsx"></script></body></html>',
  },
  {
    name: 'app.jsx',
    path: 'app.jsx',
    kind: 'text',
    mime: 'text/javascript',
    contents: 'function App() { return <VDDesignCanvas />; }',
  },
];

const tweakRuntimeFiles: WorkspaceFile[] = [
  {
    name: 'index.html',
    path: 'index.html',
    kind: 'html',
    mime: 'text/html',
    url: '/api/projects/project-1/files/index.html',
    contents:
      '<!doctype html><html><body><div id="root"></div><script type="text/babel" src="app.jsx"></script></body></html>',
  },
  {
    name: 'app.jsx',
    path: 'app.jsx',
    kind: 'text',
    mime: 'text/javascript',
    contents: `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "primaryColor": "#F26B3F",
  "dark": false
}/*EDITMODE-END*/;
function App() { const [t] = useVDTweaks(TWEAK_DEFAULTS); return <main>{t.primaryColor}</main>; }`,
  },
];

const selectedTarget: EditableNode = {
  id: 'hero',
  kind: 'text',
  label: 'Hero Heading',
  tagName: 'h1',
  className: '',
  text: 'Hero',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  fields: { text: 'Hero' },
  attributes: { 'data-vd-id': 'hero' },
  styles: {},
  isLayoutContainer: false,
  depth: 0,
  classList: [],
  selector: 'h1',
  editable: true,
  childCount: 0,
};

const commentTarget = {
  targetId: 'hero',
  selector: '[data-vd-id="hero"]',
  label: 'main',
  text: 'Hero',
  position: { x: 10, y: 20, width: 100, height: 40 },
  htmlHint: '<main data-vd-id="hero">',
};

const podCommentTarget = {
  ...commentTarget,
  targetId: 'pod:10-20_220-120',
  selector: 'pod',
  label: 'Pod: main, CTA',
  text: 'Hero CTA',
  position: { x: 10, y: 20, width: 210, height: 100 },
  htmlHint: '<main data-vd-id="hero"><button>CTA</button></main>',
  selectionKind: 'pod' as const,
  memberCount: 2,
  podMembers: [
    {
      targetId: 'hero-title',
      selector: '[data-vd-id="hero-title"]',
      label: 'Hero title',
      text: 'Hero',
      position: { x: 20, y: 24, width: 120, height: 32 },
      htmlHint: '<h1 data-vd-id="hero-title">Hero</h1>',
    },
    {
      targetId: 'hero-cta',
      selector: '[data-vd-id="hero-cta"]',
      label: 'Hero CTA',
      text: 'Start',
      position: { x: 24, y: 72, width: 80, height: 28 },
      htmlHint: '<button data-vd-id="hero-cta">Start</button>',
    },
  ],
};

function previewComment(overrides: Partial<CanvasPreviewComment> = {}): CanvasPreviewComment {
  const comment: CanvasPreviewComment = {
    id: 'comment-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    filePath: 'landing.html',
    targetId: 'hero',
    selector: '[data-vd-id="hero"]',
    label: 'main',
    text: 'Hero',
    position: { x: 10, y: 20, width: 100, height: 40 },
    htmlHint: '<main data-vd-id="hero">',
    selectionKind: 'element',
    note: 'Tighten this section',
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...comment, ...overrides } as CanvasPreviewComment;
}

function openDesignFile(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }));
}

describe('CanvasWorkspace', () => {
  it('renders an empty canvas by default when the project has no design files', () => {
    render(<CanvasWorkspace files={[]} />);

    expect(screen.getByRole('tab', { name: 'Design Files' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByText('Canvas')).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.queryByTestId('canvas-header-title')).toBeNull();
    expect(screen.queryByLabelText('Design files')).toBeNull();
    expect(screen.getByTestId('canvas-workspace-empty').textContent).toContain('No files yet.');
    expect(screen.getByText('No files yet')).toBeTruthy();
    expect(screen.getByText('Generated pages and assets will appear here after the first design run.')).toBeTruthy();
    expect(screen.queryByText('Start with context')).toBeNull();
    expect(screen.getByTestId('canvas-empty-card').className).toContain('rounded-[var(--project-radius-dialog)]');
    expect(screen.getByTestId('canvas-empty-card').className).toContain('border-[var(--border-1)]');
    expect(screen.getByTestId('canvas-empty-card').className).toContain('bg-[var(--background-fronted)]');
    expect(screen.getByTestId('canvas-empty-card').parentElement?.className).toContain('bg-[var(--project-workspace-bg)]');
    expect(screen.getByTestId('canvas-empty-card').parentElement?.className).toContain('pb-3');
    expect(screen.getByTestId('canvas-empty-card').parentElement?.className).toContain('pr-3');
    expect(screen.getByTestId('canvas-empty-card').parentElement?.className).not.toContain('pt-3');
    expect(document.body.querySelector('img[src="/assets/brand/vibedesign.png"]')).toBeTruthy();
    expect(screen.queryByText('Design System')).toBeNull();
    expect(screen.queryByText('Add screenshot')).toBeNull();
    expect(screen.queryByText('Attach codebase')).toBeNull();
    expect(screen.queryByText('Drag in a Figma file')).toBeNull();
  });

  it('opens the Design Files surface from the empty canvas', () => {
    render(<CanvasWorkspace files={[]} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));

    expect(screen.getByTestId('design-files-surface')).toBeTruthy();
    expect(screen.getByTestId('design-files-surface').parentElement?.className).toContain('bg-[var(--project-workspace-bg)]');
    expect(screen.getByTestId('design-files-surface').className).toContain('bg-[var(--background-fronted)]');
    expect(screen.getByRole('tab', { name: 'Design Files' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Start with context')).toBeNull();
    expect(screen.queryByLabelText('Select tool')).toBeNull();
    expect(screen.getByLabelText('Design files')).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Design file navigation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Up one level' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New sketch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'project' })).toBeNull();
    expect(screen.getByText('FOLDERS')).toBeTruthy();
    expect(screen.getByText('PAGES')).toBeTruthy();
    expect(screen.getByText('COMPONENTS')).toBeTruthy();
    expect(screen.getByLabelText('Design files').closest('section')?.className).toContain('bg-[var(--background-fronted)]');
    expect(screen.queryByText('OTHER RESOURCES')).toBeNull();
    expect(screen.getAllByText('No files')).toHaveLength(3);
    expect(screen.queryByText('DROP FILES HERE')).toBeNull();
    expect(screen.queryByText('Images, docs, references, Figma links, or folders - Claude will use them as context.')).toBeNull();
    expect(screen.getByText('Select a design file')).toBeTruthy();
    expect(screen.getByText('Select a design file').closest('aside')?.className).toContain('bg-[var(--background-fronted)]');
    expect(screen.queryByText('Empty canvas')).toBeNull();
    expect(screen.getByTestId('canvas-workspace-empty').textContent).toContain('Choose a file to preview.');
  });

  it('renders the Design Files surface by default when files are available', () => {
    render(<CanvasWorkspace files={files} />);

    expect(screen.getByRole('tab', { name: 'Design Files' })).toBeTruthy();
    expect(screen.getByLabelText('Design files')).toBeTruthy();
    expect(screen.getByText('FOLDERS')).toBeTruthy();
    expect(screen.getByText('PAGES')).toBeTruthy();
    expect(screen.getByText('COMPONENTS')).toBeTruthy();
    expect(screen.queryByText('OTHER RESOURCES')).toBeNull();
    expect(screen.getByRole('button', { name: 'notes.txt' }).textContent).toContain('Text file');
    expect(screen.queryByText('Canvas')).toBeNull();
    expect(screen.getByTestId('canvas-workspace-empty').textContent).toContain('Choose a file to preview.');
  });

  it('resizes the design files list and preview panes by dragging the separator', () => {
    render(<CanvasWorkspace files={files} />);

    const surface = screen.getByTestId('design-files-surface');
    const separator = screen.getByRole('separator', { name: 'Resize design files preview' });

    expect(screen.getByTestId('design-files-body').style.gridTemplateColumns).toContain('560px 1px');
    expect(surface.className).not.toContain('grid-rows-[minmax(0,1fr)_44px]');
    expect(surface.className).toContain('h-full');
    expect(surface.parentElement?.className).toContain('pb-3');
    expect(surface.parentElement?.className).toContain('pr-3');
    expect(surface.className).toContain('rounded-[var(--project-radius-dialog)]');
    expect(surface.className).toContain('border-[var(--border-1)]');
    expect(surface.className).toContain('border');
    expect(surface.className).not.toContain('border-t-transparent');
    expect(surface.className).toContain('shadow-none');

    fireEvent.pointerDown(separator, { clientX: 560 });
    fireEvent.pointerMove(window, { clientX: 700 });
    fireEvent.pointerUp(window);

    expect(screen.getByTestId('design-files-body').style.gridTemplateColumns).toContain('700px 1px');
  });

  it('splits the design files list and preview panes evenly in compact widths', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === 'design-files-surface') {
        return { width: 1100, height: 600, top: 0, left: 0, right: 1100, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };
      }

      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    try {
      render(<CanvasWorkspace files={files} />);

      expect(screen.getByTestId('design-files-body').style.gridTemplateColumns).toBe('minmax(0, 1fr) 1px minmax(0, 1fr)');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('does not render the removed file toolbar actions in the Design Files surface', () => {
    render(<CanvasWorkspace files={files} />);

    expect(screen.queryByLabelText('Upload files')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Design file navigation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Up one level' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New sketch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
  });

  it('matches Claude Design typography in the Design Files list and empty preview', () => {
    render(<CanvasWorkspace files={[]} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));

    const sectionLabelClassName = screen.getByText('FOLDERS').className;
    expect(screen.getByLabelText('Design files').className).toContain('pt-3');
    expect(sectionLabelClassName).toContain('text-[10px]');
    expect(sectionLabelClassName).toContain('tracking-[0.14em]');
    expect(sectionLabelClassName).toContain('px-3');
    expect(sectionLabelClassName).toContain('py-0');
    expect(sectionLabelClassName).not.toContain('bg-');
    expect(sectionLabelClassName).not.toContain('border-b');
    expect(screen.getByText('FOLDERS').closest('section')?.className).not.toContain('border-t');
    expect(screen.getByText('PAGES').closest('section')?.className).toContain('border-t');
    expect(screen.getByText('PAGES').closest('section')?.className).toContain('pt-3');
    expect(screen.getByText('COMPONENTS').closest('section')?.className).toContain('border-t');
    expect(screen.getByText('COMPONENTS').closest('section')?.className).toContain('pt-3');
    expect(screen.getAllByText('No files')[0].className).toContain('text-[11px]');
    expect(screen.getAllByText('No files')[0].className).toContain('leading-[32px]');
    expect(screen.getAllByText('No files')[0].className).toContain('px-3');
    expect(screen.getByText('Select a design file').className).toContain('text-[14px]');
    expect(screen.getByText('Select a design file').className).toContain('font-semibold');
    expect(screen.queryByText('DROP FILES HERE')).toBeNull();
  });

  it('keeps design file rows visually flat without stacked divider borders', () => {
    render(<CanvasWorkspace files={files} />);

    const row = screen.getByRole('button', { name: 'landing.html' });
    expect(row.className).toContain('!mx-0');
    expect(row.className).toContain('px-3');
    expect(row.className).not.toContain('px-2');
    expect(row.className).toContain('!rounded-none');
    expect(row.className).toContain('border-transparent');
    expect(row.className).not.toContain('border-[var(--border-1)]');

    fireEvent.click(row);

    expect(row.className).toContain('bg-[var(--project-input-bg)]');
    expect(row.className).toContain('hover:bg-[var(--project-input-hover-bg)]');
    expect(row.className).not.toContain('bg-primary');
    expect(row.className).not.toContain('text-primary-foreground');
    expect(row.querySelector('.text-\\[var\\(--text-primary\\)\\]')).toBeTruthy();
    expect(row.querySelector('.text-\\[var\\(--text-secondary\\)\\]')).toBeTruthy();
    expect(row.innerHTML).not.toContain('text-primary-foreground');
  });

  it('selects a design file for the side preview before opening it', () => {
    render(<CanvasWorkspace files={files} />);

    fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));

    expect(screen.queryByText('Canvas')).toBeNull();
    const detail = screen.getByTestId('design-file-detail');
    expect(detail).toBeTruthy();
    const kindLabel = within(detail).getByText('HTML page');
    const metaLabel = within(detail).getByText((text) => text.includes('text/html'));
    const pathLabel = within(detail).getAllByText('landing.html').at(-1);
    const detailTextStack = kindLabel.parentElement;
    expect(detailTextStack?.className).toContain('gap-1');
    expect(kindLabel.className).toContain('text-[12px]');
    expect(kindLabel.className).not.toContain('mt-1');
    expect(screen.queryByText('Modified recently')).toBeNull();
    expect(metaLabel.className).toContain('text-[12px]');
    expect(metaLabel.className).not.toContain('mt-3');
    expect(pathLabel?.className).toContain('text-[12px]');
    expect(pathLabel?.className).not.toContain('mt-2');
    expect(screen.getByRole('button', { name: 'Open landing.html' })).toBeTruthy();
    expect(screen.getByTestId('design-file-preview-srcdoc').getAttribute('srcdoc')).toContain('Hero');

    fireEvent.click(screen.getByRole('button', { name: 'Open landing.html' }));

    expect(screen.queryByText('Canvas')).toBeNull();
    const modeTabList = screen.getByRole('tablist', { name: 'File surface mode' });
    expect(modeTabList).toBeTruthy();
    expect(modeTabList.className).toContain('gap-1');
    expect(modeTabList.className).not.toContain('gap-2');
    expect(screen.getByTestId('canvas-preview-srcdoc')).toBeTruthy();
  });

  it('opens a design file from the file row on double click', () => {
    render(<CanvasWorkspace files={files} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'landing.html' }));

    expect(screen.queryByText('Canvas')).toBeNull();
    expect(screen.getByRole('tablist', { name: 'File surface mode' })).toBeTruthy();
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('Hero');
  });

  it('inlines sibling JSX in the selected html design file detail preview', () => {
    render(<CanvasWorkspace files={runtimeFiles} />);

    fireEvent.click(screen.getByRole('button', { name: 'index.html' }));

    const srcdoc = screen.getByTestId('design-file-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('data-vd-source="app.jsx"');
    expect(srcdoc).toContain('function App()');
    expect(srcdoc).not.toContain('src="app.jsx"');
  });

  it('passes sibling files into the opened canvas preview', () => {
    render(<CanvasWorkspace files={runtimeFiles} />);

    openDesignFile('index.html');

    const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('data-vd-source="app.jsx"');
    expect(srcdoc).toContain('function App()');
  });

  it('does not render project tweak controls in the canvas toolbar or preview surface', () => {
    render(<CanvasWorkspace files={tweakRuntimeFiles} />);

    openDesignFile('index.html');

    expect(screen.queryByRole('button', { name: 'Add tweak capabilities' })).toBeNull();
    expect(screen.queryByTestId('design-tweak-request-popover')).toBeNull();
    expect(screen.queryByTestId('design-tweaks-dock')).toBeNull();
  });

  it('renders the selected html file in a fixed desktop preview viewport', () => {
    render(<CanvasWorkspace files={files} />);

    fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));

    expect(screen.getByTestId('design-file-detail').className).toContain('grid-rows-[minmax(0,auto)_auto]');
    expect(screen.getByTestId('design-file-detail').className).toContain('gap-6');
    expect(screen.getByTestId('design-file-preview-frame').className).toContain('h-[clamp(320px,58vh,560px)]');
    expect(screen.getByTestId('design-file-preview-frame').className).toContain('max-h-[560px]');
    expect(screen.getByTestId('design-file-preview-frame').className).toContain('shadow-none');
    expect(screen.getByTestId('design-file-preview-frame').className).not.toContain('shadow-[var(--project-shadow-floating)]');
    expect(screen.getByTestId('design-file-preview-fit').className).toContain('overflow-hidden');
    expect(screen.getByTestId('design-file-preview-srcdoc').style.width).toBe('1280px');
    expect(screen.getByTestId('design-file-preview-srcdoc').style.height).toBe('800px');
    expect(screen.getByTestId('design-file-preview-srcdoc').style.transform).toContain('scale(');
  });

  it('uses the manual preview scrollbar in selected html file detail previews', () => {
    render(<CanvasWorkspace files={files} />);

    fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));

    const srcdoc = screen.getByTestId('design-file-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('data-vd-preview-scrollbar');
    expect(srcdoc).toContain('scrollbar-width: none');
    expect(srcdoc).toContain('html::-webkit-scrollbar');
    expect(srcdoc).toContain('data-vd-preview-size-bridge');
  });

  it('renders selected code files with a read-only CodeMirror preview', () => {
    render(<CanvasWorkspace files={files} />);

    fireEvent.click(screen.getByRole('button', { name: 'notes.txt' }));

    expect(screen.getByTestId('design-file-code-preview').getAttribute('aria-label')).toBe('Code preview for notes.txt');
    expect(screen.getByTestId('design-file-code-preview').textContent).toContain('Notes');
    expect(screen.queryByTestId('design-file-preview-srcdoc')).toBeNull();
  });

  it('shows stored file size for selected image resources without binary contents', () => {
    const imageFiles: WorkspaceFile[] = [
      {
        name: 'reference.png',
        path: 'reference.png',
        kind: 'image',
        mime: 'image/png',
        size: 1536,
        url: '/api/projects/project-1/files/reference.png',
      },
    ];
    render(<CanvasWorkspace files={imageFiles} />);

    fireEvent.click(screen.getByRole('button', { name: 'reference.png' }));

    const previewImage = screen.getByRole('img', { name: 'reference.png' });
    expect(previewImage.parentElement?.className).toContain('overflow-hidden');
    expect(previewImage.parentElement?.className).toContain('min-h-0');
    expect(previewImage.className).toContain('absolute');
    expect(previewImage.className).toContain('inset-0');
    expect(previewImage.className).toContain('h-full');
    expect(previewImage.className).toContain('w-full');
    expect(previewImage.className).toContain('object-contain');
    expect(previewImage.className).not.toContain('object-cover');
    expect(screen.getByTestId('design-file-detail').textContent).toContain('1.5 KB');
    expect(screen.getByTestId('design-file-detail').textContent).not.toContain('0 B');
  });

  it('shows an unsupported preview message for selected binary resources', () => {
    const resourceFiles: WorkspaceFile[] = [
      {
        name: 'clip.mp4',
        path: 'clip.mp4',
        kind: 'unsupported',
        mime: 'video/mp4',
        size: 2048,
        contents: 'binary video contents',
        url: '/api/projects/project-1/files/clip.mp4',
      },
    ];
    render(<CanvasWorkspace files={resourceFiles} />);

    fireEvent.click(screen.getByRole('button', { name: 'clip.mp4' }));

    expect(screen.getByTestId('design-file-unsupported-preview').textContent).toContain('该资源不支持展示');
    expect(screen.queryByTestId('design-file-code-preview')).toBeNull();
    expect(screen.getByTestId('design-file-detail').textContent).not.toContain('binary video contents');
  });

  it('keeps short html previews at the minimum desktop viewport size', () => {
    expect(
      resolveHtmlDesignPreviewSize({
        viewportWidth: 1280,
        viewportHeight: 800,
        scrollWidth: 900,
        scrollHeight: 620,
      }),
    ).toEqual({ width: 1280, height: 800 });
  });

  it('expands html previews to the full document size for long or wide pages', () => {
    expect(
      resolveHtmlDesignPreviewSize({
        viewportWidth: 1280,
        viewportHeight: 800,
        scrollWidth: 1440,
        scrollHeight: 2400,
      }),
    ).toEqual({ width: 1440, height: 2400 });
  });

  it('opens a matching file when an auto-open request arrives', () => {
    const { rerender } = render(<CanvasWorkspace files={[]} />);

    rerender(<CanvasWorkspace files={files} autoOpenFilePath="landing.html" />);

    expect(screen.queryByText('Canvas')).toBeNull();
    expect(screen.getByRole('tablist', { name: 'File surface mode' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'landing.html' })).toBeTruthy();
    expect(screen.getByTestId('canvas-preview-srcdoc')).toBeTruthy();
  });

  it('does not replay a consumed auto-open request when the file list refreshes', () => {
    const { rerender } = render(
      <CanvasWorkspace
        files={files}
        autoOpenFilePath="notes.txt"
        autoOpenFileRevision={1}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close tab notes.txt' }));
    expect(screen.queryByRole('tab', { name: 'notes.txt' })).toBeNull();

    rerender(
      <CanvasWorkspace
        files={[
          ...files,
          {
            name: 'new-result.html',
            path: 'new-result.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main>New result</main>',
          },
        ]}
        autoOpenFilePath="notes.txt"
        autoOpenFileRevision={1}
      />,
    );

    expect(screen.queryByRole('tab', { name: 'notes.txt' })).toBeNull();
  });

  it('offers a download action from the Design Files detail panel', () => {
    render(
      <CanvasWorkspace
        files={[
          {
            name: 'report.md',
            path: 'report.md',
            kind: 'text',
            mime: 'text/markdown',
            contents: '# Report',
            url: '/api/projects/project-1/files/report.md',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'report.md' }));

    const downloadLink = screen.getByRole('link', { name: 'Download report.md' });
    expect(downloadLink.getAttribute('href')).toBe('/api/projects/project-1/files/report.md');
    expect(downloadLink.getAttribute('download')).toBe('report.md');
  });

  it('opens an html file in preview mode with explicit mode tabs', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');

    const activeSurface = screen.getByTestId('active-file-surface');
    expect(activeSurface.parentElement?.className).toContain('bg-[var(--project-workspace-bg)]');
    expect(activeSurface.parentElement?.className).toContain('pb-3');
    expect(activeSurface.parentElement?.className).toContain('pr-3');
    expect(activeSurface.parentElement?.className).not.toContain('pt-3');
    expect(activeSurface.className).toContain('rounded-[var(--project-radius-dialog)]');
    expect(activeSurface.className).toContain('border-[var(--border-1)]');
    expect(activeSurface.className).toContain('bg-[var(--background-fronted)]');
    expect(activeSurface.className).toContain('shadow-none');
    expect(activeSurface.firstElementChild?.className).toContain('px-3');
    expect(activeSurface.firstElementChild?.className).not.toContain('px-4');
    const previewViewport = screen.getByTestId('canvas-preview-interaction-viewport');
    expect(previewViewport.className).toContain('h-full');
    expect(previewViewport.className).not.toContain('rounded');
    expect(previewViewport.className).not.toContain('border');
    expect(previewViewport.className).not.toContain('shadow');
    expect(screen.getByRole('tab', { name: 'landing.html' })).toBeTruthy();
    expect(screen.queryByTestId('canvas-header-title')).toBeNull();
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    expect(previewTab.getAttribute('aria-selected')).toBe('true');
    expect(previewTab.querySelector('svg')).toBeTruthy();
    expect(previewTab.className).toContain('bg-[var(--project-input-bg)]');
    expect(previewTab.className).toContain('hover:bg-[var(--project-input-hover-bg)]');
    expect((previewTab as HTMLButtonElement).style.backgroundColor).toBe('var(--project-input-bg)');
    expect((previewTab as HTMLButtonElement).style.color).toBe('var(--text-primary)');
    expect(screen.getByRole('tablist', { name: 'File surface mode' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add tweak capabilities' })).toBeNull();
    const markUpTab = screen.getByRole('tab', { name: 'Mark up' });
    expect(screen.queryByRole('tab', { name: 'Inspect' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Comment' })).toBeNull();
    expect(markUpTab.getAttribute('aria-selected')).toBe('false');
    for (const modeTab of [previewTab, markUpTab]) {
      expect(modeTab.className).toContain('h-7');
      expect(modeTab.className).toContain('px-2');
      expect(modeTab.className).not.toContain('h-8');
      expect(modeTab.className).not.toContain('px-3');
    }
    expect(markUpTab.className).toContain('text-[var(--text-secondary)]');
    expect(markUpTab.className).toContain('hover:bg-[var(--project-input-hover-bg)]');
    expect((markUpTab as HTMLButtonElement).style.color).toBe('var(--text-secondary)');
    expect(screen.queryByLabelText('Canvas inspector')).toBeNull();
    expect(screen.getByTestId('canvas-preview-srcdoc')).toBeTruthy();
  });

  it('captures and uploads an html preview cover once for an unchanged file', async () => {
    vi.useFakeTimers();
    const requestPreviewScreenshot = vi.fn(async () => ({
      dataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20/%3E',
      width: 1280,
      height: 800,
    }));
    const uploadPreviewCoverScreenshot = vi.fn(async () => 'assets/cover.svg');
    const uploadPreviewScreenshot = vi.fn(async () => 'screenshots/landing-preview.svg');

    const view = render(
      <CanvasWorkspace
        files={files}
        requestPreviewScreenshot={requestPreviewScreenshot}
        uploadPreviewCoverScreenshot={uploadPreviewCoverScreenshot}
        uploadPreviewScreenshot={uploadPreviewScreenshot}
      />,
    );

    try {
      openDesignFile('landing.html');

      await vi.advanceTimersByTimeAsync(999);
      expect(requestPreviewScreenshot).not.toHaveBeenCalled();
      expect(uploadPreviewCoverScreenshot).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(requestPreviewScreenshot).toHaveBeenCalledOnce();
      expect(uploadPreviewCoverScreenshot).toHaveBeenCalledWith({
        dataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20/%3E',
        width: 1280,
        height: 800,
      });
      expect(uploadPreviewScreenshot).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));
      openDesignFile('notes.txt');
      fireEvent.click(screen.getByRole('tab', { name: 'landing.html' }));

      await vi.advanceTimersByTimeAsync(1000);
      expect(uploadPreviewCoverScreenshot).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('retries html preview cover capture when clicking the active preview tab after a failed attempt', async () => {
    vi.useFakeTimers();
    const requestPreviewScreenshot = vi
      .fn<() => Promise<{ dataUrl: string; width: number; height: number }>>()
      .mockRejectedValueOnce(new Error('bridge not ready'))
      .mockResolvedValueOnce({
        dataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20/%3E',
        width: 1280,
        height: 800,
      });
    const uploadPreviewCoverScreenshot = vi.fn(async () => 'assets/cover.svg');

    const view = render(
      <CanvasWorkspace
        files={files}
        requestPreviewScreenshot={requestPreviewScreenshot}
        uploadPreviewCoverScreenshot={uploadPreviewCoverScreenshot}
      />,
    );

    try {
      openDesignFile('landing.html');

      await vi.advanceTimersByTimeAsync(1000);
      expect(requestPreviewScreenshot).toHaveBeenCalledOnce();
      expect(uploadPreviewCoverScreenshot).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));

      await vi.advanceTimersByTimeAsync(1000);
      expect(requestPreviewScreenshot).toHaveBeenCalledTimes(2);
      expect(uploadPreviewCoverScreenshot).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('does not capture non-html previews and captures html again after file content changes', async () => {
    vi.useFakeTimers();
    const requestPreviewScreenshot = vi.fn(async () => ({
      dataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20/%3E',
      width: 1280,
      height: 800,
    }));
    const uploadPreviewCoverScreenshot = vi.fn(async () => 'assets/cover.svg');
    const view = render(
      <CanvasWorkspace
        files={files}
        requestPreviewScreenshot={requestPreviewScreenshot}
        uploadPreviewCoverScreenshot={uploadPreviewCoverScreenshot}
      />,
    );

    try {
      openDesignFile('notes.txt');

      await vi.advanceTimersByTimeAsync(1000);
      expect(uploadPreviewCoverScreenshot).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));
      openDesignFile('landing.html');
      await vi.advanceTimersByTimeAsync(1000);
      expect(uploadPreviewCoverScreenshot).toHaveBeenCalledOnce();

      view.rerender(
        <CanvasWorkspace
          files={[
            { ...files[0], contents: '<main><h1 data-vd-id="hero">Changed</h1></main>' },
            files[1],
          ]}
          requestPreviewScreenshot={requestPreviewScreenshot}
          uploadPreviewCoverScreenshot={uploadPreviewCoverScreenshot}
        />,
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(uploadPreviewCoverScreenshot).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('renders non-html files without the html preview mode toolbar', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('notes.txt');

    expect(screen.queryByRole('tablist', { name: 'File surface mode' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Inspect' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Comment' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Mark up' })).toBeNull();
    expect(screen.queryByLabelText('Canvas inspector')).toBeNull();
    expect(screen.getByTestId('canvas-preview-text').textContent).toBe('Notes');
  });

  it('opens markup mode as element selection for HTML files and keeps saved comment records out of the canvas', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    const commentTab = screen.getByRole('tab', { name: 'Mark up' });
    expect(commentTab.getAttribute('aria-selected')).toBe('true');
    expect(commentTab.className).toContain('bg-[var(--project-input-bg)]');
    expect(commentTab.className).toContain('hover:bg-[var(--project-input-hover-bg)]');
    expect((commentTab as HTMLButtonElement).style.backgroundColor).toBe('var(--project-input-bg)');
    expect(commentTab.className).not.toContain('project-primary-button');
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('vd-comment-mode');
    expect(screen.queryByTestId('canvas-comment-panel')).toBeNull();
    expect(screen.getByTestId('canvas-comment-overlay')).toBeTruthy();
    expect(screen.queryByTestId('canvas-visual-comment-overlay')).toBeNull();
  });

  it('does not show internal target counts in markup mode', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    expect(screen.queryByText(/\d+ targets/)).toBeNull();
  });

  it('hides the comments tab count when the active file has no comments', () => {
    render(<CanvasWorkspace files={files} previewComments={[]} />);

    openDesignFile('landing.html');

    const surfaceModeTabs = screen.getByRole('tablist', { name: 'File surface mode' });
    expect(within(surfaceModeTabs).getByRole('tab', { name: 'Comments' })).toBeTruthy();
    expect(within(surfaceModeTabs).queryByRole('tab', { name: 'Comments 0' })).toBeNull();
  });

  it('opens the left comments panel from a top-level comments tab', () => {
    const onOpenPreviewCommentsPanel = vi.fn();

    render(
      <CanvasWorkspace
        files={files}
        previewComments={[previewComment(), previewComment({ id: 'comment-attached', status: 'attached' })]}
        commentsPanelOpen
        onOpenPreviewCommentsPanel={onOpenPreviewCommentsPanel}
      />,
    );

    openDesignFile('landing.html');

    const surfaceModeTabs = screen.getByRole('tablist', { name: 'File surface mode' });
    const commentsTab = within(surfaceModeTabs).getByRole('tab', { name: 'Comments 1' });
    expect(commentsTab.getAttribute('aria-selected')).toBe('true');
    expect(commentsTab.className).toContain('bg-[var(--project-comment-marker-bg)]');

    fireEvent.click(commentsTab);

    expect(onOpenPreviewCommentsPanel).toHaveBeenCalledOnce();
    expect(screen.getByRole('tab', { name: 'Mark up' }).getAttribute('aria-selected')).toBe('false');
  });

  it('keeps internal comment target tools out of the top toolbar', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    expect(screen.getByRole('tab', { name: 'Mark up' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Element comment tool' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pod comment tool' })).toBeNull();
  });

  it('keeps markup as the single top-level comment entry', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    expect(screen.queryByRole('tab', { name: 'Comment' })).toBeNull();
    const markUpTab = screen.getByRole('tab', { name: 'Mark up' });
    expect(markUpTab.getAttribute('aria-selected')).toBe('true');
    expect(markUpTab.className).toContain('bg-[var(--project-input-bg)]');
    expect(markUpTab.className).toContain('hover:bg-[var(--project-input-hover-bg)]');
    expect((markUpTab as HTMLButtonElement).style.backgroundColor).toBe('var(--project-input-bg)');
    expect(markUpTab.className).not.toContain('project-primary-button');
    expect(screen.getByTestId('canvas-comment-overlay')).toBeTruthy();
    expect(screen.queryByTestId('canvas-visual-comment-overlay')).toBeNull();
    expect(screen.queryByTestId('canvas-visual-comment-mark-surface')).toBeNull();
    expect(screen.queryByTestId('canvas-visual-comment-toolbar')).toBeNull();
    expect(screen.queryByTestId('canvas-comment-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Element comment tool' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to agent' })).toBeNull();
  });

  it('uses a scrollable manually zoomed preview surface in markup mode', async () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    const viewport = screen.getByTestId('canvas-preview-interaction-viewport');
    const zoomToolbar = screen.getByRole('toolbar', { name: 'Canvas zoom controls' });
    expect(viewport.className).toContain('overflow-auto');
    expect(zoomToolbar.className).not.toContain('border-l');
    expect(zoomToolbar.className).toContain('pl-2');
    expect(screen.getByTestId('canvas-preview-srcdoc').style.transform).toBe('translateX(-50%) scale(1)');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in canvas' }));

    await waitFor(() => {
      expect(screen.getByTestId('canvas-preview-srcdoc').style.transform).toBe('translateX(-50%) scale(1.1)');
    });
    expect(screen.getByText('110%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out canvas' }));

    await waitFor(() => {
      expect(screen.getByTestId('canvas-preview-srcdoc').style.transform).toBe('translateX(-50%) scale(1)');
    });
  });

  it('uses the same manual preview sizing surface in preview mode as comment mode', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');

    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('canvas-preview-interaction-viewport').className).toContain('overflow-auto');
    expect(screen.getByRole('toolbar', { name: 'Canvas zoom controls' })).toBeTruthy();
    expect(screen.getByTestId('canvas-preview-srcdoc').style.transform).toBe('translateX(-50%) scale(1)');
  });

  it('opens wide html previews at 100% scale by default in preview mode', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === 'canvas-preview-interaction-viewport') {
        return {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          top: 0,
          right: 800,
          bottom: 600,
          left: 0,
          toJSON: () => ({}),
        };
      }

      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    try {
      render(<CanvasWorkspace files={files} />);

      openDesignFile('landing.html');
      dispatchCanvasPreviewMessage({ type: 'vd-preview-size', width: 1600, height: 800 });

      await waitFor(() => {
        expect(screen.getByTestId('canvas-preview-srcdoc').style.width).toBe('1600px');
        expect(screen.getByTestId('canvas-preview-srcdoc').style.transform).toBe('translateX(-50%) scale(1)');
        expect(screen.getByTestId('canvas-preview-zoom-level').textContent).toBe('100%');
        // At 100% the wide frame overflows the 800px viewport and becomes horizontally scrollable.
        expect(Number.parseFloat(screen.getByTestId('canvas-preview-interaction-content').style.width)).toBe(1600);
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('keeps URL-backed HTML content visible when switching from preview to comment and markup modes', async () => {
    render(
      <CanvasWorkspace
        files={[
          {
            ...files[0]!,
            url: '/api/projects/project-1/files/landing.html',
          },
        ]}
      />,
    );

    openDesignFile('landing.html');
    expect(screen.getByTestId('canvas-preview-url').getAttribute('style')).toContain('visibility: hidden');
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('style')).toContain('visibility: visible');

    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    let srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
    expect(screen.getByTestId('canvas-preview-url').getAttribute('style')).toContain('visibility: hidden');
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('style')).toContain('visibility: visible');
    expect(srcdoc).toContain('<main><h1 data-vd-id="hero">Hero</h1></main>');
    expect(srcdoc).toContain('data-vd-comment-bridge');

    expect(screen.queryByTestId('canvas-visual-comment-mark-surface')).toBeNull();
    expect(screen.getByTestId('canvas-comment-overlay')).toBeTruthy();
  });

  it('aligns the comment overlay layer to the manually zoomed preview frame transform', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 400,
      top: 0,
      right: 640,
      bottom: 400,
      left: 0,
      toJSON: () => ({}),
    });

    try {
      render(<CanvasWorkspace files={files} />);

      openDesignFile('landing.html');
      fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

      await waitFor(() => {
        expect(screen.getByTestId('canvas-comment-overlay').style.transform).toBe('translateX(-50%) scale(0.5)');
      });
      expect(screen.getByTestId('canvas-preview-interaction-viewport').className).toContain('overflow-auto');
      expect(screen.getByTestId('canvas-comment-overlay').style.left).toBe('50%');
      expect(screen.getByTestId('canvas-comment-overlay').style.top).toBe('0px');
      expect(screen.getByTestId('canvas-comment-overlay').style.width).toBe('1280px');
      expect(screen.getByTestId('canvas-comment-overlay').style.height).toBe('800px');
      expect(screen.getByTestId('canvas-comment-overlay').style.transformOrigin).toBe('top center');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('opens a comment popover from a comment mode selection', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));

    const popoverElement = screen.getByTestId('canvas-comment-popover');
    const popover = within(popoverElement);
    const popoverContent = popoverElement.querySelector('[data-slot="card-content"]');
    expect(popover.getByText('Comment')).toBeTruthy();
    const note = popover.getByPlaceholderText('Describe the issue or suggestion...');
    const sendToAgentButton = popover.getByRole('button', { name: 'Send to agent' });
    const addButton = popover.getByRole('button', { name: 'Add comment' });

    expect(popoverElement.className).toContain('rounded-[var(--project-radius-lg)]');
    expect(popoverElement.className).toContain('shadow-[var(--project-shadow-popover)]');
    expect((popoverContent as HTMLElement | null)?.style.padding).toBe('0px 10px');
    expect(popoverContent?.className).toContain('space-y-1.5');
    expect(popoverContent?.className).not.toContain('!p-3');
    expect(popoverContent?.className).not.toContain('px-2.5');
    expect(popoverContent?.className).not.toContain('py-2');
    expect(note.className).toContain('min-h-[56px]');
    expect(note.className).toContain('border-[var(--border-1)]');
    expect(note.className).not.toMatch(/(^|\s)(focus-visible:)?border-\[var\(--state-danger\)\]/);
    expect(sendToAgentButton.className).toContain('project-primary-button');
    expect(addButton.className).toContain('project-secondary-ghost-button');
    expect(addButton.compareDocumentPosition(sendToAgentButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lets the comment popover height follow the comment input height', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));

    const note = screen.getByLabelText('Comment note') as HTMLTextAreaElement;
    Object.defineProperty(note, 'scrollHeight', { configurable: true, value: 116 });

    fireEvent.change(note, { target: { value: 'Line 1\nLine 2\nLine 3\nLine 4' } });

    expect(note.style.height).toBe('116px');
    expect(note.className).toContain('max-h-[180px]');
    expect(note.className).toContain('overflow-y-auto');
  });

  it('keeps the comment popover inside the visible interaction viewport', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 520,
      height: 360,
      top: 0,
      right: 520,
      bottom: 360,
      left: 0,
      toJSON: () => ({}),
    });

    try {
      render(<CanvasWorkspace files={files} />);

      openDesignFile('landing.html');
      fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
      fireEvent(window, new MessageEvent('message', {
        data: {
          type: 'vd-comment-select',
          target: {
            ...commentTarget,
            position: { x: 900, y: 650, width: 160, height: 80 },
          },
        },
      }));

      await waitFor(() => {
        const popoverHost = screen.getByTestId('canvas-comment-popover').parentElement;
        expect(popoverHost?.style.left).toBe('calc(50% - 227px)');
        expect(popoverHost?.style.top).toBe('102px');
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('saves comment drafts locally as canvas markers', async () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-hover', target: commentTarget } }));
    expect(screen.getByTestId('canvas-comment-hover-target').className).toContain('color-mix');
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));
    expect(screen.getByTestId('canvas-comment-active-target').className).toContain('bg-[var(--project-primary-alpha-10)]');
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'Tighten this section' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(screen.queryByTestId('canvas-comment-popover')).toBeNull());
    const marker = await screen.findByTestId('canvas-comment-saved-marker');
    const markerIcon = marker.querySelector('[data-marker-icon]');
    expect(markerIcon?.className).toContain('bg-[var(--project-comment-marker-bg)]');
    expect(marker.className).toContain('bg-transparent');
    expect(marker.className).toContain('hover:bg-transparent');
    expect(marker.className).toContain('active:bg-transparent');
    expect(marker.className).not.toContain('bg-[var(--state-danger)]');
    expect(screen.queryByTestId('canvas-comment-panel')).toBeNull();

    fireEvent.click(marker);

    expect(screen.getByTestId('canvas-comment-popover')).toBeTruthy();
    expect((screen.getByLabelText('Comment note') as HTMLTextAreaElement).value).toBe('Tighten this section');
  });

  it('reopens an existing element comment from its saved marker', async () => {
    render(<CanvasWorkspace files={files} previewComments={[previewComment()]} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent.click(screen.getByTestId('canvas-comment-saved-marker'));

    expect(screen.getByTestId('canvas-comment-popover')).toBeTruthy();
    expect((screen.getByLabelText('Comment note') as HTMLTextAreaElement).value).toBe('Tighten this section');
    expect(screen.getByTestId('canvas-comment-saved-marker').getAttribute('aria-pressed')).toBe('true');
  });

  it('expands a saved comment marker to the right with wrapped preview text on hover', () => {
    render(
      <CanvasWorkspace
        files={files}
        previewComments={[previewComment({ note: 'Tighten this section\nKeep the button aligned' })]}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    const marker = screen.getByTestId('canvas-comment-saved-marker');
    const preview = screen.getByTestId('canvas-comment-saved-marker-preview');
    const icon = marker.querySelector('[data-marker-icon]');

    expect(preview.getAttribute('data-state')).toBe('collapsed');
    expect(marker.className).toContain('overflow-hidden');
    expect(marker.className).toContain('transition-[width,background-color,border-color,color,box-shadow]');
    expect(marker.className).toContain('duration-200');
    expect(marker.className).toContain('w-7');
    expect(icon?.className).toContain('w-7');
    expect(icon?.className).toContain('min-w-7');
    expect(icon?.className).toContain('bg-[var(--project-comment-marker-bg)]');
    expect(preview.className).not.toContain('absolute');
    expect(preview.className).toContain('-ml-7');
    expect(preview.className).toContain('pl-10');
    expect(preview.className).toContain('py-[5px]');
    expect(preview.className).toContain('rounded-md');
    expect(preview.className).toContain('rounded-l-md');
    expect(preview.className).toContain('bg-[var(--background-fronted)]');
    expect(preview.className).toContain('text-[var(--text-primary)]');
    expect(preview.className).toContain('whitespace-normal');
    expect(preview.className).toContain('break-words');
    expect(preview.className).toContain('opacity-0');

    fireEvent.mouseEnter(marker);

    expect(preview.getAttribute('data-state')).toBe('expanded');
    expect(marker.className).toContain('w-fit');
    expect(marker.className).toContain('max-w-[320px]');
    expect(marker.className).not.toContain('w-64');
    expect(marker.className).toContain('rounded-lg');
    expect(icon?.className).toContain('w-7');
    expect(preview.className).toContain('max-w-[320px]');
    expect(preview.className).toContain('opacity-100');
    expect(preview.children).toHaveLength(1);
    expect(preview.textContent).toContain('Tighten this section');
    expect(preview.textContent).toContain('Keep the button aligned');

    fireEvent.mouseLeave(marker);

    expect(preview.getAttribute('data-state')).toBe('collapsed');
  });

  it('opens the saved comment marker preview leftward when the target hugs the right frame edge', () => {
    render(
      <CanvasWorkspace
        files={files}
        previewComments={[
          previewComment({
            note: '点击无反应',
            position: { x: 1200, y: 20, width: 70, height: 40 },
          }),
        ]}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    const marker = screen.getByTestId('canvas-comment-saved-marker');
    const preview = screen.getByTestId('canvas-comment-saved-marker-preview');

    expect(marker.getAttribute('data-preview-side')).toBe('left');
    expect(marker.className).toContain('flex-row-reverse');
    // Anchored by the right edge so the w-fit pill grows into the open left space
    // instead of being clamped to a sliver against the frame edge.
    expect(marker.style.right).not.toBe('');
    expect(marker.style.left).toBe('');
    expect(marker.style.transform).toBe('translate(14px, -14px)');
    expect(preview.className).toContain('-mr-7');
    expect(preview.className).toContain('pr-10');
    expect(preview.className).toContain('pl-3');
    expect(preview.className).not.toContain('-ml-7');
  });

  it('keeps a single-line saved comment marker preview to one rendered row', () => {
    render(<CanvasWorkspace files={files} previewComments={[previewComment({ note: 'Fix hero' })]} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    const marker = screen.getByTestId('canvas-comment-saved-marker');
    const preview = screen.getByTestId('canvas-comment-saved-marker-preview');

    fireEvent.mouseEnter(marker);

    expect(preview.getAttribute('data-state')).toBe('expanded');
    expect(preview.className).toContain('py-[5px]');
    expect(preview.className).toContain('rounded-l-full');
    expect(preview.className).not.toContain('rounded-l-md');
    expect(preview.children).toHaveLength(1);
    expect(preview.textContent).toBe('Fix hero');
  });

  it('keeps a multi-line saved comment marker preview radius aligned with the card edge', () => {
    render(
      <CanvasWorkspace
        files={files}
        previewComments={[previewComment({ note: 'First line\nSecond line' })]}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    const marker = screen.getByTestId('canvas-comment-saved-marker');
    const preview = screen.getByTestId('canvas-comment-saved-marker-preview');

    fireEvent.mouseEnter(marker);

    expect(preview.getAttribute('data-state')).toBe('expanded');
    expect(preview.className).toContain('rounded-l-md');
    expect(preview.className).not.toContain('rounded-l-full');
  });

  it('allows multiple controlled comments on different points of the same preview target', async () => {
    const onSavePreviewComment = vi.fn();

    function ControlledWorkspace() {
      const [comments, setComments] = React.useState<CanvasPreviewComment[]>([]);
      return (
        <CanvasWorkspace
          files={files}
          previewComments={comments}
          onSavePreviewComment={async (target, note) => {
            onSavePreviewComment(target, note);
            const saved = previewComment({
              ...target,
              id: `comment-${comments.length + 1}`,
              note,
              status: 'open',
              createdAt: comments.length + 1,
              updatedAt: comments.length + 1,
            });
            setComments((currentComments) => [saved, ...currentComments]);
            return saved;
          }}
        />
      );
    }

    render(<ControlledWorkspace />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', {
      data: {
        type: 'vd-comment-select',
        target: {
          ...commentTarget,
          hoverPoint: { x: 30, y: 32 },
        },
      },
    }));
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'First comment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSavePreviewComment).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId('canvas-comment-popover')).toBeNull());

    fireEvent(window, new MessageEvent('message', {
      data: {
        type: 'vd-comment-select',
        target: {
          ...commentTarget,
          position: { x: 40, y: 60, width: 100, height: 40 },
          hoverPoint: { x: 60, y: 72 },
        },
      },
    }));

    const secondDraft = screen.getByLabelText('Comment note') as HTMLTextAreaElement;
    expect(secondDraft.value).toBe('');
    fireEvent.change(secondDraft, { target: { value: 'Second comment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSavePreviewComment).toHaveBeenCalledTimes(2));
    expect(onSavePreviewComment.mock.calls[0]?.[0]).toMatchObject({ targetId: 'hero@30-32' });
    expect(onSavePreviewComment.mock.calls[1]?.[0]).toMatchObject({ targetId: 'hero@60-72' });
    expect(screen.getAllByTestId('canvas-comment-saved-marker')).toHaveLength(2);
  });

  it('restores an existing controlled comment when the same preview point is selected again', async () => {
    const onSavePreviewComment = vi.fn();

    function ControlledWorkspace() {
      const [comments, setComments] = React.useState<CanvasPreviewComment[]>([]);
      return (
        <CanvasWorkspace
          files={files}
          previewComments={comments}
          onSavePreviewComment={async (target, note) => {
            onSavePreviewComment(target, note);
            const saved = previewComment({
              ...target,
              id: `comment-${comments.length + 1}`,
              note,
              status: 'open',
              createdAt: comments.length + 1,
              updatedAt: comments.length + 1,
            });
            setComments((currentComments) => [saved, ...currentComments]);
            return saved;
          }}
        />
      );
    }

    render(<ControlledWorkspace />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', {
      data: {
        type: 'vd-comment-select',
        target: {
          ...commentTarget,
          hoverPoint: { x: 30, y: 32 },
        },
      },
    }));
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'First comment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSavePreviewComment).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId('canvas-comment-popover')).toBeNull());

    fireEvent(window, new MessageEvent('message', {
      data: {
        type: 'vd-comment-select',
        target: {
          ...commentTarget,
          hoverPoint: { x: 30, y: 32 },
        },
      },
    }));

    expect((screen.getByLabelText('Comment note') as HTMLTextAreaElement).value).toBe('First comment');
    expect(screen.getByTestId('canvas-comment-saved-marker').getAttribute('aria-pressed')).toBe('true');
  });

  it('restores a loaded point comment when only the target id suffix has the saved point', async () => {
    render(
      <CanvasWorkspace
        files={files}
        previewComments={[
          previewComment({
            targetId: 'hero@30-32',
            hoverPoint: undefined,
            note: 'Loaded point comment',
          }),
        ]}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', {
      data: {
        type: 'vd-comment-select',
        target: {
          ...commentTarget,
          hoverPoint: { x: 35, y: 36 },
        },
      },
    }));

    expect((screen.getByLabelText('Comment note') as HTMLTextAreaElement).value).toBe('Loaded point comment');
    expect(screen.getByTestId('canvas-comment-saved-marker').getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the comment popover for drag box selections from the default markup tool', () => {
    const onSavePreviewComment = vi.fn(async (target, note) =>
      previewComment({
        ...target,
        id: 'comment-pod',
        note,
        status: 'open',
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    render(<CanvasWorkspace files={files} onSavePreviewComment={onSavePreviewComment} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          type: 'vd-comment-pod-select',
          points: [{ x: 10, y: 20 }, { x: 220, y: 120 }],
          target: podCommentTarget,
        },
      }),
    );

    expect(screen.getByTestId('canvas-comment-popover')).toBeTruthy();
    expect(screen.getByTestId('canvas-comment-active-target')).toBeTruthy();
    expect(screen.getByLabelText('Comment note')).toBeTruthy();
    expect(screen.queryByText('2 members')).toBeNull();
    expect(screen.queryByText('Hero title, Hero CTA')).toBeNull();
    expect(onSavePreviewComment).not.toHaveBeenCalled();
  });

  it('ignores free pin selections from stale comment bridge messages', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          type: 'vd-comment-select',
          target: {
            targetId: 'pin-12-18',
            selector: 'pin',
            label: 'pin',
            text: '',
            position: { x: 0, y: 6, width: 24, height: 24 },
            htmlHint: '',
            hoverPoint: { x: 12, y: 18 },
          },
        },
      }),
    );

    expect(screen.queryByTestId('canvas-comment-popover')).toBeNull();
    expect(screen.queryByTestId('canvas-comment-active-target')).toBeNull();
  });

  it('sends element comments with screenshot attachments', async () => {
    const onSendCommentAttachments = vi.fn();
    const uploadPreviewScreenshot = vi.fn<(dataUrl: string) => Promise<string>>(
      async () => 'screenshots/comment-element.svg',
    );

    render(
      <CanvasWorkspace
        files={files}
        onSendCommentAttachments={onSendCommentAttachments}
        requestPreviewScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,dmVyeQ==',
          width: 1280,
          height: 800,
        })}
        uploadPreviewScreenshot={uploadPreviewScreenshot}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'Tighten this section' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

    await waitFor(() => expect(onSendCommentAttachments).toHaveBeenCalledOnce());
    expect(uploadPreviewScreenshot).toHaveBeenCalledOnce();
    const [[attachments]] = onSendCommentAttachments.mock.calls as [[CanvasCommentAttachment[]]];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      source: 'visual-mark',
      selectionKind: 'visual',
      filePath: 'landing.html',
      targetId: 'hero',
      screenshotPath: 'screenshots/comment-element.svg',
      markKind: 'click',
      comment: 'Tighten this section',
    });
  });

  it('saves the active comment target through onSavePreviewComment', async () => {
    const saved = previewComment({ note: 'Fix hero' });
    const onSavePreviewComment = vi.fn(async () => saved);
    const uploadPreviewScreenshot = vi.fn(async () => 'screenshots/hero-comment.svg');

    render(
      <CanvasWorkspace
        files={files}
        onSavePreviewComment={onSavePreviewComment}
        requestPreviewScreenshot={async () => ({
          dataUrl: 'data:image/png;base64,dmVyeQ==',
          width: 1280,
          height: 800,
        })}
        uploadPreviewScreenshot={uploadPreviewScreenshot}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          type: 'vd-comment-select',
          target: {
            ...commentTarget,
            position: { x: 10.4, y: 20.5, width: 100.2, height: 40.8 },
          },
        },
      }),
    );
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'Fix hero' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSavePreviewComment).toHaveBeenCalledOnce());
    expect(onSavePreviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'landing.html',
        targetId: 'hero',
        selectionKind: 'element',
        position: { x: 10, y: 21, width: 100, height: 41 },
        screenshotPath: 'screenshots/hero-comment.svg',
      }),
      'Fix hero',
    );
    expect(uploadPreviewScreenshot).toHaveBeenCalledOnce();
  });

  it('sends active draft comments as chat attachments from the popover', async () => {
    const onSendCommentAttachments = vi.fn();

    render(<CanvasWorkspace files={files} onSendCommentAttachments={onSendCommentAttachments} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'Fix hero spacing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

    await waitFor(() => expect(onSendCommentAttachments).toHaveBeenCalledOnce());
    const [[attachments]] = onSendCommentAttachments.mock.calls as [[CanvasCommentAttachment[]]];
    expect(attachments).toEqual([
      expect.objectContaining({
        source: 'board-batch',
        selectionKind: 'element',
        filePath: 'landing.html',
        targetId: 'hero',
        comment: 'Fix hero spacing',
      }),
    ]);
    expect(screen.queryByTestId('canvas-comment-popover')).toBeNull();
  });

  it('renders service-backed preview comments as markers without local save', () => {
    render(<CanvasWorkspace files={files} previewComments={[previewComment()]} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    expect(screen.getByTestId('canvas-comment-saved-marker')).toBeTruthy();
    expect(screen.queryByTestId('canvas-comment-panel')).toBeNull();
  });

  it('opens service-backed visual comments in mark up mode from an external open request', async () => {
    const visualComment = previewComment({
      id: 'comment-visual',
      selectionKind: 'visual',
      targetId: 'visual-mark-1',
      selector: 'visual-mark',
      label: 'Marked region',
      text: '',
      position: { x: 40, y: 50, width: 100, height: 70 },
      note: 'Make the background black',
      markKind: 'click',
    });

    render(
      <CanvasWorkspace
        files={files}
        previewComments={[visualComment]}
        autoOpenCommentId="comment-visual"
        autoOpenCommentRevision={1}
      />,
    );

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Mark up' }).getAttribute('aria-selected')).toBe('true'));
    const openedCard = screen.getByTestId('canvas-visual-comment-opened-card');
    const openedCardContent = openedCard.querySelector('[data-slot="card-content"]');
    expect(openedCard).toBeTruthy();
    expect((openedCardContent as HTMLElement | null)?.style.padding).toBe('10px');
    expect(screen.getByTestId('canvas-visual-comment-opened-note').textContent).toContain('Make the background black');
    expect(screen.getByTestId('canvas-comment-saved-marker').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not render attached preview comments as active canvas markers', () => {
    render(
      <CanvasWorkspace
        files={files}
        previewComments={[
          previewComment({ id: 'comment-open', status: 'open' }),
          previewComment({ id: 'comment-attached', status: 'attached' }),
        ]}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));

    expect(screen.getAllByTestId('canvas-comment-saved-marker')).toHaveLength(1);
  });

  it('does not write local fallback comments while previewComments is controlled', () => {
    const { rerender } = render(<CanvasWorkspace files={files} previewComments={[]} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'Should stay external' } });
    expect((screen.getByRole('button', { name: 'Add comment' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    expect(screen.getByTestId('canvas-comment-popover')).toBeTruthy();
    expect((screen.getByLabelText('Comment note') as HTMLTextAreaElement).value).toBe('Should stay external');
    expect(screen.queryByTestId('canvas-comment-saved-marker')).toBeNull();

    rerender(<CanvasWorkspace files={files} />);

    expect(screen.queryByTestId('canvas-comment-saved-marker')).toBeNull();
  });

  it('keeps the popover draft open when onSavePreviewComment rejects', async () => {
    const onSavePreviewComment = vi.fn(async () => {
      throw new Error('save failed');
    });

    render(
      <CanvasWorkspace
        files={files}
        previewComments={[]}
        onSavePreviewComment={onSavePreviewComment}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSavePreviewComment).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole('button', { name: 'Add comment' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId('canvas-comment-popover')).toBeTruthy();
    expect((screen.getByLabelText('Comment note') as HTMLTextAreaElement).value).toBe('Keep this draft');
  });

  it('saves edited comments through onSavePreviewComment without extending the target contract', async () => {
    const onSavePreviewComment = vi.fn(async (_target: unknown, _note: string) =>
      previewComment({ note: 'Updated note' }),
    );

    render(
      <CanvasWorkspace
        files={files}
        previewComments={[previewComment()]}
        onSavePreviewComment={onSavePreviewComment}
      />,
    );

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Mark up' }));
    fireEvent.click(screen.getByTestId('canvas-comment-saved-marker'));
    fireEvent.change(screen.getByLabelText('Comment note'), { target: { value: 'Updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(onSavePreviewComment).toHaveBeenCalledOnce());
    expect(onSavePreviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'hero' }),
      'Updated note',
    );
    const [[savedTarget]] = onSavePreviewComment.mock.calls;
    expect(savedTarget).not.toHaveProperty('id');
  });

  it('ignores comment bridge selections outside comment mode', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-comment-select', target: commentTarget } }));

    expect(screen.queryByTestId('canvas-comment-popover')).toBeNull();
    expect(screen.queryByTestId('canvas-comment-panel')).toBeNull();
  });

  it('does not expose inspect mode or mount the inspector dock for html files', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');

    fireEvent(window, new MessageEvent('message', { data: { type: 'vd-edit-select', target: selectedTarget } }));
    expect(screen.queryByText('Edit Text')).toBeNull();
    expect(screen.queryByLabelText('Canvas inspector')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Inspect' })).toBeNull();

    expect(screen.getByLabelText('Vibe Design Workspace').className).toContain('min-w-0');
    expect(screen.getByLabelText('Vibe Design Workspace').className).toContain('overflow-hidden');
    expect(screen.getByLabelText('Vibe Design Workspace').className).toContain('bg-[var(--project-workspace-bg)]');
    expect(screen.getByTestId('canvas-preview-interaction-viewport').className).toContain('min-w-0');
    expect(screen.getByTestId('canvas-preview-interaction-viewport').className).toContain('max-w-full');
    expect(screen.queryByTestId('canvas-inspector-floating-window')).toBeNull();
    expect(screen.queryByTestId('canvas-property-inspector')).toBeNull();
    expect(screen.queryByText('Edit Text')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Text' })).toBeNull();
  });

  it('keeps duplicate basenames in distinct path-keyed tabs and previews the active file', () => {
    const duplicateNameFiles: WorkspaceFile[] = [
      {
        name: 'index.html',
        path: 'pages/index.html',
        kind: 'html',
        mime: 'text/html',
        contents: '<main><h1>Pages Index</h1></main>',
      },
      {
        name: 'index.html',
        path: 'components/index.html',
        kind: 'html',
        mime: 'text/html',
        contents: '<section><h2>Components Index</h2></section>',
      },
    ];

    render(<CanvasWorkspace files={duplicateNameFiles} />);

    const fileButtons = screen.getAllByRole('button', { name: 'index.html' });
    fireEvent.click(fileButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Open index.html' }));

    expect(screen.getAllByRole('tab', { name: 'index.html' })).toHaveLength(1);
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('Pages Index');

    fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));
    const updatedFileButtons = screen.getAllByRole('button', { name: 'index.html' });
    fireEvent.click(updatedFileButtons[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Open index.html' }));

    const fileTabs = screen.getAllByRole('tab', { name: 'index.html' });
    expect(fileTabs).toHaveLength(2);
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('Components Index');

    fireEvent.click(fileTabs[0]);

    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('Pages Index');
  });

  it('activates an existing file tab', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));
    openDesignFile('notes.txt');
    fireEvent.click(screen.getByRole('tab', { name: 'landing.html' }));

    expect(screen.getByRole('tab', { name: 'landing.html' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('canvas-preview-srcdoc')).toBeTruthy();
  });

  it('opens same-project html files when the preview requests relative navigation', () => {
    const mpaFiles: WorkspaceFile[] = [
      {
        name: 'index.html',
        path: 'index.html',
        kind: 'html',
        mime: 'text/html',
        contents: '<main><a href="about.html">About</a><h1>Home</h1></main>',
      },
      {
        name: 'about.html',
        path: 'about.html',
        kind: 'html',
        mime: 'text/html',
        contents: '<main><h1>About page</h1></main>',
      },
    ];

    render(<CanvasWorkspace files={mpaFiles} />);

    openDesignFile('index.html');
    dispatchCanvasPreviewMessage({ type: 'vd-preview-navigate', path: 'about.html', href: 'about.html' });

    expect(screen.getByRole('tab', { name: 'about.html' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).toContain('About page');
    expect(screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc')).not.toContain('Vibe Design');
  });

  it('normalizes duplicate saved tabs for the same file path on first render', () => {
    const initialTabs: WorkspaceTabsState = {
      tabs: [
        { kind: 'file', key: 'landing.html', path: 'landing.html', name: 'landing.html' },
        { kind: 'file', key: 'file:landing.html', path: 'landing.html', name: 'landing.html' },
      ],
      activeTabKey: 'landing.html',
    };

    render(<CanvasWorkspace files={files} initialTabs={initialTabs} />);

    const fileTabs = screen.getAllByRole('tab', { name: 'landing.html' });
    expect(fileTabs).toHaveLength(1);
    expect(fileTabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('keeps file tabs free of reorder controls while supporting tab close', () => {
    const reorderFiles: WorkspaceFile[] = [
      ...files,
      {
        name: 'about.html',
        path: 'about.html',
        kind: 'html',
        mime: 'text/html',
        contents: '<main>About</main>',
      },
    ];
    render(<CanvasWorkspace files={reorderFiles} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));
    openDesignFile('notes.txt');
    fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));
    openDesignFile('about.html');

    const workspaceTabs = within(screen.getByRole('tablist', { name: 'Workspace tabs' }));
    const designFilesTab = workspaceTabs.getByRole('tab', { name: 'Design Files' });
    const designFilesFolderPath = designFilesTab.querySelector('svg path');

    expect(workspaceTabs.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Design Files',
      'landing.html',
      'notes.txt',
      'about.html',
    ]);
    expect(designFilesTab.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(designFilesFolderPath?.getAttribute('fill')).toBe('currentColor');
    expect(designFilesFolderPath?.getAttribute('d')).toContain('M8.92969 2C9.42628');
    expect(screen.getByRole('button', { name: 'Close tab landing.html' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close tab notes.txt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close tab about.html' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move landing.html left' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move about.html right' })).toBeNull();
  });

  it('matches Claude Design styling for workspace file tabs', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');

    const fileTabShell = screen.getByTestId('workspace-file-tab-landing.html');
    const fileTab = screen.getByRole('tab', { name: 'landing.html' });
    const closeButton = screen.getByRole('button', { name: 'Close tab landing.html' });
    const workspaceTabsHeader = screen.getByRole('tablist', { name: 'Workspace tabs' }).parentElement;

    expect(workspaceTabsHeader?.className).not.toContain('border-b');
    expect(workspaceTabsHeader?.className).toContain('pl-2');
    expect(workspaceTabsHeader?.className).toContain('pr-4');
    expect(workspaceTabsHeader?.className).not.toContain('px-2');
    expect(fileTabShell.className).toContain('rounded-md');
    expect(fileTabShell.className).toContain('h-7');
    expect(fileTabShell.className).toContain('min-h-7');
    expect(fileTabShell.className).toContain('border-[var(--border-1)]');
    expect(fileTabShell.className).not.toContain('ring-');
    expect(fileTabShell.className).toContain('bg-[var(--background)]');
    expect(fileTab.className).toContain('rounded-none');
    expect(fileTab.className).toContain('bg-transparent');
    expect(fileTab.className).toContain('text-[12px]');
    expect(fileTab.className).toContain('pl-2.5');
    expect(fileTab.className).toContain('pr-0.5');
    expect(closeButton.className).toContain('h-5');
    expect(closeButton.className).toContain('w-6');
    expect(closeButton.className).toContain('min-w-6');
    expect(closeButton.className).toContain('pl-0.5');
    expect(closeButton.className).toContain('pr-2');
    expect(closeButton.className).toContain('hover:!bg-transparent');
    expect(closeButton.className).toContain('active:!bg-transparent');
    expect(closeButton.className).not.toContain('rounded-none');
    expect(closeButton.className).not.toContain('border-0');
    expect(closeButton.className).not.toContain('text-[var(--text-secondary)]');
    expect(closeButton.className).not.toContain('rounded-l-none');
    expect(closeButton.querySelector('svg')?.getAttribute('width')).toBe('10');
    expect(closeButton.querySelector('svg')?.getAttribute('height')).toBe('10');
  });

  it('closes the active file tab and returns to the remaining file tab', () => {
    render(<CanvasWorkspace files={files} />);

    openDesignFile('landing.html');
    fireEvent.click(screen.getByRole('tab', { name: 'Design Files' }));
    openDesignFile('notes.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Close tab notes.txt' }));

    expect(screen.queryByRole('tab', { name: 'notes.txt' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'landing.html' }).getAttribute('aria-selected')).toBe('true');
  });

});

function dispatchCanvasPreviewMessage(data: unknown) {
  const srcdocFrame = screen.getByTestId('canvas-preview-srcdoc') as HTMLIFrameElement;
  const source = srcdocFrame.contentWindow;

  if (!source) {
    throw new Error('Expected jsdom to create an iframe contentWindow');
  }

  fireEvent(
    window,
    new MessageEvent('message', {
      data,
      source,
    }),
  );
}
