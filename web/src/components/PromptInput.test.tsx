// @vitest-environment jsdom
import React, { act } from 'react';
import { fireEvent } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { PromptInput, type PromptInputHandle } from './PromptInput';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const emptyClientRects = (): DOMRectList => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
} as DOMRectList);

const zeroClientRect = (): DOMRect => new DOMRect(0, 0, 0, 0);

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = emptyClientRects;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = zeroClientRect;
}
if (!('getClientRects' in Node.prototype)) {
  Object.defineProperty(Node.prototype, 'getClientRects', {
    configurable: true,
    value: emptyClientRects,
  });
}
if (!('getBoundingClientRect' in Node.prototype)) {
  Object.defineProperty(Node.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: zeroClientRect,
  });
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

function editor(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[role="textbox"][aria-label="Prompt"]');
  if (!(element instanceof HTMLElement)) throw new Error('Missing prompt editor');
  return element;
}

describe('PromptInput', () => {
  it('renders a TipTap textbox and synchronizes the plain-text form value', async () => {
    const changes: string[] = [];
    const { container, root } = renderComponent(
      <PromptInput
        ariaLabel="Prompt"
        name="prompt"
        placeholder="描述你想生成的内容..."
        value=""
        onChange={(value) => changes.push(value)}
      />,
    );

    try {
      const promptEditor = editor(container);
      const hiddenInput = container.querySelector<HTMLInputElement>('input[type="hidden"][name="prompt"]');

      expect(promptEditor.getAttribute('contenteditable')).toBe('true');
      expect(hiddenInput).not.toBeNull();

      await act(async () => {
        promptEditor.textContent = '生成一个组件';
        fireEvent.input(promptEditor);
      });

      expect(changes.at(-1)).toBe('生成一个组件');
      expect(hiddenInput!.value).toBe('生成一个组件');
    } finally {
      cleanup(root, container);
    }
  });

  it('submits on Enter only when the caller accepts the shortcut', async () => {
    const submit = vi.fn();
    const { container, root } = renderComponent(
      <PromptInput
        ariaLabel="Prompt"
        value="发送这条"
        onChange={vi.fn()}
        onSubmitShortcut={submit}
        shouldSubmitOnEnter={(event) => !event.shiftKey}
      />,
    );

    try {
      const promptEditor = editor(container);

      await act(async () => {
        fireEvent.keyDown(promptEditor, { key: 'Enter', code: 'Enter', shiftKey: true });
        fireEvent.keyDown(promptEditor, { key: 'Enter', code: 'Enter' });
      });

      expect(submit).toHaveBeenCalledOnce();
    } finally {
      cleanup(root, container);
    }
  });

  it('inserts a line break on Cmd+Enter when the caller does not accept it as submit', async () => {
    const changes: string[] = [];
    const ref = React.createRef<PromptInputHandle>();
    const { container, root } = renderComponent(
      <PromptInput
        ref={ref}
        ariaLabel="Prompt"
        value="第一行"
        onChange={(value) => changes.push(value)}
        onSubmitShortcut={vi.fn()}
        shouldSubmitOnEnter={(event) => !event.metaKey}
      />,
    );

    try {
      const promptEditor = editor(container);

      await act(async () => {
        ref.current?.focusToEnd();
        fireEvent.keyDown(promptEditor, {
          key: 'Enter',
          code: 'Enter',
          metaKey: true,
          cancelable: true,
        });
      });

      expect(changes.at(-1)).toBe('第一行\n');
    } finally {
      cleanup(root, container);
    }
  });

  it('inserts a line break on Shift+Enter when the caller does not accept it as submit', async () => {
    const changes: string[] = [];
    const ref = React.createRef<PromptInputHandle>();
    const { container, root } = renderComponent(
      <PromptInput
        ref={ref}
        ariaLabel="Prompt"
        value="第一行"
        onChange={(value) => changes.push(value)}
        onSubmitShortcut={vi.fn()}
        shouldSubmitOnEnter={(event) => !event.shiftKey}
      />,
    );

    try {
      const promptEditor = editor(container);

      await act(async () => {
        ref.current?.focusToEnd();
        fireEvent.keyDown(promptEditor, {
          key: 'Enter',
          code: 'Enter',
          shiftKey: true,
          cancelable: true,
        });
      });

      expect(changes.at(-1)).toBe('第一行\n');
    } finally {
      cleanup(root, container);
    }
  });

  it('inserts a line break on Ctrl+Enter when the caller does not accept it as submit', async () => {
    const changes: string[] = [];
    const ref = React.createRef<PromptInputHandle>();
    const { container, root } = renderComponent(
      <PromptInput
        ref={ref}
        ariaLabel="Prompt"
        value="第一行"
        onChange={(value) => changes.push(value)}
        onSubmitShortcut={vi.fn()}
        shouldSubmitOnEnter={(event) => !event.ctrlKey}
      />,
    );

    try {
      const promptEditor = editor(container);

      await act(async () => {
        ref.current?.focusToEnd();
        fireEvent.keyDown(promptEditor, {
          key: 'Enter',
          code: 'Enter',
          ctrlKey: true,
          cancelable: true,
        });
      });

      expect(changes.at(-1)).toBe('第一行\n');
    } finally {
      cleanup(root, container);
    }
  });

  it('does not submit Enter while IME composition is active', async () => {
    const submit = vi.fn();
    const { container, root } = renderComponent(
      <PromptInput
        ariaLabel="Prompt"
        value="中文"
        onChange={vi.fn()}
        onSubmitShortcut={submit}
        shouldSubmitOnEnter={() => true}
      />,
    );

    try {
      const promptEditor = editor(container);
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'isComposing', { value: true });

      await act(async () => {
        promptEditor.dispatchEvent(event);
      });

      expect(submit).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('preserves paragraph breaks when syncing DOM input events', async () => {
    const changes: string[] = [];
    const { container, root } = renderComponent(
      <PromptInput
        ariaLabel="Prompt"
        value={'第一行\n第二行'}
        onChange={(value) => changes.push(value)}
      />,
    );

    try {
      await act(async () => {
        fireEvent.input(editor(container));
      });

      expect(changes).toEqual([]);
    } finally {
      cleanup(root, container);
    }
  });

  it('exposes focus and insertText for composer integrations', async () => {
    const ref = React.createRef<PromptInputHandle>();
    const changes: string[] = [];
    const { container, root } = renderComponent(
      <PromptInput
        ref={ref}
        ariaLabel="Prompt"
        value=""
        onChange={(value) => changes.push(value)}
      />,
    );

    try {
      await act(async () => {
        ref.current?.focus();
        ref.current?.insertText('@');
      });

      expect(document.activeElement).toBe(editor(container));
      expect(changes.at(-1)).toBe('@');
    } finally {
      cleanup(root, container);
    }
  });
});
