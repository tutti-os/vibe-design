import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, CanvasCommentAttachment, ChatAttachment, ProjectFile, RunContextSelection } from '../../../types';
import type { IChatTimelineService } from '../../chat-timeline/chat-timeline-service.interface';
import { ChatTimelineService } from '../../chat-timeline/internal/chat-timeline-service';
import type { IContextPickerService } from '../../context-picker/context-picker-service.interface';
import type { IDesignFileService } from '../../design-files/design-file-service.interface';
import type { IRunService } from '../../run/run-service.interface';
import type { CreateRunInput, RunStreamHandlers } from '../../run/run-types';
import { ChatSessionService, createBrowserQueuedTurnStore } from './chat-session-service';

describe('ChatSessionService', () => {
  it('expands /search before createRun and starts streaming', async () => {
    const { service, run, context } = createService();

    await service.sendTurn({ draft: '/search EV trends', files: [] });

    expect(firstCreateRunInput(run).prompt).toContain('Search for: EV trends');
    expect(firstCreateRunInput(run).context).toEqual({ skillIds: ['skill-1'] });
    expect(context.buildRunContext).toHaveBeenCalledWith();
    expect(run.streamRun).toHaveBeenCalledWith('run-1', expect.any(Object));
  });

  it('resumes streaming when initialized with an active run', () => {
    const { run } = createService({ activeRunId: 'run-restored' });

    expect(run.streamRun).toHaveBeenCalledWith('run-restored', expect.any(Object), null);
  });

  it('resumes an active run after the last restored event id', () => {
    const { run } = createService({
      activeRunId: 'run-restored',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Existing output',
          events: [
            { type: 'status', eventId: 4, label: 'running' },
            { type: 'text_delta', eventId: 5, delta: 'Existing output' },
          ],
          blocks: [],
          runId: 'run-restored',
          runStatus: 'running',
        },
      ],
    });

    expect(run.streamRun).toHaveBeenCalledWith('run-restored', expect.any(Object), 5);
  });

  it('exposes a starting state while the run creation request is pending', async () => {
    let resolveCreateRun: ((value: { runId: string }) => void) | undefined;
    const { service, run } = createService();
    run.createRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreateRun = resolve;
        }),
    );

    const sendPromise = service.sendTurn({ draft: 'Build it', files: [] });

    await waitFor(() => {
      expect(service.getSnapshot().startingRun).toBe(true);
    });

    if (!resolveCreateRun) {
      throw new Error('createRun promise was not started');
    }
    resolveCreateRun({ runId: 'run-delayed' });
    await sendPromise;

    expect(service.getSnapshot().startingRun).toBe(false);
  });

  it('passes the selected agent id into createRun', async () => {
    const { service, run } = createService();

    await service.sendTurn({ draft: 'Use Claude for this', files: [], agentId: 'claude' });

    expect(firstCreateRunInput(run)).toMatchObject({
      agentId: 'claude',
      prompt: 'Use Claude for this',
    });
  });

  it('passes the selected model into createRun', async () => {
    const { service, run } = createService();

    await service.sendTurn({
      draft: 'Use Codex mini',
      files: [],
      agentId: 'codex',
      model: 'codex:gpt-5.4-mini',
    });

    expect(firstCreateRunInput(run)).toMatchObject({
      agentId: 'codex',
      model: 'codex:gpt-5.4-mini',
      prompt: 'Use Codex mini',
    });
  });

  it('can show a short user message while sending a fuller run prompt', async () => {
    const { service, timeline, run } = createService();

    await service.sendTurn({
      draft: 'Please update assets/login-page.html.\n\nInternal protocol details for useVDTweaks.',
      displayDraft: '加一个主题色替换',
      files: [],
    });

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: '加一个主题色替换',
      attachments: [],
    });
    expect(firstCreateRunInput(run).prompt).toContain('Internal protocol details for useVDTweaks');
  });

  it('locks the active conversation to the provider returned by createRun', async () => {
    const { service, timeline, run } = createService({ createRunResult: { runId: 'run-1', provider: 'claude' } });

    await service.sendTurn({ draft: 'Use Claude for this', files: [], agentId: 'claude' });

    expect(run.createRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'claude' }));
    expect(timeline.setConversationProvider).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      provider: 'claude',
    });
  });

  it('keeps using Codex when the active conversation is already locked to Codex', async () => {
    const { service, run } = createService({ activeConversationProvider: 'codex' });

    await service.sendTurn({ draft: 'Try Claude anyway', files: [], agentId: 'claude' });

    expect(firstCreateRunInput(run)).toMatchObject({
      agentId: 'codex',
      prompt: 'Try Claude anyway',
    });
  });

  it('uploads staged files, appends the user message, builds context, creates the run, starts the assistant run, and wires stream handlers', async () => {
    const stagedFiles = [new File(['hero'], 'Hero.tsx', { type: 'text/tsx' })];
    const attachments: ChatAttachment[] = [
      { path: 'src/Hero.tsx', name: 'Hero.tsx', kind: 'file', mimeType: 'text/tsx' },
    ];
    const selectedSkills = [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }];
    const { service, timeline, run, context, files } = createService({ attachments, selectedSkills });

    await service.sendTurn({ draft: 'Build the hero', files: stagedFiles });

    expect(files.uploadFiles).toHaveBeenCalledWith(stagedFiles);
    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Build the hero',
      attachments,
      context: {
        selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      },
    });
    expect(context.buildRunContext).toHaveBeenCalledWith();
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Build the hero',
      attachments,
      context: { skillIds: ['skill-1'] },
      messageContext: {
        selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      },
    });
    expect(timeline.startAssistantRun).toHaveBeenCalledWith({ runId: 'run-1', conversationId: 'conversation-1' });
    expect(run.streamRun).toHaveBeenCalledWith('run-1', {
      onEvent: expect.any(Function),
      onEnd: expect.any(Function),
      onError: expect.any(Function),
    });
  });

  it('keeps already uploaded attachments when sending an edited queued turn', async () => {
    const uploadedAttachments: ChatAttachment[] = [
      { path: 'assets/reference.png', name: 'reference.png', kind: 'image', mimeType: 'image/png', size: 128 },
    ];
    const { service, timeline, run } = createService();

    await service.sendTurn({
      draft: 'Use this reference',
      files: [],
      attachments: uploadedAttachments,
    });

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Use this reference',
      attachments: uploadedAttachments,
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Use this reference',
      attachments: uploadedAttachments,
      context: { skillIds: ['skill-1'] },
    });
  });

  it('sends staged files without showing a default instruction', async () => {
    const stagedFiles = [new File(['hero'], 'Hero.tsx', { type: 'text/tsx' })];
    const attachments: ChatAttachment[] = [
      { path: 'src/Hero.tsx', name: 'Hero.tsx', kind: 'file', mimeType: 'text/tsx' },
    ];
    const { service, timeline, run } = createService({ attachments });

    await service.sendTurn({ draft: '', files: stagedFiles });

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: '',
      attachments,
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Review the attached file.',
      attachments,
      context: { skillIds: ['skill-1'] },
    });
  });

  it('uses a default instruction when sending only selected skill context', async () => {
    const selectedSkills = [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }];
    const { service, timeline, run } = createService({ selectedSkills });

    await service.sendTurn({ draft: '', files: [] });

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Use the selected skill.',
      attachments: [],
      context: {
        selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      },
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Use the selected skill.',
      context: { skillIds: ['skill-1'] },
      messageContext: {
        selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      },
    });
  });

  it('stores selected design files on the user message when sending only selected file context', async () => {
    const selectedDesignFiles = [
      {
        id: 'file-1',
        name: 'design-preview-navy-coral.html',
        path: 'design-preview-navy-coral.html',
        size: 2048,
        mtime: 1,
        kind: 'html' as const,
        mime: 'text/html',
      },
    ];
    const { service, timeline, run } = createService({
      selectedDesignFiles,
      runContext: {
        skillIds: [],
        designFileIds: ['file-1'],
        designFilePaths: ['design-preview-navy-coral.html'],
      },
    });

    await service.sendTurn({ draft: '', files: [] });

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Use the selected context.',
      attachments: [],
      context: { selectedDesignFiles },
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Use the selected context.',
      context: {
        skillIds: [],
        designFileIds: ['file-1'],
        designFilePaths: ['design-preview-navy-coral.html'],
      },
      messageContext: { selectedDesignFiles },
    });
  });

  it('removes the optimistic user message when createRun fails', async () => {
    const { service, timeline, run } = createService();
    run.createRun.mockRejectedValueOnce(new Error('network down'));

    await expect(service.sendTurn({ draft: '[form answers — discovery]\n- 产品或品牌是什么？: OJO', files: [] }))
      .rejects.toThrow('network down');

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: '[form answers — discovery]\n- 产品或品牌是什么？: OJO',
      attachments: [],
    });
    expect(timeline.removeMessage).toHaveBeenCalledWith('message-1');
    expect(timeline.startAssistantRun).not.toHaveBeenCalled();
    expect(run.streamRun).not.toHaveBeenCalled();
  });

  it('passes preview comment attachments through the local user message and run request', async () => {
    const commentAttachments = [commentAttachment()];
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: 'Apply this comment', files: [], commentAttachments });

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Apply this comment',
      attachments: [],
      commentAttachments,
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Apply this comment',
      commentAttachments,
      context: { skillIds: ['skill-1'] },
    });
  });

  it('sends visual preview comment screenshots as image attachments', async () => {
    const commentAttachments = [visualCommentAttachment()];
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: '', files: [], commentAttachments });

    const expectedScreenshotAttachment = {
      path: 'assets/visual-comment.svg',
      name: 'visual-comment.svg',
      kind: 'image' as const,
      mimeType: 'image/svg+xml',
    };
    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Tighten spacing',
      attachments: [expectedScreenshotAttachment],
      commentAttachments,
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Tighten spacing',
      attachments: [expectedScreenshotAttachment],
      commentAttachments,
      context: { skillIds: ['skill-1'] },
    });
  });

  it('uses all visual preview comment screenshots with plain comment text', async () => {
    const commentAttachments = [
      visualCommentAttachment({
        id: 'comment-visual-a',
        order: 1,
        comment: 'Tighten hero spacing',
        screenshotPath: 'assets/visual-comment-a.svg',
      }),
      visualCommentAttachment({
        id: 'comment-visual-b',
        order: 2,
        comment: 'Fix CTA contrast',
        screenshotPath: 'assets/visual-comment-b.svg',
      }),
    ];
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: '', files: [], commentAttachments });

    const expectedAttachments = [
      {
        path: 'assets/visual-comment-a.svg',
        name: 'visual-comment-a.svg',
        kind: 'image' as const,
        mimeType: 'image/svg+xml',
      },
      {
        path: 'assets/visual-comment-b.svg',
        name: 'visual-comment-b.svg',
        kind: 'image' as const,
        mimeType: 'image/svg+xml',
      },
    ];
    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Tighten hero spacing\nFix CTA contrast',
      attachments: expectedAttachments,
      commentAttachments,
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Tighten hero spacing\nFix CTA contrast',
      attachments: expectedAttachments,
      commentAttachments,
      context: { skillIds: ['skill-1'] },
    });
  });

  it('uses a default instruction when sending preview comment attachments without typed text', async () => {
    const commentAttachments = [commentAttachment()];
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: '', files: [], commentAttachments });

    expect(timeline.appendUserMessage).toHaveBeenCalledWith({
      content: 'Tighten spacing',
      attachments: [],
      commentAttachments,
    });
    expect(run.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      conversationId: 'conversation-1',
      prompt: 'Tighten spacing',
      commentAttachments,
      context: { skillIds: ['skill-1'] },
    });
  });

  it('forwards stream events to the timeline and does not double-finalize after a terminal end event', async () => {
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: 'Build it', files: [] });
    const handlers = firstStreamHandlers(run);
    const endEvent: AgentEvent = { type: 'end', code: 0, signal: null, status: 'succeeded' };

    handlers.onEvent({ type: 'text_delta', delta: 'Done' });
    handlers.onEvent(endEvent);
    expect(timeline.applyAgentEvent).not.toHaveBeenCalledWith('run-1', endEvent);

    handlers.onEnd('succeeded');
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(timeline.applyAgentEvent).toHaveBeenCalledWith('run-1', { type: 'text_delta', delta: 'Done' });
    expect(timeline.applyAgentEvent).toHaveBeenCalledWith('run-1', endEvent);
    expect(timeline.finishRun).not.toHaveBeenCalled();
  });

  it('extracts streamed HTML artifacts, saves them as design files, and keeps artifact markup out of chat text', async () => {
    const { service, timeline, run, files } = createService();

    await service.sendTurn({ draft: 'Build a landing page', files: [] });
    const handlers = firstStreamHandlers(run);

    handlers.onEvent({
      type: 'text_delta',
      delta: 'Here is the page.\n<artifact identifier="landing-page" type="text/html" title="Landing Page">',
    });
    handlers.onEvent({
      type: 'text_delta',
      delta: '<!doctype html><html><body><h1>Landing</h1></body></html>',
    });
    handlers.onEvent({ type: 'text_delta', delta: '</artifact>' });
    handlers.onEnd('succeeded');
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(timeline.applyAgentEvent).toHaveBeenCalledWith('run-1', {
      type: 'text_delta',
      delta: 'Here is the page.\n',
    });
    expect(timeline.applyAgentEvent).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ delta: expect.stringContaining('<!doctype html>') }),
    );
    expect(files.saveFileContent).toHaveBeenCalledWith(
      'landing-page.html',
      '<!doctype html><html><body><h1>Landing</h1></body></html>',
    );
    expect(timeline.applyAgentEvent).toHaveBeenCalledWith('run-1', {
      type: 'generated_file',
      name: 'landing-page.html',
      artifactType: 'text/html',
      title: 'Landing Page',
    });
    expect(timeline.finishRun).toHaveBeenCalledWith('run-1', { status: 'succeeded' });
  });

  it('keeps generated files visible when the terminal end event arrives before artifact finalization', async () => {
    const timeline = new ChatTimelineService();
    const { service, run, files } = createService({ timeline });

    await service.sendTurn({ draft: 'Build a landing page', files: [] });
    const handlers = firstStreamHandlers(run);

    handlers.onEvent({
      type: 'text_delta',
      delta:
        'Here is the page.\n<artifact identifier="landing-page" type="text/html" title="Landing Page"><!doctype html><html><body><h1>Landing</h1></body></html></artifact>',
    });
    handlers.onEvent({ type: 'end', code: 0, signal: null, status: 'succeeded' });
    handlers.onEnd('succeeded');
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const assistantMessage = timeline.getSnapshot().messages.find((message) => message.role === 'assistant');
    expect(files.saveFileContent).toHaveBeenCalledWith(
      'landing-page.html',
      '<!doctype html><html><body><h1>Landing</h1></body></html>',
    );
    expect(assistantMessage?.runStatus).toBe('succeeded');
    expect(assistantMessage?.blocks.at(-1)).toEqual({
      kind: 'generated-files',
      files: [{ name: 'landing-page.html', artifactType: 'text/html', title: 'Landing Page' }],
    });
  });

  it('finalizes the active run as failed when the stream errors', async () => {
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: 'Build it', files: [] });
    const handlers = firstStreamHandlers(run);
    handlers.onError(new Error('No API key configured'));

    expect(timeline.applyAgentEvent).toHaveBeenCalledWith('run-1', {
      type: 'error',
      code: 'RUN_STREAM_ERROR',
      message: 'No API key configured',
    });
    expect(timeline.finishRun).toHaveBeenCalledWith('run-1', { status: 'failed' });
  });

  it('finalizes a still-active run when an error event is followed by stream onError', async () => {
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: 'Build it', files: [] });
    const handlers = firstStreamHandlers(run);

    handlers.onEvent({ type: 'error', code: 'stream_error', message: 'stream failed' });
    expect(timeline.getSnapshot()).toMatchObject({ activeRunId: 'run-1', phase: 'failed' });

    handlers.onError(new Error('stream failed'));

    expect(timeline.finishRun).toHaveBeenCalledWith('run-1', { status: 'failed' });
    expect(timeline.getSnapshot()).toMatchObject({ activeRunId: null, phase: 'failed' });
  });

  it('stops the active run and is a no-op when none is active', async () => {
    const { service, run } = createService();

    await service.stopActiveRun();
    expect(run.stopRun).not.toHaveBeenCalled();

    await service.sendTurn({ draft: 'Build it', files: [] });
    await service.stopActiveRun();

    expect(run.stopRun).toHaveBeenCalledWith('run-1');
  });

  it('answers tool questions for the active run and throws a clear error when none is active', async () => {
    const { service, run } = createService();

    await expect(service.answerToolQuestion('tool-1', 'Yes')).rejects.toThrow(
      'Cannot answer a tool question because there is no active run.',
    );

    await service.sendTurn({ draft: 'Build it', files: [] });
    await service.answerToolQuestion('tool-1', 'Yes');

    expect(run.submitToolResult).toHaveBeenCalledWith('run-1', 'tool-1', 'Yes');
  });

  it('creates the next run inside the currently active conversation', async () => {
    const { service, timeline, run } = createService();

    timeline.getSnapshot.mockImplementation(() => ({
      messages: [],
      activeRunId: null,
      phase: 'idle',
      pinnedTodoInput: null,
      activeConversationId: 'conversation-2',
      activeConversationTitle: 'Create a landing page',
      conversations: [
        { id: 'conversation-1', title: 'Build a tank battle', updatedAt: 1, createdAt: 1 },
        { id: 'conversation-2', title: 'Create a landing page', updatedAt: 2, createdAt: 2 },
      ],
    }));

    await service.sendTurn({ draft: 'Continue the landing page', files: [] });

    expect(firstCreateRunInput(run)).toMatchObject({
      conversationId: 'conversation-2',
      prompt: 'Continue the landing page',
    });
  });

  it('waits for a newly selected conversation to persist before creating a run', async () => {
    const createConversation = deferred<{
      id: string;
      title: string;
      provider: null;
      createdAt: number;
      updatedAt: number;
    }>();
    const timeline = new ChatTimelineService({
      api: {
        createConversation: vi.fn(() => createConversation.promise),
        renameConversation: vi.fn(),
        deleteConversation: vi.fn(async () => undefined),
        listMessages: vi.fn(async () => []),
      },
      initialSnapshot: {
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'Initial turn',
            events: [],
            blocks: [],
          },
        ],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'Initial turn',
        conversations: [{ id: 'conversation-1', title: 'Initial turn', updatedAt: 1, createdAt: 1 }],
      },
    });
    const { service, run } = createService({ timeline });
    const newConversation = timeline.createConversation();

    timeline.selectConversation('conversation-1');
    timeline.selectConversation(newConversation.id);
    const sendPromise = service.sendTurn({ draft: 'Continue the new conversation', files: [] });
    await flushQueuedTurn();

    expect(run.createRun).not.toHaveBeenCalled();

    createConversation.resolve({
      id: newConversation.id,
      title: 'New conversation',
      provider: null,
      createdAt: 2,
      updatedAt: 2,
    });
    await sendPromise;

    expect(firstCreateRunInput(run)).toMatchObject({
      conversationId: newConversation.id,
      prompt: 'Continue the new conversation',
    });
  });

  it('queues turns while a run is active and starts the next turn after the active run ends', async () => {
    const { service, timeline, run } = createService();

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });

    expect(timeline.appendUserMessage).toHaveBeenCalledTimes(1);
    expect(run.createRun).toHaveBeenCalledTimes(1);
    expect(firstCreateRunInput(run).prompt).toBe('First turn');

    const handlers = firstStreamHandlers(run);
    handlers.onEnd('succeeded');
    await flushQueuedTurn();

    expect(timeline.appendUserMessage).toHaveBeenCalledTimes(2);
    expect(timeline.appendUserMessage).toHaveBeenLastCalledWith({
      content: 'Second turn',
      attachments: [],
      conversationId: 'conversation-1',
    });
    expect(run.createRun).toHaveBeenCalledTimes(2);
    expect(createRunInputAt(run, 1)).toMatchObject({
      conversationId: 'conversation-1',
      prompt: 'Second turn',
    });
    expect(timeline.startAssistantRun).toHaveBeenNthCalledWith(2, { runId: 'run-2', conversationId: 'conversation-1' });
    expect(run.streamRun).toHaveBeenNthCalledWith(2, 'run-2', expect.any(Object));
  });

  it('keeps a queued assistant run in the conversation captured when the turn was prepared', async () => {
    const timeline = new ChatTimelineService();
    const { service, run } = createService({ timeline });
    const firstConversationId = timeline.getSnapshot().activeConversationId!;
    const commentAttachments = [commentAttachment()];

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [], commentAttachments });
    const secondConversation = timeline.createConversation();

    firstStreamHandlers(run).onEvent({
      type: 'end',
      code: 0,
      signal: null,
      status: 'succeeded',
    });
    firstStreamHandlers(run).onEnd('succeeded');
    await flushQueuedTurn();

    expect(createRunInputAt(run, 1)).toMatchObject({
      conversationId: firstConversationId,
      prompt: 'Second turn',
      commentAttachments,
    });
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: secondConversation.id,
      messages: [],
    });

    timeline.selectConversation(firstConversationId);
    const firstConversationMessages = timeline.getSnapshot().messages;
    expect(firstConversationMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(firstConversationMessages[2]?.commentAttachments).toEqual(commentAttachments);
    expect(firstConversationMessages[3]).toMatchObject({
      role: 'assistant',
      runId: 'run-2',
      runStatus: 'running',
    });

    timeline.selectConversation(secondConversation.id);
    expect(timeline.getSnapshot().messages).toEqual([]);
  });

  it.each([
    ['stream error', (handlers: RunStreamHandlers) => handlers.onError(new Error('stream failed'))],
    ['stream end without terminal event', (handlers: RunStreamHandlers) => handlers.onEnd('failed')],
  ])('finishes a background queued run after %s and keeps draining queued turns', async (_caseName, finishSecondRun) => {
    const timeline = new ChatTimelineService();
    const { service, run } = createService({ timeline });
    const firstConversationId = timeline.getSnapshot().activeConversationId!;

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });
    await service.sendTurn({ draft: 'Third turn', files: [] });
    const secondConversation = timeline.createConversation();

    firstStreamHandlers(run).onEvent({
      type: 'end',
      code: 0,
      signal: null,
      status: 'succeeded',
    });
    firstStreamHandlers(run).onEnd('succeeded');
    await flushQueuedTurn();

    expect(createRunInputAt(run, 1)).toMatchObject({
      conversationId: firstConversationId,
      prompt: 'Second turn',
    });
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: secondConversation.id,
      messages: [],
    });

    finishSecondRun(streamHandlersAt(run, 1));
    await flushQueuedTurn();

    expect(createRunInputAt(run, 2)).toMatchObject({
      conversationId: firstConversationId,
      prompt: 'Third turn',
    });
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: secondConversation.id,
      messages: [],
    });

    timeline.selectConversation(firstConversationId);
    expect(timeline.getSnapshot()).toMatchObject({
      activeConversationId: firstConversationId,
      activeRunId: 'run-3',
      phase: 'streaming',
    });
    expect(timeline.getSnapshot().messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(timeline.getSnapshot().messages[3]).toMatchObject({
      role: 'assistant',
      runId: 'run-2',
      runStatus: 'failed',
      endedAt: expect.any(Number),
    });
    expect(timeline.getSnapshot().messages[5]).toMatchObject({
      role: 'assistant',
      runId: 'run-3',
      runStatus: 'running',
    });
  });

  it('keeps queued turns out of the visible message flow while exposing queue previews', async () => {
    const selectedSkills = [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }];
    const { service, timeline } = createService({ selectedSkills });

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });

    expect(timeline.appendUserMessage).toHaveBeenCalledTimes(1);
    expect(timeline.setUserMessageTurnStatus).not.toHaveBeenCalled();
    expect(service.getSnapshot().queuedTurns).toEqual([
      expect.objectContaining({
        content: 'Second turn',
        prompt: 'Second turn',
        conversationId: 'conversation-1',
        messageContext: {
          selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
        },
      }),
    ]);
  });

  it('keeps default file review prompts out of queued turn previews', async () => {
    const stagedFiles = [new File(['report'], 'report.md', { type: 'text/markdown' })];
    const attachments: ChatAttachment[] = [
      { path: 'assets/report.md', name: 'report.md', kind: 'file', mimeType: 'text/markdown' },
    ];
    const { service, files } = createService();
    files.uploadFiles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(attachments);

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: '', files: stagedFiles });

    expect(service.getSnapshot().queuedTurns).toEqual([
      expect.objectContaining({
        content: '',
        attachments,
      }),
    ]);
    expect(service.getSnapshot().queuedTurns[0]?.prompt).toBeUndefined();
  });

  it('deletes a queued turn before the queue drains', async () => {
    const { service, run } = createService();

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });
    await service.sendTurn({ draft: 'Third turn', files: [] });
    const secondQueuedTurn = service.getSnapshot().queuedTurns[0];

    service.deleteQueuedTurn(secondQueuedTurn!.id);

    expect(service.getSnapshot().queuedTurns.map((turn) => turn.content)).toEqual(['Third turn']);

    firstStreamHandlers(run).onEnd('succeeded');
    await flushQueuedTurn();

    expect(createRunInputAt(run, 1)).toMatchObject({ prompt: 'Third turn' });
  });

  it('sends the selected queued turn immediately and leaves older queued turns waiting', async () => {
    const { service, run } = createService();

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });
    await service.sendTurn({ draft: 'Third turn', files: [] });
    const thirdQueuedTurn = service.getSnapshot().queuedTurns[1];

    await service.sendQueuedTurnNext(thirdQueuedTurn!.id);

    expect(service.getSnapshot().queuedTurns.map((turn) => turn.content)).toEqual(['Second turn']);
    expect(createRunInputAt(run, 1)).toMatchObject({ prompt: 'Third turn' });
  });

  it('sends a queued turn immediately by stopping the active run first', async () => {
    const { service, run } = createService();

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });
    await service.sendTurn({ draft: 'Third turn', files: [] });
    const thirdQueuedTurn = service.getSnapshot().queuedTurns[1];

    await service.sendQueuedTurnNext(thirdQueuedTurn!.id);

    expect(run.stopRun).toHaveBeenCalledWith('run-1');
    expect(run.createRun).toHaveBeenCalledTimes(2);
    expect(createRunInputAt(run, 1)).toMatchObject({ prompt: 'Third turn' });
    expect(service.getSnapshot().queuedTurns.map((turn) => turn.content)).toEqual(['Second turn']);
  });

  it('does not drain an older queued turn while sending a selected queued turn after stop completes', async () => {
    const { service, run } = createService();

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });
    await service.sendTurn({ draft: 'Third turn', files: [] });
    const thirdQueuedTurn = service.getSnapshot().queuedTurns[1];

    run.stopRun.mockImplementationOnce(async () => {
      firstStreamHandlers(run).onEnd('canceled');
      await flushQueuedTurn();
    });

    await service.sendQueuedTurnNext(thirdQueuedTurn!.id);

    expect(run.createRun).toHaveBeenCalledTimes(2);
    expect(createRunInputAt(run, 1)).toMatchObject({ prompt: 'Third turn' });
    expect(service.getSnapshot().queuedTurns.map((turn) => turn.content)).toEqual(['Second turn']);
  });

  it('starts queued turns after a terminal stream event clears the active run before onEnd', async () => {
    const { service, run } = createService();

    await service.sendTurn({ draft: 'First turn', files: [] });
    await service.sendTurn({ draft: 'Second turn', files: [] });

    const handlers = firstStreamHandlers(run);
    handlers.onEvent({ type: 'end', code: 0, signal: null, status: 'succeeded' });
    handlers.onEnd('succeeded');
    await flushQueuedTurn();

    expect(run.createRun).toHaveBeenCalledTimes(2);
    expect(createRunInputAt(run, 1)).toMatchObject({ prompt: 'Second turn' });
  });

  it('restores queued turns after project re-entry and sends them immediately when no run is active', async () => {
    const queuedTurnStore = createMemoryQueuedTurnStore();
    const firstEntry = createService({ queuedTurnStore });

    await firstEntry.service.sendTurn({ draft: 'First turn', files: [] });
    await firstEntry.service.sendTurn({
      draft: 'Second turn',
      files: [],
      agentId: 'codex',
      model: 'codex:gpt-5.4-mini',
    });

    expect(firstEntry.run.createRun).toHaveBeenCalledTimes(1);
    expect(firstEntry.service.getSnapshot().queuedTurns.map((turn) => turn.content)).toEqual(['Second turn']);

    const secondEntry = createService({ queuedTurnStore });
    await flushQueuedTurn();

    expect(secondEntry.service.getSnapshot().queuedTurns).toEqual([]);
    expect(secondEntry.run.createRun).toHaveBeenCalledTimes(1);
    expect(firstCreateRunInput(secondEntry.run)).toMatchObject({
      conversationId: 'conversation-1',
      model: 'codex:gpt-5.4-mini',
      prompt: 'Second turn',
    });
    expect(queuedTurnStore.save).toHaveBeenLastCalledWith('demo-project', []);
  });

  it('keeps restored queued turns waiting when restored messages still have a running run', async () => {
    const queuedTurnStore = createMemoryQueuedTurnStore();
    const firstEntry = createService({ queuedTurnStore });

    await firstEntry.service.sendTurn({ draft: 'First turn', files: [] });
    await firstEntry.service.sendTurn({ draft: 'Second turn', files: [] });

    const timeline = new ChatTimelineService({
      initialSnapshot: {
        conversations: [{ id: 'conversation-1', title: 'First turn', createdAt: 1, updatedAt: 1 }],
        activeConversationId: 'conversation-1',
        activeConversationTitle: 'First turn',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'First turn',
            attachments: [],
            events: [],
            blocks: [],
          },
          {
            id: 'message-2',
            role: 'assistant',
            content: 'Working',
            events: [{ type: 'text_delta', delta: 'Working' }],
            blocks: [],
            runId: 'run-restored',
            runStatus: 'running',
            startedAt: 1,
          },
        ],
        activeRunId: null,
        phase: 'idle',
        pinnedTodoInput: null,
      },
    });
    const secondEntry = createService({ queuedTurnStore, timeline });
    await flushQueuedTurn();

    expect(secondEntry.run.streamRun).toHaveBeenCalledWith('run-restored', expect.any(Object), null);
    expect(secondEntry.run.createRun).not.toHaveBeenCalled();
    expect(secondEntry.service.getSnapshot().queuedTurns.map((turn) => turn.content)).toEqual(['Second turn']);

    firstStreamHandlers(secondEntry.run).onEnd('succeeded');
    await flushQueuedTurn();

    expect(secondEntry.run.createRun).toHaveBeenCalledTimes(1);
    expect(firstCreateRunInput(secondEntry.run)).toMatchObject({
      conversationId: 'conversation-1',
      prompt: 'Second turn',
    });
  });

  it('keeps restored queued turns cached when immediate re-entry send fails', async () => {
    const queuedTurnStore = createMemoryQueuedTurnStore();
    const firstEntry = createService({ queuedTurnStore });

    await firstEntry.service.sendTurn({ draft: 'First turn', files: [] });
    await firstEntry.service.sendTurn({ draft: 'Second turn', files: [] });

    const secondEntry = createService({ queuedTurnStore });
    secondEntry.run.createRun.mockRejectedValueOnce(new Error('run unavailable'));
    await flushQueuedTurn();

    expect(secondEntry.service.getSnapshot().queuedTurns.map((turn) => turn.content)).toEqual(['Second turn']);
    expect(queuedTurnStore.save).toHaveBeenLastCalledWith('demo-project', [
      expect.objectContaining({ content: 'Second turn' }),
    ]);
  });

  it('uses localStorage for queued turn handoff when browser storage is available', () => {
    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    const store = createBrowserQueuedTurnStore({ localStorage, sessionStorage });

    store?.save('demo-project', [
      {
        queueId: 'queued-turn-1',
        content: 'Cached turn',
        prompt: 'Cached turn',
        attachments: [],
        commentAttachments: [],
        conversationId: 'conversation-1',
        appendConversationId: 'conversation-1',
      },
    ]);

    expect(localStorage.getItem('vibe-design:queued-turns:demo-project')).toContain('Cached turn');
    expect(sessionStorage.getItem('vibe-design:queued-turns:demo-project')).toBeNull();
    expect(store?.load('demo-project')).toEqual([expect.objectContaining({ content: 'Cached turn' })]);
  });
});

type TestTimelineService = IChatTimelineService & {
  appendUserMessage: ReturnType<typeof vi.fn>;
  setUserMessageTurnStatus: ReturnType<typeof vi.fn>;
  startAssistantRun: ReturnType<typeof vi.fn>;
  applyAgentEvent: ReturnType<typeof vi.fn>;
  finishRun: ReturnType<typeof vi.fn>;
  setConversationProvider: ReturnType<typeof vi.fn>;
  createConversation: ReturnType<typeof vi.fn>;
  ensureConversationPersisted: ReturnType<typeof vi.fn>;
  selectConversation: ReturnType<typeof vi.fn>;
  renameConversation: ReturnType<typeof vi.fn>;
  getSnapshot: ReturnType<typeof vi.fn>;
};

function createService(
  options: {
    attachments?: ChatAttachment[];
    timeline?: IChatTimelineService;
    createRunResult?: { runId: string; provider?: string | null };
    activeConversationProvider?: string | null;
    selectedSkills?: Array<{ id: string; name: string; description?: string }>;
    selectedDesignFiles?: ProjectFile[];
    runContext?: RunContextSelection;
    activeRunId?: string | null;
    messages?: ReturnType<IChatTimelineService['getSnapshot']>['messages'];
    queuedTurnStore?: {
      load: ReturnType<typeof vi.fn>;
      save: ReturnType<typeof vi.fn>;
    };
  } = {},
) {
  let activeRunId: string | null = options.activeRunId ?? null;
  let phase = 'idle';
  let nextMessageNumber = 1;
  const timeline = (options.timeline ?? {
    _serviceBrand: undefined,
    subscribe: vi.fn(() => vi.fn()),
    appendUserMessage: vi.fn((input: { content: string; attachments?: ChatAttachment[]; commentAttachments?: CanvasCommentAttachment[] }) => ({
      id: `message-${nextMessageNumber++}`,
      role: 'user' as const,
      content: input.content,
      attachments: input.attachments,
      commentAttachments: input.commentAttachments,
    })),
    removeMessage: vi.fn(),
    setConversationProvider: vi.fn(),
    setUserMessageTurnStatus: vi.fn(),
    startAssistantRun: vi.fn((input: { runId: string; conversationId?: string | null }) => {
      activeRunId = input.runId;
      phase = 'streaming';
      return {
        id: `message-${nextMessageNumber++}`,
        role: 'assistant' as const,
        content: '',
        runId: input.runId,
        runStatus: 'running' as const,
      };
    }),
    applyAgentEvent: vi.fn((runId: string, event: AgentEvent) => {
      if (event.type === 'end') {
        activeRunId = null;
        phase = event.status;
      }
      if (event.type === 'error') {
        phase = 'failed';
      }
    }),
    finishRun: vi.fn((runId: string, input: { status: string }) => {
      activeRunId = null;
      phase = input.status;
    }),
    createConversation: vi.fn(() => ({
      id: 'conversation-1',
      title: 'New conversation',
      createdAt: 1,
      updatedAt: 1,
    })),
    ensureConversationPersisted: vi.fn(async () => undefined),
    selectConversation: vi.fn(() => undefined),
    renameConversation: vi.fn(() => undefined),
    getSnapshot: vi.fn(() => ({
      messages: options.messages ?? [],
      activeRunId,
      phase,
      pinnedTodoInput: null,
      activeConversationId: 'conversation-1',
      activeConversationTitle: 'New conversation',
      conversations: [
        {
          id: 'conversation-1',
          title: 'New conversation',
          provider: options.activeConversationProvider ?? null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })),
  }) as TestTimelineService;
  let nextRunNumber = 1;
  const run = {
    _serviceBrand: undefined,
    createRun: vi.fn(async () => options.createRunResult ?? { runId: `run-${nextRunNumber++}` }),
    streamRun: vi.fn(() => ({ dispose: vi.fn() })),
    stopRun: vi.fn(async () => undefined),
    submitToolResult: vi.fn(async () => undefined),
  };
  const context = {
    _serviceBrand: undefined,
    subscribe: vi.fn(() => vi.fn()),
    search: vi.fn(),
    selectSkill: vi.fn(),
    selectDesignFile: vi.fn(),
    selectResult: vi.fn(),
    removeSelection: vi.fn(),
    buildRunContext: vi.fn(() => options.runContext ?? { skillIds: ['skill-1'] }),
    getSnapshot: vi.fn(() => ({
      selectedSkills: options.selectedSkills ?? [],
      selectedDesignFiles: options.selectedDesignFiles ?? [],
    })),
  };
  const files = {
    _serviceBrand: undefined,
    subscribe: vi.fn(() => vi.fn()),
    listFiles: vi.fn(),
    readFileContent: vi.fn(async () => ''),
    fileUrl: vi.fn(() => null),
    saveFileContent: vi.fn(),
    uploadFiles: vi.fn(async () => options.attachments ?? []),
  };

  return {
    service: new ChatSessionService({
      project: {
        _serviceBrand: undefined,
        getProjectId: vi.fn(() => 'demo-project'),
      },
      timeline: timeline as IChatTimelineService,
      run: run as IRunService,
      context: context as IContextPickerService,
      files: files as IDesignFileService,
      ...(options.queuedTurnStore ? { queuedTurnStore: options.queuedTurnStore } : {}),
    } as ConstructorParameters<typeof ChatSessionService>[0]),
    timeline,
    run,
    context,
    files,
  };
}

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

function visualCommentAttachment(overrides: Partial<CanvasCommentAttachment> = {}): CanvasCommentAttachment {
  const attachment: CanvasCommentAttachment = {
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
    intent: 'Apply the visual comment using the screenshot.',
  };
  return { ...attachment, ...overrides } as CanvasCommentAttachment;
}

async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

function firstCreateRunInput(run: { createRun: { mock: { calls: unknown[][] } } }): CreateRunInput {
  return run.createRun.mock.calls[0]?.[0] as CreateRunInput;
}

function createRunInputAt(run: { createRun: { mock: { calls: unknown[][] } } }, index: number): CreateRunInput {
  return run.createRun.mock.calls[index]?.[0] as CreateRunInput;
}

function firstStreamHandlers(run: { streamRun: { mock: { calls: unknown[][] } } }): RunStreamHandlers {
  return run.streamRun.mock.calls[0]?.[1] as RunStreamHandlers;
}

function streamHandlersAt(run: { streamRun: { mock: { calls: unknown[][] } } }, index: number): RunStreamHandlers {
  return run.streamRun.mock.calls[index]?.[1] as RunStreamHandlers;
}

async function flushQueuedTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createMemoryQueuedTurnStore() {
  let storedTurns: unknown[] = [];
  return {
    load: vi.fn(() => structuredClone(storedTurns)),
    save: vi.fn((_projectId: string, turns: unknown[]) => {
      storedTurns = structuredClone(turns);
    }),
  };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, String(value));
    }),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
