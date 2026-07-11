// @vitest-environment jsdom
import React, { act } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane as ChatPaneBase } from './ChatPane';
import { PRESET_PROMPTS, pickPresetPrompts } from './presetPrompts';
import type { ChatTimelineSnapshot } from '../services/chat-timeline/chat-timeline-types';
import type { CanvasCommentAttachment, ChatAttachment, ProjectFile } from '../types';
import type {
  CanvasPreviewComment,
  CanvasVisualMarkCommentAttachment,
} from '../features/canvas-workspace/canvas-comment/canvas-comment-types';
import type { WorkspaceFile } from '../features/canvas-workspace';

const transformControls = vi.hoisted(() => ({
  centerView: vi.fn(),
  resetTransform: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));
const transformWrapperProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const TEST_AGENT_AVAILABILITY = [
  { id: 'codex', label: 'Codex', available: true },
  { id: 'claude-code', label: 'Claude Code', available: true },
];

const TEST_AGENT_MODEL_CATALOG = [
  { agentId: 'codex', label: 'Codex', models: [] },
  { agentId: 'claude-code', label: 'Claude Code', models: [] },
];

function ChatPane(props: React.ComponentProps<typeof ChatPaneBase>): React.ReactElement {
  return (
    <ChatPaneBase
      {...props}
      agentAvailability={props.agentAvailability ?? TEST_AGENT_AVAILABILITY}
      agentModelCatalog={props.agentModelCatalog ?? TEST_AGENT_MODEL_CATALOG}
    />
  );
}

vi.mock('react-zoom-pan-pinch', async () => {
  const ReactModule = await import('react');

  return {
    TransformWrapper: ({
      children,
      ...props
    }: {
      children: (controls: typeof transformControls) => React.ReactNode;
    } & Record<string, unknown>) => {
      transformWrapperProps.current = props;
      return ReactModule.createElement(
        'div',
        { 'data-testid': 'chat-image-preview-transform-wrapper' },
        typeof children === 'function' ? children(transformControls) : children,
      );
    },
    TransformComponent: ({
      children,
      contentClass,
      wrapperClass,
    }: {
      children: React.ReactNode;
      contentClass?: string;
      wrapperClass?: string;
    }) =>
      ReactModule.createElement(
        'div',
        { className: wrapperClass },
        ReactModule.createElement('div', { className: contentClass }, children),
      ),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Element.prototype.scrollIntoView = vi.fn();

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

(
  globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }
).ResizeObserver = TestResizeObserver as typeof ResizeObserver;

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

beforeEach(() => {
  transformControls.centerView.mockClear();
  transformControls.resetTransform.mockClear();
  transformControls.zoomIn.mockClear();
  transformControls.zoomOut.mockClear();
  transformWrapperProps.current = null;
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

function getByLabelText(container: HTMLElement, label: string): HTMLElement {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing element labelled ${label}`);
  return element;
}

function queryByLabelText(container: HTMLElement, label: string): HTMLElement | null {
  const element = container.querySelector(`[aria-label="${label}"]`);
  return element instanceof HTMLElement ? element : null;
}

function buttonByName(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${name}`);
  return button;
}

function queryButtonByName(container: HTMLElement, name: string): HTMLButtonElement | null {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(name),
  );
  return button instanceof HTMLButtonElement ? button : null;
}

async function changeText(element: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    element.textContent = value;
    fireEvent.input(element);
  });
}

async function changeInputValue(element: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    fireEvent.input(element, { target: { value } });
  });
}

async function nextAnimationFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function previewComment(overrides: Partial<CanvasPreviewComment> = {}): CanvasPreviewComment {
  const comment: CanvasPreviewComment = {
    id: 'comment-1',
    projectId: 'project-1',
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

describe('ChatPane', () => {
  it('shows the project title in the active header when available', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectTitle="Warm music app"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.querySelector('[data-testid="chat-active-conversation-title"]')?.textContent).toBe('Warm music app');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders rich mention markdown in user messages without exposing mention hrefs', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Ask [@群聊](mention://workspace-app/group-chat?workspaceId=workspace-1) for context',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const userText = container.querySelector('.msg.user .user-text');
      const mention = userText?.querySelector('.tutti-rich-text-mention');

      expect(userText?.textContent).toBe('Ask @群聊 for context');
      expect(userText?.textContent).not.toContain('mention://workspace-app');
      expect(mention?.getAttribute('data-provider-id')).toBe('workspace-app');
    } finally {
      cleanup(root, container);
    }
  });

  it('renames the project title from the active header when a project title is shown', async () => {
    const onRenameConversation = vi.fn();
    const onRenameProject = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="project-1"
        projectTitle="Warm music app"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={onRenameConversation}
        onRenameProject={onRenameProject}
      />,
    );

    try {
      await act(async () => getByLabelText(container, 'Rename project').click());
      const renameInput = getByLabelText(container, 'Rename active project');
      if (!(renameInput instanceof HTMLInputElement)) throw new Error('Expected rename input');
      expect(renameInput.value).toBe('Warm music app');

      await act(async () => {
        renameInput.value = 'Updated music app';
        renameInput.dispatchEvent(new Event('input', { bubbles: true }));
        renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });

      expect(onRenameProject).toHaveBeenCalledWith('project-1', 'Updated music app');
      expect(onRenameConversation).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="chat-active-conversation-title"]')?.textContent).toBe('Updated music app');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders the cloned left-panel shell, supports history and rename interactions, and forwards question callbacks', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const onAnswerToolQuestion = vi.fn();
    const onCreateConversation = vi.fn();
    const onSelectConversation = vi.fn();
    const onRenameConversation = vi.fn();
    const onDeleteConversation = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: '制作一个坦克大战',
      conversations: [
        { id: 'conversation-1', title: '制作一个坦克大战', createdAt: 1, updatedAt: 2 },
        { id: 'conversation-2', title: '我想生成一个登陆页', createdAt: 2, updatedAt: 3 },
      ],
      pinnedTodoInput: {
        todos: [
          { content: 'Read source', status: 'completed' },
          { content: 'Build fixed todo list', activeForm: 'Writing current screen', status: 'in_progress' },
          { content: 'Verify layout', status: 'pending' },
        ],
      },
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Make the chat usable',
          events: [],
          blocks: [],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [
            { kind: 'text', content: 'Working on it', markdown: true },
            {
              kind: 'ask-user-question',
              toolUseId: 'question-1',
              input: {
                questions: [
                  {
                    question: 'Choose density',
                    options: [{ label: 'Compact' }, { label: 'Comfortable' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={onSend}
        onStop={onStop}
        onAnswerToolQuestion={onAnswerToolQuestion}
        onCreateConversation={onCreateConversation}
        onSelectConversation={onSelectConversation}
        onRenameConversation={onRenameConversation}
        onDeleteConversation={onDeleteConversation}
      />,
    );

    try {
      expect(container.textContent).toContain('制作一个坦克大战');
      expect(container.textContent).toContain('Make the chat usable');
      expect(container.textContent).toContain('Working on it');
      expect(container.querySelector('[aria-label="Pinned todo"]')).toBeNull();
      const dashboardLink = getByLabelText(container, 'Back to dashboard');
      expect(dashboardLink).toBeInstanceOf(HTMLAnchorElement);
      expect((dashboardLink as HTMLAnchorElement).getAttribute('href')).toBe('/');
      expect(dashboardLink.closest('.chat-active-conversation')).toBeTruthy();
      expect(dashboardLink.className).toContain('icon-only');
      expect(dashboardLink.closest('.chat-header-primary')).toBeNull();

      await act(async () => getByLabelText(container, 'Conversation history').click());
      expect(container.textContent).toContain('我想生成一个登陆页');
      await act(async () => getByLabelText(container, 'Delete conversation 我想生成一个登陆页').click());
      expect(document.body.textContent).toContain('Delete conversation?');
      expect(document.body.textContent).toContain('我想生成一个登陆页');
      expect(onDeleteConversation).not.toHaveBeenCalled();
      expect(onSelectConversation).not.toHaveBeenCalled();
      await act(async () => buttonByName(document.body, 'Cancel').click());
      expect(onDeleteConversation).not.toHaveBeenCalled();

      await act(async () => getByLabelText(container, 'Conversation history').click());
      await act(async () => getByLabelText(container, 'Delete conversation 我想生成一个登陆页').click());
      await act(async () => buttonByName(document.body, 'Delete').click());
      expect(onDeleteConversation).toHaveBeenCalledWith('conversation-2');

      await act(async () => getByLabelText(container, 'Conversation history').click());
      await act(async () => buttonByName(container, '我想生成一个登陆页').click());
      expect(onSelectConversation).toHaveBeenCalledWith('conversation-2');

      const renameButton = getByLabelText(container, 'Rename conversation');
      expect(renameButton.closest('.chat-active-conversation')).toBeTruthy();
      expect(renameButton.querySelector('svg')).toBeTruthy();
      expect(renameButton.textContent).not.toContain('✎');
      await act(async () => renameButton.click());
      const renameInput = getByLabelText(container, 'Rename active conversation');
      if (!(renameInput instanceof HTMLInputElement)) throw new Error('Expected rename input');
      await act(async () => {
        renameInput.value = '新的会话标题';
        renameInput.dispatchEvent(new Event('input', { bubbles: true }));
        renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(onRenameConversation).toHaveBeenCalledWith('conversation-1', '新的会话标题');

      await act(async () => buttonByName(container, 'Compact').click());
      await act(async () => buttonByName(container, 'Submit').click());
      expect(onAnswerToolQuestion).toHaveBeenCalledWith('question-1', 'Compact');

      expect((getByLabelText(container, 'Stop') as HTMLButtonElement).disabled).toBe(false);
      expect(container.querySelector('[aria-label="Send message"]')).toBeNull();
      expect(onStop).not.toHaveBeenCalled();

      await act(async () =>
        root.render(
          <ChatPane
            snapshot={{ ...snapshot, phase: 'idle' }}
            contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
            contextSearch={async () => ({ items: [] })}
            contextSelect={vi.fn()}
            onSend={onSend}
            onStop={onStop}
            onAnswerToolQuestion={onAnswerToolQuestion}
            onCreateConversation={onCreateConversation}
            onSelectConversation={onSelectConversation}
            onRenameConversation={onRenameConversation}
          />,
        ),
      );
      await changeText(getByLabelText(container, 'Message'), 'Ship this panel');
      await act(async () => getByLabelText(container, 'Send message').click());
      expect(onSend).toHaveBeenCalledWith({ draft: 'Ship this panel', files: [], agentId: 'codex' });
    } finally {
      cleanup(root, container);
    }
  });

  it('defines 20 preset prompts and samples a random visible set', () => {
    expect(PRESET_PROMPTS).toHaveLength(20);

    const selected = pickPresetPrompts(() => 0, 4);

    expect(selected.map((prompt) => prompt.title)).toEqual([
      'SaaS Analytics Dashboard',
      'Mobile Banking Onboarding',
      'AI Image Studio',
      'Developer Docs Portal',
    ]);
  });

  it('prefills the composer from random preset cards and omits starter examples in empty state', async () => {
    const onSend = vi.fn();
    const onCreateConversation = vi.fn();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={onCreateConversation}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('Start with context');
      expect(container.textContent).toContain('SaaS Analytics Dashboard');
      expect(container.textContent).toContain('Mobile Banking Onboarding');
      expect(container.textContent).toContain('AI Image Studio');
      expect(container.textContent).toContain('Developer Docs Portal');
      expect(container.textContent).not.toContain('Design System');
      expect(container.textContent).not.toContain('Start with a design request');
      expect(container.textContent).not.toContain('坦克大战');
      expect(getByLabelText(container, 'Start new conversation')).toBeTruthy();
      expect(getByLabelText(container, 'Start new conversation').querySelector('svg.lucide-message-square-plus')).toBeTruthy();
      expect(getByLabelText(container, 'Conversation history').querySelector('svg.lucide-clock')).toBeTruthy();

      await act(async () => buttonByName(container, 'SaaS Analytics Dashboard').click());
      expect(getByLabelText(container, 'Message').textContent).toContain('SaaS 增长分析仪表盘');
      expect(onCreateConversation).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
      cleanup(root, container);
    }
  });

  it('shows a project start empty state for new project conversations without starter prompt cards', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="project-1"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.querySelector('[data-testid="project-chat-empty-icon"]')).not.toBeNull();
      expect(container.textContent).toContain('Ready to start creating');
      expect(container.textContent).toContain('Prototype Design turns ideas into designs you can see, discuss, and refine.');
      expect(container.textContent).not.toContain('Start with context');
      expect(container.textContent).not.toContain('SaaS Analytics Dashboard');
      expect(container.textContent).not.toContain('Mobile Banking Onboarding');
      expect(container.textContent).not.toContain('AI Image Studio');
      expect(container.textContent).not.toContain('Developer Docs Portal');
    } finally {
      cleanup(root, container);
    }
  });

  it('uses the product philosophy copy in the project empty state', async () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="project-1"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        agentAvailability={[
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude-code', label: 'Claude Code', available: true },
        ]}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const modelProvider = getByLabelText(container, 'Model provider');
      await act(async () => {
        fireEvent.pointerDown(modelProvider, { button: 0, ctrlKey: false });
        fireEvent.click(modelProvider);
      });
      const claudeOption = Array.from(
        document.body.querySelectorAll('[data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-sub-trigger"]'),
      ).find((option) => option.textContent?.includes('Claude Code'));
      expect(claudeOption).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(claudeOption!);
      });

      const emptyHint = container.querySelector('.chat-empty-hint');
      expect(emptyHint?.textContent).toBe('Prototype Design turns ideas into designs you can see, discuss, and refine.');
      expect(emptyHint?.textContent).not.toContain('Claude Code');
      expect(emptyHint?.textContent).not.toContain('Codex');
    } finally {
      cleanup(root, container);
    }
  });

  it('disables new conversation actions with an explanation while the active conversation is empty', async () => {
    const onCreateConversation = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={onCreateConversation}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const startButton = getByLabelText(container, 'Start new conversation') as HTMLButtonElement;
      expect(startButton.disabled).toBe(true);
      expect(startButton.getAttribute('title')).toBeNull();

      const tooltipTrigger = startButton.closest('[data-slot="tooltip-trigger"]');
      expect(tooltipTrigger).not.toBeNull();
      await act(async () => {
        fireEvent.pointerMove(tooltipTrigger!);
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain('Send a message before starting another conversation.');
      });

      await act(async () => getByLabelText(container, 'Conversation history').click());
      const historyNewButton = buttonByName(container, 'New');
      expect(historyNewButton.disabled).toBe(true);
      await act(async () => historyNewButton.click());
      expect(onCreateConversation).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('does not offer deleting the only conversation in history', async () => {
    const onDeleteConversation = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onDeleteConversation={onDeleteConversation}
      />,
    );

    try {
      await act(async () => getByLabelText(container, 'Conversation history').click());

      expect(queryByLabelText(container, 'Delete conversation New conversation')).toBeNull();
      expect(onDeleteConversation).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('renders only the chat surface in the project panel header', async () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.querySelector('[role="tablist"]')).toBeNull();
      expect(container.querySelectorAll('button[role="tab"]')).toHaveLength(0);
      expect(queryButtonByName(container, 'Chat')).toBeNull();
      expect(queryButtonByName(container, 'Comments')).toBeNull();
      expect(getByLabelText(container, 'Message')).toBeTruthy();

      await act(async () => {
        root.render(
          <ChatPane
            snapshot={snapshot}
            contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
            contextSearch={async () => ({ items: [] })}
            contextSelect={vi.fn()}
            onSend={vi.fn()}
            onStop={vi.fn()}
            onAnswerToolQuestion={vi.fn()}
            onCreateConversation={vi.fn()}
            onSelectConversation={vi.fn()}
            onRenameConversation={vi.fn()}
          />,
        );
      });

      expect(container.querySelector('[role="tablist"]')).toBeNull();
      expect(queryButtonByName(container, 'Comments')).toBeNull();
      expect(queryByLabelText(container, 'Preview comments panel')).toBeNull();
      expect(getByLabelText(container, 'Message')).toBeTruthy();
    } finally {
      cleanup(root, container);
    }
  });

  it('renders the canvas-opened comments panel without restoring chat tabs', async () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };
    const onClosePreviewCommentsPanel = vi.fn();

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        previewComments={[previewComment()]}
        commentPanelOpen
        onClosePreviewCommentsPanel={onClosePreviewCommentsPanel}
        onSendPreviewComments={vi.fn()}
        onDeletePreviewComment={vi.fn()}
        onOpenPreviewComment={vi.fn()}
        onPatchPreviewCommentStatus={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.querySelector('[role="tablist"]')).toBeNull();
      expect(container.querySelectorAll('button[role="tab"]')).toHaveLength(0);
      expect(queryButtonByName(container, 'Chat')).toBeNull();
      expect(queryButtonByName(container, 'Comments')).toBeNull();
      expect(queryByLabelText(container, 'Message')).toBeNull();
      expect(getByLabelText(container, 'Preview comments panel')).toBeTruthy();
      expect(container.querySelector('[data-testid="chat-preview-comment-row-comment-1"]')?.textContent).toContain(
        'Tighten this section',
      );

      await act(async () => {
        getByLabelText(container, 'Close comments').click();
      });

      expect(onClosePreviewCommentsPanel).toHaveBeenCalledOnce();
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps the unsent composer draft across parent rerenders', async () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };
    const baseProps = {
      snapshot,
      contextSnapshot: { selectedSkills: [], selectedDesignFiles: [] },
      contextSearch: async () => ({ items: [] }),
      contextSelect: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      onAnswerToolQuestion: vi.fn(),
      onCreateConversation: vi.fn(),
      onSelectConversation: vi.fn(),
      onRenameConversation: vi.fn(),
    };

    const { container, root } = renderComponent(<ChatPane {...baseProps} />);

    try {
      await changeText(getByLabelText(container, 'Message'), 'Keep this draft');
      expect(getByLabelText(container, 'Message').textContent).toContain('Keep this draft');

      await act(async () => {
        root.render(<ChatPane {...baseProps} />);
      });

      expect(getByLabelText(container, 'Message').textContent).toContain('Keep this draft');
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps the chat message scroll position across parent rerenders', async () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        { id: 'user-1', role: 'user', content: 'First request', events: [], blocks: [] },
        { id: 'assistant-1', role: 'assistant', content: 'First response', runStatus: 'succeeded', events: [], blocks: [] },
        { id: 'user-2', role: 'user', content: 'Second request', events: [], blocks: [] },
        { id: 'assistant-2', role: 'assistant', content: 'Second response', runStatus: 'succeeded', events: [], blocks: [] },
      ],
    };
    const baseProps = {
      snapshot,
      contextSnapshot: { selectedSkills: [], selectedDesignFiles: [] },
      contextSearch: async () => ({ items: [] }),
      contextSelect: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      onAnswerToolQuestion: vi.fn(),
      onCreateConversation: vi.fn(),
      onSelectConversation: vi.fn(),
      onRenameConversation: vi.fn(),
    };

    const { container, root } = renderComponent(<ChatPane {...baseProps} />);

    try {
      const chatLog = container.querySelector('.chat-log');
      if (!(chatLog instanceof HTMLDivElement)) throw new Error('Missing chat log');
      chatLog.scrollTop = 128;
      fireEvent.scroll(chatLog);

      await act(async () => {
        root.render(<ChatPane {...baseProps} />);
      });

      const restoredChatLog = container.querySelector('.chat-log');
      if (!(restoredChatLog instanceof HTMLDivElement)) throw new Error('Missing restored chat log');
      expect(restoredChatLog.scrollTop).toBe(128);
    } finally {
      cleanup(root, container);
    }
  });

  it('submits historical question answers as a new turn', async () => {
    const onSend = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'succeeded',
          events: [],
          blocks: [
            {
              kind: 'ask-user-question',
              toolUseId: 'question-1',
              input: { question: 'Pick density', options: [{ label: 'Compact' }, { label: 'Comfortable' }] },
            },
          ],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      await act(async () => buttonByName(container, 'Comfortable').click());
      await act(async () => buttonByName(container, 'Submit').click());
      expect(onSend).toHaveBeenCalledWith({ draft: 'Comfortable', files: [], agentId: 'codex' });
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps an arbitrary canonical conversation provider when submitting an inline question form', async () => {
    const onSend = vi.fn();
    const agentModelCatalog = [
      {
        agentId: 'tutti-agent',
        label: 'Tutti Agent',
        models: [{ id: 'default', label: 'Default' }],
      },
    ];
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a product page',
      conversations: [{ id: 'conversation-1', title: 'Build a product page', provider: 'tutti-agent', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'succeeded',
          events: [],
          blocks: [
            {
              kind: 'question-form',
              form: {
                id: 'discovery',
                title: '快速确认',
                questions: [
                  {
                    id: 'visual_style',
                    title: '视觉风格',
                    type: 'select',
                    options: [{ value: 'modern_dark', label: '现代深色' }],
                  },
                  {
                    id: 'brand_name',
                    title: '品牌名称',
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        agentModelCatalog={agentModelCatalog}
        activeConversationProvider="tutti-agent"
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      await act(async () => buttonByName(container, '现代深色').click());
      await changeInputValue(getByLabelText(container, '品牌名称'), 'Acme');
      await act(async () => buttonByName(container, 'Submit').click());

      expect(onSend).toHaveBeenCalledWith({
        draft: [
          '[form answers — discovery]',
          '- 视觉风格: 现代深色 [value: modern_dark]',
          '- 品牌名称: Acme',
        ].join('\n'),
        files: [],
        agentId: 'tutti-agent',
      });
      expect(container.textContent).toContain('Tutti Agent');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows a running status for the active assistant turn', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [{ kind: 'text', content: 'Working on it', markdown: true }],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const status = getByLabelText(container, 'Agent run status');
      expect(status.textContent).toBe('running');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows queued status on user turns that are waiting behind an active run', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
        {
          id: 'user-1',
          role: 'user',
          content: 'Use the selected skill next',
          turnStatus: 'queued',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const queuedStatus = getByLabelText(container, 'Queued turn status');
      expect(queuedStatus.textContent).toBe('queued');
      expect(container.textContent).toContain('Use the selected skill next');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows selected skill names on queued turn previews', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        queuedTurns={[
          {
            id: 'queued-turn-1',
            content: 'Use the selected skill.',
            conversationId: 'conversation-1',
            attachments: [],
            commentAttachments: [],
            messageContext: {
              selectedSkills: [
                { id: 'skill-1', name: 'Hero Builder' },
                { id: 'skill-2', name: 'Layout Critic' },
              ],
            },
          },
        ]}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('Skill');
      expect(container.textContent).toContain('Hero Builder');
      expect(container.textContent).toContain('Layout Critic');
    } finally {
      cleanup(root, container);
    }
  });

  it('keeps queued turn previews out of the message log layout reservation', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        queuedTurns={[
          {
            id: 'queued-turn-1',
            content: 'Use the selected skill.',
            conversationId: 'conversation-1',
            attachments: [],
            commentAttachments: [],
          },
        ]}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const pane = container.querySelector('.pane');
      const chatLog = container.querySelector('.chat-log');
      const queuedTurns = container.querySelector('.queued-turns');

      expect(pane?.className).toBe('pane');
      expect(chatLog).toBeTruthy();
      expect(queuedTurns).toBeTruthy();
      expect((pane as HTMLElement | null)?.style.getPropertyValue('--chat-queued-turns-reserved-height')).toBe('');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows selected skill names on user messages that carry skill context', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Use the selected skill next',
          context: {
            selectedSkills: [
              { id: 'skill-1', name: 'Hero Builder' },
              { id: 'skill-2', name: 'Layout Critic' },
            ],
          },
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('Skill');
      expect(container.textContent).toContain('Hero Builder');
      expect(container.textContent).toContain('Layout Critic');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows selected design file names on user messages that carry file context', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Use the selected context.',
          context: {
            selectedDesignFiles: [
              {
                id: 'file-1',
                name: 'design-preview-navy-coral.html',
                path: 'design-preview-navy-coral.html',
                size: 2048,
                mtime: 1,
                kind: 'html',
                mime: 'text/html',
              },
            ],
          },
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('design-preview-navy-coral.html');
    } finally {
      cleanup(root, container);
    }
  });

  it('shows queued preview comments above the composer with screenshot and comment text', () => {
    const queuedComment = {
      ...visualCommentAttachment(),
      comment: 'Make the featured podcast title use the saved editorial copy.',
    };
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        queuedTurns={[
          {
            id: 'queued-1',
            content: 'Apply the attached preview comment.',
            conversationId: 'conversation-1',
            attachments: [
              {
                path: 'assets/visual-comment.svg',
                name: 'visual-comment.svg',
                kind: 'image',
                mimeType: 'image/svg+xml',
              },
            ],
            commentAttachments: [queuedComment],
          },
        ]}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const queuedPreview = getByLabelText(container, 'Queued turns');
      expect(queuedPreview.textContent).not.toContain('Apply the attached preview comment.');
      expect(queuedPreview.textContent).toContain(queuedComment.comment);
      expect(queuedPreview.textContent).not.toContain('Hero title');
      const image = queuedPreview.querySelector<HTMLImageElement>('.preview-comment-attachment-image');
      expect(image).toBeInstanceOf(HTMLImageElement);
      expect(image?.alt).toBe('visual-comment.svg');
      expect(image?.getAttribute('src')).toBe('/api/assets/visual-comment.svg');
      expect(queuedPreview.querySelector('.user-attachment-image-button')).toBeNull();
      expect(container.querySelectorAll('.msg.user')).toHaveLength(0);
    } finally {
      cleanup(root, container);
    }
  });

  it('offers queued turn delete and send-next actions', async () => {
    const onDeleteQueuedTurn = vi.fn();
    const onSendQueuedTurnNext = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a dashboard',
      conversations: [{ id: 'conversation-1', title: 'Build a dashboard', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        queuedTurns={[
          {
            id: 'queued-1',
            content: 'Send this next',
            conversationId: 'conversation-1',
            attachments: [],
            commentAttachments: [],
          },
        ]}
        onDeleteQueuedTurn={onDeleteQueuedTurn}
        onSendQueuedTurnNext={onSendQueuedTurnNext}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      await act(async () => getByLabelText(container, 'Send queued turn next').click());
      await act(async () => getByLabelText(container, 'Delete queued turn').click());

      expect(onSendQueuedTurnNext).toHaveBeenCalledWith('queued-1');
      expect(onDeleteQueuedTurn).toHaveBeenCalledWith('queued-1');
    } finally {
      cleanup(root, container);
    }
  });

  it('moves a queued turn back into the composer for editing', async () => {
    const onDeleteQueuedTurn = vi.fn();
    const onSend = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a dashboard',
      conversations: [{ id: 'conversation-1', title: 'Build a dashboard', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        queuedTurns={[
          {
            id: 'queued-1',
            content: 'Visible queued summary',
            prompt: 'Editable queued prompt',
            conversationId: 'conversation-1',
            attachments: [
              {
                path: 'assets/reference.png',
                name: 'reference.png',
                kind: 'image',
                mimeType: 'image/png',
                size: 128,
              },
            ],
            commentAttachments: [],
          },
        ]}
        onDeleteQueuedTurn={onDeleteQueuedTurn}
        onSend={onSend}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      await act(async () => getByLabelText(container, 'Edit queued turn').click());
      await nextAnimationFrame();

      expect(onDeleteQueuedTurn).toHaveBeenCalledWith('queued-1');
      expect(getByLabelText(container, 'Message').textContent).toBe('Editable queued prompt');
      expect(getByLabelText(container, 'Staged input attachments').textContent).toContain('reference.png');
      expect(document.activeElement).toBe(getByLabelText(container, 'Message'));

      await act(async () => getByLabelText(container, 'Send message').click());

      expect(onSend).toHaveBeenCalledWith({
        draft: 'Editable queued prompt',
        files: [],
        attachments: [
          {
            path: 'assets/reference.png',
            name: 'reference.png',
            kind: 'image',
            mimeType: 'image/png',
            size: 128,
          },
        ],
        agentId: 'codex',
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('restores queued turn skill and design-file context when editing', async () => {
    const onDeleteQueuedTurn = vi.fn();
    const onSend = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a dashboard',
      conversations: [{ id: 'conversation-1', title: 'Build a dashboard', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
      ],
    };

    function Harness() {
      const [contextSnapshot, setContextSnapshot] = React.useState({
        selectedSkills: [{ id: 'stale-skill', name: 'Stale Skill' }],
        selectedDesignFiles: [projectFile({ id: 'stale-file', path: 'src/Stale.tsx', name: 'Stale.tsx' })],
      });
      const contextSelect = vi.fn((item) => {
        setContextSnapshot((current) => {
          if (item.kind === 'skill') {
            return {
              ...current,
              selectedSkills: [...current.selectedSkills, { id: item.value, name: item.label }],
            };
          }
          return {
            ...current,
            selectedDesignFiles: [
              ...current.selectedDesignFiles,
              projectFile({ id: item.value, path: item.path, name: item.label }),
            ],
          };
        });
      });
      const contextRemove = vi.fn((kind, id) => {
        setContextSnapshot((current) => {
          if (kind === 'skill') {
            return {
              ...current,
              selectedSkills: current.selectedSkills.filter((skill) => skill.id !== id),
            };
          }
          return {
            ...current,
            selectedDesignFiles: current.selectedDesignFiles.filter((file) => file.id !== id && file.path !== id),
          };
        });
      });

      return (
        <ChatPane
          snapshot={snapshot}
          contextSnapshot={contextSnapshot}
          contextSearch={async () => ({ items: [] })}
          contextSelect={contextSelect}
          contextRemove={contextRemove}
          queuedTurns={[
            {
              id: 'queued-1',
              content: 'Use the selected skill.',
              prompt: 'Use the selected skill.',
              conversationId: 'conversation-1',
              attachments: [],
              commentAttachments: [],
              messageContext: {
                selectedSkills: [{ id: 'skill-1', name: 'Hero Builder' }],
                selectedDesignFiles: [projectFile({ id: 'file-1', path: 'pages/landing.html', name: 'landing.html' })],
              },
            },
          ]}
          onDeleteQueuedTurn={onDeleteQueuedTurn}
          onSend={onSend}
          onStop={vi.fn()}
          onAnswerToolQuestion={vi.fn()}
          onCreateConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onRenameConversation={vi.fn()}
        />
      );
    }

    const { container, root } = renderComponent(<Harness />);

    try {
      await act(async () => getByLabelText(container, 'Edit queued turn').click());
      await nextAnimationFrame();

      const selectedContext = getByLabelText(container, 'Selected context');
      expect(selectedContext.textContent).toContain('Hero Builder');
      expect(selectedContext.textContent).toContain('landing.html');
      expect(selectedContext.textContent).not.toContain('Stale Skill');
      expect(selectedContext.textContent).not.toContain('Stale.tsx');
      expect(onDeleteQueuedTurn).toHaveBeenCalledWith('queued-1');
    } finally {
      cleanup(root, container);
    }
  });

  it('submits inline question-form answers with the active conversation provider', async () => {
    const onSend = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a dashboard',
      conversations: [
        {
          id: 'conversation-1',
          title: 'Build a dashboard',
          provider: 'claude-code',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'succeeded',
          events: [],
          blocks: [
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
                    options: [{ value: 'dashboard', label: '仪表盘' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      await act(async () => buttonByName(container, '仪表盘').click());
      await act(async () => buttonByName(container, 'Submit').click());

      expect(onSend).toHaveBeenCalledWith({
        draft: '[form answers — discovery]\n- 任务类型是什么？: 仪表盘 [value: dashboard]',
        files: [],
        agentId: 'claude-code',
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('hides submitted question-form option values in the user bubble while keeping the form locked from the original content', async () => {
    const onSend = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a dashboard',
      conversations: [
        {
          id: 'conversation-1',
          title: 'Build a dashboard',
          provider: 'claude-code',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'succeeded',
          events: [],
          blocks: [
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
                    options: [{ value: 'dashboard', label: '仪表盘' }],
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'user-1',
          role: 'user',
          content: '[form answers — discovery]\n- 任务类型是什么？: 仪表盘 [value: dashboard]',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const userText = container.querySelector('.msg.user .user-text');
      expect(userText?.textContent).toBe('Your choices are recorded\n- 任务类型是什么？: 仪表盘');
      expect(buttonByName(container, '仪表盘').disabled).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('renders user image attachments in the message flow', async () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Use this reference image',
          attachments: [
            {
              path: 'assets/reference.png',
              name: 'reference.png',
              kind: 'image',
              size: 128,
              mimeType: 'image/png',
            },
          ],
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="demo-project"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const previewButton = getByLabelText(container, 'View attached image reference.png');
      const thumbnail = previewButton.querySelector('img');
      expect(thumbnail).toBeInstanceOf(HTMLImageElement);
      expect((thumbnail as HTMLImageElement).src).toContain('/api/projects/demo-project/files/reference.png');
      expect(container.textContent).toContain('Use this reference image');

      await act(async () => previewButton.click());

      const previewImage = getByLabelText(document.body, 'Image preview reference.png');
      expect(previewImage).toBeInstanceOf(HTMLImageElement);
      expect((previewImage as HTMLImageElement).src).toContain('/api/projects/demo-project/files/reference.png');
      expect(document.body.textContent).toContain('Open original');
      expect(transformWrapperProps.current).toMatchObject({
        centerOnInit: true,
        centerZoomedOut: true,
        initialScale: 0.95,
        minScale: 0.5,
        maxScale: 6,
        smooth: true,
        wheel: { step: 0.004 },
        zoomAnimation: { animationTime: 160, animationType: 'easeOut' },
        doubleClick: { mode: 'toggle', step: 0.25, animationTime: 160, animationType: 'easeOut' },
        panning: { velocityDisabled: true },
      });
      await act(async () => fireEvent.load(previewImage));
      expect(transformControls.centerView).toHaveBeenCalledWith(0.95, 120, 'easeOut');

      const zoomInButton = getByLabelText(document.body, 'Zoom in image');
      const zoomOutButton = getByLabelText(document.body, 'Zoom out image');
      const resetZoomButton = getByLabelText(document.body, 'Reset image zoom');
      await act(async () => zoomInButton.click());
      await act(async () => zoomOutButton.click());
      await act(async () => resetZoomButton.click());
      expect(transformControls.zoomIn).toHaveBeenCalledWith(0.25, 160, 'easeOut');
      expect(transformControls.zoomOut).toHaveBeenCalledWith(0.25, 160, 'easeOut');
      expect(transformControls.centerView).toHaveBeenCalledWith(0.95, 160, 'easeOut');
      expect(transformControls.resetTransform).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it('marks user messages with attachments for full-row attachment layout', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Use this reference image',
          attachments: [
            {
              path: 'assets/reference.png',
              name: 'reference.png',
              kind: 'image',
              size: 128,
              mimeType: 'image/png',
            },
          ],
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="demo-project"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const userMessage = container.querySelector('.msg.user');
      expect(userMessage?.classList.contains('msg--has-attachments')).toBe(true);
    } finally {
      cleanup(root, container);
    }
  });

  it('renders default file review attachments without showing the fallback prompt', () => {
    const attachments: ChatAttachment[] = [
      {
        path: 'src/Hero.tsx',
        name: 'Hero.tsx',
        kind: 'file',
        mimeType: 'text/tsx',
      },
    ];
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Review the attached file.',
          attachments,
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="demo-project"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.querySelector('.msg.user[data-message-id="user-1"]')).toBeTruthy();
      expect(container.querySelector('.msg.user .user-text')).toBeNull();
      const fileLink = container.querySelector('.msg.user .user-attachment-file');
      expect(fileLink).toBeInstanceOf(HTMLAnchorElement);
      expect(fileLink?.textContent).toBe('Hero.tsx');
      expect((fileLink as HTMLAnchorElement).href).toContain('/api/projects/demo-project/files/Hero.tsx');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders default file review attachments as file attachment links', () => {
    const attachments: ChatAttachment[] = [
      {
        path: 'assets/report.md',
        name: 'report.md',
        kind: 'file',
        mimeType: 'text/markdown',
      },
    ];
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Review report',
      conversations: [{ id: 'conversation-1', title: 'Review report', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Review the attached file.',
          attachments,
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="demo-project"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.querySelector('.msg.user .user-text')).toBeNull();
      const fileLink = container.querySelector<HTMLAnchorElement>('.msg.user .user-attachment-file');
      expect(fileLink).toBeInstanceOf(HTMLAnchorElement);
      expect(fileLink?.textContent).toBe('report.md');
      expect(fileLink?.href).toContain('/api/projects/demo-project/files/report.md');
    } finally {
      cleanup(root, container);
    }
  });

  it('does not move the default file review prompt into the composer when editing a queued file turn', async () => {
    const onDeleteQueuedTurn = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: 'run-1',
      phase: 'streaming',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Review report',
      conversations: [{ id: 'conversation-1', title: 'Review report', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          runStatus: 'running',
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        queuedTurns={[
          {
            id: 'queued-1',
            content: '',
            prompt: 'Review the attached file.',
            conversationId: 'conversation-1',
            attachments: [
              {
                path: 'assets/report.md',
                name: 'report.md',
                kind: 'file',
                mimeType: 'text/markdown',
              },
            ],
            commentAttachments: [],
          },
        ]}
        onDeleteQueuedTurn={onDeleteQueuedTurn}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      await act(async () => getByLabelText(container, 'Edit queued turn').click());
      await nextAnimationFrame();

      expect(onDeleteQueuedTurn).toHaveBeenCalledWith('queued-1');
      expect(getByLabelText(container, 'Message').textContent).toBe('');
      expect(getByLabelText(container, 'Staged input attachments').textContent).toContain('report.md');
    } finally {
      cleanup(root, container);
    }
  });

  it('opens default file review attachments through the workspace callback', async () => {
    const onOpenAttachment = vi.fn();
    const attachments: ChatAttachment[] = [
      {
        path: 'assets/report.md',
        name: 'report.md',
        kind: 'file',
        mimeType: 'text/markdown',
      },
    ];
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Review report',
      conversations: [{ id: 'conversation-1', title: 'Review report', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Review the attached file.',
          attachments,
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="demo-project"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onOpenAttachment={onOpenAttachment}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const fileButton = container.querySelector<HTMLButtonElement>('.user-attachment-file');
      expect(fileButton).toBeInstanceOf(HTMLButtonElement);

      await act(async () => fileButton?.click());

      expect(onOpenAttachment).toHaveBeenCalledWith(attachments[0]);
    } finally {
      cleanup(root, container);
    }
  });

  it('renders preview comment attachment chips on user messages', () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Apply this preview comment',
          commentAttachments: [commentAttachment()],
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const chips = getByLabelText(container, 'Attached preview comments');
      expect(chips.textContent).toContain('Tighten spacing');
      expect(chips.textContent).not.toContain('element');
      expect(chips.textContent).not.toContain('index.html');
      expect(chips.querySelector('.preview-comment-attachment-kind')).toBeNull();
      expect(chips.querySelector('.preview-comment-attachment-detail__body')).toBeNull();
      expect(chips.querySelector('.preview-comment-attachment-detail')).toBeInstanceOf(HTMLElement);
    } finally {
      cleanup(root, container);
    }
  });

  it('shows sent preview comment user turns as preview-only message content', async () => {
    const longComment = 'Please update this marked area with the full submitted comment text so the conversation detail does not hide the message.';
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Apply the attached preview comments.',
          attachments: [],
          commentAttachments: [
            {
              ...visualCommentAttachment(),
              comment: longComment,
              label: 'Hero title with a long annotation label that should remain inspectable',
              filePath: 'src/pages/landing/index.html',
            },
          ],
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="project-1"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).not.toContain('Apply the attached preview comments.');
      expect(container.querySelector('.user-text')).toBeNull();
      expect(container.textContent).toContain(longComment);
      const image = container.querySelector<HTMLImageElement>('.preview-comment-attachment-image');
      expect(image).toBeInstanceOf(HTMLImageElement);
      expect(image?.alt).toBe('visual-comment.svg');
      expect(image?.getAttribute('src')).toBe('/api/projects/project-1/files/visual-comment.svg');
      expect(container.querySelector('.user-attachment-image-button')).toBeNull();
      const detail = container.querySelector<HTMLElement>('.preview-comment-attachment-detail');
      expect(detail).toBeInstanceOf(HTMLElement);
      expect(detail).not.toBeInstanceOf(HTMLDetailsElement);
      expect(detail?.textContent).toContain(longComment);
      expect(detail?.textContent).not.toContain('visual');
      expect(detail?.textContent).not.toContain('Hero title with a long annotation label');
      expect(detail?.textContent).not.toContain('src/pages/landing/index.html');
      expect(container.querySelector('.preview-comment-attachment-kind')).toBeNull();
      expect(container.querySelector('.preview-comment-attachment-detail__body')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('opens the image preview from sent preview comment screenshots in user messages', async () => {
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Apply the attached preview comments.',
          attachments: [],
          commentAttachments: [visualCommentAttachment()],
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="project-1"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const previewButton = getByLabelText(container, 'View attached image visual-comment.svg');
      const thumbnail = previewButton.querySelector('img');
      expect(thumbnail).toBeInstanceOf(HTMLImageElement);
      expect((thumbnail as HTMLImageElement).src).toContain('/api/projects/project-1/files/visual-comment.svg');

      await act(async () => previewButton.click());

      const previewImage = getByLabelText(document.body, 'Image preview visual-comment.svg');
      expect(previewImage).toBeInstanceOf(HTMLImageElement);
      expect((previewImage as HTMLImageElement).src).toContain('/api/projects/project-1/files/visual-comment.svg');
    } finally {
      cleanup(root, container);
    }
  });

  it('renders each preview comment screenshot next to its comment in the user message', () => {
    const firstComment = visualCommentAttachment();
    const secondComment = {
      ...visualCommentAttachment(),
      id: 'comment-visual-2',
      order: 2,
      comment: 'Make the CTA easier to scan.',
      screenshotPath: 'assets/visual-comment-2.svg',
    };
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Tighten spacing\nMake the CTA easier to scan.',
          attachments: [
            {
              path: 'assets/visual-comment.svg',
              name: 'visual-comment.svg',
              kind: 'image',
              mimeType: 'image/svg+xml',
            },
            {
              path: 'assets/visual-comment-2.svg',
              name: 'visual-comment-2.svg',
              kind: 'image',
              mimeType: 'image/svg+xml',
            },
          ],
          commentAttachments: [firstComment, secondComment],
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        projectId="project-1"
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const commentList = getByLabelText(container, 'Attached preview comments');
      const rows = commentList.querySelectorAll('.preview-comment-attachment-detail');
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toContain('Tighten spacing');
      expect(rows[1]?.textContent).toContain('Make the CTA easier to scan.');
      expect(rows[0]?.textContent).not.toContain('1.');
      expect(rows[1]?.textContent).not.toContain('2.');
      expect(rows[0]?.textContent).not.toContain('第 1 条');
      expect(rows[1]?.textContent).not.toContain('第 2 条');

      const firstImage = rows[0]?.querySelector<HTMLImageElement>('.preview-comment-attachment-image');
      const secondImage = rows[1]?.querySelector<HTMLImageElement>('.preview-comment-attachment-image');
      expect(firstImage).toBeInstanceOf(HTMLImageElement);
      expect(firstImage?.getAttribute('src')).toBe('/api/projects/project-1/files/visual-comment.svg');
      expect(secondImage).toBeInstanceOf(HTMLImageElement);
      expect(secondImage?.getAttribute('src')).toBe('/api/projects/project-1/files/visual-comment-2.svg');
      expect(container.querySelector('.user-attachment-image-button')).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it('passes staged preview comment attachments through the composer send payload', async () => {
    const onSend = vi.fn();
    const commentAttachments = [commentAttachment()];
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
      messages: [],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        commentAttachments={commentAttachments}
        onSend={onSend}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      const sendButton = getByLabelText(container, 'Send message');
      expect(sendButton.className).toContain('project-primary-button');

      await act(async () => sendButton.click());
      expect(onSend).toHaveBeenCalledWith({ draft: '', files: [], agentId: 'codex', commentAttachments });
    } finally {
      cleanup(root, container);
    }
  });

  it('formats older message timestamps in hours instead of large minute counts', () => {
    const now = new Date(2026, 5, 3, 12, 0, 0).getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'idle',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a tank battle',
      conversations: [{ id: 'conversation-1', title: 'Build a tank battle', createdAt: now, updatedAt: now }],
      pinnedTodoInput: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Older message',
          createdAt: now - 1003 * 60_000,
          events: [],
          blocks: [],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('16 hours ago');
      expect(container.textContent).not.toContain('1003 minutes ago');
    } finally {
      cleanup(root, container);
      vi.useRealTimers();
    }
  });

  it('opens generated files from the assistant timeline', async () => {
    const onOpenGeneratedFile = vi.fn();
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'succeeded',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build an alarm app',
      conversations: [{ id: 'conversation-1', title: 'Build an alarm app', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
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
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onOpenGeneratedFile={onOpenGeneratedFile}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      await act(async () => buttonByName(container, 'calm-blue-alarm-iphone.html').click());

      expect(onOpenGeneratedFile).toHaveBeenCalledWith({
        name: 'calm-blue-alarm-iphone.html',
        artifactType: 'text/html',
        title: '安静蓝色闹钟 iPhone 界面',
      });
    } finally {
      cleanup(root, container);
    }
  });

  it('shows only generated file and file operation entries that exist in design files', () => {
    const designFiles: WorkspaceFile[] = [
      {
        name: 'dashboard-login.html',
        path: 'dashboard-login.html',
        kind: 'html',
        mime: 'text/html',
        contents: '<!doctype html><html><body>Dashboard</body></html>',
      },
    ];
    const snapshot: ChatTimelineSnapshot = {
      activeRunId: null,
      phase: 'succeeded',
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'Build a dashboard login',
      conversations: [{ id: 'conversation-1', title: 'Build a dashboard login', createdAt: 1, updatedAt: 1 }],
      pinnedTodoInput: null,
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
                  name: 'dashboard-login.html',
                  artifactType: 'text/html',
                  title: 'Dashboard login page',
                },
                {
                  name: '/workspace/scratch.html',
                  artifactType: 'text/html',
                },
              ],
            },
            {
              kind: 'file-ops',
              ops: [
                {
                  path: 'dashboard-login.html',
                  fullPath: '/project/dashboard-login.html',
                  ops: ['write'],
                  opCounts: { read: 0, write: 1, edit: 0, delete: 0 },
                  total: 1,
                  status: 'done',
                },
                {
                  path: 'scratch.html',
                  fullPath: '/workspace/scratch.html',
                  ops: ['write'],
                  opCounts: { read: 0, write: 1, edit: 0, delete: 0 },
                  total: 1,
                  status: 'done',
                },
              ],
            },
          ],
        },
      ],
    };

    const { container, root } = renderComponent(
      <ChatPane
        snapshot={snapshot}
        designFiles={designFiles}
        contextSnapshot={{ selectedSkills: [], selectedDesignFiles: [] }}
        contextSearch={async () => ({ items: [] })}
        contextSelect={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onAnswerToolQuestion={vi.fn()}
        onCreateConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onRenameConversation={vi.fn()}
      />,
    );

    try {
      expect(container.textContent).toContain('Generated files');
      expect(container.textContent).toContain('File operations');
      expect(container.textContent).toContain('dashboard-login.html');
      expect(container.textContent).not.toContain('/workspace/scratch.html');
      expect(container.textContent).not.toContain('scratch.html');
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

function visualCommentAttachment(): CanvasVisualMarkCommentAttachment {
  return {
    id: 'comment-visual-1',
    order: 1,
    filePath: 'index.html',
    targetId: 'visual-mark-1',
    selector: 'visual-mark',
    label: 'Hero title',
    comment: 'Tighten spacing',
    currentText: 'Heading',
    pagePosition: { x: 1, y: 2, width: 3, height: 4 },
    htmlHint: '<h1>Heading</h1>',
    selectionKind: 'visual',
    source: 'visual-mark',
    markKind: 'click',
    screenshotPath: 'assets/visual-comment.svg',
  };
}

function projectFile(overrides: Pick<ProjectFile, 'id' | 'name' | 'path'>): ProjectFile {
  return {
    ...overrides,
    type: 'file',
    size: 0,
    mtime: 0,
    kind: 'code',
    mime: 'text/html',
  };
}
