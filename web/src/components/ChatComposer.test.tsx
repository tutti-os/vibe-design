// @vitest-environment jsdom
import React, { act } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';
import type {
  ContextPickerSnapshot,
  ContextSearchResultItem,
} from '../services/context-picker/context-picker-types';
import type { CanvasCommentAttachment } from '../types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Element.prototype.scrollIntoView = vi.fn();

function renderComponent(element: React.ReactElement): { container: HTMLElement; root: Root } {
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

function getByLabelText(container: HTMLElement, label: string): HTMLElement {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing element labelled ${label}`);
  return element;
}

function buttonByName(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${name}`);
  return button;
}

async function changeText(element: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    element.textContent = value;
    fireEvent.input(element);
  });
}

function editorText(element: HTMLElement): string {
  return element.textContent ?? '';
}

async function selectFiles(element: HTMLElement, files: File[]): Promise<void> {
  if (!(element instanceof HTMLInputElement)) throw new Error('Expected input');
  await act(async () => {
    Object.defineProperty(element, 'files', { value: files, configurable: true });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('ChatComposer', () => {
  it('does not render the pet shortcut in the composer actions', () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      expect(container.querySelector('[aria-label="Pet"]')).toBeNull();
      expect(container.textContent).not.toContain('宠物');
      expect(getByLabelText(container, 'Open mentions')).toBeTruthy();
      expect(getByLabelText(container, 'Attach files')).toBeTruthy();
    } finally {
      cleanup(root, container);
    }
  });

  it('focuses the message input when the textarea layer blank area is clicked', async () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      const layer = container.querySelector('.composer-textarea-layer');
      if (!(layer instanceof HTMLElement)) throw new Error('Missing composer textarea layer');

      await act(async () => {
        fireEvent.mouseDown(layer);
      });

      expect(document.activeElement).toBe(getByLabelText(container, 'Message'));
    } finally {
      cleanup(root, container);
    }
  });

  it('lets the user switch the composer model provider between Codex and Claude Code', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const provider = getByLabelText(container, 'Model provider');
      expect(provider.textContent).toContain('Codex');
      const codexIcon = provider.querySelector('[data-provider-icon="codex"]');
      expect(codexIcon).toBeInstanceOf(HTMLImageElement);
      expect((codexIcon as HTMLImageElement | null)?.getAttribute('src')).toContain('workspace-dock-agent-codex');
      expect(provider.querySelectorAll('[data-provider-icon]')).toHaveLength(1);

      await act(async () => {
        fireEvent.click(provider);
      });

      const claudeOption = Array.from(document.body.querySelectorAll('[role="option"]')).find((option) =>
        option.textContent?.includes('Claude Code'),
      );
      expect(claudeOption).not.toBeUndefined();
      const claudeOptionIcon = claudeOption!.querySelector('[data-provider-icon="claude-code"]');
      expect(claudeOptionIcon).toBeInstanceOf(HTMLImageElement);
      expect((claudeOptionIcon as HTMLImageElement | null)?.getAttribute('src')).toContain(
        'workspace-dock-agent-claude-code',
      );

      await act(async () => {
        fireEvent.click(claudeOption!);
      });

      expect(provider.textContent).toContain('Claude Code');
      const claudeIcon = provider.querySelector('[data-provider-icon="claude-code"]');
      expect(claudeIcon).toBeInstanceOf(HTMLImageElement);
      expect((claudeIcon as HTMLImageElement | null)?.getAttribute('src')).toContain(
        'workspace-dock-agent-claude-code',
      );
      expect(provider.querySelectorAll('[data-provider-icon]')).toHaveLength(1);

      await changeText(getByLabelText(container, 'Message'), 'Use Claude');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: 'Use Claude', files: [], agentId: 'claude' });
    } finally {
      cleanup(root, container);
    }
  });

  it('disables locally unavailable model providers before sending', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        agentAvailability={[
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude', label: 'Claude Code', available: false, unavailableReason: 'Claude Code is not installed.' },
        ]}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const provider = getByLabelText(container, 'Model provider');
      expect(provider.textContent).toContain('Codex');

      await act(async () => {
        fireEvent.click(provider);
      });

      const claudeOption = Array.from(document.body.querySelectorAll('[role="option"]')).find((option) =>
        option.textContent?.includes('Claude Code'),
      );
      expect(claudeOption).not.toBeUndefined();
      expect(claudeOption!.getAttribute('aria-disabled')).toBe('true');

      await act(async () => {
        fireEvent.click(claudeOption!);
      });

      expect(provider.textContent).toContain('Codex');
      await changeText(getByLabelText(container, 'Message'), 'Use the available provider');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: 'Use the available provider', files: [], agentId: 'codex' });
    } finally {
      cleanup(root, container);
    }
  });

  it('offers to install Claude Code from the unavailable model provider option', async () => {
    const onInstallAgent = vi.fn(async () => undefined);
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        agentAvailability={[
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude', label: 'Claude Code', available: false, unavailableReason: 'Claude Code is not installed.' },
        ]}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onInstallAgent={onInstallAgent}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await act(async () => {
        fireEvent.click(getByLabelText(container, 'Model provider'));
      });

      const installButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Install'),
      );
      expect(installButton).toBeInstanceOf(HTMLButtonElement);
      expect(installButton?.getAttribute('aria-label')).toBe('Install Claude Code');

      await act(async () => {
        fireEvent.click(installButton!);
      });
      await flushAsyncWork();

      expect(onInstallAgent).toHaveBeenCalledWith('claude');
      expect(container.textContent).toContain('Claude Code installed. Select it to use it.');
    } finally {
      cleanup(root, container);
    }
  });

  it('locks the composer model provider when the conversation already has one', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentId="claude"
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const provider = getByLabelText(container, 'Model provider');
      expect(provider.textContent).toContain('Claude Code');
      expect(provider.getAttribute('aria-disabled')).not.toBe('true');
      expect(provider.querySelector('[data-provider-icon="claude-code"]')).toBeInstanceOf(HTMLImageElement);

      await act(async () => {
        fireEvent.click(provider);
      });

      const codexOption = Array.from(document.body.querySelectorAll('[role="option"]')).find((option) =>
        option.textContent?.includes('Codex'),
      );
      const claudeOption = Array.from(document.body.querySelectorAll('[role="option"]')).find((option) =>
        option.textContent?.includes('Claude Code'),
      );
      expect(codexOption).not.toBeUndefined();
      expect(codexOption!.getAttribute('aria-disabled')).toBe('true');
      expect(codexOption!.getAttribute('title')).toBeNull();
      expect(document.body.textContent).not.toContain('Switching models is not supported in the same conversation yet');
      const lockedOptionTooltipTrigger = codexOption!.closest('[data-slot="tooltip-trigger"]');
      expect(lockedOptionTooltipTrigger).not.toBeNull();
      await act(async () => {
        fireEvent.pointerMove(lockedOptionTooltipTrigger!);
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain('Switching models is not supported in the same conversation yet');
      });
      expect(claudeOption).not.toBeUndefined();
      expect(claudeOption!.getAttribute('aria-disabled')).not.toBe('true');

      await changeText(getByLabelText(container, 'Message'), 'Continue with Claude');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: 'Continue with Claude', files: [], agentId: 'claude' });
    } finally {
      cleanup(root, container);
    }
  });

  it('explains why a Codex conversation cannot switch to Claude Code', () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentId="codex"
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      const provider = getByLabelText(container, 'Model provider');
      const tooltip = container.querySelector('[role="tooltip"]');
      expect(provider).toBeTruthy();
      expect(tooltip).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('stages design system picker changes until Done is clicked', async () => {
    const onOpenDesignSystemPicker = vi.fn();
    const onSelectDesignSystem = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        activeDesignSystem={{
          id: 'jimeng-ai',
          title: 'Jimeng AI Reference',
          category: 'Creator tool',
          summary: 'Current composer reference system.',
          swatches: ['#ff6a00', '#111111'],
        }}
        designSystemPickerState="ready"
        designSystems={[
          {
            id: 'jimeng-ai',
            title: 'Jimeng AI Reference',
            category: 'Creator tool',
            summary: 'Current composer reference system.',
            swatches: ['#ff6a00', '#111111'],
          },
          {
            id: 'anthropic-web',
            title: 'Anthropic Web Reference',
            category: 'Research product',
            summary: 'Official product reference system.',
            swatches: ['#f7f0e8', '#111111'],
          },
        ]}
        onOpenDesignSystemPicker={onOpenDesignSystemPicker}
        onSelectDesignSystem={onSelectDesignSystem}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await act(async () => {
        getByLabelText(container, 'Choose design style').click();
      });

      expect(getByLabelText(container, 'Choose design style').querySelector('svg.lucide-swatch-book')).toBeTruthy();
      expect(onOpenDesignSystemPicker).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain('Choose design styles');
      expect(document.body.textContent).toContain('Selected');
      expect(document.body.textContent).toContain('Available');
      expect(document.body.textContent).not.toContain('Browse Design System');
      expect(document.body.textContent).toContain('Anthropic Web Reference');

      const option = document.body.querySelector(
        '[aria-label="Select design style Anthropic Web Reference"]',
      );
      if (!(option instanceof HTMLButtonElement)) {
        throw new Error('Missing design system option');
      }

      await act(async () => {
        fireEvent.click(option);
      });
      await flushAsyncWork();

      expect(onSelectDesignSystem).not.toHaveBeenCalled();
      expect(getByLabelText(container, 'Choose design style').textContent).toContain('Jimeng AI Reference');
      expect(document.body.textContent).toContain('Anthropic Web Reference');

      await act(async () => {
        buttonByName(document.body, 'Done').click();
      });
      await flushAsyncWork();

      expect(onSelectDesignSystem).toHaveBeenCalledWith('anthropic-web');
      await waitFor(() => expect(document.body.textContent).not.toContain('Choose design styles'));
    } finally {
      cleanup(root, container);
    }
  });

  it('only clears the active design system after the picker Done action', async () => {
    const onSelectDesignSystem = vi.fn();
    const activeDesignSystem = {
      id: 'anthropic-web',
      title: 'Anthropic Web Reference',
      category: 'Research product',
      summary: 'Official product reference system.',
      swatches: ['#f7f0e8', '#111111'],
    };
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        activeDesignSystem={activeDesignSystem}
        designSystemPickerState="ready"
        designSystems={[activeDesignSystem]}
        onSelectDesignSystem={onSelectDesignSystem}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await act(async () => {
        getByLabelText(container, 'Choose design style').click();
      });

      const removeButton = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Remove Anthropic Web Reference"]',
      );
      if (!removeButton) {
        throw new Error('Missing remove design system button');
      }

      await act(async () => {
        fireEvent.click(removeButton);
      });
      await flushAsyncWork();

      expect(onSelectDesignSystem).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Anthropic Web Reference');
      expect(document.body.textContent).toContain('No design style selected');

      await act(async () => {
        buttonByName(document.body, 'Done').click();
      });
      await flushAsyncWork();

      expect(onSelectDesignSystem).toHaveBeenCalledWith(null);
      await waitFor(() => expect(document.body.textContent).not.toContain('Choose design styles'));
    } finally {
      cleanup(root, container);
    }
  });

  it('shows skill and design-file mention results, selects one, and sends draft with files', async () => {
    const onSend = vi.fn();
    const selectResult = vi.fn();
    const resultItems: ContextSearchResultItem[] = [
      { id: 'skill:skill-1', kind: 'skill', label: 'Hero Builder', value: 'skill-1' },
      {
        id: 'design-file:file-1',
        kind: 'design-file',
        label: 'Hero.tsx',
        value: 'file-1',
        path: 'src/Hero.tsx',
      },
    ];
    const snapshot: ContextPickerSnapshot = {
      selectedSkills: [{ id: 'skill-2', name: 'Layout Critic' }],
      selectedDesignFiles: [
        {
          id: 'file-2',
          name: 'Landing.tsx',
          path: 'src/Landing.tsx',
          type: 'file',
          size: 0,
          mtime: 0,
          kind: 'code',
          mime: 'text/tsx',
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: resultItems }),
          selectResult,
          snapshot,
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('Layout Critic');
      expect(container.textContent).toContain('Landing.tsx');

      await changeText(getByLabelText(container, 'Message'), '@hero');
      expect(container.textContent).toContain('Hero Builder');
      expect(container.textContent).toContain('Hero.tsx');
      expect(container.querySelector('[data-mention-icon="skill"]')).toBeInstanceOf(SVGElement);
      expect(container.querySelector('[data-mention-icon="design-file"]')).toBeInstanceOf(SVGElement);
      expect(container.querySelector('[role="listbox"]')).toBeNull();

      await act(async () => buttonByName(container, 'Hero.tsx').click());
      expect(selectResult).toHaveBeenCalledWith(resultItems[1]);

      const upload = getByLabelText(container, 'Import files');
      const file = new File(['content'], 'brief.md', { type: 'text/markdown' });
      await selectFiles(upload, [file]);
      await changeText(getByLabelText(container, 'Message'), 'Build a hero');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: 'Build a hero', files: [file], agentId: 'codex' });
    } finally {
      cleanup(root, container);
    }
  });

  it('opens mention results when @ follows Chinese text without a space', async () => {
    const item: ContextSearchResultItem = {
      id: 'skill:skill-1',
      kind: 'skill',
      label: 'Hero Builder',
      value: 'skill-1',
    };
    const search = vi.fn(async () => ({ items: [item] }));
    const selectResult = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search,
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), '做一个中文@hero');

      await waitFor(() => expect(search).toHaveBeenCalledWith('hero'));
      expect(container.textContent).toContain('Hero Builder');

      await act(async () => buttonByName(container, 'Hero Builder').click());
      expect(selectResult).toHaveBeenCalledWith(item);
      expect(editorText(getByLabelText(container, 'Message'))).toBe('做一个中文');
    } finally {
      cleanup(root, container);
    }
  });

  it('opens mention results when @ follows non-Chinese text without a space', async () => {
    const item: ContextSearchResultItem = {
      id: 'skill:skill-1',
      kind: 'skill',
      label: 'Hero Builder',
      value: 'skill-1',
    };
    const search = vi.fn(async () => ({ items: [item] }));
    const selectResult = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search,
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), 'make@hero');

      await waitFor(() => expect(search).toHaveBeenCalledWith('hero'));
      expect(container.textContent).toContain('Hero Builder');

      await act(async () => buttonByName(container, 'Hero Builder').click());
      expect(selectResult).toHaveBeenCalledWith(item);
      expect(editorText(getByLabelText(container, 'Message'))).toBe('make');
    } finally {
      cleanup(root, container);
    }
  });

  it('opens mention results when @ follows digits without a space', async () => {
    const item: ContextSearchResultItem = {
      id: 'skill:skill-1',
      kind: 'skill',
      label: 'Hero Builder',
      value: 'skill-1',
    };
    const search = vi.fn(async () => ({ items: [item] }));
    const selectResult = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search,
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), '123@hero');

      await waitFor(() => expect(search).toHaveBeenCalledWith('hero'));
      expect(container.textContent).toContain('Hero Builder');

      await act(async () => buttonByName(container, 'Hero Builder').click());
      expect(selectResult).toHaveBeenCalledWith(item);
      expect(editorText(getByLabelText(container, 'Message'))).toBe('123');
    } finally {
      cleanup(root, container);
    }
  });

  it('opens empty-query mention results immediately when @ follows digits', async () => {
    const search = vi.fn(async () => ({ items: [] }));
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search,
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), '123@');

      await waitFor(() => expect(search).toHaveBeenCalledWith(''));
      expect(container.querySelector('[aria-label="Mention results"]')).not.toBeNull();
      expect(container.textContent).toContain('No context results');
    } finally {
      cleanup(root, container);
    }
  });

  it('opens mention results when a fullwidth @ follows digits', async () => {
    const item: ContextSearchResultItem = {
      id: 'skill:skill-1',
      kind: 'skill',
      label: 'Hero Builder',
      value: 'skill-1',
    };
    const search = vi.fn(async () => ({ items: [item] }));
    const selectResult = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search,
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), '123＠hero');

      await waitFor(() => expect(search).toHaveBeenCalledWith('hero'));
      expect(container.textContent).toContain('Hero Builder');

      await act(async () => buttonByName(container, 'Hero Builder').click());
      expect(selectResult).toHaveBeenCalledWith(item);
      expect(editorText(getByLabelText(container, 'Message'))).toBe('123');
    } finally {
      cleanup(root, container);
    }
  });

  it('filters mention results by all, skill, and file tabs', async () => {
    const selectResult = vi.fn();
    const resultItems: ContextSearchResultItem[] = [
      { id: 'skill:skill-1', kind: 'skill', label: 'Hero Builder', value: 'skill-1' },
      {
        id: 'design-file:file-1',
        kind: 'design-file',
        label: 'Hero.tsx',
        value: 'file-1',
        path: 'src/Hero.tsx',
      },
    ];
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: resultItems }),
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      const message = getByLabelText(container, 'Message');
      await changeText(message, '@hero');

      expect(getByLabelText(container, 'Mention filters')).toBeTruthy();
      expect(container.textContent).toContain('Hero Builder');
      expect(container.textContent).toContain('Hero.tsx');

      await act(async () => buttonByName(container, 'Skill').click());
      expect(container.textContent).toContain('Hero Builder');
      expect(container.textContent).not.toContain('Hero.tsx');

      await act(async () => buttonByName(container, 'Files').click());
      expect(container.textContent).not.toContain('Hero Builder');
      expect(container.textContent).toContain('Hero.tsx');

      await act(async () => {
        fireEvent.keyDown(message, { key: 'Enter', code: 'Enter' });
      });
      await flushAsyncWork();

      expect(selectResult).toHaveBeenCalledWith(resultItems[1]);
    } finally {
      cleanup(root, container);
    }
  });

  it('switches mention filters with Tab while mention results are open', async () => {
    const resultItems: ContextSearchResultItem[] = [
      { id: 'skill:skill-1', kind: 'skill', label: 'Hero Builder', value: 'skill-1' },
      {
        id: 'design-file:file-1',
        kind: 'design-file',
        label: 'Hero.tsx',
        value: 'file-1',
        path: 'src/Hero.tsx',
      },
    ];
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: resultItems }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      const message = getByLabelText(container, 'Message');
      await changeText(message, '@hero');

      expect(buttonByName(container, 'All').getAttribute('aria-selected')).toBe('true');

      let tabFromMessage = true;
      await act(async () => {
        tabFromMessage = fireEvent.keyDown(message, { key: 'Tab', code: 'Tab' });
      });
      expect(tabFromMessage).toBe(false);
      expect(buttonByName(container, 'Skill').getAttribute('aria-selected')).toBe('true');
      expect(container.textContent).toContain('Hero Builder');
      expect(container.textContent).not.toContain('Hero.tsx');

      await act(async () => {
        tabFromMessage = fireEvent.keyDown(message, { key: 'Tab', code: 'Tab' });
      });
      expect(tabFromMessage).toBe(false);
      expect(buttonByName(container, 'Files').getAttribute('aria-selected')).toBe('true');
      expect(container.textContent).not.toContain('Hero Builder');
      expect(container.textContent).toContain('Hero.tsx');

      const filesTab = buttonByName(container, 'Files');
      let tabFromFilter = true;
      await act(async () => {
        tabFromFilter = fireEvent.keyDown(filesTab, { key: 'Tab', code: 'Tab', shiftKey: true });
      });
      expect(tabFromFilter).toBe(false);
      expect(buttonByName(container, 'Skill').getAttribute('aria-selected')).toBe('true');
    } finally {
      cleanup(root, container);
    }
  });

  it('removes selected context chips through the context picker service', async () => {
    const removeSelection = vi.fn();
    const snapshot: ContextPickerSnapshot = {
      selectedSkills: [{ id: 'skill-2', name: 'Layout Critic' }],
      selectedDesignFiles: [
        {
          id: 'file-2',
          name: 'Landing.tsx',
          path: 'src/Landing.tsx',
          type: 'file',
          size: 0,
          mtime: 0,
          kind: 'code',
          mime: 'text/tsx',
        },
      ],
    };
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          removeSelection,
          snapshot,
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await act(async () => {
        getByLabelText(container, 'Remove context Layout Critic').click();
      });
      await act(async () => {
        getByLabelText(container, 'Remove context Landing.tsx').click();
      });

      expect(removeSelection).toHaveBeenNthCalledWith(1, 'skill', 'skill-2');
      expect(removeSelection).toHaveBeenNthCalledWith(2, 'design-file', 'file-2');
    } finally {
      cleanup(root, container);
    }
  });

  it('clears selected context only after send succeeds', async () => {
    const send = deferred<void>();
    const onSend = vi.fn(() => send.promise);
    const removeSelection = vi.fn();
    const snapshot: ContextPickerSnapshot = {
      selectedSkills: [{ id: 'skill-2', name: 'Layout Critic' }],
      selectedDesignFiles: [
        {
          id: 'file-2',
          name: 'Landing.tsx',
          path: 'src/Landing.tsx',
          type: 'file',
          size: 0,
          mtime: 0,
          kind: 'code',
          mime: 'text/tsx',
        },
      ],
    };
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          removeSelection,
          snapshot,
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), 'Build this layout');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
        await Promise.resolve();
      });

      expect(onSend).toHaveBeenCalledWith({ draft: 'Build this layout', files: [], agentId: 'codex' });
      expect(removeSelection).not.toHaveBeenCalled();

      await act(async () => {
        send.resolve();
      });
      await flushAsyncWork();

      expect(removeSelection).toHaveBeenNthCalledWith(1, 'skill', 'skill-2');
      expect(removeSelection).toHaveBeenNthCalledWith(2, 'design-file', 'file-2');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders staged images and files inside the message input surface', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:staged-reference');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      const image = new File(['image'], 'reference.png', { type: 'image/png' });
      const documentFile = new File(['notes'], 'brief.pdf', { type: 'application/pdf' });

      await selectFiles(getByLabelText(container, 'Import files'), [image, documentFile]);

      const inputWrap = container.querySelector('.composer-input-wrap');
      const stagedAttachments = getByLabelText(container, 'Staged input attachments');
      expect(inputWrap?.contains(stagedAttachments)).toBe(true);
      expect(stagedAttachments.textContent).toContain('reference.png');
      expect(stagedAttachments.textContent).toContain('brief.pdf');

      const imagePreview = stagedAttachments.querySelector('img[alt="reference.png"]');
      expect(imagePreview).toBeInstanceOf(HTMLImageElement);
      expect((imagePreview as HTMLImageElement).getAttribute('src')).toBe('blob:staged-reference');
      expect(createObjectUrl).toHaveBeenCalledWith(image);
    } finally {
      cleanup(root, container);
      createObjectUrl.mockRestore();
      revokeObjectUrl.mockRestore();
    }
  });

  it('stages pasted images inside the message input surface and sends them as files', async () => {
    const onSend = vi.fn();
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pasted-reference');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const image = new File(['pasted image'], 'clipboard.png', { type: 'image/png' });
      const text = new File(['not image'], 'notes.txt', { type: 'text/plain' });
      const clipboardData = {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => image },
          { kind: 'file', type: 'text/plain', getAsFile: () => text },
        ],
        files: [image, text],
      };

      await act(async () => {
        fireEvent.paste(getByLabelText(container, 'Message'), { clipboardData });
      });

      const stagedAttachments = getByLabelText(container, 'Staged input attachments');
      expect(stagedAttachments.textContent).toContain('clipboard.png');
      expect(stagedAttachments.textContent).not.toContain('notes.txt');
      expect(stagedAttachments.querySelector('img[alt="clipboard.png"]')).toBeInstanceOf(HTMLImageElement);
      expect(createObjectUrl).toHaveBeenCalledWith(image);

      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: '', files: [image], agentId: 'codex' });
    } finally {
      cleanup(root, container);
      createObjectUrl.mockRestore();
      revokeObjectUrl.mockRestore();
    }
  });

  it('renders staged preview comment chips and sends them without local clearing', async () => {
    const onSend = vi.fn();
    const commentAttachments = [commentAttachment()];
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        commentAttachments={commentAttachments}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const chips = getByLabelText(container, 'Staged preview comments');
      expect(chips.textContent).toContain('element');
      expect(chips.textContent).toContain('Hero title');
      expect(chips.textContent).toContain('index.html');
      expect(chips.querySelector('.preview-comment-attachment-chip')).toBeInstanceOf(HTMLElement);

      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: '', files: [], agentId: 'codex', commentAttachments });
      expect(getByLabelText(container, 'Staged preview comments').textContent).toContain('Hero title');
    } finally {
      cleanup(root, container);
    }
  });

  it('opens an empty mention state when no context results are available', async () => {
    const search = vi.fn(async () => ({ items: [] }));
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search,
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await act(async () => {
        getByLabelText(container, 'Open mentions').click();
      });

      await waitFor(() => expect(search).toHaveBeenCalledWith(''));
      await waitFor(() => expect(container.querySelector('[aria-label="Mention results"]')).not.toBeNull());
      expect(container.textContent).toContain('No context results');
      expect(editorText(getByLabelText(container, 'Message'))).toBe('@');
    } finally {
      cleanup(root, container);
    }
  });

  it('selects the first mention result on Enter and removes the mention trigger from the draft', async () => {
    const selectResult = vi.fn();
    const item: ContextSearchResultItem = {
      id: 'skill:skill-1',
      kind: 'skill',
      label: 'Hero Builder',
      value: 'skill-1',
    };
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [item] }),
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      const message = getByLabelText(container, 'Message');
      await changeText(message, '@hero');
      await waitFor(() => expect(container.textContent).toContain('Hero Builder'));

      await act(async () => {
        fireEvent.keyDown(message, { key: 'Enter', code: 'Enter' });
      });
      await flushAsyncWork();

      expect(selectResult).toHaveBeenCalledWith(item);
      expect(editorText(message)).toBe('');
      expect(container.querySelector('[aria-label="Mention results"]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps Cmd+Enter available for editor line breaks instead of sending the draft', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const message = getByLabelText(container, 'Message');
      await changeText(message, '第一行');

      await act(async () => {
        fireEvent.keyDown(message, {
          key: 'Enter',
          code: 'Enter',
          metaKey: true,
          cancelable: true,
        });
      });

      expect(message.querySelectorAll('p')).toHaveLength(2);
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps Ctrl+Enter available for editor line breaks instead of sending the draft', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const message = getByLabelText(container, 'Message');
      await changeText(message, '第一行');

      await act(async () => {
        fireEvent.keyDown(message, {
          key: 'Enter',
          code: 'Enter',
          ctrlKey: true,
          cancelable: true,
        });
      });

      expect(message.querySelectorAll('p')).toHaveLength(2);
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('does not send the draft when Enter confirms active IME composition', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const message = getByLabelText(container, 'Message');
      await changeText(message, '中文输入');
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'isComposing', { value: true });

      await act(async () => {
        message.dispatchEvent(event);
      });
      await flushAsyncWork();

      expect(onSend).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('renders a clickable stop action while streaming with no draft', () => {
    const onStop = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={true}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={onStop}
      />,
    );

    try {
      const actions = container.querySelectorAll('.composer-send');
      expect(actions).toHaveLength(1);
      const stopButton = getByLabelText(container, 'Stop') as HTMLButtonElement;
      expect(stopButton).toBeTruthy();
      expect(stopButton.disabled).toBe(false);
      expect(container.querySelector('[aria-label="Send message"]')).toBeNull();
      expect(onStop).not.toHaveBeenCalled();

      act(() => {
        fireEvent.click(stopButton);
      });
      expect(onStop).toHaveBeenCalledTimes(1);
    } finally {
      cleanup(root, container);
    }
  });

  it('allows submitting selected skill context while streaming so the session can queue it', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={true}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: {
            selectedSkills: [{ id: 'skill-1', name: 'Hero Builder' }],
            selectedDesignFiles: [],
          },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('Hero Builder');
      expect(getByLabelText(container, 'Send message')).toBeTruthy();
      expect((getByLabelText(container, 'Send message') as HTMLButtonElement).disabled).toBe(false);
      expect(container.querySelector('[aria-label="Response loading"]')).toBeNull();

      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: '', files: [], agentId: 'codex' });
    } finally {
      cleanup(root, container);
    }
  });

  it('allows submitting a draft while streaming so the session can queue it', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={true}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={onStop}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), 'Queue this next');

      expect(container.querySelectorAll('.composer-send')).toHaveLength(1);
      expect(container.querySelector('[aria-label="Stop response"]')).toBeNull();
      expect(getByLabelText(container, 'Send message')).toBeTruthy();
      expect(getByLabelText(container, 'Send message').className).toContain('project-primary-button');

      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onStop).not.toHaveBeenCalled();
      expect(onSend).toHaveBeenCalledWith({ draft: 'Queue this next', files: [], agentId: 'codex' });
      expect(editorText(getByLabelText(container, 'Message'))).toBe('');
    } finally {
      cleanup(root, container);
    }
  });

  it('handles rejected context search without leaving mention results open', async () => {
    const search = vi.fn(async () => {
      throw new Error('search unavailable');
    });
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search,
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), '@missing');

      expect(search).toHaveBeenCalledWith('missing');
      expect(container.querySelector('[aria-label="Mention results"]')).toBeNull();
      expect(container.textContent).toContain('Context search unavailable');
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps draft and files when send rejects and shows an error', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('Browser request API is unavailable.');
    });
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const file = new File(['content'], 'brief.md', { type: 'text/markdown' });
      await selectFiles(getByLabelText(container, 'Import files'), [file]);
      await changeText(getByLabelText(container, 'Message'), 'Keep this draft');

      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });

      expect(onSend).toHaveBeenCalledWith({ draft: 'Keep this draft', files: [file], agentId: 'codex' });
      expect(editorText(getByLabelText(container, 'Message'))).toBe('Keep this draft');
      expect(container.textContent).toContain('brief.md');
      await waitFor(() => expect(container.textContent).toContain('Browser request API is unavailable.'));
    } finally {
      cleanup(root, container);
    }
  });

  it('clears draft and files only after async send succeeds', async () => {
    const send = deferred<void>();
    const onSend = vi.fn(() => send.promise);
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    try {
      const file = new File(['content'], 'brief.md', { type: 'text/markdown' });
      await selectFiles(getByLabelText(container, 'Import files'), [file]);
      await changeText(getByLabelText(container, 'Message'), 'Send after resolve');

      await act(async () => {
        getByLabelText(container, 'Send message').click();
        await Promise.resolve();
      });

      expect(editorText(getByLabelText(container, 'Message'))).toBe(
        'Send after resolve',
      );
      expect(container.textContent).toContain('brief.md');
      expect((getByLabelText(container, 'Response loading') as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        send.resolve();
      });
      await flushAsyncWork();

      await waitFor(() => expect(editorText(getByLabelText(container, 'Message'))).toBe(''));
      await waitFor(() => expect(container.textContent).not.toContain('brief.md'));
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps mention options open when context selection rejects and shows an error', async () => {
    const selectResult = vi.fn(async () => {
      throw new Error('selection failed');
    });
    const item: ContextSearchResultItem = {
      id: 'skill:skill-1',
      kind: 'skill',
      label: 'Hero Builder',
      value: 'skill-1',
    };
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [item] }),
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      await changeText(getByLabelText(container, 'Message'), '@hero');
      await act(async () => buttonByName(container, 'Hero Builder').click());

      expect(selectResult).toHaveBeenCalledWith(item);
      expect(container.querySelector('[aria-label="Mention results"]')).not.toBeNull();
      expect(container.textContent).toContain('Context selection failed');
    } finally {
      cleanup(root, container);
    }
  });
});

function commentAttachment(): CanvasCommentAttachment {
  return {
    id: 'comment-1',
    order: 1,
    filePath: 'index.html',
    targetId: 'hero-title',
    selector: '#hero-title',
    label: 'Hero title',
    comment: 'Tighten spacing',
    currentText: 'Heading',
    pagePosition: { x: 1, y: 2, width: 3, height: 4 },
    htmlHint: '<h1>Heading</h1>',
    selectionKind: 'element',
    source: 'board-batch',
  };
}
