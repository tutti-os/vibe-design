// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignFilesPanel } from './DesignFilesPanel';
import { applyLocale, I18nProvider } from '../i18n';
import { liveArtifactTabId } from '../types';
import type { LiveArtifactWorkspaceEntry, ProjectFile, ProjectFileKind } from '../types';

const lsStore = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    lsStore.set(key, value);
  },
  removeItem: (key: string) => {
    lsStore.delete(key);
  },
  clear: () => {
    lsStore.clear();
  },
});

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => undefined },
    setPointerCapture: { configurable: true, value: () => undefined },
  });
});

afterAll(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
});

function file(overrides: Partial<ProjectFile> & Pick<ProjectFile, 'name'>): ProjectFile {
  return {
    path: overrides.name,
    type: 'file',
    size: 1024,
    mtime: Date.now(),
    kind: 'html',
    mime: 'text/html',
    ...overrides,
  };
}

function extForKind(kind: ProjectFileKind): string {
  if (kind === 'html') return 'html';
  if (kind === 'image') return 'png';
  if (kind === 'sketch') return 'sketch.json';
  if (kind === 'text') return 'txt';
  if (kind === 'code') return 'ts';
  if (kind === 'pdf') return 'pdf';
  return 'bin';
}

function generateFiles(count: number): ProjectFile[] {
  const kinds: ProjectFileKind[] = ['html', 'image', 'sketch', 'text', 'code', 'pdf'];
  return Array.from({ length: count }, (_, index) => {
    const kind = kinds[index % kinds.length]!;
    return file({
      name: `file-${index + 1}.${extForKind(kind)}`,
      kind,
      size: 1024 * (index + 1),
      mtime: Date.now() - index * 60_000,
      mime: 'text/plain',
    });
  });
}

function liveArtifact(
  overrides: Partial<LiveArtifactWorkspaceEntry> = {},
): LiveArtifactWorkspaceEntry {
  return {
    kind: 'live-artifact',
    tabId: liveArtifactTabId('artifact-1'),
    artifactId: 'artifact-1',
    projectId: 'test-project',
    title: 'Hero image',
    slug: 'hero-image',
    status: 'active',
    refreshStatus: 'idle',
    pinned: false,
    preview: { type: 'image', url: 'https://example.com/hero.png', thumbnailUrl: 'https://example.com/thumb.png' },
    hasDocument: true,
    updatedAt: new Date(2026, 4, 1).toISOString(),
    ...overrides,
  };
}

function renderPanel(
  files: ProjectFile[],
  projectId = 'test-project',
  propOverrides: Partial<Omit<React.ComponentProps<typeof DesignFilesPanel>, 'files' | 'projectId'>> = {},
  locale?: React.ComponentProps<typeof I18nProvider>['initialLocale'],
) {
  const onOpenFile = vi.fn();
  const onDeleteFile = vi.fn();
  const onDeleteFiles = vi.fn();
  const onRenameFile = vi.fn();
  const onUploadFiles = vi.fn();
  const props = {
    projectId,
    liveArtifacts: [],
    onRefreshFiles: vi.fn(),
    onOpenFile,
    onOpenLiveArtifact: vi.fn(),
    onRenameFile,
    onDeleteFile,
    onDeleteFiles,
    onUpload: vi.fn(),
    onUploadFiles,
    onPaste: vi.fn(),
    onNewSketch: vi.fn(),
    ...propOverrides,
  } satisfies Omit<React.ComponentProps<typeof DesignFilesPanel>, 'files'>;
  const panel = <DesignFilesPanel {...props} files={files} />;
  const result = render(locale ? <I18nProvider initialLocale={locale}>{panel}</I18nProvider> : panel);
  return {
    ...result,
    onDeleteFile: props.onDeleteFile,
    onDeleteFiles: props.onDeleteFiles,
    onOpenFile: props.onOpenFile,
    onRenameFile: props.onRenameFile,
    onUploadFiles: props.onUploadFiles,
    rerenderPanel: (nextFiles: ProjectFile[], nextProjectId = props.projectId) => {
      const nextPanel = <DesignFilesPanel {...props} projectId={nextProjectId} files={nextFiles} />;
      result.rerender(locale ? <I18nProvider initialLocale={locale}>{nextPanel}</I18nProvider> : nextPanel);
    },
  };
}

function chooseSelectOption(label: string, optionName: string) {
  fireEvent.pointerDown(screen.getByLabelText(label), {
    button: 0,
    ctrlKey: false,
    pointerId: 1,
    pointerType: 'mouse',
  });
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}

describe('DesignFilesPanel', () => {
  beforeEach(() => {
    lsStore.clear();
  });

  afterEach(() => {
    cleanup();
    applyLocale('en');
    vi.useRealTimers();
  });

  it('localizes file panel controls and empty states with the active locale', () => {
    renderPanel([], 'test-project', {}, 'zh-CN');

    expect(screen.getByRole('region', { name: '设计文件' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '设计文件' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '上传' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建草图' })).toBeTruthy();
    expect(screen.getByText('暂无文件。')).toBeTruthy();
    expect(screen.queryByText('Design files')).toBeNull();
    expect(screen.queryByText('No files yet.')).toBeNull();
  });

  it('groups files by kind by default', () => {
    renderPanel([
      file({ name: 'page.html', kind: 'html', mime: 'text/html' }),
      file({ name: 'chart.png', kind: 'image', mime: 'image/png' }),
    ]);

    expect(screen.getByRole('group', { name: 'Group by' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Design file list' })).toBeNull();
    expect(screen.getAllByText('HTML').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Image').length).toBeGreaterThan(0);
    expect(screen.getByTestId('design-file-row-page.html')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-chart.png')).toBeTruthy();
  });

  it('groups files by modified date when selected', () => {
    const now = new Date(2026, 4, 9, 12).getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    renderPanel([
      file({ name: 'today.html', mtime: new Date(2026, 4, 9, 11).getTime() }),
      file({ name: 'yesterday.html', mtime: new Date(2026, 4, 8, 12).getTime() }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Modified' }));

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-today.html')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-yesterday.html')).toBeTruthy();
  });

  it('renders only the default page size for large file lists and navigates pages', () => {
    const { container } = renderPanel(generateFiles(45));

    expect(container.querySelectorAll('[data-testid^="design-file-row-"]').length).toBe(30);
    expect(screen.getByText('1-30 of 45')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(container.querySelectorAll('[data-testid^="design-file-row-"]').length).toBe(15);
    expect(screen.getByText('31-45 of 45')).toBeTruthy();
  });

  it('clamps the current page when the file list shrinks after navigation', () => {
    const { container, rerenderPanel } = renderPanel(generateFiles(45));

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    rerenderPanel(generateFiles(10));

    expect(screen.getByText('1-10 of 10')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid^="design-file-row-"]').length).toBe(10);
    expect(screen.getByTestId('design-file-row-file-1.html')).toBeTruthy();
  });

  it('persists sort and page size preferences to localStorage', () => {
    renderPanel(generateFiles(60));

    chooseSelectOption('Page size', '60');
    chooseSelectOption('Sort by', 'Name');

    expect(lsStore.get('od:design-files:view-state:v1:test-project')).toContain('"pageSize":60');
    expect(lsStore.get('od:design-files:view-state:v1:test-project')).toContain('"sortKey":"name"');
  });

  it('filters files by kind and persists the selected filter', () => {
    renderPanel([
      file({ name: 'page.html', kind: 'html', mime: 'text/html' }),
      file({ name: 'chart.png', kind: 'image', mime: 'image/png' }),
    ]);

    fireEvent.click(screen.getByLabelText('Filter Image'));

    expect(screen.queryByTestId('design-file-row-page.html')).toBeNull();
    expect(screen.getByTestId('design-file-row-chart.png')).toBeTruthy();
    expect(lsStore.get('od:design-files:view-state:v1:test-project')).toContain('"kindFilter":["image"]');
  });

  it('resets transient state and reloads persisted view preferences when project changes', () => {
    lsStore.set('od:design-files:view-state:v1:project-b', JSON.stringify({ pageSize: 60 }));
    const { onDeleteFiles, rerenderPanel } = renderPanel(generateFiles(45), 'project-a');

    fireEvent.click(screen.getByLabelText('Select file-1.html'));
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeTruthy();
    expect(screen.getByText('1-30 of 45')).toBeTruthy();

    rerenderPanel(generateFiles(45), 'project-b');

    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
    expect(screen.getByLabelText('Select file-1.html').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('1-45 of 45')).toBeTruthy();
    expect(onDeleteFiles).not.toHaveBeenCalled();
  });

  it('passes selected file names to batch delete', () => {
    const { onDeleteFiles } = renderPanel(generateFiles(3));

    fireEvent.click(screen.getByLabelText('Select file-1.html'));
    fireEvent.click(screen.getByLabelText('Select file-2.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    expect(onDeleteFiles).toHaveBeenCalledWith(['file-1.html', 'file-2.png']);
  });

  it('batch deletes selected files across pagination in the current folder', () => {
    const { onDeleteFiles } = renderPanel(generateFiles(45));

    fireEvent.click(screen.getByLabelText('Select file-1.html'));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByLabelText('Select file-31.html'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    expect(onDeleteFiles).toHaveBeenCalledWith(['file-1.html', 'file-31.html']);
  });

  it('prevents duplicate batch delete while parent delete is pending', async () => {
    let resolveDelete: (() => void) | undefined;
    const onDeleteFiles = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    renderPanel(generateFiles(1), 'test-project', { onDeleteFiles });

    fireEvent.click(screen.getByLabelText('Select file-1.html'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    expect(onDeleteFiles).toHaveBeenCalledTimes(1);

    resolveDelete?.();
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Delete selected' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  it('does not batch delete a selected file hidden by folder navigation', () => {
    const { onDeleteFiles } = renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    fireEvent.click(screen.getByLabelText('Select top.html'));
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open folder assets' }));

    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
    expect(onDeleteFiles).not.toHaveBeenCalled();
  });

  it('passes a single file name to row delete', () => {
    const { onDeleteFile } = renderPanel(generateFiles(1));

    fireEvent.click(screen.getByRole('button', { name: 'Delete file-1.html' }));

    expect(onDeleteFile).toHaveBeenCalledWith('file-1.html');
  });

  it('passes old and new file names to row rename', () => {
    const { onRenameFile } = renderPanel(generateFiles(1));

    fireEvent.click(screen.getByRole('button', { name: 'Rename file-1.html' }));
    fireEvent.change(screen.getByLabelText('New name for file-1.html'), {
      target: { value: 'renamed.html' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rename file-1.html' }));

    expect(onRenameFile).toHaveBeenCalledWith('file-1.html', 'renamed.html');
  });

  it('closes rename UI without dispatching when the resolved name is unchanged', () => {
    const { onRenameFile } = renderPanel(generateFiles(1));

    fireEvent.click(screen.getByRole('button', { name: 'Rename file-1.html' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rename file-1.html' }));

    expect(onRenameFile).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('New name for file-1.html')).toBeNull();
  });

  it('keeps rename UI open when rename resolves to null', async () => {
    const onRenameFile = vi.fn().mockResolvedValue(null);
    renderPanel(generateFiles(1), 'test-project', { onRenameFile });

    fireEvent.click(screen.getByRole('button', { name: 'Rename file-1.html' }));
    fireEvent.change(screen.getByLabelText('New name for file-1.html'), {
      target: { value: 'renamed.html' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rename file-1.html' }));

    await waitFor(() => {
      expect(onRenameFile).toHaveBeenCalledWith('file-1.html', 'renamed.html');
    });
    expect(screen.getByLabelText('New name for file-1.html')).toBeTruthy();
  });

  it('keeps rename UI open when rename rejects', async () => {
    const onRenameFile = vi.fn().mockRejectedValue(new Error('rename failed'));
    renderPanel(generateFiles(1), 'test-project', { onRenameFile });

    fireEvent.click(screen.getByRole('button', { name: 'Rename file-1.html' }));
    fireEvent.change(screen.getByLabelText('New name for file-1.html'), {
      target: { value: 'renamed.html' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rename file-1.html' }));

    await waitFor(() => {
      expect(onRenameFile).toHaveBeenCalledWith('file-1.html', 'renamed.html');
    });
    expect(screen.getByLabelText('New name for file-1.html')).toBeTruthy();
  });

  it('preserves the current directory path when renaming inside a folder', () => {
    const { onRenameFile } = renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open folder assets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename assets/logo.png' }));
    fireEvent.change(screen.getByLabelText('New name for assets/logo.png'), {
      target: { value: 'logo-new.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rename assets/logo.png' }));

    expect(onRenameFile).toHaveBeenCalledWith('assets/logo.png', 'assets/logo-new.png');
  });

  it('shows basename-only labels and rename drafts inside a folder', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open folder assets' }));
    const row = screen.getByTestId('design-file-row-assets/logo.png');

    expect(row.textContent).toContain('logo.png');
    expect(row.textContent).not.toContain('assets/logo.png');

    fireEvent.click(screen.getByRole('button', { name: 'Rename assets/logo.png' }));
    const renameInput = screen.getByLabelText('New name for assets/logo.png') as HTMLInputElement;

    expect(renameInput.value).toBe('logo.png');
  });

  it('keeps directories visible while paginating current-folder files only', () => {
    const folderFiles = Array.from({ length: 5 }, (_, index) =>
      file({ name: `folder-${index + 1}/nested.html`, kind: 'html' }),
    );
    const { container } = renderPanel([...folderFiles, ...generateFiles(30)]);

    expect(screen.getByRole('button', { name: 'Open folder folder-1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open folder folder-5' })).toBeTruthy();
    expect(container.querySelectorAll('[data-testid^="design-file-row-file-"]').length).toBe(30);
    expect(screen.getByText('1-30 of 30')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open folder folder-1' }));

    expect(screen.getByTestId('design-file-row-folder-1/nested.html')).toBeTruthy();
    expect(screen.getByText('1-1 of 1')).toBeTruthy();
  });

  it('passes selected upload files to the parent upload-file callback', () => {
    const { onUploadFiles } = renderPanel(generateFiles(1));
    const upload = screen.getByLabelText('Upload files');
    const files = [new File(['hello'], 'hello.txt', { type: 'text/plain' })];

    fireEvent.change(upload, { target: { files } });

    expect(onUploadFiles).toHaveBeenCalledWith(files);
  });

  it('prunes selected files when removed so re-added names are not preselected', () => {
    const { onDeleteFiles, rerenderPanel } = renderPanel([
      file({ name: 'file-1.html' }),
      file({ name: 'file-2.html' }),
    ]);

    fireEvent.click(screen.getByLabelText('Select file-1.html'));
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeTruthy();

    rerenderPanel([file({ name: 'file-2.html' })]);
    rerenderPanel([file({ name: 'file-1.html' }), file({ name: 'file-2.html' })]);

    expect(screen.getByLabelText('Select file-1.html').getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
    expect(onDeleteFiles).not.toHaveBeenCalled();
  });

  it('navigates into folders and back to root', () => {
    renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'assets/icons/star.svg', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open folder assets' }));

    expect(screen.getByText('assets')).toBeTruthy();
    expect(screen.getByTestId('design-file-row-assets/logo.png')).toBeTruthy();
    expect(screen.queryByTestId('design-file-row-top.html')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Root folder' }));

    expect(screen.getByTestId('design-file-row-top.html')).toBeTruthy();
  });

  it('resets to root when the current directory disappears after rerender', () => {
    const { rerenderPanel } = renderPanel([
      file({ name: 'assets/logo.png', kind: 'image' }),
      file({ name: 'top.html', kind: 'html' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open folder assets' }));
    expect(screen.getByTestId('design-file-row-assets/logo.png')).toBeTruthy();

    rerenderPanel([file({ name: 'top.html', kind: 'html' })]);

    expect(screen.queryByRole('button', { name: 'Root folder' })).toBeNull();
    expect(screen.getByTestId('design-file-row-top.html')).toBeTruthy();
  });

  it('renders generated media cards with thumbnails and download links', () => {
    const onOpenLiveArtifact = vi.fn();
    renderPanel([], 'test-project', {
      liveArtifacts: [
        liveArtifact(),
        liveArtifact({
          tabId: liveArtifactTabId('artifact-2'),
          artifactId: 'artifact-2',
          title: 'Ambient audio',
          preview: { type: 'audio', url: 'https://example.com/audio.mp3' },
        }),
      ],
      onOpenLiveArtifact,
    });

    expect(screen.getByText('Generated Media')).toBeTruthy();
    expect(screen.getByAltText('Hero image').getAttribute('src')).toBe('https://example.com/thumb.png');
    expect(screen.getByText('Audio preview')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download Hero image' }).getAttribute('href')).toBe(
      'https://example.com/hero.png',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open live artifact Hero image' }));

    expect(onOpenLiveArtifact).toHaveBeenCalledWith(liveArtifactTabId('artifact-1'));
  });

  it('surfaces plugin folders with scheme action objects', async () => {
    const onPluginFolderAgentAction = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      [
        file({ name: 'generated-plugin/vibe-design.json', kind: 'code' }),
        file({ name: 'generated-plugin/SKILL.md', kind: 'text' }),
        file({ name: 'ordinary/readme.md', kind: 'text' }),
      ],
      'test-project',
      { onPluginFolderAgentAction },
    );

    expect(screen.getByTestId('design-plugin-folder-generated-plugin')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Install generated-plugin to My Plugins' }));
    await waitFor(() => {
      expect(onPluginFolderAgentAction).toHaveBeenCalledWith('generated-plugin', {
        kind: 'install-to-plugins',
        path: 'generated-plugin',
        pluginName: 'generated-plugin',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Publish generated-plugin repository' }));
    await waitFor(() => {
      expect(onPluginFolderAgentAction).toHaveBeenCalledWith('generated-plugin', {
        kind: 'publish-repo',
        path: 'generated-plugin',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Prototype Design PR for generated-plugin' }));
    await waitFor(() => {
      expect(onPluginFolderAgentAction).toHaveBeenCalledWith('generated-plugin', {
        kind: 'vibe-design-pr',
        path: 'generated-plugin',
        prTitle: 'Add generated-plugin to Prototype Design',
      });
    });
  });
});
