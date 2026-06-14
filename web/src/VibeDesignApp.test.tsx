// @vitest-environment jsdom
import React, { act } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { applyLocale } from './i18n';
import { createVibeDesignFlow } from './launch/vibe-design-flow';
import { ChatTimelineService } from './services/chat-timeline/internal/chat-timeline-service';
import { ContextPickerService } from './services/context-picker/internal/context-picker-service';
import type { CanvasPreviewComment } from './features/canvas-workspace/canvas-comment/canvas-comment-types';
import type { IPreviewCommentService } from './services/preview-comments/preview-comment-service.interface';
import type { PreviewCommentSnapshot } from './services/preview-comments/preview-comment-types';
import type { CreateProjectInput, IProjectService } from './services/projects/project-service.interface';
import type { DesignFileChangeEvent, IDesignFileService } from './services/design-files/design-file-service.interface';
import type { IChatSessionService } from './services/chat-session/chat-session-service.interface';
import type { SendTurnInput } from './services/chat-session/chat-session-types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderComponent(element: React.ReactNode): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

function cleanup(root: Root, container: HTMLElement): void {
  act(() => root.unmount());
  container.remove();
}

function pendingInitialPromptKey(projectId: string): string {
  return `vibe-design:initial-project-prompt:${projectId}`;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) {
    throw new Error(`Could not find button with text "${text}".`);
  }
  return button;
}

function queryButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  ) ?? null;
}

function tabButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) {
    throw new Error(`Could not find tab button with text "${text}".`);
  }
  return button;
}

function createTestChatSessionService(
  sendTurn: (input: SendTurnInput) => Promise<void>,
): IChatSessionService {
  return {
    _serviceBrand: undefined,
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ startingRun: false, queuedTurns: [] })),
    sendTurn: vi.fn(sendTurn),
    deleteQueuedTurn: vi.fn(),
    sendQueuedTurnNext: vi.fn(),
    stopActiveRun: vi.fn(async () => undefined),
    answerToolQuestion: vi.fn(async () => undefined),
  };
}

function createTestDesignFileService(): IDesignFileService {
  const listeners = new Set<(event: DesignFileChangeEvent) => void>();
  return {
    _serviceBrand: undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listFiles: vi.fn(async () => []),
    readFileContent: vi.fn(async () => ''),
    fileUrl: vi.fn((name: string) => `/api/projects/test-project/files/${encodeURIComponent(name)}`),
    saveFileContent: vi.fn(async (name: string, content: string) => {
      const file = {
        name,
        path: `assets/${name}`,
        kind: 'html' as const,
        mime: 'text/html',
        size: content.length,
        mtime: 1,
        updatedAt: 1,
      };
      listeners.forEach((listener) => listener({ type: 'saved', file, content }));
      return file;
    }),
    uploadFiles: vi.fn(async (files: File[]) =>
      files.map((file, index) => ({
        path: `assets/${file.name || `upload-${index}.png`}`,
        name: file.name || `upload-${index}.png`,
        kind: 'image' as const,
        size: file.size,
        mimeType: file.type || 'image/png',
      })),
    ),
  };
}

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
    status: 'needs_review',
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...comment, ...overrides } as CanvasPreviewComment;
}

function createPreviewCommentService(initial: PreviewCommentSnapshot): IPreviewCommentService {
  const listeners = new Set<() => void>();
  let snapshot = initial;
  return {
    _serviceBrand: undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: vi.fn(() => snapshot),
    load: vi.fn(async () => undefined),
    upsert: vi.fn(async (conversationId, input) => {
      const target =
        input.target && typeof input.target === 'object' ? (input.target as Partial<CanvasPreviewComment>) : {};
      const existing = snapshot.comments.find(
        (candidate) =>
          candidate.conversationId === conversationId &&
          candidate.filePath === target.filePath &&
          candidate.targetId === target.targetId,
      );
      const comment = previewComment({
        id: existing?.id ?? 'comment-saved',
        createdAt: existing?.createdAt ?? 1,
        conversationId,
        note: input.note,
        ...target,
        status: 'open',
        updatedAt: 2,
      });
      snapshot = {
        ...snapshot,
        comments: existing
          ? snapshot.comments.map((candidate) => (candidate.id === existing.id ? comment : candidate))
          : [comment, ...snapshot.comments],
      };
      for (const listener of listeners) listener();
      return comment;
    }),
    patchStatus: vi.fn(async (_conversationId, commentId, status) => {
      const comment = {
        ...(snapshot.comments.find((candidate) => candidate.id === commentId) ?? previewComment({ id: commentId })),
        status,
        updatedAt: 2,
      };
      snapshot = {
        ...snapshot,
        comments: snapshot.comments.map((candidate) => (candidate.id === commentId ? comment : candidate)),
      };
      for (const listener of listeners) listener();
      return comment;
    }),
    delete: vi.fn(async (_conversationId, commentId) => {
      snapshot = { ...snapshot, comments: snapshot.comments.filter((comment) => comment.id !== commentId) };
      for (const listener of listeners) listener();
    }),
  };
}

describe('VibeDesignApp', () => {
  it('uses the Tutti app context locale and follows host locale changes', async () => {
    const listeners = new Set<(context: { locale: string }) => void>();
    const tuttiWindow = window as typeof window & {
      tutti?: {
        appContext?: {
          get(): Promise<{ locale: string }>;
          subscribe(listener: (context: { locale: string }) => void): () => void;
        };
      };
    };
    tuttiWindow.tutti = {
      appContext: {
        get: vi.fn(async () => ({ locale: 'zh-CN' })),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };

    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      await waitFor(() => expect(container.textContent).toContain('新建原型'));
      expect(document.documentElement.lang).toBe('zh-CN');

      act(() => {
        for (const listener of listeners) listener({ locale: 'en' });
      });

      await waitFor(() => expect(container.textContent).toContain('New prototype'));
      expect(document.documentElement.lang).toBe('en');
    } finally {
      cleanup(root, container);
      delete tuttiWindow.tutti;
      applyLocale('en');
      document.documentElement.removeAttribute('lang');
    }
  });

  it('reloads dashboard design systems when the Tutti locale changes', async () => {
    const listeners = new Set<(context: { locale: string }) => void>();
    const tuttiWindow = window as typeof window & {
      tutti?: {
        appContext?: {
          get(): Promise<{ locale: string }>;
          subscribe(listener: (context: { locale: string }) => void): () => void;
        };
      };
    };
    tuttiWindow.tutti = {
      appContext: {
        get: vi.fn(async () => ({ locale: 'en' })),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/design-systems?locale=zh-CN') {
        return Response.json({
          designSystems: [
            {
              id: 'default',
              title: 'Vibe 默认',
              category: '应用',
              summary: '适合清晰工作台界面的克制应用设计系统。',
              swatches: ['#f7f8fb'],
              source: 'built-in',
              status: 'published',
              isEditable: false,
            },
          ],
        });
      }

      return Response.json({
        designSystems: [
          {
            id: 'default',
            title: 'Vibe Default',
            category: 'Application',
            summary: 'A quiet application design system.',
            swatches: ['#f7f8fb'],
            source: 'built-in',
            status: 'published',
            isEditable: false,
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);

    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        fireEvent.click(buttonByText(container, 'Set up design style'));
      });
      await waitFor(() => expect(document.body.textContent).toContain('Vibe Default'));
      expect(fetch).toHaveBeenCalledWith('/api/design-systems?locale=en');

      act(() => {
        for (const listener of listeners) listener({ locale: 'zh-CN' });
      });

      await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/design-systems?locale=zh-CN'));
      await waitFor(() => expect(document.body.textContent).toContain('Vibe 默认'));
      expect(document.body.textContent).not.toContain('Vibe Default');
    } finally {
      cleanup(root, container);
      vi.unstubAllGlobals();
      delete tuttiWindow.tutti;
      applyLocale('en');
      document.documentElement.removeAttribute('lang');
    }
  });

  it('does not render dashboard archive filters', () => {
    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      const archiveTabs = [
        ...container.querySelectorAll<HTMLButtonElement>('[data-dashboard-archive-tab]'),
      ].map((button) => button.dataset.dashboardArchiveTab);

      expect(archiveTabs).toEqual([]);
      expect(container.textContent).not.toContain('Recent');
      expect(container.textContent).not.toContain('Your designs');
      expect(container.textContent).not.toContain('Examples');
      expect(container.textContent).not.toContain('Design styles');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders dashboard copy with the selected locale and syncs document language', () => {
    const flow = createVibeDesignFlow({ locale: 'zh-CN' });
    const { container, root } = renderComponent(flow.render());

    try {
      expect(document.documentElement.lang).toBe('zh-CN');
      expect(container.textContent).toContain('新建原型');
      expect(container.querySelector('input[aria-label="项目名称"]')).toBeTruthy();
      expect(container.textContent).not.toContain('New prototype');
    } finally {
      cleanup(root, container);
      applyLocale('en');
      document.documentElement.removeAttribute('lang');
    }
  });

  it('sorts dashboard projects by updated time', () => {
    const flow = createVibeDesignFlow({
      recentProjects: [
        {
          id: 'old-created-new-updated',
          title: 'Old created, new updated',
          prompt: 'Old created, new updated',
          projectKind: 'prototype',
          createdAt: 100,
          updatedAt: 900,
        },
        {
          id: 'new-created-old-updated',
          title: 'New created, old updated',
          prompt: 'New created, old updated',
          projectKind: 'prototype',
          createdAt: 900,
          updatedAt: 100,
        },
        {
          id: 'middle-created-middle-updated',
          title: 'Middle created, middle updated',
          prompt: 'Middle created, middle updated',
          projectKind: 'prototype',
          createdAt: 500,
          updatedAt: 500,
        },
      ],
    });
    const { container, root } = renderComponent(flow.render());

    function projectIds(): string[] {
      return [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/project/"]')].map((link) =>
        decodeURIComponent(link.href.split('/project/')[1] ?? ''),
      );
    }

    try {
      expect(projectIds()).toEqual([
        'old-created-new-updated',
        'middle-created-middle-updated',
        'new-created-old-updated',
      ]);

      const projectMetadata = container.querySelector<HTMLElement>('[data-testid="dashboard-project-metadata"]');
      const ownerBadge = [...container.querySelectorAll<HTMLElement>('[data-slot="badge"]')].find((element) =>
        element.textContent?.trim() === 'Owner',
      );

      expect(projectMetadata?.className).toContain('font-normal');
      expect(projectMetadata?.className).toContain('mt-1');
      expect(projectMetadata?.className).not.toContain('mt-2');
      expect(ownerBadge?.className).toContain('font-normal');

      const projectPlaceholders = [...container.querySelectorAll<SVGElement>('[data-testid="project-empty-placeholder-icon"]')];
      expect(projectPlaceholders).toHaveLength(3);
      expect(projectPlaceholders.every((icon) => icon.getAttribute('width') === '32')).toBe(true);
      expect(projectPlaceholders.every((icon) => icon.getAttribute('height') === '32')).toBe(true);
      expect(projectPlaceholders.every((icon) => icon.className.baseVal.includes('text-[var(--text-placeholder)]'))).toBe(true);
      expect(projectPlaceholders.every((icon) => icon.querySelector('path')?.getAttribute('fill') === 'currentColor')).toBe(true);
    } finally {
      cleanup(root, container);
    }
  });

  it('renders dashboard project preview images when available', () => {
    const flow = createVibeDesignFlow({
      recentProjects: [
        {
          id: 'project-with-preview',
          title: 'Project with preview',
          prompt: 'Project with preview',
          projectKind: 'prototype',
          createdAt: 100,
          updatedAt: 100,
          coverUrl: '/api/projects/project-with-preview/files/homepage-preview.png',
        },
      ],
    });
    const { container, root } = renderComponent(flow.render());

    try {
      const image = container.querySelector<HTMLImageElement>('[data-testid="project-preview-image"]');
      expect(image).not.toBeNull();
      expect(image?.getAttribute('src')).toBe('/api/projects/project-with-preview/files/homepage-preview.png');
      expect(image?.parentElement?.className).toContain('h-40');
      expect(image?.parentElement?.className).toContain('sm:h-36');
      expect(image?.parentElement?.className).not.toContain('aspect-[3/2]');
      expect(image?.closest('[data-slot="card"]')?.className).toContain('gap-0');
      expect(image?.closest('[data-slot="card"]')?.querySelector('[data-slot="card-content"]')?.className).toContain('pt-2');
      expect(image?.closest('[data-slot="card"]')?.querySelector('[data-slot="card-content"]')?.className).not.toContain('pt-1');
      expect(image?.className).toContain('object-cover');
      expect(image?.className).toContain('object-top');
      expect(image?.className).not.toContain('object-contain');
      expect(image?.className).not.toContain('min-h-full');
      expect(image?.className).not.toContain('min-w-full');
      expect(container.querySelectorAll('[data-testid="project-empty-placeholder-icon"]')).toHaveLength(0);

      act(() => {
        fireEvent.error(image!);
      });

      expect(container.querySelector('[data-testid="project-preview-image"]')).toBeNull();
      expect(container.querySelectorAll('[data-testid="project-empty-placeholder-icon"]')).toHaveLength(1);
      expect(container.querySelector('[data-testid="project-empty-placeholder-icon"]')?.parentElement?.className).toContain('h-40');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders project screenshot covers before the project icon fallback', () => {
    const flow = createVibeDesignFlow({
      recentProjects: [
        {
          id: 'project-shot',
          title: 'Screenshot project',
          prompt: 'Screenshot project',
          projectKind: 'prototype',
          createdAt: 200,
          updatedAt: 200,
          coverUrl: '/api/projects/project-shot/files/cover.png',
        },
        {
          id: 'project-plain',
          title: 'Plain project',
          prompt: 'Plain project',
          projectKind: 'prototype',
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    });
    const { container, root } = renderComponent(flow.render());

    try {
      const screenshotCover = container.querySelector<HTMLImageElement>('[data-testid="project-preview-image"]');
      expect(screenshotCover).toBeInstanceOf(HTMLImageElement);
      expect(screenshotCover?.getAttribute('src')).toBe('/api/projects/project-shot/files/cover.png');
      expect(screenshotCover?.getAttribute('alt')).toBe('');

      expect(container.querySelector('[data-testid="project-empty-placeholder-icon"]')).not.toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('refreshes dashboard project covers when the window regains focus', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input) === '/api/projects') {
        return Response.json({
          projects: [
            {
              id: 'project-shot',
              title: 'Screenshot project',
              prompt: 'Screenshot project',
              projectKind: 'prototype',
              createdAt: 200,
              updatedAt: 201,
              coverUrl: '/api/projects/project-shot/files/cover.svg',
            },
          ],
        });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const flow = createVibeDesignFlow({
      recentProjects: [
        {
          id: 'project-shot',
          title: 'Screenshot project',
          prompt: 'Screenshot project',
          projectKind: 'prototype',
          createdAt: 200,
          updatedAt: 200,
        },
      ],
    });
    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.querySelector('[data-testid="project-preview-image"]')).toBeNull();

      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(container.querySelector<HTMLImageElement>('[data-testid="project-preview-image"]')?.getAttribute('src')).toBe(
          '/api/projects/project-shot/files/cover.svg',
        );
      });
    } finally {
      cleanup(root, container);
      vi.unstubAllGlobals();
    }
  });

  it('creates a project from the dashboard project name field and opens it', async () => {
    const createdInputs: CreateProjectInput[] = [];
    const openedProjects: string[] = [];
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        createdInputs.push(input);
        return {
          id: 'project-12345678',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectDesignSystem(projectId, designSystemId) {
        return {
          id: projectId,
          title: 'Project',
          prompt: 'Project',
          projectKind: 'prototype',
          designSystemId,
          createdAt: 1,
          updatedAt: 1,
        };
      },
    };
    const flow = createVibeDesignFlow({
      projectService,
      openProject: (projectId) => openedProjects.push(projectId),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"]',
      );
      const submit = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );

      expect(projectName).not.toBeNull();
      expect(submit).not.toBeNull();

      await act(async () => {
        fireEvent.change(projectName!, { target: { value: '我想生成一个登陆页' } });
        fireEvent.click(submit!);
      });

      expect(createdInputs).toEqual([
        {
          prompt: '我想生成一个登陆页',
          projectKind: 'prototype',
        },
      ]);
      expect(projectName!.value).toBe('');
      expect(openedProjects).toEqual(['project-12345678']);
    } finally {
      cleanup(root, container);
    }
  });

  it('creates a dashboard project with the official design system', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        designSystems: [
          {
            id: 'default',
            title: 'Vibe Default',
            category: 'Application',
            summary: 'A quiet application design system.',
            swatches: ['#f7f8fb', '#111827', '#2563eb'],
            source: 'built-in',
            status: 'published',
            isEditable: false,
          },
          {
            id: 'user:atelier-zero',
            title: 'Atelier Zero',
            category: 'Editorial',
            summary: 'Warm paper and editorial rhythm.',
            swatches: ['#f7f0e8', '#111111'],
            source: 'user',
            status: 'draft',
            isEditable: true,
          },
          {
            id: 'anthropic-web',
            title: 'Anthropic Web Reference',
            category: 'Research product',
            summary: 'Official product reference system.',
            swatches: ['#f7f0e8', '#111111'],
            source: 'built-in',
            status: 'published',
            isEditable: false,
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetch);
    const createdInputs: CreateProjectInput[] = [];
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        createdInputs.push(input);
        return {
          id: 'project-design-system',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectDesignSystem(projectId, designSystemId) {
        return {
          id: projectId,
          title: 'Project',
          prompt: 'Project',
          projectKind: 'prototype',
          designSystemId,
          createdAt: 1,
          updatedAt: 1,
        };
      },
    };
    const flow = createVibeDesignFlow({
      projectService,
      openProject: vi.fn(),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        fireEvent.click(buttonByText(container, 'Set up design style'));
      });

      await waitFor(() => {
        expect(document.body.textContent).toContain('Vibe Default');
      });
      expect(fetch).toHaveBeenCalledWith('/api/design-systems?locale=en');
      expect(document.body.textContent).toContain('Choose design styles');
      expect(document.body.textContent).toContain('Selected');
      expect(document.body.textContent).toContain('Available');
      expect(document.body.textContent).not.toContain('Browse Design System');
      expect(document.body.textContent).not.toContain('Atelier Zero');

      const anthropicOption = document.body.querySelector(
        '[aria-label="Select design style Anthropic Web Reference"]',
      );
      if (!(anthropicOption instanceof HTMLButtonElement)) {
        throw new Error('Missing Anthropic design system option');
      }

      await act(async () => {
        fireEvent.click(anthropicOption);
      });

      expect(container.querySelector('[data-testid="dashboard-selected-design-system"]')).toBeNull();
      expect(container.querySelector('input[name="designSystemId"]')).toBeNull();
      expect(buttonByText(container, 'Set up design style')).toBeTruthy();

      const creatorDesignSystem = container.querySelector('[data-testid="dashboard-creator-design-system"]');
      expect(container.querySelector('form')?.contains(creatorDesignSystem)).toBe(true);
      expect(document.body.textContent).not.toContain('No assets in Anthropic Web Reference');

      const doneButton = buttonByText(document.body, 'Done');
      expect(doneButton.className).toContain('project-primary-button');

      await act(async () => {
        doneButton.click();
      });

      await waitFor(() => expect(document.body.textContent).not.toContain('Choose design styles'));
      const selectedDesignSystemSummary = container.querySelector(
        '[data-testid="dashboard-selected-design-system"]',
      );
      const swatches = selectedDesignSystemSummary?.querySelectorAll(
        '[aria-label="Anthropic Web Reference color swatches"] span',
      );
      expect(selectedDesignSystemSummary?.textContent).toContain('Anthropic Web Reference');
      expect(selectedDesignSystemSummary?.textContent).toContain('Official product reference system.');
      expect(selectedDesignSystemSummary?.textContent).not.toContain('Design style');
      const reselectDesignSystemButton = buttonByText(container, 'Reselect design style');
      expect(reselectDesignSystemButton.className).toContain('project-secondary-button');
      expect(container.textContent).not.toContain('Set up design style');
      expect(swatches).toHaveLength(2);
      expect((swatches?.[0] as HTMLElement | undefined)?.style.backgroundColor).toBe('rgb(247, 240, 232)');
      expect((swatches?.[1] as HTMLElement | undefined)?.style.backgroundColor).toBe('rgb(17, 17, 17)');

      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"]',
      );
      const submit = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );

      await act(async () => {
        fireEvent.change(projectName!, { target: { value: '品牌仪表盘' } });
        fireEvent.click(submit!);
      });

      expect(createdInputs).toEqual([
        {
          prompt: '品牌仪表盘',
          projectKind: 'prototype',
          designSystemId: 'anthropic-web',
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
      cleanup(root, container);
    }
  });

  it('keeps the dashboard design system unselected when opening the picker without an outer selection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        designSystems: [
          {
            id: 'default',
            title: 'Vibe Default',
            category: 'Application',
            summary: 'A quiet application design system.',
            swatches: ['#f7f8fb', '#111827', '#2563eb'],
            source: 'built-in',
            status: 'published',
            isEditable: false,
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetch);
    const createdInputs: CreateProjectInput[] = [];
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        createdInputs.push(input);
        return {
          id: 'project-without-design-system',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectDesignSystem(projectId, designSystemId) {
        return {
          id: projectId,
          title: 'Project',
          prompt: 'Project',
          projectKind: 'prototype',
          designSystemId,
          createdAt: 1,
          updatedAt: 1,
        };
      },
    };
    const flow = createVibeDesignFlow({
      projectService,
      openProject: vi.fn(),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        fireEvent.click(buttonByText(container, 'Set up design style'));
      });

      await waitFor(() => {
        expect(document.body.textContent).toContain('Vibe Default');
      });
      expect(document.body.textContent).toContain('No design style selected');
      expect(document.body.querySelector('[aria-label="Remove Vibe Default"]')).toBeNull();

      await act(async () => {
        fireEvent.change(container.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!, {
          target: { value: '无默认设计系统项目' },
        });
        fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Create prototype"]')!);
      });

      expect(createdInputs).toEqual([
        {
          prompt: '无默认设计系统项目',
          projectKind: 'prototype',
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
      cleanup(root, container);
    }
  });

  it('does not expose custom design system management in the dashboard', async () => {
    const designSystems = [
      {
        id: 'user:acme-core',
        title: 'Acme Core',
        category: 'Productivity',
        summary: 'Operational product surfaces.',
        swatches: ['#f7f8fb', '#111827', '#3366ff'],
        source: 'user',
        status: 'draft',
        isEditable: true,
      },
      {
        id: 'default',
        title: 'Vibe Default',
        category: 'Application',
        summary: 'A quiet application design system.',
        swatches: ['#f7f8fb', '#111827', '#2563eb'],
        source: 'built-in',
        status: 'published',
        isEditable: false,
      },
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/design-systems?locale=en' && (!init?.method || init.method === 'GET')) {
        return Response.json({ designSystems });
      }
      return Response.json({ error: { message: `Unexpected ${init?.method ?? 'GET'} ${url}` } }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const createdInputs: CreateProjectInput[] = [];
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        createdInputs.push(input);
        return {
          id: 'project-custom-design-system',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectDesignSystem(projectId, designSystemId) {
        return {
          id: projectId,
          title: 'Project',
          prompt: 'Project',
          projectKind: 'prototype',
          designSystemId,
          createdAt: 1,
          updatedAt: 1,
        };
      },
    };
    const flow = createVibeDesignFlow({
      projectService,
      openProject: vi.fn(),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        fireEvent.click(buttonByText(container, 'Set up design style'));
      });

      await waitFor(() => {
        expect(document.body.textContent).toContain('Vibe Default');
      });
      expect(document.body.textContent).not.toContain('Acme Core');
      expect(document.body.textContent).not.toContain('Create custom design style');
      expect(document.body.textContent).not.toContain('Delete Acme Core');

      const defaultOption = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Select design style Vibe Default"]',
      );
      if (!(defaultOption instanceof HTMLButtonElement)) {
        throw new Error('Missing Vibe Default design system option');
      }

      await act(async () => {
        fireEvent.click(defaultOption);
      });

      expect(container.querySelector('[data-testid="dashboard-selected-design-system"]')).toBeNull();
      expect(container.querySelector<HTMLInputElement>('input[name="designSystemId"]')).toBeNull();
      expect(document.body.querySelector('[aria-label="Remove Vibe Default"]')).not.toBeNull();

      await act(async () => {
        buttonByText(document.body, 'Done').click();
      });

      await waitFor(() => expect(document.body.textContent).not.toContain('Choose design styles'));
      expect(container.querySelector('[data-testid="dashboard-selected-design-system"]')?.textContent).toContain(
        'Vibe Default',
      );
      expect(container.querySelector<HTMLInputElement>('input[name="designSystemId"]')?.value).toBe('default');

      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"]',
      );
      const submit = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );

      await act(async () => {
        fireEvent.change(projectName!, { target: { value: '运营面板' } });
        fireEvent.click(submit!);
      });

      expect(createdInputs).toEqual([
        {
          prompt: '运营面板',
          projectKind: 'prototype',
          designSystemId: 'default',
        },
      ]);
      expect(fetch).not.toHaveBeenCalledWith('/api/design-systems', expect.objectContaining({ method: 'POST' }));
      expect(fetch).not.toHaveBeenCalledWith('/api/design-systems/user%3Aacme-core', { method: 'DELETE' });
    } finally {
      vi.unstubAllGlobals();
      cleanup(root, container);
    }
  });

  it('clears the selected dashboard design system from the picker', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        designSystems: [
          {
            id: 'jimmeng-ai',
            title: 'Jimeng AI Reference',
            category: 'AI media',
            summary: 'A vivid AI creation design system.',
            swatches: ['#f3f8ff', '#111111'],
            source: 'built-in',
            status: 'published',
            isEditable: false,
          },
          {
            id: 'anthropic-web',
            title: 'Anthropic Web Reference',
            category: 'Research product',
            summary: 'A warm editorial research system.',
            swatches: ['#f7f0e8', '#111111'],
            source: 'built-in',
            status: 'published',
            isEditable: false,
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetch);
    const createdInputs: CreateProjectInput[] = [];
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        createdInputs.push(input);
        return {
          id: 'project-with-cleared-design-system',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectDesignSystem(projectId, designSystemId) {
        return {
          id: projectId,
          title: 'Project',
          prompt: 'Project',
          projectKind: 'prototype',
          designSystemId,
          createdAt: 1,
          updatedAt: 1,
        };
      },
    };
    const flow = createVibeDesignFlow({
      projectService,
      openProject: vi.fn(),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        fireEvent.click(buttonByText(container, 'Set up design style'));
      });

      await waitFor(() => {
        expect(document.body.textContent).toContain('Jimeng AI Reference');
      });

      const jimengOption = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Select design style Jimeng AI Reference"]',
      );
      if (!(jimengOption instanceof HTMLButtonElement)) {
        throw new Error('Missing Jimeng design system option');
      }

      await act(async () => {
        fireEvent.click(jimengOption);
      });

      const removeButton = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Remove Jimeng AI Reference"]',
      );
      if (!removeButton) {
        throw new Error('Missing remove design system button');
      }
      expect(removeButton.closest('.chat-composer__design-system-selected-card')?.className).not.toContain(
        'chat-composer__design-system-selected-card--clearable',
      );
      expect(document.body.textContent).not.toContain('Default');

      await act(async () => {
        fireEvent.click(removeButton);
      });

      expect(document.body.textContent).toContain('No design style selected');
      expect(document.body.querySelector('[aria-label="Select design style Jimeng AI Reference"]')).not.toBeNull();

      await act(async () => {
        buttonByText(document.body, 'Done').click();
      });

      await waitFor(() => expect(document.body.textContent).not.toContain('Choose design styles'));
      expect(container.querySelector('[data-testid="dashboard-selected-design-system"]')).toBeNull();

      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"]',
      );
      const submit = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );

      await act(async () => {
        fireEvent.change(projectName!, { target: { value: '无设计系统项目' } });
        fireEvent.click(submit!);
      });

      expect(createdInputs).toEqual([
        {
          prompt: '无设计系统项目',
          projectKind: 'prototype',
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
      cleanup(root, container);
    }
  });

  it('does not stash the dashboard project name as an initial chat prompt', async () => {
    sessionStorage.clear();
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        return {
          id: 'project-handoff',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectDesignSystem(projectId, designSystemId) {
        return {
          id: projectId,
          title: 'Project',
          prompt: 'Project',
          projectKind: 'prototype',
          designSystemId,
          createdAt: 1,
          updatedAt: 1,
        };
      },
    };
    const flow = createVibeDesignFlow({
      projectService,
      openProject: vi.fn(),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"]',
      );
      const submit = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );

      await act(async () => {
        fireEvent.change(projectName!, { target: { value: '把这个需求带到项目里' } });
        fireEvent.click(submit!);
      });

      expect(sessionStorage.getItem(pendingInitialPromptKey('project-handoff'))).toBeNull();
    } finally {
      sessionStorage.clear();
      cleanup(root, container);
    }
  });

  it('creates a project from the dashboard form submission', async () => {
    const createdInputs: CreateProjectInput[] = [];
    const openedProjects: string[] = [];
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        createdInputs.push(input);
        return {
          id: 'project-enter',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectDesignSystem(projectId, designSystemId) {
        return {
          id: projectId,
          title: 'Project',
          prompt: 'Project',
          projectKind: 'prototype',
          designSystemId,
          createdAt: 1,
          updatedAt: 1,
        };
      },
    };
    const flow = createVibeDesignFlow({
      projectService,
      openProject: (projectId) => openedProjects.push(projectId),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"]',
      );
      const createButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );
      const form = createButton?.closest('form');

      expect(projectName).not.toBeNull();
      expect(form).not.toBeNull();

      await act(async () => {
        fireEvent.change(projectName!, { target: { value: '提交创建项目' } });
        fireEvent.submit(form!);
      });

      expect(createdInputs).toEqual([
        {
          prompt: '提交创建项目',
          projectKind: 'prototype',
        },
      ]);
      expect(openedProjects).toEqual(['project-enter']);
    } finally {
      cleanup(root, container);
    }
  });

  it('renders the dashboard project name as the synchronized form field', () => {
    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"][name="prompt"]',
      );

      expect(projectName).not.toBeNull();
      expect(projectName!.type).toBe('text');
      expect(container.querySelector('textarea[placeholder="描述你想生成的内容..."]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('does not render prototype fidelity choices in the dashboard creator', () => {
    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      const highFidelity = container.querySelector<HTMLButtonElement>(
        'button[aria-label="High fidelity prototype"]',
      );
      const wireframe = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Wireframe prototype"]',
      );

      expect(highFidelity).toBeNull();
      expect(wireframe).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('renders the dashboard project setup and design system entry', () => {
    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).toContain('New prototype');
      expect(container.textContent).not.toContain('Wireframe');
      expect(container.textContent).not.toContain('High fidelity');
      expect(container.textContent).toContain('Design style');
      expect(container.textContent).toContain('Set up design style');
      expect(buttonByText(container, 'Set up design style').className).toContain('project-secondary-button');
      expect(buttonByText(container, 'Set up design style').className).not.toContain('project-primary-button');
      expect(container.querySelector('input[aria-label="Search designs"]')).not.toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('renders the dashboard submit action as create', () => {
    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      const createButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );

      expect(createButton).not.toBeNull();
      expect(createButton!.textContent).toContain('Create');
      expect(container.querySelector('button[aria-label="创建项目"]')).toBeNull();
      expect(createButton!.textContent).not.toContain('Upload');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders the dashboard as a split project browser shell', () => {
    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).not.toContain('Research Preview');
      expect(container.textContent).toContain('New prototype');

      const projectName = container.querySelector<HTMLInputElement>(
        'input[aria-label="Project name"]',
      );
      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search designs"]',
      );
      const createButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create prototype"]',
      );
      const main = container.querySelector('main');
      const sidebar = container.querySelector('aside');
      const projectBrowser = container.querySelector('main > div > section');
      const searchRow = container.querySelector<HTMLElement>('[data-testid="dashboard-search-row"]');
      const projectGrid = container.querySelector<HTMLElement>('[data-testid="dashboard-project-grid"]');
      const brandIcon = container.querySelector('img[data-testid="brand-icon"][src="/icon.png"]');
      const designSystemDescription = [...container.querySelectorAll<HTMLElement>('p')].find((element) =>
        element.textContent?.includes('Choose an official design style'),
      );

      expect(projectName).not.toBeNull();
      expect(search).not.toBeNull();
      expect(createButton).not.toBeNull();
      expect(brandIcon).not.toBeNull();
      expect(container.querySelector('[data-testid="project-empty-placeholder-icon"]')).not.toBeNull();
      expect(designSystemDescription?.className).toContain('font-normal');
      expect(container.textContent).not.toContain('Anyone in your organization');
      expect(main?.className).toContain('h-screen');
      expect(main?.className).toContain('overflow-hidden');
      expect(sidebar?.className).toContain('overflow-y-auto');
      expect(projectBrowser?.className).toContain('overflow-y-auto');
      expect(searchRow?.className).toContain('justify-start');
      expect(searchRow?.className).not.toContain('justify-end');
      expect(projectGrid?.className).toContain('grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))]');
      expect(projectGrid?.className).not.toContain('max-w-');
      expect(projectGrid?.className).not.toContain('lg:grid-cols-4');
      expect(container.querySelector('[data-dashboard-project-type]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('clears a pending dashboard prompt without starting the project conversation', async () => {
    sessionStorage.setItem(pendingInitialPromptKey('project-from-dashboard'), '自动发起这个对话');
    const sendTurn = vi.fn<(input: SendTurnInput) => Promise<void>>(async () => undefined);
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'project-from-dashboard' },
      projectEditor: {
        project: { id: 'project-from-dashboard', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
      chatSessionService: createTestChatSessionService(sendTurn),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(sendTurn).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(pendingInitialPromptKey('project-from-dashboard'))).toBeNull();
      expect(container.textContent).not.toContain('自动发起这个对话');
    } finally {
      sessionStorage.clear();
      cleanup(root, container);
    }
  });

  it('does not replay a pending dashboard prompt when the initial user message is already loaded', async () => {
    sessionStorage.setItem(pendingInitialPromptKey('project-from-dashboard'), '自动发起这个对话');
    const sendTurn = vi.fn<(input: SendTurnInput) => Promise<void>>(async () => undefined);
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'project-from-dashboard' },
      projectEditor: {
        project: { id: 'project-from-dashboard', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: '自动发起这个对话', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [
          {
            id: 'initial-user-message',
            role: 'user',
            content: '自动发起这个对话',
            attachments: [],
            commentAttachments: [],
            events: [],
            blocks: [{ kind: 'text', content: '自动发起这个对话', markdown: true }],
            createdAt: 1,
          },
        ],
      },
      chatSessionService: createTestChatSessionService(sendTurn),
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(sendTurn).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(pendingInitialPromptKey('project-from-dashboard'))).toBeNull();
      expect(container.textContent).toContain('自动发起这个对话');
    } finally {
      sessionStorage.clear();
      cleanup(root, container);
    }
  });

  it('does not pin persisted running todos above the project composer on initial load', async () => {
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'project-with-running-todos' },
      projectEditor: {
        project: { id: 'project-with-running-todos', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Running todos', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Working through the checklist.',
            events: [
              {
                type: 'tool_use',
                id: 'todo-1',
                name: 'TodoWrite',
                input: {
                  todos: [
                    { content: 'Read source', status: 'completed' },
                    { content: 'Build fixed todo list', active_form: 'Writing current screen', status: 'in_progress' },
                    { content: 'Verify layout', status: 'pending' },
                  ],
                },
              },
            ],
            blocks: [],
            runId: 'run-1',
            runStatus: 'running',
            createdAt: 1,
            startedAt: 1,
          },
        ],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.querySelector('[aria-label="Pinned todo"]')).toBeNull();
      expect(container.textContent).toContain('Read source');
      expect(container.textContent).toContain('Build fixed todo list');
      expect(container.textContent).toContain('Verify layout');
    } finally {
      cleanup(root, container);
    }
  });

  it('selects an official design system from the project composer', async () => {
    const updateProjectDesignSystem = vi.fn(async (projectId: string, designSystemId: string | null) => ({
      id: projectId,
      title: 'Project',
      prompt: 'Project',
      projectKind: 'prototype',
      designSystemId,
      createdAt: 1,
      updatedAt: 2,
    }));
    const projectService: IProjectService = {
      _serviceBrand: undefined,
      async createProject(input) {
        return {
          id: 'project-context-design-system',
          title: input.prompt,
          prompt: input.prompt,
          projectKind: input.projectKind,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async updateProjectTabsState() {},
      async updateProjectTitle(projectId, title) {
        return {
          id: projectId,
          title,
          prompt: 'Project',
          projectKind: 'prototype',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      updateProjectDesignSystem,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        designSystems: [
          {
            id: 'anthropic-web',
            title: 'Anthropic Web Reference',
            category: 'Research product',
            summary: 'Official product reference.',
            swatches: ['#f7f0e8', '#111111'],
            source: 'built-in',
          },
          {
            id: 'user-acme',
            title: 'ACME',
            category: 'Draft',
            summary: 'User draft.',
            swatches: ['#ffffff'],
            source: 'user',
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetch);
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'project-context-design-system' },
      projectEditor: {
        project: { id: 'project-context-design-system', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Project', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
      projectService,
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Choose design style"]');
      expect(trigger).not.toBeNull();

      await act(async () => {
        fireEvent.click(trigger!);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain('Anthropic Web Reference');
      });
      expect(document.body.textContent).not.toContain('ACME');

      const option = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Select design style Anthropic Web Reference"]',
      );
      expect(option).not.toBeNull();

      await act(async () => {
        fireEvent.click(option!);
        await Promise.resolve();
      });

      expect(updateProjectDesignSystem).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('Anthropic Web Reference');

      const doneButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
        button.textContent?.includes('Done'),
      );
      expect(doneButton).not.toBeUndefined();

      await act(async () => {
        fireEvent.click(doneButton!);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(updateProjectDesignSystem).toHaveBeenCalledWith(
          'project-context-design-system',
          'anthropic-web',
        );
      });
      await waitFor(() => expect(container.textContent).toContain('Anthropic Web Reference'));

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[aria-label="Choose design style"]')?.click();
        await Promise.resolve();
      });

      const removeButton = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Remove Anthropic Web Reference"]',
      );
      expect(removeButton).not.toBeNull();

      await act(async () => {
        fireEvent.click(removeButton!);
        await Promise.resolve();
      });

      expect(updateProjectDesignSystem).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain('No design style selected');

      await act(async () => {
        buttonByText(document.body, 'Done').click();
        await Promise.resolve();
      });

      expect(updateProjectDesignSystem).toHaveBeenLastCalledWith(
        'project-context-design-system',
        null,
      );
      await waitFor(() => expect(container.textContent).not.toContain('Anthropic Web Reference'));
    } finally {
      vi.unstubAllGlobals();
      cleanup(root, container);
    }
  });

  it('renders dashboard design system picker options without official badges', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        designSystems: [
          {
            id: 'anthropic-web',
            title: 'Anthropic Web Reference',
            category: 'Research product',
            summary: 'A warm editorial research system.',
            swatches: ['#f7f0e8', '#111111'],
            source: 'built-in',
            status: 'published',
            isEditable: false,
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetch);
    const flow = createVibeDesignFlow();
    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        buttonByText(container, 'Set up design style').click();
      });

      await waitFor(() => {
        expect(document.body.textContent).toContain('Anthropic Web Reference');
      });
      expect(document.body.textContent).not.toContain('Official');
    } finally {
      vi.unstubAllGlobals();
      cleanup(root, container);
    }
  });

  it('repaints when context and timeline services emit state changes', async () => {
    const timeline = new ChatTimelineService();
    const context = new ContextPickerService({
      listSkills: async () => [
        { id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' },
      ],
      listDesignFiles: async () => [],
    });
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'demo-project' },
      chatTimelineService: timeline,
      contextPickerService: context,
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).not.toContain('Hero Builder');
      expect(container.textContent).not.toContain('Build it');

      await act(async () => {
        await context.selectSkill('skill-1');
      });
      expect(container.textContent).toContain('Hero Builder');

      act(() => {
        timeline.appendUserMessage({ content: 'Build it', attachments: [] });
      });
      expect(container.textContent).toContain('Build it');
    } finally {
      cleanup(root, container);
    }
  });

  it('hydrates the selected project design system label when opening a project', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        designSystems: [
          {
            id: 'capcut',
            title: 'CapCut Creator Reference',
            category: 'Creator tools',
            summary: 'Short-form video product reference.',
            swatches: ['#111111', '#ffffff'],
            source: 'built-in',
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetch);
    const flow = createVibeDesignFlow({
      locale: 'zh-CN',
      route: { kind: 'project', projectId: 'project-with-design-system' },
      projectEditor: {
        project: {
          id: 'project-with-design-system',
          designSystemId: 'capcut',
          tabsState: { tabs: [], activeTabKey: null },
        },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Project', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await waitFor(() => {
        expect(container.textContent).toContain('CapCut Creator Reference');
      });
      expect(fetch).toHaveBeenCalledWith('/api/design-systems?locale=zh-CN');
    } finally {
      applyLocale('en');
      cleanup(root, container);
    }
  });

  it('reloads the selected project design system label when the Tutti locale changes', async () => {
    const listeners = new Set<(context: { locale: string }) => void>();
    const tuttiWindow = window as typeof window & {
      tutti?: {
        appContext?: {
          get(): Promise<{ locale: string }>;
          subscribe(listener: (context: { locale: string }) => void): () => void;
        };
      };
    };
    tuttiWindow.tutti = {
      appContext: {
        get: vi.fn(async () => ({ locale: 'en' })),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/design-systems?locale=zh-CN') {
        return Response.json({
          designSystems: [
            {
              id: 'capcut',
              title: 'CapCut 创作者参考',
              category: '创作者工具',
              summary: '受 CapCut 公开编辑器和落地页启发的高速 AI 创作套件系统。',
              swatches: ['#111111', '#ffffff'],
              source: 'built-in',
            },
          ],
        });
      }

      return Response.json({
        designSystems: [
          {
            id: 'capcut',
            title: 'CapCut Creator Reference',
            category: 'Creator tools',
            summary: 'Short-form video product reference.',
            swatches: ['#111111', '#ffffff'],
            source: 'built-in',
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'project-with-design-system' },
      projectEditor: {
        project: {
          id: 'project-with-design-system',
          designSystemId: 'capcut',
          tabsState: { tabs: [], activeTabKey: null },
        },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Project', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await waitFor(() => expect(container.textContent).toContain('CapCut Creator Reference'));
      expect(fetch).toHaveBeenCalledWith('/api/design-systems?locale=en');

      act(() => {
        for (const listener of listeners) listener({ locale: 'zh-CN' });
      });

      await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/design-systems?locale=zh-CN'));
      await waitFor(() => expect(container.textContent).toContain('CapCut 创作者参考'));
      expect(container.textContent).not.toContain('CapCut Creator Reference');
    } finally {
      applyLocale('en');
      cleanup(root, container);
      vi.unstubAllGlobals();
      delete tuttiWindow.tutti;
      document.documentElement.removeAttribute('lang');
    }
  });

  it('opens a generated file in the right-side canvas workspace', async () => {
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'generated-file-project' },
      projectEditor: {
        project: { id: 'generated-file-project', tabsState: { tabs: [], activeTabKey: null } },
        files: [
          {
            name: 'calm-blue-alarm-iphone.html',
            path: 'calm-blue-alarm-iphone.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main><h1>闹钟</h1></main>',
          },
        ],
        conversations: [{ id: 'conversation-1', title: '制作一个闹钟应用', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            runStatus: 'succeeded',
            events: [],
            blocks: [
              {
                kind: 'generated-files',
                files: [
                  {
                    name: 'calm-blue-alarm-iphone.html',
                    artifactType: 'text/html',
                    title: '安静蓝色闹钟 iPhone 界面',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.querySelector('[data-testid="canvas-preview-srcdoc"]')).toBeNull();

      const generatedFileButton = container.querySelector<HTMLButtonElement>('.tool-card__row button');
      expect(generatedFileButton).not.toBeNull();

      await act(async () => {
        fireEvent.click(generatedFileButton!);
      });

      expect(container.querySelector('[data-testid="canvas-preview-srcdoc"]')).toBeInstanceOf(HTMLIFrameElement);
      expect(container.textContent).toContain('Preview');
      expect(container.textContent).toContain('calm-blue-alarm-iphone.html');
    } finally {
      cleanup(root, container);
    }
  });

  it('opens a user file attachment in the right-side design files workspace', async () => {
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'attachment-file-project' },
      projectEditor: {
        project: { id: 'attachment-file-project', tabsState: { tabs: [], activeTabKey: null } },
        files: [
          {
            name: 'image-output.mp4',
            path: 'image-output.mp4',
            kind: 'unsupported',
            mime: 'video/mp4',
            contents: 'binary video contents',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Review attached file', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Review the attached file.',
            attachments: [
              {
                path: 'assets/image-output.mp4',
                name: 'image-output.mp4',
                kind: 'file',
                mimeType: 'video/mp4',
              },
            ],
            events: [],
            blocks: [],
          },
        ],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.querySelector('[data-testid="canvas-preview-srcdoc"]')).toBeNull();

      const attachmentButton = buttonByText(container, 'image-output.mp4');

      await act(async () => {
        fireEvent.click(attachmentButton);
      });

      expect(container.textContent).toContain('Design Files');
      expect(container.textContent).toContain('image-output.mp4');
      expect(container.textContent).toContain('该资源不支持展示');
      expect(container.textContent).not.toContain('binary video contents');
      expect(container.querySelector('[data-testid="design-file-code-preview"]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('refreshes comment-mode srcdoc contents after a run updates project files', async () => {
    const timeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-1', title: 'Apply comment', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'Apply comment',
        messages: [],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });
    const designFiles = {
      ...createTestDesignFileService(),
      listFiles: vi.fn(async () => [
        {
          name: 'landing.html',
          path: 'assets/landing.html',
          kind: 'html' as const,
          mime: 'text/html',
          size: 74,
          mtime: 2,
          updatedAt: 2,
        },
      ]),
      readFileContent: vi.fn(async () => '<main><h1 data-vd-id="hero">Updated Hero</h1></main>'),
      fileUrl: vi.fn((name: string) => `/api/projects/comment-refresh-project/files/${encodeURIComponent(name)}`),
    };
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'comment-refresh-project' },
      chatTimelineService: timeline,
      designFileService: designFiles as unknown as IDesignFileService,
      projectEditor: {
        project: {
          id: 'comment-refresh-project',
          tabsState: {
            tabs: [{ kind: 'file', key: 'file:landing.html', path: 'landing.html', name: 'landing.html' }],
            activeTabKey: 'file:landing.html',
          },
        },
        files: [
          {
            name: 'landing.html',
            path: 'landing.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main><h1 data-vd-id="hero">Old Hero</h1></main>',
            url: '/api/projects/comment-refresh-project/files/landing.html',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Apply comment', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        fireEvent.click(tabButtonByText(container, 'Mark up'));
      });
      expect(container.querySelector('[data-testid="canvas-preview-srcdoc"]')?.getAttribute('srcdoc')).toContain(
        'Old Hero',
      );

      act(() => {
        timeline.startAssistantRun({ runId: 'run-1', conversationId: 'conversation-1' });
      });
      act(() => {
        timeline.finishRun('run-1', { status: 'succeeded' });
      });

      await waitFor(() => expect(designFiles.listFiles).toHaveBeenCalledOnce());
      await waitFor(() => {
        const srcdoc = container.querySelector('[data-testid="canvas-preview-srcdoc"]')?.getAttribute('srcdoc');
        expect(srcdoc).toContain('Updated Hero');
        expect(srcdoc).not.toContain('Old Hero');
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('refreshes design files while an active run reports a generated file', async () => {
    const timeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-1', title: 'Generate brief', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'Generate brief',
        messages: [],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });
    const designFiles = {
      ...createTestDesignFileService(),
      listFiles: vi.fn(async () => [
        {
          name: 'DESIGN.md',
          path: 'assets/DESIGN.md',
          kind: 'text' as const,
          mime: 'text/markdown',
          size: 15,
          mtime: 2,
          updatedAt: 2,
        },
      ]),
      readFileContent: vi.fn(async () => '# Design Brief\n'),
      fileUrl: vi.fn((name: string) => `/api/projects/generated-brief-project/files/${encodeURIComponent(name)}`),
    };
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'generated-brief-project' },
      chatTimelineService: timeline,
      designFileService: designFiles as unknown as IDesignFileService,
      projectEditor: {
        project: { id: 'generated-brief-project', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Generate brief', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).toContain('No files yet');

      act(() => {
        timeline.startAssistantRun({ runId: 'run-1', conversationId: 'conversation-1' });
      });
      act(() => {
        timeline.applyAgentEvent('run-1', {
          type: 'generated_file',
          name: 'DESIGN.md',
          artifactType: 'text/markdown',
        });
      });

      await waitFor(() => expect(designFiles.listFiles).toHaveBeenCalledOnce());
      await waitFor(() => expect(container.textContent).toContain('DESIGN.md'));
    } finally {
      cleanup(root, container);
    }
  });

  it('refreshes design files while an active run writes a workspace file operation', async () => {
    const timeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-1', title: 'Write Python file', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'Write Python file',
        messages: [],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });
    const designFiles = {
      ...createTestDesignFileService(),
      listFiles: vi.fn(async () => [
        {
          name: 'is_prime-3.py',
          path: 'assets/is_prime-3.py',
          kind: 'code' as const,
          mime: 'text/x-python',
          size: 33,
          mtime: 2,
          updatedAt: 2,
        },
      ]),
      readFileContent: vi.fn(async () => 'def is_prime(value):\n    return True\n'),
      fileUrl: vi.fn((name: string) => `/api/projects/file-op-refresh-project/files/${encodeURIComponent(name)}`),
    };
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'file-op-refresh-project' },
      chatTimelineService: timeline,
      designFileService: designFiles as unknown as IDesignFileService,
      projectEditor: {
        project: { id: 'file-op-refresh-project', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Write Python file', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).toContain('No files yet');

      act(() => {
        timeline.startAssistantRun({ runId: 'run-1', conversationId: 'conversation-1' });
      });
      act(() => {
        timeline.applyAgentEvent('run-1', {
          type: 'tool_use',
          id: 'write-is-prime',
          name: 'Write',
          input: {
            file_path:
              '/Users/Sun/.nextop/apps/workspaces/example/vibe-design/data/projects/project/assets/is_prime-3.py',
          },
        });
      });

      await waitFor(() => expect(designFiles.listFiles).toHaveBeenCalledOnce());
      await waitFor(() => expect(container.textContent).toContain('is_prime-3.py'));

      const generatedFileButton = [
        ...container.querySelectorAll<HTMLButtonElement>('.tool-card__generated-row button'),
      ].find((button) => button.textContent?.includes('is_prime-3.py'));
      expect(generatedFileButton).not.toBeNull();

      await act(async () => {
        fireEvent.click(generatedFileButton!);
      });

      expect(container.textContent).toContain('Design Files');
      expect(container.textContent).toContain('def is_prime(value):');
    } finally {
      cleanup(root, container);
    }
  });

  it('refreshes design files after staged upload files are stored', async () => {
    const listeners = new Set<(event: DesignFileChangeEvent) => void>();
    const designFiles = {
      ...createTestDesignFileService(),
      subscribe(listener: (event: DesignFileChangeEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      listFiles: vi.fn(async () => [
        {
          name: 'reference.png',
          path: 'assets/reference.png',
          kind: 'image' as const,
          mime: 'image/png',
          size: 9,
          mtime: 2,
          updatedAt: 2,
        },
      ]),
      fileUrl: vi.fn((name: string) => `/api/projects/upload-refresh-project/files/${encodeURIComponent(name)}`),
    };
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'upload-refresh-project' },
      designFileService: designFiles as unknown as IDesignFileService,
      projectEditor: {
        project: { id: 'upload-refresh-project', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Upload reference', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).toContain('No files yet');

      act(() => {
        for (const listener of listeners) {
          listener({
            type: 'uploaded',
            attachments: [
              {
                path: 'assets/reference.png',
                name: 'reference.png',
                kind: 'image',
                size: 9,
                mimeType: 'image/png',
              },
            ],
          } as DesignFileChangeEvent);
        }
      });

      await waitFor(() => expect(designFiles.listFiles).toHaveBeenCalledOnce());
      await waitFor(() => expect(container.textContent).toContain('reference.png'));
    } finally {
      cleanup(root, container);
    }
  });

  it('refreshes design files when a run ends without a generated file event', async () => {
    const timeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-1', title: 'Generate brief', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'Generate brief',
        messages: [],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });
    const designFiles = {
      ...createTestDesignFileService(),
      listFiles: vi.fn(async () => [
        {
          name: 'design.md',
          path: 'assets/design.md',
          kind: 'text' as const,
          mime: 'text/markdown',
          size: 15,
          mtime: 2,
          updatedAt: 2,
        },
      ]),
      readFileContent: vi.fn(async () => '# Design Brief\n'),
      fileUrl: vi.fn((name: string) => `/api/projects/generated-brief-project/files/${encodeURIComponent(name)}`),
    };
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'generated-brief-project' },
      chatTimelineService: timeline,
      designFileService: designFiles as unknown as IDesignFileService,
      projectEditor: {
        project: { id: 'generated-brief-project', tabsState: { tabs: [], activeTabKey: null } },
        files: [],
        conversations: [{ id: 'conversation-1', title: 'Generate brief', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).toContain('No files yet');

      act(() => {
        timeline.startAssistantRun({ runId: 'run-1', conversationId: 'conversation-1' });
        timeline.applyAgentEvent('run-1', {
          type: 'end',
          status: 'succeeded',
          code: 0,
          signal: null,
        });
      });

      await waitFor(() => expect(designFiles.listFiles).toHaveBeenCalledOnce());
      await waitFor(() => expect(container.textContent).toContain('design.md'));
    } finally {
      cleanup(root, container);
    }
  });

  it('does not open read-only file operations in the right-side canvas workspace', async () => {
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'file-op-project' },
      projectEditor: {
        project: { id: 'file-op-project', tabsState: { tabs: [], activeTabKey: null } },
        files: [
          {
            name: 'visual-comment-1780721550953.svg',
            path: 'assets/visual-comment-1780721550953.svg',
            kind: 'image',
            mime: 'image/svg+xml',
            contents: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Apply visual comment', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            runStatus: 'running',
            events: [],
            blocks: [
              {
                kind: 'file-ops',
                ops: [
                  {
                    path: 'visual-comment-1780721550953.svg',
                    fullPath:
                      '/Users/zhengweibin/Desktop/team-shell/vibe-design/server/.vibe/projects/project/assets/visual-comment-1780721550953.svg',
                    ops: ['read'],
                    opCounts: { read: 1, write: 0, edit: 0, delete: 0 },
                    total: 1,
                    status: 'running',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const fileOpButton = container.querySelector<HTMLButtonElement>(
        '[aria-label="Open visual-comment-1780721550953.svg"]',
      );
      expect(fileOpButton).toBeNull();

      const openedFileTab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) =>
        tab.textContent?.includes('visual-comment-1780721550953.svg'),
      );
      expect(openedFileTab).toBeUndefined();
    } finally {
      cleanup(root, container);
    }
  });

  it('does not render top toolbar tweak requests in the active project conversation', async () => {
    const sendTurn = vi.fn<(input: SendTurnInput) => Promise<void>>(async () => undefined);
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'tweak-save-project' },
      chatSessionService: createTestChatSessionService(sendTurn),
      projectEditor: {
        project: {
          id: 'tweak-save-project',
          tabsState: {
            tabs: [{ kind: 'file', key: 'file:index.html', path: 'index.html', name: 'index.html' }],
            activeTabKey: 'file:index.html',
          },
        },
        files: [
          {
            name: 'index.html',
            path: 'index.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main id="root">Disabled</main><script src="app.js"></script>',
          },
          {
            name: 'app.js',
            path: 'app.js',
            kind: 'text',
            mime: 'application/javascript',
            contents: 'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"enabled":false}/*EDITMODE-END*/;',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Project updates', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.textContent).not.toContain('Tweaks');
      expect(container.querySelector('[data-testid="design-tweak-request-popover"]')).toBeNull();
      expect(sendTurn).not.toHaveBeenCalled();
      expect(tabButtonByText(container, 'index.html').getAttribute('aria-selected')).toBe('true');
      expect(container.textContent).not.toContain('Canvas app.js');
    } finally {
      cleanup(root, container);
    }
  });

  it('wires preview comments to the active project conversation', async () => {
    const previewCommentService = createPreviewCommentService({
      comments: [previewComment({ status: 'open' })],
      loading: false,
      error: null,
    });
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'preview-comment-project' },
      previewCommentService,
      projectEditor: {
        project: {
          id: 'preview-comment-project',
          tabsState: {
            tabs: [{ kind: 'file', key: 'file:landing.html', path: 'landing.html', name: 'landing.html' }],
            activeTabKey: 'file:landing.html',
          },
        },
        files: [
          {
            name: 'landing.html',
            path: 'landing.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main><h1 data-vd-id="hero">Hero</h1></main>',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Preview comments', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(previewCommentService.load).toHaveBeenCalledWith('conversation-1');

      await act(async () => {
        fireEvent.click(buttonByText(container, 'Comments 1'));
      });

      const previewCommentsPanel = container.querySelector('[aria-label="Preview comments panel"]');
      const previewCommentRowsList = container.querySelector('.preview-comment-records__list');
      expect(previewCommentsPanel).toBeTruthy();
      expect(previewCommentRowsList).toBeTruthy();
      expect(container.querySelector('[data-testid="chat-preview-comment-row-comment-1"]')?.textContent).toContain(
        'Tighten this section',
      );
      expect(container.querySelector('[aria-label="Message"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Close comments"]')?.click();
      });

      expect(container.querySelector('[aria-label="Preview comments panel"]')).toBeNull();
      expect(container.querySelector('[aria-label="Message"]')).not.toBeNull();

      await act(async () => {
        fireEvent.click(tabButtonByText(container, 'Mark up'));
      });

      await act(async () => {
        fireEvent.click(container.querySelector<HTMLButtonElement>('[data-testid="canvas-comment-saved-marker"]')!);
      });
      expect(container.querySelector('[data-testid="canvas-comment-popover"]')).toBeTruthy();

      await act(async () => {
        fireEvent(
          window,
          new MessageEvent('message', {
            data: {
              type: 'vd-comment-select',
              target: {
                targetId: 'hero',
                selector: '[data-vd-id="hero"]',
                label: 'main',
                text: 'Hero',
                position: { x: 10, y: 20, width: 100, height: 40 },
                htmlHint: '<main data-vd-id="hero">',
              },
            },
          }),
        );
      });
      const note = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment note"]');
      expect(note).not.toBeNull();

      await act(async () => {
        fireEvent.change(note!, { target: { value: 'Fix hero' } });
        fireEvent.click(buttonByText(container, 'Add comment'));
      });

      await waitFor(() =>
        expect(previewCommentService.upsert).toHaveBeenCalledWith(
          'conversation-1',
          expect.objectContaining({
            target: expect.objectContaining({ filePath: 'landing.html', targetId: 'hero' }),
            note: 'Fix hero',
          }),
        ),
      );

      expect(previewCommentService.delete).not.toHaveBeenCalled();
      expect(previewCommentService.patchStatus).not.toHaveBeenCalledWith('conversation-1', 'comment-1', 'open');
    } finally {
      cleanup(root, container);
    }
  });

  it('uploads project editor visual comment screenshots before sending attachments', async () => {
    const now = new Date(2026, 5, 11, 9, 30, 0).getTime();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    const sendTurn = vi.fn<(input: { draft: string; files: File[]; commentAttachments?: unknown[] }) => Promise<void>>(
      async () => undefined,
    );
    const uploadFiles = vi.fn<(files: File[]) => Promise<Array<{ path: string; name: string; kind: 'image'; size: number; mimeType: string }>>>(
      async (files) => {
        expect(files).toHaveLength(1);
        expect(files[0]?.type).toBe('image/svg+xml');
        await expect(files[0]?.text()).resolves.toContain('<rect');
        return [
          {
            path: `assets/${files[0]?.name ?? 'visual-comment-20260611093000.svg'}`,
            name: files[0]?.name ?? 'visual-comment-20260611093000.svg',
            kind: 'image' as const,
            size: files[0]?.size ?? 0,
            mimeType: files[0]?.type ?? 'image/svg+xml',
          },
        ];
      },
    );
    const designFileService: IDesignFileService = {
      _serviceBrand: undefined,
      subscribe: vi.fn(() => vi.fn()),
      listFiles: vi.fn(async () => []),
      readFileContent: vi.fn(async () => ''),
      fileUrl: vi.fn(() => null),
      saveFileContent: vi.fn(async (name) => ({
        name,
        path: `assets/${name}`,
        kind: 'html' as const,
        mime: 'text/html',
        size: 1,
        mtime: 1,
        updatedAt: 1,
      })),
      uploadFiles,
    };
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'visual-comment-upload-project' },
      designFileService,
      chatSessionService: createTestChatSessionService(sendTurn),
      projectEditor: {
        project: {
          id: 'visual-comment-upload-project',
          tabsState: {
            tabs: [{ kind: 'file', key: 'file:landing.html', path: 'landing.html', name: 'landing.html' }],
            activeTabKey: 'file:landing.html',
          },
        },
        files: [
          {
            name: 'landing.html',
            path: 'landing.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main><h1 data-vd-id="hero">Hero</h1></main>',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Visual comments', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(tabButtonByText(container, 'Mark up'));
      });

      const previewFrame = container.querySelector<HTMLIFrameElement>('iframe[data-testid="canvas-preview-srcdoc"]');
      expect(previewFrame?.contentWindow).toBeTruthy();
      vi.spyOn(previewFrame!.contentWindow!, 'postMessage').mockImplementation((message) => {
        const request = message as { type?: string; id?: string };
        if (request.type !== 'vd-preview-snapshot') return;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'vd-preview-snapshot-result',
              id: request.id,
              dataUrl: 'data:image/png;base64,cHJldmlldw==',
              width: 1280,
              height: 800,
            },
          }),
        );
      });

      await act(async () => {
        fireEvent(window, new MessageEvent('message', {
          data: {
            type: 'vd-comment-select',
            target: {
              targetId: 'hero',
              selector: '[data-vd-id="hero"]',
              label: 'Hero',
              text: 'Hero',
              position: { x: 40, y: 50, width: 100, height: 70 },
              htmlHint: '<h1 data-vd-id="hero">Hero</h1>',
            },
          },
        }));
      });
      await act(async () => {
        fireEvent.change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment note"]')!, {
          target: { value: 'Refine this visual area' },
        });
      });
      await act(async () => {
        await waitFor(() =>
          expect(buttonByText(container, 'Send to agent').disabled).toBe(false),
        );
        fireEvent.click(buttonByText(container, 'Send to agent'));
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => expect(uploadFiles).toHaveBeenCalledOnce());
      await waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
      expect(uploadFiles.mock.calls[0]?.[0][0]?.name).toBe('visual-comment-20260611093000.svg');

      expect(sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        draft: '',
        displayDraft: 'Refine this visual area',
        files: [],
        commentAttachments: [
          expect.objectContaining({
            source: 'visual-mark',
            screenshotPath: 'assets/visual-comment-20260611093000.svg',
            markKind: 'click',
            comment: 'Refine this visual area',
          }),
        ],
      }));
      expect(JSON.stringify((sendTurn.mock.calls as unknown[][])[0]?.[0])).not.toContain('data:image');
    } finally {
      cleanup(root, container);
      dateNow.mockRestore();
    }
  });

  it('edits an existing preview comment without duplicating the service-backed row', async () => {
    const previewCommentService = createPreviewCommentService({
      comments: [previewComment()],
      loading: false,
      error: null,
    });
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'preview-comment-edit-project' },
      previewCommentService,
      projectEditor: {
        project: {
          id: 'preview-comment-edit-project',
          tabsState: {
            tabs: [{ kind: 'file', key: 'file:landing.html', path: 'landing.html', name: 'landing.html' }],
            activeTabKey: 'file:landing.html',
          },
        },
        files: [
          {
            name: 'landing.html',
            path: 'landing.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main><h1 data-vd-id="hero">Hero</h1></main>',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Preview comments', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        messages: [],
      },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(buttonByText(container, 'Mark up'));
      });
      await act(async () => {
        fireEvent.click(container.querySelector<HTMLButtonElement>('[data-testid="canvas-comment-saved-marker"]')!);
      });

      const note = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment note"]');
      expect(note).not.toBeNull();

      await act(async () => {
        fireEvent.change(note!, { target: { value: 'Updated saved note' } });
        fireEvent.click(buttonByText(container, 'Add comment'));
      });

      await waitFor(() =>
        expect(previewCommentService.upsert).toHaveBeenCalledWith(
          'conversation-1',
          expect.objectContaining({
            target: expect.objectContaining({ filePath: 'landing.html', targetId: 'hero' }),
            note: 'Updated saved note',
          }),
        ),
      );
      expect(container.querySelector('[data-testid^="chat-preview-comment-row-"]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('does not render global project header actions in the editor shell', () => {
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'settings-project' },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      expect(container.querySelector('header')).toBeNull();
      expect(container.textContent).not.toContain('settings-project');
      expect(container.textContent).not.toContain('Claude');
      expect(container.textContent).not.toContain('Skills');
      expect(container.textContent).not.toContain('Run / SSE');
      expect(container.textContent).not.toContain('Share');

      expect(container.querySelector('button[aria-label="Open settings"]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('renders the project editor as a side-by-side preview shell', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'preview-project' },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const layout = container.querySelector<HTMLElement>('[data-testid="project-editor-layout"]');

      expect(layout).not.toBeNull();
      expect(layout!.style.gridTemplateColumns).toBe('clamp(500px, 29vw, 600px) minmax(0, 1fr)');
      expect(container.innerHTML).toContain('Project Canvas Workspace');
      expect(container.textContent).not.toContain('Project Canvas Workspace');
      expect(container.textContent).toContain('Design Files');
      expect(container.textContent).not.toContain('Chat');
      expect(container.textContent).not.toContain('Comments');
      expect(container.textContent).toContain('Ready to start creating');
      expect(container.textContent).toContain('Describe the first screen or change you want, and Agent will generate the project files here.');
      expect(container.textContent).toContain('No files yet');
      expect(container.textContent).not.toContain('Start with context');
      expect(container.textContent).not.toContain('SaaS Analytics Dashboard');
      expect(container.textContent).not.toContain('Mobile Banking Onboarding');
      expect(container.textContent).not.toContain('AI Image Studio');
      expect(container.textContent).not.toContain('Developer Docs Portal');
      expect(container.textContent).not.toContain('Attach codebase');

      const chatPanel = container.querySelector<HTMLElement>('[data-testid="project-chat-panel"]');
      const resizeHandle = container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize chat panel"]');
      expect(chatPanel).not.toBeNull();
      expect(resizeHandle).not.toBeNull();
      expect(chatPanel!.className).not.toContain('border-r');
      expect(resizeHandle!.querySelector('span')?.className).toContain('bg-transparent');
      expect(resizeHandle!.querySelector('span')?.className).not.toContain('bg-[var(--border-1)]');
    } finally {
      randomSpy.mockRestore();
      cleanup(root, container);
    }
  });

  it('compresses the chat panel to 360px in compact project editor widths', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === 'project-editor-layout') {
        return { width: 1400, height: 720, top: 0, left: 0, right: 1400, bottom: 720, x: 0, y: 0, toJSON: () => ({}) };
      }

      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'compact-project' },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const layout = container.querySelector<HTMLElement>('[data-testid="project-editor-layout"]');
      const resizeHandle = container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize chat panel"]');

      expect(layout).not.toBeNull();
      expect(resizeHandle).not.toBeNull();
      expect(layout!.style.gridTemplateColumns).toBe('360px minmax(0, 1fr)');
      expect(resizeHandle!.style.left).toBe('360px');
      expect(resizeHandle!.getAttribute('aria-valuenow')).toBe('360');
    } finally {
      cleanup(root, container);
      rectSpy.mockRestore();
    }
  });

  it('resizes the project chat panel with min and max width limits', async () => {
    const flow = createVibeDesignFlow({
      route: { kind: 'project', projectId: 'resizable-project' },
    });

    const { container, root } = renderComponent(flow.render());

    try {
      const layout = container.querySelector<HTMLElement>('[data-testid="project-editor-layout"]');
      const resizeHandle = container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize chat panel"]');

      expect(layout).not.toBeNull();
      expect(resizeHandle).not.toBeNull();
      expect(layout!.style.gridTemplateColumns).toBe('clamp(500px, 29vw, 600px) minmax(0, 1fr)');

      await act(async () => {
        fireEvent.pointerDown(resizeHandle!, { clientX: 520 });
      });
      await act(async () => {
        fireEvent.pointerMove(window, { clientX: 900 });
        fireEvent.pointerUp(window);
      });

      expect(layout!.style.gridTemplateColumns).toBe('600px minmax(0, 1fr)');
      expect(resizeHandle!.getAttribute('aria-valuenow')).toBe('600');

      await act(async () => {
        fireEvent.pointerDown(resizeHandle!, { clientX: 600 });
      });
      await act(async () => {
        fireEvent.pointerMove(window, { clientX: 120 });
        fireEvent.pointerUp(window);
      });

      expect(layout!.style.gridTemplateColumns).toBe('360px minmax(0, 1fr)');
      expect(resizeHandle!.getAttribute('aria-valuenow')).toBe('360');
    } finally {
      cleanup(root, container);
    }
  });
});
