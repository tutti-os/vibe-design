import { describe, expect, it, vi } from 'vitest';
import type { CanvasCommentAttachment } from '../../../types';
import { FetchChatTimelineApi } from '../chat-timeline-api';
import { ChatTimelineService } from './chat-timeline-service';

describe('ChatTimelineService', () => {
  it('tracks multiple conversations, auto-titles the first turn, and preserves per-conversation timelines', () => {
    const timeline = new ChatTimelineService();

    const firstConversation = timeline.getSnapshot().activeConversationId;
    expect(firstConversation).toBeTruthy();
    expect(timeline.getSnapshot().activeConversationTitle).toBe('New conversation');

    timeline.appendUserMessage({ content: 'Build a tank battle for kids', attachments: [] });
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationTitle: 'Build a tank battle for kids',
    });

    const secondConversation = timeline.createConversation();
    expect(secondConversation).toMatchObject({
      title: 'New conversation',
    });
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: secondConversation.id,
      activeConversationTitle: 'New conversation',
      messages: [],
    });

    timeline.appendUserMessage({ content: 'Create a landing page', attachments: [] });
    timeline.selectConversation(firstConversation!);
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: firstConversation,
      activeConversationTitle: 'Build a tank battle for kids',
    });
    expect(timeline.getSnapshot().messages).toHaveLength(1);

    timeline.renameConversation(firstConversation!, '制作一个坦克大战');
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationTitle: '制作一个坦克大战',
    });
    expect(timeline.getSnapshot().conversations[0]).toMatchObject({
      id: firstConversation,
      title: '制作一个坦克大战',
    });
  });

  it('persists the auto-title from the first user message for a default server conversation', () => {
    const api = {
      createConversation: vi.fn(),
      renameConversation: vi.fn(async () => ({
        id: 'conversation-1',
        title: '帮我写一个登陆页',
        provider: null,
        createdAt: 1,
        updatedAt: 2,
      })),
      deleteConversation: vi.fn(async () => undefined),
      listMessages: vi.fn(),
    };
    const timeline = new ChatTimelineService({
      api,
      initialSnapshot: {
        conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'New conversation',
        messages: [],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });

    timeline.appendUserMessage({ content: '帮我写一个登陆页', attachments: [] });

    expect(timeline.getSnapshot().activeConversationTitle).toBe('帮我写一个登陆页');
    expect(api.renameConversation).toHaveBeenCalledWith('conversation-1', '帮我写一个登陆页');
  });

  it('locks a conversation provider once while allowing the remembered model to change', () => {
    const timeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'New conversation',
        messages: [],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });

    timeline.setConversationProvider({
      conversationId: 'conversation-1',
      provider: 'codex',
      model: 'codex:gpt-5.4',
    });
    timeline.setConversationProvider({
      conversationId: 'conversation-1',
      provider: 'claude',
      model: 'claude:opus',
    });
    timeline.setConversationProvider({
      conversationId: 'conversation-1',
      provider: 'codex',
      model: 'codex:gpt-5.5',
    });

    expect(timeline.getSnapshot().conversations[0]).toMatchObject({
      provider: 'codex',
      model: 'codex:gpt-5.5',
    });
  });

  it('reuses the current empty conversation instead of creating duplicate blank conversations', () => {
    const api = {
      createConversation: vi.fn(async (input: { id: string; title?: string }) => ({
        id: input.id,
        title: input.title ?? 'New conversation',
        provider: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      renameConversation: vi.fn(),
      deleteConversation: vi.fn(async () => undefined),
      listMessages: vi.fn(),
    };
    const timeline = new ChatTimelineService({ api });
    const listener = vi.fn();
    const firstConversationId = timeline.getSnapshot().activeConversationId;
    timeline.subscribe(listener);

    const reusedConversation = timeline.createConversation();

    expect(reusedConversation.id).toBe(firstConversationId);
    expect(timeline.getSnapshot().activeConversationId).toBe(firstConversationId);
    expect(timeline.getSnapshot().conversations).toHaveLength(1);
    expect(api.createConversation).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('creates a fresh conversation after a failed first turn is rolled back', () => {
    const api = {
      createConversation: vi.fn(async (input: { id: string; title?: string }) => ({
        id: input.id,
        title: input.title ?? 'New conversation',
        provider: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      renameConversation: vi.fn(),
      deleteConversation: vi.fn(async () => undefined),
      listMessages: vi.fn(),
    };
    const timeline = new ChatTimelineService({ api });
    const firstConversationId = timeline.getSnapshot().activeConversationId;
    const rolledBackMessage = timeline.appendUserMessage({ content: 'Use Codex', attachments: [] });

    timeline.removeMessage(rolledBackMessage.id);
    const nextConversation = timeline.createConversation();

    expect(nextConversation.id).not.toBe(firstConversationId);
    expect(timeline.getSnapshot().activeConversationId).toBe(nextConversation.id);
    expect(timeline.getSnapshot().conversations).toHaveLength(2);
    expect(api.createConversation).toHaveBeenCalledTimes(1);
  });

  it('generates distinct local conversation ids across independent project timelines', () => {
    const firstTimeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-project-a', title: 'Project A', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-project-a',
        activeConversationTitle: 'Project A',
        messages: [{ id: 'message-a', role: 'user', content: 'Existing A', attachments: [], events: [], blocks: [] }],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });
    const secondTimeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-project-b', title: 'Project B', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-project-b',
        activeConversationTitle: 'Project B',
        messages: [{ id: 'message-b', role: 'user', content: 'Existing B', attachments: [], events: [], blocks: [] }],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });

    const firstConversation = firstTimeline.createConversation();
    const secondConversation = secondTimeline.createConversation();

    expect(firstConversation.id).not.toBe(secondConversation.id);
    expect(firstConversation.id).toMatch(/^conversation-[A-Za-z0-9._-]+$/);
    expect(secondConversation.id).toMatch(/^conversation-[A-Za-z0-9._-]+$/);
  });

  it('appends user and assistant messages, then applies stream events', () => {
    const timeline = new ChatTimelineService();

    const userMessage = timeline.appendUserMessage({ content: 'Build it', attachments: [] });
    const assistantMessage = timeline.startAssistantRun({ runId: 'run-1' });
    timeline.applyAgentEvent('run-1', { type: 'text_delta', delta: 'Working' });
    timeline.finishRun('run-1', { status: 'succeeded' });

    const snapshot = timeline.getSnapshot();
    expect(userMessage).toMatchObject({
      id: 'message-1',
      role: 'user',
      content: 'Build it',
      attachments: [],
    });
    expect(assistantMessage).toMatchObject({
      id: 'message-2',
      role: 'assistant',
      content: '',
      runId: 'run-1',
      runStatus: 'running',
    });
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[0]).toMatchObject({
      id: 'message-1',
      role: 'user',
      content: 'Build it',
      attachments: [],
    });
    expect(snapshot.messages[1]).toMatchObject({
      id: 'message-2',
      role: 'assistant',
      content: 'Working',
      runId: 'run-1',
      runStatus: 'succeeded',
    });
    expect(snapshot.messages[1]?.endedAt).toEqual(expect.any(Number));
    expect(snapshot.messages[1]?.events).toEqual([
      { type: 'text_delta', delta: 'Working' },
      { type: 'end', code: 0, signal: null, status: 'succeeded' },
    ]);
    expect(snapshot.activeRunId).toBeNull();
    expect(snapshot.phase).toBe('succeeded');
  });

  it('stores and clones selected skill context on user messages', () => {
    const timeline = new ChatTimelineService();
    const selectedSkills = [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }];

    const appended = timeline.appendUserMessage({
      content: 'Build it',
      attachments: [],
      context: { selectedSkills },
    });
    selectedSkills[0]!.name = 'Mutated Skill';
    const appendedContext = appended.context;
    expect(appendedContext?.selectedSkills).toHaveLength(1);
    appendedContext!.selectedSkills![0]!.name = 'Mutated Return';

    const snapshot = timeline.getSnapshot();
    expect(snapshot.messages[0]?.context).toEqual({
      selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
    });

    const snapshotContext = snapshot.messages[0]!.context;
    expect(snapshotContext?.selectedSkills).toHaveLength(1);
    snapshotContext!.selectedSkills![0]!.name = 'Mutated Snapshot';
    expect(timeline.getSnapshot().messages[0]?.context?.selectedSkills?.[0]?.name).toBe('Hero Builder');
  });

  it('settles unresolved written files as generated files when finishRun completes without an end event', () => {
    const timeline = new ChatTimelineService();

    timeline.startAssistantRun({ runId: 'run-1' });
    timeline.applyAgentEvent('run-1', {
      type: 'tool_use',
      id: 'write-1',
      name: 'Write',
      input: { path: 'README.md' },
    });
    timeline.finishRun('run-1', { status: 'succeeded' });

    const blocks = timeline.getSnapshot().messages[0]?.blocks ?? [];
    expect(blocks.find((block) => block.kind === 'generated-files')).toEqual({
      kind: 'generated-files',
      files: [{ name: 'README.md' }],
    });
    expect(blocks.find((block) => block.kind === 'file-ops')).toBeUndefined();
  });

  it('starts assistant runs in the specified conversation instead of the active conversation', () => {
    const timeline = new ChatTimelineService();
    const firstConversationId = timeline.getSnapshot().activeConversationId!;
    timeline.appendUserMessage({ content: 'First conversation turn', attachments: [] });
    const secondConversation = timeline.createConversation();

    const assistantMessage = timeline.startAssistantRun({
      runId: 'run-1',
      conversationId: firstConversationId,
    });

    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      runId: 'run-1',
      runStatus: 'running',
    });
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: secondConversation.id,
      activeRunId: null,
      phase: 'idle',
      messages: [],
    });

    timeline.selectConversation(firstConversationId);
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: firstConversationId,
      activeRunId: 'run-1',
      phase: 'streaming',
    });
    expect(timeline.getSnapshot().messages[1]).toMatchObject({
      role: 'assistant',
      runId: 'run-1',
      runStatus: 'running',
    });
  });

  it('updates blocks and pinned todos from assistant events', () => {
    const timeline = new ChatTimelineService();

    timeline.startAssistantRun({ runId: 'run-1' });
    timeline.applyAgentEvent('run-1', {
      type: 'tool_use',
      id: 'todo-1',
      name: 'TodoWrite',
      input: { todos: [{ content: 'Ship timeline', status: 'in_progress' }] },
    });

    const snapshot = timeline.getSnapshot();
    expect(snapshot.pinnedTodoInput).toEqual({
      todos: [{ content: 'Ship timeline', status: 'in_progress' }],
    });
    expect(snapshot.messages[0]?.blocks).toEqual([
      {
        kind: 'todo-write',
        toolUseId: 'todo-1',
        input: { todos: [{ content: 'Ship timeline', status: 'in_progress' }] },
      },
    ]);
  });

  it('rebuilds initial assistant blocks from persisted events', () => {
    const timeline = new ChatTimelineService({
      initialSnapshot: {
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'question-form验证',
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
        conversations: [{ id: 'conversation-1', title: 'question-form验证', createdAt: 1, updatedAt: 1 }],
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '<question-form id="discovery" title="快速确认"><question type="select" id="output_type" title="任务类型是什么？" options="web_game:可玩的网页游戏" /></question-form>',
            events: [
              {
                type: 'text_delta',
                delta:
                  '<question-form id="discovery" title="快速确认"><question type="select" id="output_type" title="任务类型是什么？" options="web_game:可玩的网页游戏" /></question-form>',
              },
            ],
            blocks: [
              {
                kind: 'text',
                content:
                  '<question-form id="discovery" title="快速确认"><question type="select" id="output_type" title="任务类型是什么？" options="web_game:可玩的网页游戏" /></question-form>',
                markdown: true,
              },
            ],
          },
        ],
      },
    });

    expect(timeline.getSnapshot().messages[0]?.blocks).toEqual([
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
    ]);
  });

  it('finalizes the active assistant run when an end event arrives', () => {
    const timeline = new ChatTimelineService();

    timeline.startAssistantRun({ runId: 'run-1' });
    timeline.applyAgentEvent('run-1', {
      type: 'tool_use',
      id: 'todo-1',
      name: 'TodoWrite',
      input: { todos: [{ content: 'Ship timeline', status: 'in_progress' }] },
    });
    timeline.applyAgentEvent('run-1', {
      type: 'end',
      code: 0,
      signal: null,
      status: 'succeeded',
    });

    const snapshot = timeline.getSnapshot();
    expect(snapshot.activeRunId).toBeNull();
    expect(snapshot.phase).toBe('succeeded');
    expect(snapshot.messages[0]).toMatchObject({
      role: 'assistant',
      runId: 'run-1',
      runStatus: 'succeeded',
    });
    expect(snapshot.messages[0]?.endedAt).toEqual(expect.any(Number));
    expect(snapshot.pinnedTodoInput).toEqual({
      todos: [{ content: 'Ship timeline', status: 'stopped' }],
    });
  });

  it('does not let unknown or stale finishRun calls overwrite the active phase', () => {
    const timeline = new ChatTimelineService();

    timeline.startAssistantRun({ runId: 'run-1' });
    timeline.startAssistantRun({ runId: 'run-2' });
    timeline.finishRun('missing-run', { status: 'failed' });
    expect(timeline.getSnapshot()).toMatchObject({
      activeRunId: 'run-2',
      phase: 'streaming',
    });

    timeline.finishRun('run-1', { status: 'succeeded' });
    expect(timeline.getSnapshot()).toMatchObject({
      activeRunId: 'run-2',
      phase: 'streaming',
    });
  });

  it('does not let stale assistant events overwrite the active phase', () => {
    const timeline = new ChatTimelineService();

    timeline.startAssistantRun({ runId: 'run-1' });
    timeline.startAssistantRun({ runId: 'run-2' });
    timeline.applyAgentEvent('run-1', { type: 'thinking_delta', delta: 'late thought' });

    const snapshot = timeline.getSnapshot();
    expect(snapshot.activeRunId).toBe('run-2');
    expect(snapshot.phase).toBe('streaming');
    expect(snapshot.messages[0]?.events).toEqual([
      { type: 'thinking_delta', delta: 'late thought' },
    ]);
  });

  it('appends user messages to the requested inactive conversation', () => {
    const timeline = new ChatTimelineService();
    const firstConversationId = timeline.getSnapshot().activeConversationId!;
    timeline.appendUserMessage({ content: 'First conversation turn', attachments: [] });
    const secondConversation = timeline.createConversation();

    timeline.appendUserMessage({
      content: 'Queued comment turn',
      attachments: [],
      conversationId: firstConversationId,
    });

    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: secondConversation.id,
      messages: [],
    });

    timeline.selectConversation(firstConversationId);
    expect(timeline.getSnapshot().messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'First conversation turn',
      }),
      expect.objectContaining({
        role: 'user',
        content: 'Queued comment turn',
      }),
    ]);
  });

  it('deletes conversations, selects the next available conversation, and calls the API', () => {
    const api = {
      createConversation: vi.fn(async (input: { id: string; title?: string }) => ({
        id: input.id,
        title: input.title ?? 'New conversation',
        provider: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      renameConversation: vi.fn(),
      deleteConversation: vi.fn(async () => undefined),
      listMessages: vi.fn(),
    };
    const timeline = new ChatTimelineService({ api });
    const firstConversationId = timeline.getSnapshot().activeConversationId!;
    timeline.appendUserMessage({ content: 'First conversation', attachments: [] });
    const secondConversation = timeline.createConversation('Second conversation');
    timeline.appendUserMessage({ content: 'Second message', attachments: [] });
    const listener = vi.fn();
    timeline.subscribe(listener);

    timeline.deleteConversation(secondConversation.id);

    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: firstConversationId,
      activeConversationTitle: 'First conversation',
    });
    expect(timeline.getSnapshot().conversations.map((conversation) => conversation.id)).toEqual([firstConversationId]);
    expect(timeline.getSnapshot().messages).toEqual([
      expect.objectContaining({ content: 'First conversation' }),
    ]);
    expect(api.deleteConversation).toHaveBeenCalledWith(secondConversation.id);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the last conversation and skips the API when deleting the only conversation', () => {
    const api = {
      createConversation: vi.fn(async (input: { id: string; title?: string }) => ({
        id: input.id,
        title: input.title ?? 'New conversation',
        provider: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      renameConversation: vi.fn(),
      deleteConversation: vi.fn(async () => undefined),
      listMessages: vi.fn(),
    };
    const timeline = new ChatTimelineService({ api });
    const conversationId = timeline.getSnapshot().activeConversationId!;
    const listener = vi.fn();
    timeline.subscribe(listener);

    timeline.deleteConversation(conversationId);

    const snapshot = timeline.getSnapshot();
    expect(snapshot.activeConversationId).toBe(conversationId);
    expect(snapshot.activeConversationTitle).toBe('New conversation');
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.messages).toEqual([]);
    expect(api.deleteConversation).not.toHaveBeenCalled();
    expect(api.createConversation).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('preserves comment attachments when fetching persisted conversation messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Revise this area',
              attachments: [],
              commentAttachments: [
                {
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
                },
              ],
              events: [],
              context: {
                selectedSkills: [{ id: 'skill-1', name: 'Hero Builder' }],
              },
            },
            {
              id: 'user-2',
              role: 'user',
              content: 'No comments here',
              events: [],
            },
          ],
        }),
      })),
    );

    try {
      const messages = await new FetchChatTimelineApi('project-1').listMessages('conversation-1');

      expect(messages[0]?.commentAttachments).toEqual([
        {
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
        },
      ]);
      expect(messages[0]?.context).toEqual({
        selectedSkills: [{ id: 'skill-1', name: 'Hero Builder' }],
      });
      expect(messages[1]?.commentAttachments).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('deletes persisted conversations through the fetch API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);

    try {
      await new FetchChatTimelineApi('project-1').deleteConversation('conversation-1');

      expect(fetch).toHaveBeenCalledWith(
        '/api/projects/project-1/conversations/conversation-1',
        { method: 'DELETE' },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clones comment attachments when returning snapshots', () => {
    const timeline = new ChatTimelineService({
      initialSnapshot: {
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'With comments',
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
        conversations: [{ id: 'conversation-1', title: 'With comments', createdAt: 1, updatedAt: 1 }],
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Revise this area',
            attachments: [],
            commentAttachments: [
              {
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
              },
            ],
            events: [],
            blocks: [],
          },
        ],
      },
    });

    const snapshot = timeline.getSnapshot();
    snapshot.messages[0]!.commentAttachments![0]!.pagePosition.x = 99;

    expect(timeline.getSnapshot().messages[0]?.commentAttachments?.[0]?.pagePosition.x).toBe(1);
  });

  it('stores and clones comment attachments when appending user messages', () => {
    const timeline = new ChatTimelineService();
    const commentAttachments = [commentAttachment()];

    const appended = timeline.appendUserMessage({
      content: 'Revise this area',
      attachments: [],
      commentAttachments,
    });
    commentAttachments[0]!.pagePosition.x = 99;
    appended.commentAttachments![0]!.pagePosition.y = 88;

    const snapshot = timeline.getSnapshot();
    expect(snapshot.messages[0]?.commentAttachments?.[0]).toMatchObject({
      id: 'comment-1',
      pagePosition: { x: 1, y: 2, width: 3, height: 4 },
    });

    snapshot.messages[0]!.commentAttachments![0]!.pagePosition.width = 77;
    expect(timeline.getSnapshot().messages[0]?.commentAttachments?.[0]?.pagePosition.width).toBe(3);
  });

  it('removes a local message by id', () => {
    const timeline = new ChatTimelineService();
    const listener = vi.fn();
    timeline.subscribe(listener);

    const first = timeline.appendUserMessage({ content: 'First local turn', attachments: [] });
    timeline.appendUserMessage({ content: 'Second local turn', attachments: [] });

    timeline.removeMessage(first.id);

    const snapshot = timeline.getSnapshot();
    expect(snapshot.messages.map((message) => message.content)).toEqual(['Second local turn']);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('notifies subscribers only after timeline state changes', () => {
    const timeline = new ChatTimelineService();
    const listener = vi.fn();

    const unsubscribe = timeline.subscribe(listener);

    timeline.applyAgentEvent('missing-run', { type: 'text_delta', delta: 'ignored' });
    expect(listener).not.toHaveBeenCalled();

    timeline.appendUserMessage({ content: 'Build it', attachments: [] });
    timeline.startAssistantRun({ runId: 'run-1' });
    timeline.applyAgentEvent('run-1', { type: 'text_delta', delta: 'Done' });
    timeline.finishRun('run-1', { status: 'succeeded' });

    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    timeline.appendUserMessage({ content: 'No listener', attachments: [] });
    expect(listener).toHaveBeenCalledTimes(4);
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
