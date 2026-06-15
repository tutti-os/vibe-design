// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from './AssistantMessage';
import { applyLocale, I18nProvider } from '../i18n';
import type { MessageBlock } from '../services/chat-timeline/chat-timeline-types';
import type { ChatMessage } from '../types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  applyLocale('en');
});

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

function buttonByName(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${name}`);
  return button;
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const input = container.querySelector(`[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input ${label}`);
  return input;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('AssistantMessage', () => {
  it('localizes assistant status and tool chrome with the active locale', () => {
    const message: ChatMessage = {
      id: 'assistant-i18n',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };

    const { container, root } = renderComponent(
      <I18nProvider initialLocale="zh-CN">
        <AssistantMessage
          message={message}
          blocks={[
            { kind: 'thinking', content: 'Checking constraints' },
            {
              kind: 'generated-files',
              files: [{ name: 'landing-page.html', artifactType: 'text/html', title: 'Landing Page' }],
            },
            { kind: 'todo-write', toolUseId: 'todo-1', input: { todos: [] } },
          ]}
          streaming={true}
        />
      </I18nProvider>,
    );

    try {
      expect(container.querySelector('[aria-label="智能体工作状态"]')).toBeInstanceOf(HTMLElement);
      expect(container.textContent).toContain('运行中');
      expect(container.textContent).toContain('思考中');
      expect(container.textContent).toContain('生成的文件');
      expect(container.textContent).toContain('待办');
      expect(container.textContent).toContain('暂无待办');
      expect(container.textContent).not.toContain('Generated files');
      expect(container.textContent).not.toContain('No todos');
    } finally {
      cleanup(root, container);
    }
  });

  it('omits the generated files count from the tool card header', () => {
    const message: ChatMessage = {
      id: 'assistant-generated-files',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'generated-files',
            files: [{ name: 'landing-page.html', artifactType: 'text/html', title: 'Landing Page' }],
          },
        ]}
        streaming={false}
      />,
    );

    try {
      const header = container.querySelector('.tool-card__header');
      expect(header?.textContent?.trim()).toBe('Generated files');
      expect(container.textContent).toContain('landing-page.html');
      expect(container.textContent).toContain('HTML');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows generated file basenames without truncating the open control', async () => {
    const onOpenGeneratedFile = vi.fn();
    const fullPath =
      '/Users/chovy/Desktop/workspace/vibe-design/server/.vibe/projects/project-1/night-market-poster.html';
    const message: ChatMessage = {
      id: 'assistant-generated-file-path',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const file = { name: fullPath, artifactType: 'text/html', title: 'Night Market Event Poster' };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[{ kind: 'generated-files', files: [file] }]}
        streaming={false}
        onOpenGeneratedFile={onOpenGeneratedFile}
      />,
    );

    try {
      const openButton = buttonByName(container, 'night-market-poster.html');
      const fileName = openButton.querySelector('span');

      expect(openButton.textContent).toContain('night-market-poster.html');
      expect(openButton.textContent).not.toContain('/Users/chovy/Desktop');
      expect(fileName?.className).not.toContain('truncate');

      await act(async () => openButton.click());

      expect(onOpenGeneratedFile).toHaveBeenCalledWith(file);
    } finally {
      cleanup(root, container);
    }
  });

  it('renders duplicate generated file paths as one generated file row', () => {
    const fullPath =
      '/Users/chovy/Desktop/workspace/vibe-design/server/.vibe/projects/project-1/night-market-poster.html';
    const message: ChatMessage = {
      id: 'assistant-generated-file-duplicate-paths',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'generated-files',
            files: [
              { name: 'night-market-poster.html', artifactType: 'text/html', title: 'Night Market Event Poster' },
              { name: fullPath, artifactType: 'text/html' },
            ],
          },
        ]}
        streaming={false}
      />,
    );

    try {
      const rows = Array.from(container.querySelectorAll('.tool-card__generated-row'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.textContent).toContain('night-market-poster.html');
      expect(rows[0]?.textContent).toContain('Night Market Event Poster');
      expect(rows[0]?.textContent).not.toContain('/Users/chovy/Desktop');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows an in-progress content block when the active assistant turn has not streamed content yet', () => {
    const message: ChatMessage = {
      id: 'assistant-running-empty',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={[]} streaming={true} />,
    );

    try {
      const status = container.querySelector('[aria-label="Agent working status"]');
      expect(status).toBeInstanceOf(HTMLElement);
      expect(status?.textContent).toContain('running');
      expect(container.querySelector('.chat-message__running-icon')).toBeInstanceOf(SVGElement);
      expect(container.querySelectorAll('.chat-running-dot')).toHaveLength(0);
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps a running status at the bottom while assistant content is streaming', () => {
    const message: ChatMessage = {
      id: 'assistant-running-with-content',
      role: 'assistant',
      content: 'Working on it',
      runStatus: 'running',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[{ kind: 'text', content: 'Working on it', markdown: true }]}
        streaming={true}
      />,
    );

    try {
      expect(container.textContent).toContain('Working on it');
      const blocks = container.querySelector('.chat-message__blocks');
      const status = container.querySelector('[aria-label="Agent working status"]');
      expect(status).toBeInstanceOf(HTMLElement);
      expect(status?.textContent).toContain('running');
      expect(blocks?.lastElementChild).toBe(status);
    } finally {
      cleanup(root, container);
    }
  });

  it('shows an empty canceled run instead of rendering a blank assistant turn', () => {
    const message: ChatMessage = {
      id: 'assistant-canceled-empty',
      role: 'assistant',
      content: '',
      runStatus: 'canceled',
    };

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={[]} streaming={false} />,
    );

    try {
      const status = container.querySelector('[aria-label="Agent run status"]');
      expect(status).toBeInstanceOf(HTMLElement);
      expect(status?.textContent).toContain('canceled');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows an empty successful run instead of rendering a blank assistant turn', () => {
    const message: ChatMessage = {
      id: 'assistant-succeeded-empty',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };

    const { container, root } = renderComponent(
      <I18nProvider initialLocale="zh-CN">
        <AssistantMessage message={message} blocks={[]} streaming={false} />
      </I18nProvider>,
    );

    try {
      const status = container.querySelector('[aria-label="智能体运行状态"]');
      expect(status).toBeInstanceOf(HTMLElement);
      expect(status?.textContent).toContain('已完成');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders every assistant block type and answers tool questions', async () => {
    const onAnswerToolQuestion = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const blocks: MessageBlock[] = [
      { kind: 'text', content: 'Here is the plan', markdown: true },
      { kind: 'thinking', content: 'Checking constraints' },
      {
        kind: 'tool-group',
        calls: [{ id: 'tool-1', name: 'Read', input: { file_path: '/tmp/src/App.tsx' } }],
        results: [{ toolUseId: 'tool-1', content: 'ok', isError: false }],
      },
      {
        kind: 'file-ops',
        ops: [
          {
            path: 'App.tsx',
            fullPath: '/tmp/src/App.tsx',
            ops: ['read', 'edit'],
            opCounts: { read: 1, write: 0, edit: 1, delete: 0 },
            total: 2,
            status: 'done',
          },
        ],
      },
      {
        kind: 'generated-files',
        files: [{ name: 'landing-page.html', artifactType: 'text/html', title: 'Landing Page' }],
      },
      {
        kind: 'ask-user-question',
        toolUseId: 'question-1',
        input: {
          questions: [
            {
              header: 'Direction',
              question: 'Pick a layout',
              options: [
                { label: 'Grid', description: 'Dense browsing' },
                { label: 'List', description: 'Linear review' },
              ],
            },
          ],
        },
      },
      {
        kind: 'todo-write',
        toolUseId: 'todo-1',
        input: {
          todos: [
            { content: 'Read source', status: 'completed' },
            { content: 'Build target', status: 'in_progress', active_form: 'coding' },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={true}
        onAnswerToolQuestion={onAnswerToolQuestion}
      />,
    );

    try {
      expect(container.textContent).toContain('Here is the plan');
      expect(container.textContent).toContain('Checking constraints');
      expect(container.textContent).toContain('Read');
      expect(container.textContent).toContain('App.tsx');
      expect(container.textContent).toContain('Generated files');
      expect(container.textContent).toContain('landing-page.html');
      expect(container.textContent).toContain('Landing Page');
      expect(container.textContent).not.toContain('<!doctype html>');
      expect(container.textContent).toContain('Pick a layout');
      expect(container.textContent).toContain('Quick brief');
      expect(container.textContent).not.toContain('AskUserQuestion');
      expect(container.textContent).toContain('Read source');
      expect(container.textContent).toContain('Build target');
      expect(container.textContent).not.toContain('completed');
      expect(container.textContent).not.toContain('in_progress');
      expect(container.textContent).not.toContain('TodoWrite');
      expect(container.textContent).not.toContain('2Read source');

      await act(async () => buttonByName(container, 'Grid').click());
      await act(async () => buttonByName(container, 'Submit').click());
      expect(onAnswerToolQuestion).toHaveBeenCalledWith('question-1', 'Grid');
    } finally {
      cleanup(root, container);
    }
  });

  it('does not make read-only file operations clickable', () => {
    const onOpenFileOp = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-read-file-op',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'file-ops',
            ops: [
              {
                path: 'visual-comment-1780721550953.svg',
                fullPath: '/tmp/project/assets/visual-comment-1780721550953.svg',
                ops: ['read'],
                opCounts: { read: 1, write: 0, edit: 0, delete: 0 },
                total: 1,
                status: 'done',
              },
            ],
          },
        ]}
        streaming={false}
        onOpenFileOp={onOpenFileOp}
      />,
    );

    try {
      expect(container.querySelector('[aria-label="Open visual-comment-1780721550953.svg"]')).toBeNull();
      expect(container.textContent).toContain('visual-comment-1780721550953.svg');
    } finally {
      cleanup(root, container);
    }
  });

  it('does not render numeric totals on file operation rows', () => {
    const message: ChatMessage = {
      id: 'assistant-file-op-total',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'file-ops',
            ops: [
              {
                path: 'SPEC.md',
                fullPath: '/tmp/project/SPEC.md',
                ops: ['write'],
                opCounts: { read: 0, write: 2, edit: 0, delete: 0 },
                total: 2,
                status: 'running',
              },
            ],
          },
        ]}
        streaming={true}
      />,
    );

    try {
      const fileOpRows = Array.from(container.querySelectorAll('.tool-card__row'));
      expect(fileOpRows).toHaveLength(1);
      expect(fileOpRows[0]?.textContent).toContain('SPEC.md');
      expect(fileOpRows[0]?.textContent).toContain('write');
      expect(fileOpRows[0]?.textContent).not.toContain('2');
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps write file operations clickable', async () => {
    const onOpenFileOp = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-write-file-op',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const op = {
      path: 'landing-page.html',
      fullPath: '/tmp/project/landing-page.html',
      ops: ['write' as const],
      opCounts: { read: 0, write: 1, edit: 0, delete: 0 },
      total: 1,
      status: 'done' as const,
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[{ kind: 'file-ops', ops: [op] }]}
        streaming={false}
        onOpenFileOp={onOpenFileOp}
      />,
    );

    try {
      await act(async () => buttonByName(container, 'landing-page.html').click());
      expect(onOpenFileOp).toHaveBeenCalledWith(op);
    } finally {
      cleanup(root, container);
    }
  });

  it('shows a command preview in the tool call summary', () => {
    const message: ChatMessage = {
      id: 'assistant-command',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'tool-group',
            calls: [{ id: 'bash-1', name: 'Bash', input: { command: 'pnpm --filter @vibe-design/server test' } }],
            results: [],
          },
        ]}
        streaming={true}
      />,
    );

    try {
      const preview = container.querySelector('.tool-card__summary-command');
      expect(preview).toBeInstanceOf(HTMLElement);
      expect(preview?.textContent).toBe('pnpm --filter @vibe-design/server test');
    } finally {
      cleanup(root, container);
    }
  });

  it('does not render repeated per-row counts for grouped tool calls', () => {
    const message: ChatMessage = {
      id: 'assistant-grouped-tools',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'tool-group',
            calls: [
              { id: 'bash-1', name: 'Bash', input: { command: '/bin/zsh -lc "pwd"' } },
              { id: 'bash-2', name: 'Bash', input: { command: '/bin/zsh -lc "ls"' } },
            ],
            results: [],
          },
        ]}
        streaming={true}
      />,
    );

    try {
      const rows = Array.from(container.querySelectorAll('.tool-card__row'));
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toBe('Bash/bin/zsh -lc "pwd"');
      expect(rows[1]?.textContent).toBe('Bash/bin/zsh -lc "ls"');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows tool result details next to the matching tool call', () => {
    const message: ChatMessage = {
      id: 'assistant-tool-result-details',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'tool-group',
            calls: [{ id: 'bash-1', name: 'Bash', input: { command: 'pnpm test' } }],
            results: [{ toolUseId: 'bash-1', content: 'Tests passed', isError: false }],
          },
        ]}
        streaming={false}
      />,
    );

    try {
      const rows = Array.from(container.querySelectorAll('.tool-card__row'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.textContent).toContain('Bash');
      expect(rows[0]?.textContent).toContain('pnpm test');
      expect(rows[0]?.textContent).toContain('Tests passed');
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps long command previews complete when they wrap inside the card', () => {
    const message: ChatMessage = {
      id: 'assistant-long-command',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const command =
      "/bin/zsh -lc \"sed -n '1,220p' /Users/zhengweibin/.codex/superpowers/skills/using-superpowers/SKILL.md\"";

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'tool-group',
            calls: [{ id: 'bash-long', name: 'Bash', input: { command } }],
            results: [],
          },
        ]}
        streaming={true}
      />,
    );

    try {
      const preview = container.querySelector('.tool-card__summary-command');
      expect(preview).toBeInstanceOf(HTMLElement);
      expect(preview?.textContent).toBe(command);
    } finally {
      cleanup(root, container);
    }
  });

  it('renders direct AskUserQuestion input and answers an option', async () => {
    const onAnswerToolQuestion = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-2',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'ask-user-question',
        toolUseId: 'question-2',
        input: {
          question: 'Choose a direction',
          options: [
            { label: 'Minimal', description: 'Quiet interface' },
            { label: 'Expressive', description: 'Richer motion' },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={true}
        onAnswerToolQuestion={onAnswerToolQuestion}
      />,
    );

    try {
      expect(container.querySelector('.question-form-card')).toBeInstanceOf(HTMLElement);
      expect(container.textContent).toContain('Choose a direction');
      expect(container.textContent).toContain('Minimal');
      expect(container.textContent).toContain('Quick brief');
      expect(container.textContent).not.toContain('AskUserQuestion');
      expect(container.textContent).not.toContain('Waiting for input');

      await act(async () => buttonByName(container, 'Expressive').click());
      await act(async () => buttonByName(container, 'Submit').click());
      expect(onAnswerToolQuestion).toHaveBeenCalledWith('question-2', 'Expressive');
    } finally {
      cleanup(root, container);
    }
  });

  it('disables question options while async answer is pending and reports rejection', async () => {
    const answer = deferred<void>();
    const onAnswerToolQuestion = vi.fn(() => answer.promise);
    const message: ChatMessage = {
      id: 'assistant-3',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'ask-user-question',
        toolUseId: 'question-3',
        input: {
          question: 'Pick one',
          options: [{ label: 'Alpha' }, { label: 'Beta' }],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={true}
        onAnswerToolQuestion={onAnswerToolQuestion}
      />,
    );

    try {
      const alpha = buttonByName(container, 'Alpha');
      await act(async () => alpha.click());
      await act(async () => buttonByName(container, 'Submit').click());
      await act(async () => buttonByName(container, 'Submit').click());

      expect(onAnswerToolQuestion).toHaveBeenCalledTimes(1);
      expect(alpha.disabled).toBe(true);

      await act(async () => answer.reject(new Error('answer failed')));

      expect(container.textContent).toContain('Answer failed');
      expect(buttonByName(container, 'Alpha').disabled).toBe(false);
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps question options disabled after async answer succeeds', async () => {
    const answer = deferred<void>();
    const onAnswerToolQuestion = vi.fn(() => answer.promise);
    const message: ChatMessage = {
      id: 'assistant-4',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'ask-user-question',
        toolUseId: 'question-4',
        input: {
          question: 'Choose once',
          options: [{ label: 'Alpha' }, { label: 'Beta' }],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={true}
        onAnswerToolQuestion={onAnswerToolQuestion}
      />,
    );

    try {
      const alpha = buttonByName(container, 'Alpha');
      await act(async () => alpha.click());
      await act(async () => buttonByName(container, 'Submit').click());
      await act(async () => answer.resolve());

      expect(buttonByName(container, 'Alpha').disabled).toBe(true);
      await act(async () => buttonByName(container, 'Alpha').click());
      expect(onAnswerToolQuestion).toHaveBeenCalledTimes(1);
    } finally {
      cleanup(root, container);
    }
  });

  it('renders thinking content as markdown inside the expandable block', () => {
    const message: ChatMessage = {
      id: 'assistant-thinking',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'thinking',
        content:
          '**Plan**\n\n- Style: `Liquid Aurora`\n- Platform: Desktop',
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={blocks} streaming={true} />,
    );

    try {
      const thinking = container.querySelector('.chat-message__thinking');
      expect(thinking?.querySelector('pre')).toBeNull();
      expect(thinking?.querySelector('strong')?.textContent).toBe('Plan');
      expect(thinking?.querySelectorAll('li')).toHaveLength(2);
      expect(thinking?.querySelector('code')?.textContent).toBe('Liquid Aurora');
      expect(thinking?.textContent).not.toContain('- Style');
    } finally {
      cleanup(root, container);
    }
  });

  it('labels completed thinking as a thought process instead of an active thinking state', () => {
    const message: ChatMessage = {
      id: 'assistant-thinking-complete',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };

    const { container, root } = renderComponent(
      <I18nProvider initialLocale="zh-CN">
        <AssistantMessage
          message={message}
          blocks={[{ kind: 'thinking', content: '已经完成的推理内容' }]}
          streaming={false}
        />
      </I18nProvider>,
    );

    try {
      const thinking = container.querySelector('.chat-message__thinking');
      expect(thinking?.textContent).toContain('思考过程');
      expect(thinking?.textContent).not.toContain('思考中');
    } finally {
      cleanup(root, container);
    }
  });

  it('requires confirming an AskUserQuestion option before submitting it', async () => {
    const onAnswerToolQuestion = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-question-confirm',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'ask-user-question',
        toolUseId: 'question-confirm',
        input: {
          question: 'Choose a direction',
          options: [
            { label: 'Minimal', description: 'Quiet interface' },
            { label: 'Expressive', description: 'Richer motion' },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={true}
        onAnswerToolQuestion={onAnswerToolQuestion}
      />,
    );

    try {
      await act(async () => buttonByName(container, 'Expressive').click());
      expect(onAnswerToolQuestion).not.toHaveBeenCalled();
      expect(buttonByName(container, 'Expressive').getAttribute('aria-pressed')).toBe('true');

      await act(async () => buttonByName(container, 'Submit').click());
      expect(onAnswerToolQuestion).toHaveBeenCalledWith('question-confirm', 'Expressive');
    } finally {
      cleanup(root, container);
    }
  });

  it('submits one selected option per AskUserQuestion question as numbered answers', async () => {
    const onAnswerToolQuestion = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-multi-question',
      role: 'assistant',
      content: '',
      runStatus: 'running',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'ask-user-question',
        toolUseId: 'question-multi',
        input: {
          questions: [
            {
              header: '视角',
              question: '游戏视角选择？',
              options: [
                { label: '俯视 2D', description: '经典街机风格上帝视角' },
                { label: '侧视 2D', description: '横版卷轴风格' },
              ],
            },
            {
              header: '游戏规模',
              question: '游戏长度和结构？',
              options: [
                { label: '单关卡', description: '5-10 分钟一局' },
                { label: '无限模式', description: '随机生成赛道' },
              ],
            },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={true}
        onAnswerToolQuestion={onAnswerToolQuestion}
      />,
    );

    try {
      await act(async () => buttonByName(container, '俯视 2D').click());
      await act(async () => buttonByName(container, '无限模式').click());
      expect(buttonByName(container, '俯视 2D').getAttribute('aria-pressed')).toBe('true');
      expect(buttonByName(container, '无限模式').getAttribute('aria-pressed')).toBe('true');

      await act(async () => buttonByName(container, 'Submit').click());

      expect(onAnswerToolQuestion).toHaveBeenCalledWith(
        'question-multi',
        '1. 游戏视角选择？ 俯视 2D\n2. 游戏长度和结构？ 无限模式',
      );
    } finally {
      cleanup(root, container);
    }
  });

  it('renders agent error blocks in the assistant flow', () => {
    const message: ChatMessage = {
      id: 'assistant-error',
      role: 'assistant',
      content: '',
      runStatus: 'failed',
    };
    const blocks = [
      { kind: 'error', code: 'RUN_START_FAILED', message: 'agent executable not found' },
    ] as unknown as MessageBlock[];

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={blocks} streaming={false} />,
    );

    try {
      const error = container.querySelector('[role="alert"]');
      const surface = error?.querySelector('.chat-message__error-surface');
      expect(error).toBeInstanceOf(HTMLElement);
      expect(surface).toBeInstanceOf(HTMLElement);
      expect(error?.textContent).toContain('Agent error');
      expect(error?.textContent).toContain('RUN_START_FAILED');
      expect(error?.textContent).toContain('agent executable not found');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders markdown lists as list elements', () => {
    const message: ChatMessage = {
      id: 'assistant-5',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      { kind: 'text', content: '- First item\n- `Second` item', markdown: true },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={blocks} streaming={false} />,
    );

    try {
      expect(container.querySelector('ul')).not.toBeNull();
      expect(container.querySelectorAll('li')).toHaveLength(2);
      expect(container.querySelector('code')?.textContent).toBe('Second');
      expect(container.textContent).not.toContain('- First item');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders GitHub-flavored markdown tables from assistant planning text', () => {
    const message: ChatMessage = {
      id: 'assistant-gfm-table',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'text',
        content:
          '5维度 critique（构建前规划）\n\n| 维度 | 决策 |\n|---|---|\n| 层级 | 看板列标题 -> 卡片姓名/职位 -> 元数据 |\n| 无障碍 | 对比度 >= 4.5:1 |',
        markdown: true,
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={blocks} streaming={false} />,
    );

    try {
      const table = container.querySelector('table');
      expect(table).toBeInstanceOf(HTMLTableElement);
      expect(table?.querySelectorAll('th')).toHaveLength(2);
      expect(table?.querySelectorAll('td')).toHaveLength(4);
      expect(table?.textContent).toContain('看板列标题 -> 卡片姓名/职位 -> 元数据');
      expect(container.textContent).not.toContain('|---|');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders markdown fenced code blocks as code elements', () => {
    const message: ChatMessage = {
      id: 'assistant-6',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      { kind: 'text', content: '```ts\nconst value = 1;\n```', markdown: true },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={blocks} streaming={false} />,
    );

    try {
      expect(container.querySelector('pre code')?.textContent).toBe('const value = 1;');
      expect(container.textContent).not.toContain('```');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders markdown emphasis as semantic inline elements', () => {
    const message: ChatMessage = {
      id: 'assistant-7',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      { kind: 'text', content: '**问题排查 / Bug 修复**：确认根因后最小修复。', markdown: true },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage message={message} blocks={blocks} streaming={false} />,
    );

    try {
      const strong = container.querySelector('strong');
      expect(strong?.textContent).toBe('问题排查 / Bug 修复');
      expect(container.textContent).not.toContain('**');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders inline question forms and submits answers as a new user turn', async () => {
    const onSubmitToolQuestionFallback = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-5',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'question-form',
        form: {
          id: 'discovery',
          title: '快速确认',
          questions: [
            {
              id: 'output_type',
              title: '任务类型是什么？',
              type: 'select',
              options: [{ value: 'web_game', label: '可玩的网页游戏' }],
            },
            {
              id: 'brand_context',
              title: '是否有品牌背景？',
              type: 'text',
              placeholder: '例如：无品牌限制',
            },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={false}
        onSubmitToolQuestionFallback={onSubmitToolQuestionFallback}
      />,
    );

    try {
      await act(async () => buttonByName(container, '可玩的网页游戏').click());
      const brandInput = inputByLabel(container, '是否有品牌背景？');
      await act(async () => {
        setInputValue(brandInput, '无品牌限制');
      });
      await act(async () => buttonByName(container, 'Submit').click());

      expect(onSubmitToolQuestionFallback).toHaveBeenCalledWith(
        [
          '[form answers — discovery]',
          '- 任务类型是什么？: 可玩的网页游戏 [value: web_game]',
          '- 是否有品牌背景？: 无品牌限制',
        ].join('\n'),
      );
    } finally {
      cleanup(root, container);
    }
  });

  it('disables inline question form submission until at least one answer is filled', async () => {
    const onSubmitToolQuestionFallback = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-empty-form',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'question-form',
        form: {
          id: 'discovery',
          title: '快速确认',
          questions: [
            {
              id: 'output_type',
              title: '任务类型是什么？',
              type: 'select',
              options: [{ value: 'web_game', label: '可玩的网页游戏' }],
            },
            {
              id: 'brand_context',
              title: '是否有品牌背景？',
              type: 'text',
              placeholder: '例如：无品牌限制',
            },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={false}
        onSubmitToolQuestionFallback={onSubmitToolQuestionFallback}
      />,
    );

    try {
      const submit = buttonByName(container, 'Submit');
      expect(submit.disabled).toBe(true);

      await act(async () => submit.click());
      expect(onSubmitToolQuestionFallback).not.toHaveBeenCalled();

      await act(async () => buttonByName(container, '可玩的网页游戏').click());
      expect(submit.disabled).toBe(false);

      await act(async () => submit.click());
      expect(onSubmitToolQuestionFallback).toHaveBeenCalledWith(
        [
          '[form answers — discovery]',
          '- 任务类型是什么？: 可玩的网页游戏 [value: web_game]',
          '- 是否有品牌背景？: (skipped)',
        ].join('\n'),
      );
    } finally {
      cleanup(root, container);
    }
  });

  it('does not render the inline question form question count badge', () => {
    const message: ChatMessage = {
      id: 'assistant-form-count',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'question-form',
        form: {
          id: 'discovery',
          title: '快速确认',
          questions: [
            { id: 'platform', title: '目标平台', type: 'select', options: [{ value: 'pc', label: 'PC 端为主' }] },
            { id: 'user', title: '目标用户', type: 'select', options: [{ value: 'buyer', label: '购房者' }] },
            { id: 'style', title: '视觉风格', type: 'select', options: [{ value: 'clean', label: '现代简洁' }] },
            { id: 'map', title: '地图展示偏好', type: 'select', options: [{ value: 'placeholder', label: '占位示意图即可' }] },
            { id: 'scope', title: '设计范围', type: 'select', options: [{ value: 'homepage', label: '首页' }] },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={false}
        onSubmitToolQuestionFallback={vi.fn()}
      />,
    );

    try {
      const header = container.querySelector('.question-form-card__header');
      expect(header?.textContent).toContain('快速确认');
      expect(header?.textContent).not.toContain('5');
      expect(header?.querySelector('[data-slot="badge"]')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('shows the underlying inline question form submit error', async () => {
    const onSubmitToolQuestionFallback = vi.fn(async () => {
      throw new Error('conversation not found');
    });
    const message: ChatMessage = {
      id: 'assistant-form-error',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'question-form',
        form: {
          id: 'discovery',
          title: '快速确认',
          questions: [
            {
              id: 'output_type',
              title: '任务类型是什么？',
              type: 'select',
              options: [{ value: 'web_game', label: '可玩的网页游戏' }],
            },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={false}
        onSubmitToolQuestionFallback={onSubmitToolQuestionFallback}
      />,
    );

    try {
      await act(async () => buttonByName(container, '可玩的网页游戏').click());
      await act(async () => buttonByName(container, 'Submit').click());

      expect(container.textContent).toContain('conversation not found');
    } finally {
      cleanup(root, container);
    }
  });

  it('locks an inline question form when the next user message contains submitted answers', async () => {
    const onSubmitToolQuestionFallback = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-6',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'question-form',
        form: {
          id: 'discovery',
          title: '快速确认',
          questions: [
            {
              id: 'output_type',
              title: '任务类型是什么？',
              type: 'select',
              options: [{ value: 'web_game', label: '可玩的网页游戏' }],
            },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={false}
        nextUserContent={'[form answers — discovery]\n- 任务类型是什么？: 可玩的网页游戏 [value: web_game]'}
        onSubmitToolQuestionFallback={onSubmitToolQuestionFallback}
      />,
    );

    try {
      expect(buttonByName(container, '可玩的网页游戏').disabled).toBe(true);
      expect(container.textContent).toContain('Answered');
      expect(buttonByName(container, 'Submit').disabled).toBe(true);
    } finally {
      cleanup(root, container);
    }
  });

  it('marks an unanswered inline question form as skipped once a later user message exists', () => {
    const onSubmitToolQuestionFallback = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-skip',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const blocks: MessageBlock[] = [
      {
        kind: 'question-form',
        form: {
          id: 'discovery',
          title: '快速确认',
          questions: [
            {
              id: 'output_type',
              title: '任务类型是什么？',
              type: 'select',
              options: [{ value: 'web_game', label: '可玩的网页游戏' }],
            },
          ],
        },
      },
    ];

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={blocks}
        streaming={false}
        nextUserContent={'帮我直接生成一个落地页'}
        onSubmitToolQuestionFallback={onSubmitToolQuestionFallback}
      />,
    );

    try {
      expect(buttonByName(container, '可玩的网页游戏').disabled).toBe(true);
      expect(container.textContent).toContain('Skipped');
      expect(buttonByName(container, 'Submit').disabled).toBe(true);
    } finally {
      cleanup(root, container);
    }
  });

  it('locks an answered AskUserQuestion card and keeps an unanswered one skippable but non-submittable', () => {
    const message: ChatMessage = {
      id: 'assistant-aq',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
    };
    const input = { question: 'Pick one', options: [{ label: 'Alpha' }, { label: 'Beta' }] };

    const answered = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[{ kind: 'ask-user-question', toolUseId: 't1', input, answered: true }]}
        streaming={false}
        onAnswerToolQuestion={vi.fn()}
        onSubmitToolQuestionFallback={vi.fn()}
      />,
    );
    try {
      expect(answered.container.textContent).toContain('Answered');
      expect(buttonByName(answered.container, 'Submit').disabled).toBe(true);
    } finally {
      cleanup(answered.root, answered.container);
    }

    const skipped = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[{ kind: 'ask-user-question', toolUseId: 't1', input, answered: false }]}
        streaming={false}
        nextUserContent={'别问了，直接做'}
        onAnswerToolQuestion={vi.fn()}
        onSubmitToolQuestionFallback={vi.fn()}
      />,
    );
    try {
      expect(skipped.container.textContent).toContain('Skipped');
      expect(buttonByName(skipped.container, 'Submit').disabled).toBe(true);
    } finally {
      cleanup(skipped.root, skipped.container);
    }
  });

  it('routes markdown links for project files into the design file workspace instead of opening a browser tab', async () => {
    const onOpenGeneratedFile = vi.fn();
    const message: ChatMessage = {
      id: 'assistant-project-link',
      role: 'assistant',
      content: 'Saved [report.md](/api/projects/project-1/files/report.md).',
      runStatus: 'succeeded',
    };

    const { container, root } = renderComponent(
      <AssistantMessage
        message={message}
        blocks={[
          {
            kind: 'text',
            content: 'Saved [report.md](/api/projects/project-1/files/report.md).',
            markdown: true,
          },
        ]}
        streaming={false}
        onOpenGeneratedFile={onOpenGeneratedFile}
      />,
    );

    try {
      const link = container.querySelector('a');
      expect(link).toBeInstanceOf(HTMLAnchorElement);
      expect(link?.getAttribute('target')).toBeNull();

      await act(async () => {
        link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });

      expect(onOpenGeneratedFile).toHaveBeenCalledWith({ name: 'report.md' });
    } finally {
      cleanup(root, container);
    }
  });
});
