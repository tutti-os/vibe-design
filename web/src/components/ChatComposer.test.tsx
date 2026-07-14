// @vitest-environment jsdom
import React, { act } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer as ChatComposerBase } from './ChatComposer';
import type {
  ContextPickerSnapshot,
} from '../services/context-picker/context-picker-types';
import type { CanvasCommentAttachment } from '../types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Element.prototype.scrollIntoView = vi.fn();

const TEST_AGENT_AVAILABILITY = [
  { agentTargetId: 'codex', providerId: 'codex', label: 'Codex', supported: true, authState: 'ok' },
  { agentTargetId: 'claude-code', providerId: 'claude-code', label: 'Claude Code', supported: true, authState: 'ok' },
] satisfies NonNullable<React.ComponentProps<typeof ChatComposerBase>['agentAvailability']>;

const TEST_AGENT_MODEL_CATALOG = [
  { agentTargetId: 'codex', providerId: 'codex', label: 'Codex', supported: true, models: [] },
  { agentTargetId: 'claude-code', providerId: 'claude-code', label: 'Claude Code', supported: true, models: [] },
];

function ChatComposer(props: React.ComponentProps<typeof ChatComposerBase>): React.ReactElement {
  return (
    <ChatComposerBase
      {...props}
      agentAvailability={props.agentAvailability ?? TEST_AGENT_AVAILABILITY}
      agentModelCatalog={props.agentModelCatalog ?? TEST_AGENT_MODEL_CATALOG}
    />
  );
}

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
  const element = container.querySelector(`[aria-label="${label}"]`)
    ?? (label === 'Message' ? container.querySelector('.chat-composer__textarea [contenteditable]') : null);
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

function menuItemByName(name: string): HTMLElement {
  const item = Array.from(
    document.body.querySelectorAll(
      '[data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-label"]',
    ),
  ).find((candidate) => candidate.textContent?.includes(name));
  if (!(item instanceof HTMLElement)) throw new Error(`Missing menu item ${name}`);
  return item;
}

async function openModelMenu(container: HTMLElement): Promise<void> {
  const trigger = getByLabelText(container, 'Agent and model');
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  });
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

function setTuttiExternalAtQuery(
  query: (input: {
    keyword: string;
    maxResults?: number;
    providers?: readonly string[];
  }) => Promise<unknown[]>,
): void {
  (window as Window & {
    tuttiExternal?: {
      at?: {
        query: typeof query;
      };
    };
  }).tuttiExternal = {
    at: { query },
  };
}

function clearTuttiExternal(): void {
  delete (window as Window & { tuttiExternal?: unknown }).tuttiExternal;
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

  it('does not synthesize selectable providers from availability', async () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        agentAvailability={[
          { agentTargetId: 'codex', providerId: 'codex', label: 'Codex', supported: true, authState: 'ok' },
          { agentTargetId: 'tutti-agent', providerId: 'tutti-agent', label: 'Tutti Agent', supported: true, authState: 'ok' },
        ]}
        agentModelCatalog={[
          { agentTargetId: 'codex', providerId: 'codex', label: 'Codex', supported: true, models: [{ id: 'default', label: 'Default' }] },
        ]}
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
      await openModelMenu(container);
      expect(document.body.querySelector('[data-provider-option="tutti-agent"]')).toBeNull();
      expect(document.body.textContent).not.toContain('Tutti Agent');
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps multiple targets on one provider independently selectable by exact target id', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        agentAvailability={[
          { agentTargetId: 'team:alpha', providerId: 'codex', label: 'Alpha', supported: true, authState: 'ok' },
          { agentTargetId: 'team:beta', providerId: 'codex', label: 'Beta', supported: true, authState: 'ok' },
        ]}
        agentModelCatalog={[
          {
            agentTargetId: 'team:alpha',
            providerId: 'codex',
            label: 'Alpha',
            supported: true,
            isDefault: true,
            models: [{ id: 'default', label: 'Default' }],
          },
          {
            agentTargetId: 'team:beta',
            providerId: 'codex',
            label: 'Beta',
            supported: true,
            models: [{ id: 'default', label: 'Default' }],
          },
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
      await openModelMenu(container);
      const betaDefault = document.body.querySelector<HTMLElement>(
        '[data-provider-models="team:beta"] [data-model-option-id="default"]',
      );
      expect(betaDefault).not.toBeNull();

      await act(async () => betaDefault!.click());
      await changeText(getByLabelText(container, 'Message'), 'Run the beta target');
      await act(async () => getByLabelText(container, 'Send message').click());
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({
        draft: 'Run the beta target',
        files: [],
        agentTargetId: 'team:beta',
        model: 'default',
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('does not let an unavailable target disable a sibling on the same provider', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        draft="Run alpha"
        agentAvailability={[
          { agentTargetId: 'team:alpha', providerId: 'codex', label: 'Alpha', supported: true, authState: 'ok' },
          {
            agentTargetId: 'team:beta',
            providerId: 'codex',
            label: 'Beta',
            supported: false,
            authState: 'missing',
            unavailableReason: 'Beta is unavailable.',
          },
        ]}
        agentModelCatalog={[
          { agentTargetId: 'team:alpha', providerId: 'codex', label: 'Alpha', supported: true, isDefault: true, models: [] },
          { agentTargetId: 'team:beta', providerId: 'codex', label: 'Beta', supported: true, models: [] },
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
      await openModelMenu(container);
      expect(document.body.querySelector('[data-provider-option="team:beta"]')?.getAttribute('aria-disabled')).toBe('true');

      await act(async () => getByLabelText(container, 'Send message').click());
      await flushAsyncWork();
      expect(onSend).toHaveBeenCalledWith({
        draft: 'Run alpha',
        files: [],
        agentTargetId: 'team:alpha',
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('does not send when availability has a provider omitted from the catalog', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        draft="Use hidden provider"
        agentAvailability={[{ agentTargetId: 'codex', providerId: 'codex', label: 'Codex', supported: true, authState: 'ok' }]}
        agentModelCatalog={[]}
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
      const send = getByLabelText(container, 'Send message') as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      await act(async () => send.click());
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps an omitted conversation provider locked and disables sending', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        draft="Continue hidden conversation"
        lockedAgentTargetId="tutti-agent"
        agentModelCatalog={TEST_AGENT_MODEL_CATALOG}
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
      expect(getByLabelText(container, 'Agent and model').textContent).toContain('tutti-agent');
      const send = getByLabelText(container, 'Send message') as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      await act(async () => send.click());
      expect(onSend).not.toHaveBeenCalled();
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
      const provider = getByLabelText(container, 'Agent and model');
      expect(provider.textContent).toContain('Codex');
      const codexIcon = provider.querySelector('[data-provider-icon="codex"]');
      expect(codexIcon).toBeInstanceOf(HTMLImageElement);
      expect((codexIcon as HTMLImageElement | null)?.getAttribute('src')).toContain('workspace-dock-agent-codex');
      expect(provider.querySelectorAll('[data-provider-icon]')).toHaveLength(1);

      await openModelMenu(container);

      const menuContent = document.body.querySelector('.composer-model-menu-content');
      expect(menuContent).toBeInstanceOf(HTMLElement);

      const claudeOption = menuItemByName('Claude Code');
      const claudeOptionIcon = claudeOption.querySelector('[data-provider-icon="claude-code"]');
      expect(claudeOptionIcon).toBeInstanceOf(HTMLImageElement);
      expect((claudeOptionIcon as HTMLImageElement | null)?.getAttribute('src')).toContain(
        'workspace-dock-agent-claude-code',
      );

      await act(async () => {
        fireEvent.click(claudeOption);
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

      expect(onSend).toHaveBeenCalledWith({ draft: 'Use Claude', files: [], agentTargetId: 'claude-code' });
    } finally {
      cleanup(root, container);
    }
  });

  it('lets the user select a Codex model and sends it with the turn', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        agentModelCatalog={[
          {
            agentTargetId: 'codex',
            label: 'Codex',
            supported: true,
            models: [
              { id: 'default', label: 'Default' },
              {
                id: 'codex:gpt-5.5',
                label: 'GPT-5.5',
                description: 'Frontier model for complex coding, research, and real-world work.',
              },
            ],
          },
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
      const provider = getByLabelText(container, 'Agent and model');
      expect(provider.textContent).toContain('Codex');
      expect(provider.textContent).toContain('Default');
      expect(container.querySelector('[aria-label="Model"]')).toBeNull();

      await openModelMenu(container);

      const gpt55Option = document.body.querySelector('[data-model-option-id="codex:gpt-5.5"]');
      expect(gpt55Option).toBeInstanceOf(HTMLElement);
      expect(gpt55Option?.closest('[data-provider-models="codex"]')).toBeInstanceOf(HTMLElement);
      expect(gpt55Option?.textContent).toContain('Frontier model for complex coding');
      expect(document.body.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull();

      await act(async () => {
        fireEvent.click(gpt55Option!);
      });

      expect(provider.textContent).toContain('GPT-5.5');

      await changeText(getByLabelText(container, 'Message'), 'Use Codex mini');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({
        draft: 'Use Codex mini',
        files: [],
        agentTargetId: 'codex',
        model: 'codex:gpt-5.5',
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('switches to Claude models without synthesizing providers omitted by Tutti', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        agentModelCatalog={[
          {
            agentTargetId: 'codex',
            label: 'Codex',
            supported: true,
            models: [{ id: 'default', label: 'Default' }],
          },
          {
            agentTargetId: 'claude-code',
            label: 'Claude Code',
            supported: true,
            models: [
              { id: 'default', label: 'Default' },
              {
                id: 'claude:opus',
                label: 'Opus',
                description: 'Opus 4.7 · Most capable for complex work · ~2x usage vs Sonnet',
              },
            ],
          },
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
      const provider = getByLabelText(container, 'Agent and model');
      expect(provider.textContent).toContain('Codex');
      expect(provider.textContent).toContain('Default');
      await openModelMenu(container);

      expect(document.body.querySelector('[data-provider-option="tutti"]')).toBeNull();
      expect(document.body.querySelector('[data-provider-option="hermes"]')).toBeNull();
      expect(document.body.querySelector('[data-provider-option="openclaw"]')).toBeNull();

      const opusOption = document.body.querySelector('[data-model-option-id="claude:opus"]');
      expect(opusOption).toBeInstanceOf(HTMLElement);
      expect(opusOption?.closest('[data-provider-models="claude-code"]')).toBeInstanceOf(HTMLElement);
      expect(opusOption?.textContent).toContain('Opus 4.7');
      await act(async () => {
        fireEvent.click(opusOption!);
      });
      expect(provider.textContent).toContain('Claude Code');
      expect(provider.textContent).toContain('Opus');

      await changeText(getByLabelText(container, 'Message'), 'Use Claude opus');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({
        draft: 'Use Claude opus',
        files: [],
        agentTargetId: 'claude-code',
        model: 'claude:opus',
      });
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
          { agentTargetId: 'codex', providerId: 'codex', label: 'Codex', supported: true, authState: 'ok' },
          { agentTargetId: 'claude-code', providerId: 'claude-code', label: 'Claude Code', supported: false, authState: 'unknown', unavailableReason: 'Claude Code is not installed.' },
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
      const provider = getByLabelText(container, 'Agent and model');
      expect(provider.textContent).toContain('Codex');

      await openModelMenu(container);

      const claudeOption = menuItemByName('Claude Code');
      expect(claudeOption.getAttribute('aria-disabled')).toBe('true');

      await act(async () => {
        fireEvent.click(claudeOption);
      });

      expect(provider.textContent).toContain('Codex');
      await changeText(getByLabelText(container, 'Message'), 'Use the available provider');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: 'Use the available provider', files: [], agentTargetId: 'codex' });
    } finally {
      cleanup(root, container);
    }
  });

  it('does not expose provider-specific installation actions', async () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        agentAvailability={[
          { agentTargetId: 'team:writer', providerId: 'team:writer', label: 'Writer', supported: true, authState: 'ok' },
          {
            agentTargetId: 'team:reviewer',
            label: 'Reviewer',
            supported: false,
            authState: 'missing',
            unavailableReason: 'The agent runtime is unavailable.',
          },
        ]}
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
      await openModelMenu(container);

      expect(
        Array.from(document.body.querySelectorAll('button')).some((button) =>
          button.textContent?.includes('Install'),
        ),
      ).toBe(false);
    } finally {
      cleanup(root, container);
    }
  });

  it('locks the composer model provider when the conversation already has one', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentTargetId="claude-code"
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
      const provider = getByLabelText(container, 'Agent and model');
      expect(provider.textContent).toContain('Claude Code');
      expect(provider.getAttribute('aria-disabled')).not.toBe('true');
      expect(provider.querySelector('[data-provider-icon="claude-code"]')).toBeInstanceOf(HTMLImageElement);

      await openModelMenu(container);

      const codexOption = menuItemByName('Codex');
      const claudeOption = menuItemByName('Claude Code');
      expect(codexOption.getAttribute('aria-disabled')).toBe('true');
      expect(codexOption.getAttribute('title')).toBeNull();
      expect(document.body.textContent).not.toContain('Start a new conversation to switch agents');
      const lockedOptionTooltipTrigger = codexOption.closest('[data-slot="tooltip-trigger"]');
      expect(lockedOptionTooltipTrigger).not.toBeNull();
      await act(async () => {
        fireEvent.pointerMove(lockedOptionTooltipTrigger!);
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain('Start a new conversation to switch agents');
      });
      expect(claudeOption.getAttribute('aria-disabled')).not.toBe('true');

      await changeText(getByLabelText(container, 'Message'), 'Continue with Claude');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({ draft: 'Continue with Claude', files: [], agentTargetId: 'claude-code' });
    } finally {
      cleanup(root, container);
    }
  });

  it('restores the remembered model for a locked provider and still allows same-provider model changes', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentTargetId="codex"
        lockedModel="codex:gpt-5.5"
        agentModelCatalog={[
          {
            agentTargetId: 'codex',
            label: 'Codex',
            supported: true,
            models: [
              { id: 'default', label: 'Default' },
              { id: 'gpt-5.5', label: 'GPT-5.5' },
            ],
          },
          {
            agentTargetId: 'claude-code',
            label: 'Claude Code',
            supported: true,
            models: [{ id: 'claude:opus', label: 'Opus' }],
          },
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
      const provider = getByLabelText(container, 'Agent and model');
      expect(provider.textContent).toContain('Codex');
      expect(provider.textContent).toContain('GPT-5.5');

      await openModelMenu(container);

      const claudeOption = menuItemByName('Claude Code');
      expect(claudeOption.getAttribute('aria-disabled')).toBe('true');

      const defaultOption = document.body.querySelector('[data-model-option-id="default"]');
      expect(defaultOption).toBeInstanceOf(HTMLElement);
      expect(defaultOption?.closest('[data-provider-models="codex"]')).toBeInstanceOf(HTMLElement);
      expect(defaultOption?.getAttribute('aria-disabled')).not.toBe('true');

      await act(async () => {
        fireEvent.click(defaultOption!);
      });
      expect(provider.textContent).toContain('Default');

      await changeText(getByLabelText(container, 'Message'), 'Use default Codex');
      await act(async () => {
        getByLabelText(container, 'Send message').click();
      });
      await flushAsyncWork();

      expect(onSend).toHaveBeenCalledWith({
        draft: 'Use default Codex',
        files: [],
        agentTargetId: 'codex',
        model: 'default',
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps a locked canonical model id when the catalog uses canonical ids', async () => {
    const onSend = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentTargetId="codex"
        lockedModel="codex:gpt-5.4"
        agentModelCatalog={[
          {
            agentTargetId: 'codex',
            label: 'Codex',
            supported: true,
            models: [
              { id: 'default', label: 'Default' },
              { id: 'codex:gpt-5.4', label: 'GPT-5.4' },
            ],
          },
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
      const provider = getByLabelText(container, 'Agent and model');
      await waitFor(() => {
        expect(provider.textContent).toContain('GPT-5.4');
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('normalizes a locked model with the runtime provider prefix while keeping the exact target lock', async () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentTargetId="team:writer"
        lockedModel="codex:gpt-5.5"
        agentAvailability={[
          { agentTargetId: 'team:writer', providerId: 'codex', label: 'Writer', supported: true, authState: 'ok' },
        ]}
        agentModelCatalog={[
          {
            agentTargetId: 'team:writer',
            providerId: 'codex',
            label: 'Writer',
            supported: true,
            models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
          },
        ]}
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
      await waitFor(() => {
        expect(getByLabelText(container, 'Agent and model').textContent).toContain('GPT-5.5');
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('normalizes a locked model with the historical Claude provider prefix', async () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentTargetId="team:claude"
        lockedModel="claude:opus"
        agentAvailability={[
          { agentTargetId: 'team:claude', providerId: 'claude-code', label: 'Claude', supported: true, authState: 'ok' },
        ]}
        agentModelCatalog={[
          {
            agentTargetId: 'team:claude',
            providerId: 'claude-code',
            label: 'Claude',
            supported: true,
            models: [{ id: 'opus', label: 'Opus' }],
          },
        ]}
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
      await waitFor(() => {
        expect(getByLabelText(container, 'Agent and model').textContent).toContain('Opus');
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('uses the Claude Code icon for the historical claude provider alias', () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentTargetId="team:claude"
        agentAvailability={[
          { agentTargetId: 'team:claude', providerId: 'claude', label: 'Claude', supported: true, authState: 'ok' },
        ]}
        agentModelCatalog={[
          { agentTargetId: 'team:claude', providerId: 'claude', label: 'Claude', supported: true, models: [] },
        ]}
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
      expect(
        getByLabelText(container, 'Agent and model').querySelector('[data-provider-icon="claude-code"]'),
      ).toBeInstanceOf(HTMLImageElement);
    } finally {
      cleanup(root, container);
    }
  });

  it('explains why a Codex conversation cannot switch to Claude Code', () => {
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        lockedAgentTargetId="codex"
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
      const provider = getByLabelText(container, 'Agent and model');
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

  it('queries Tutti external agent targets and inserts the exact agent mention', async () => {
    const selectResult = vi.fn();
    const onDraftChange = vi.fn();
    const atQuery = vi.fn(async () => [
      {
        providerId: 'agent-target',
        itemId: 'team:automation',
        label: 'Automation Agent',
        subtitle: 'Agent',
        thumbnailUrl: '/assets/automation-agent.png',
        insert: {
          kind: 'mention',
          mention: {
            entityId: 'team:automation',
            label: 'Automation Agent',
            scope: {
              workspaceId: 'workspace-1',
            },
            presentation: {
              iconUrl: '/assets/automation-agent.png',
              subtitle: 'Agent',
            },
          },
        },
      },
    ]);
    setTuttiExternalAtQuery(atQuery);
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult,
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onDraftChange={onDraftChange}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    try {
      const message = getByLabelText(container, 'Message');
      await changeText(message, '@auto');

      await waitFor(() =>
        expect(atQuery).toHaveBeenCalledWith({
          keyword: 'auto',
          maxResults: 20,
          providers: ['agent-target'],
        }),
      );
      await waitFor(() => expect(document.body.textContent).toContain('Automation Agent'));
      expect(document.body.textContent).toContain('Agent');

      await act(async () => buttonByName(document.body, 'Automation Agent').click());
      await flushAsyncWork();

      expect(selectResult).not.toHaveBeenCalled();
      expect(onDraftChange).toHaveBeenLastCalledWith(
        '[@Automation Agent](mention://agent-target/team:automation?workspaceId=workspace-1)',
      );
      expect(container.querySelector('[aria-label="Mention results"]')).toBeNull();
    } finally {
      clearTuttiExternal();
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

      expect(onSend).toHaveBeenCalledWith({ draft: 'Build this layout', files: [], agentTargetId: 'codex' });
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

      expect(onSend).toHaveBeenCalledWith({ draft: '', files: [image], agentTargetId: 'codex' });
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

      expect(onSend).toHaveBeenCalledWith({ draft: '', files: [], agentTargetId: 'codex', commentAttachments });
      expect(getByLabelText(container, 'Staged preview comments').textContent).toContain('Hero title');
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps Cmd+Enter available for editor line breaks instead of sending the draft', async () => {
    const onSend = vi.fn();
    const onDraftChange = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onDraftChange={onDraftChange}
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

      expect(onDraftChange).toHaveBeenLastCalledWith('第一行\n');
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps Ctrl+Enter available for editor line breaks instead of sending the draft', async () => {
    const onSend = vi.fn();
    const onDraftChange = vi.fn();
    const { container, root } = renderComponent(
      <ChatComposer
        streaming={false}
        context={{
          search: async () => ({ items: [] }),
          selectResult: vi.fn(),
          snapshot: { selectedSkills: [], selectedDesignFiles: [] },
        }}
        onDraftChange={onDraftChange}
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

      expect(onDraftChange).toHaveBeenLastCalledWith('第一行\n');
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

      expect(onSend).toHaveBeenCalledWith({ draft: '', files: [], agentTargetId: 'codex' });
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
      expect(onSend).toHaveBeenCalledWith({ draft: 'Queue this next', files: [], agentTargetId: 'codex' });
      expect(editorText(getByLabelText(container, 'Message'))).toBe('');
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

      expect(onSend).toHaveBeenCalledWith({ draft: 'Keep this draft', files: [file], agentTargetId: 'codex' });
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
