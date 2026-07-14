import { latestTodoWriteInputForPinnedCard } from '../../../runtime/todos';
import type { AgentEvent, ChatAttachment, ChatMessage, RunPhase, RunStatus } from '../../../types';
import type { ChatTimelineApi } from '../chat-timeline-api';
import type { IChatTimelineService } from '../chat-timeline-service.interface';
import type {
  AppendUserMessageInput,
  ChatConversationSummary,
  ChatTimelineMessage,
  ChatTimelineSnapshot,
  FinishRunInput,
  MessageBlock,
  SetConversationAgentInput,
  SetUserMessageTurnStatusInput,
  StartAssistantRunInput,
} from '../chat-timeline-types';
import { buildMessageBlocks } from './message-blocks';

export class ChatTimelineService implements IChatTimelineService {
  readonly _serviceBrand = undefined;

  private readonly conversations = new Map<string, ConversationState>();
  private readonly api: ChatTimelineApi | null;
  private activeConversationId: string | null = null;
  private nextMessageId = 1;
  private readonly listeners = new Set<() => void>();

  constructor(options: ChatTimelineServiceOptions = {}) {
    this.api = options.api ?? null;
    if (options.initialSnapshot?.conversations.length) {
      for (const summary of options.initialSnapshot.conversations) {
        const isActive = summary.id === options.initialSnapshot.activeConversationId;
        const initialMessages = isActive ? options.initialSnapshot.messages.map(normalizeInitialMessage) : [];
        const activeRunId = isActive
          ? options.initialSnapshot.activeRunId ?? restoredActiveRunId(initialMessages)
          : null;
        this.conversations.set(summary.id, {
          summary: { ...summary },
          messages: initialMessages,
          activeRunId,
          phase: isActive ? restoredPhase(options.initialSnapshot.phase, activeRunId) : 'idle',
          pinnedTodoInput: isActive ? cloneValue(options.initialSnapshot.pinnedTodoInput) : null,
          customTitle: summary.title !== DEFAULT_CONVERSATION_TITLE,
          loaded: isActive,
          hasHadMessages: initialMessages.length > 0 || Boolean(summary.agentTargetId),
          persisted: true,
          persistPromise: null,
        });
      }
      this.activeConversationId = options.initialSnapshot.activeConversationId ?? options.initialSnapshot.conversations[0]?.id ?? null;
      this.nextMessageId = options.initialSnapshot.messages.length + 1;
      return;
    }

    const initialConversation = this.createConversationState();
    this.conversations.set(initialConversation.summary.id, initialConversation);
    this.activeConversationId = initialConversation.summary.id;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ChatTimelineSnapshot {
    const activeConversation = this.getActiveConversation();
    return cloneSnapshot({
      conversations: this.listConversationSummaries(),
      activeConversationId: activeConversation?.summary.id ?? null,
      activeConversationTitle: activeConversation?.summary.title ?? DEFAULT_CONVERSATION_TITLE,
      messages: activeConversation?.messages ?? [],
      activeRunId: activeConversation?.activeRunId ?? null,
      phase: activeConversation?.phase ?? 'idle',
      pinnedTodoInput: activeConversation?.pinnedTodoInput ?? null,
    });
  }

  createConversation(title?: string): ChatConversationSummary {
    const activeConversation = this.getActiveConversation();
    if (activeConversation && activeConversation.messages.length === 0 && !activeConversation.hasHadMessages) {
      void this.persistConversation(activeConversation).catch(() => undefined);
      return { ...activeConversation.summary };
    }

    const conversation = this.createConversationState(title, this.api === null);
    this.conversations.set(conversation.summary.id, conversation);
    this.activeConversationId = conversation.summary.id;
    this.emitChange();
    void this.persistConversation(conversation).catch(() => undefined);
    return { ...conversation.summary };
  }

  async ensureConversationPersisted(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }

    await this.persistConversation(conversation);
  }

  selectConversation(conversationId: string): void {
    if (!this.conversations.has(conversationId) || this.activeConversationId === conversationId) {
      return;
    }

    this.activeConversationId = conversationId;
    this.loadConversationMessagesIfNeeded(conversationId);
    this.emitChange();
  }

  renameConversation(conversationId: string, title: string): void {
    const conversation = this.conversations.get(conversationId);
    const normalized = normalizeConversationTitle(title);
    if (!conversation || !normalized || conversation.summary.title === normalized) {
      return;
    }

    conversation.summary = {
      ...conversation.summary,
      title: normalized,
      updatedAt: Date.now(),
    };
    conversation.customTitle = true;
    this.emitChange();
    void this.api?.renameConversation(conversationId, normalized).catch(() => undefined);
  }

  deleteConversation(conversationId: string): void {
    if (!this.conversations.has(conversationId) || this.conversations.size <= 1) {
      return;
    }

    const deletingActiveConversation = this.activeConversationId === conversationId;
    this.conversations.delete(conversationId);
    if (deletingActiveConversation) {
      const nextConversationId = this.listConversationSummaries()[0]?.id ?? null;
      if (nextConversationId) {
        this.activeConversationId = nextConversationId;
        this.loadConversationMessagesIfNeeded(nextConversationId);
      }
    }

    this.emitChange();
    void this.api?.deleteConversation(conversationId).catch(() => undefined);
  }

  appendUserMessage(input: AppendUserMessageInput): ChatMessage {
    const conversation = input.conversationId
      ? this.conversations.get(input.conversationId) ?? this.ensureActiveConversation()
      : this.ensureActiveConversation();
    const message: ChatTimelineMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: input.content,
      attachments: cloneAttachments(input.attachments ?? []),
      commentAttachments: cloneValue(input.commentAttachments ?? []),
      ...(input.context ? { context: cloneValue(input.context) } : {}),
      events: [],
      blocks: [],
      createdAt: Date.now(),
    };

    conversation.messages = [...conversation.messages, message];
    conversation.hasHadMessages = true;
    const shouldAutoTitle =
      conversation.messages.filter((entry) => entry.role === 'user').length === 1 &&
      !conversation.customTitle;
    if (shouldAutoTitle) {
      const nextTitle = deriveConversationTitle(input.content);
      conversation.summary = {
        ...conversation.summary,
        title: nextTitle,
        updatedAt: Date.now(),
      };
      if (conversation.persisted && this.api) {
        void Promise.resolve(this.api.renameConversation(conversation.summary.id, nextTitle)).catch(() => undefined);
      }
    } else {
      conversation.summary = {
        ...conversation.summary,
        updatedAt: Date.now(),
      };
    }
    this.refreshPinnedTodoInput(conversation);
    this.emitChange();
    return cloneMessage(message);
  }

  removeMessage(messageId: string): void {
    const target = this.findMessage(messageId);
    if (!target) return;

    const [removedMessage] = target.conversation.messages.slice(target.messageIndex, target.messageIndex + 1);
    target.conversation.messages = [
      ...target.conversation.messages.slice(0, target.messageIndex),
      ...target.conversation.messages.slice(target.messageIndex + 1),
    ];
    if (removedMessage?.role === 'assistant' && removedMessage.runId === target.conversation.activeRunId) {
      target.conversation.activeRunId = null;
      target.conversation.phase = 'idle';
    }
    target.conversation.summary = {
      ...target.conversation.summary,
      updatedAt: Date.now(),
    };
    this.refreshPinnedTodoInput(target.conversation);
    this.emitChange();
  }

  setUserMessageTurnStatus(input: SetUserMessageTurnStatusInput): void {
    const target = this.findMessage(input.messageId);
    if (!target) return;

    const current = target.conversation.messages[target.messageIndex];
    if (!current || current.role !== 'user') return;

    const nextMessage: ChatTimelineMessage = {
      ...current,
      ...(input.turnStatus ? { turnStatus: input.turnStatus } : {}),
    };
    if (!input.turnStatus) {
      delete nextMessage.turnStatus;
    }

    target.conversation.messages = replaceAt(target.conversation.messages, target.messageIndex, nextMessage);
    this.emitChange();
  }

  setConversationAgent(input: SetConversationAgentInput): void {
    const conversation = this.conversations.get(input.conversationId);
    if (!conversation) {
      return;
    }
    if (conversation.summary.agentTargetId && conversation.summary.agentTargetId !== input.agentTargetId) {
      return;
    }

    conversation.summary = {
      ...conversation.summary,
      agentTargetId: input.agentTargetId,
      provider: input.provider,
      ...(input.model ? { model: input.model } : {}),
      updatedAt: Date.now(),
    };
    conversation.hasHadMessages = true;
    this.emitChange();
  }

  startAssistantRun(input: StartAssistantRunInput): ChatMessage {
    const conversation = input.conversationId
      ? this.conversations.get(input.conversationId) ?? this.ensureActiveConversation()
      : this.ensureActiveConversation();
    const message: ChatTimelineMessage = {
      id: this.createMessageId(),
      role: 'assistant',
      content: '',
      events: [],
      blocks: [],
      runId: input.runId,
      runStatus: 'running',
      startedAt: Date.now(),
    };

    conversation.messages = [...conversation.messages, message];
    conversation.hasHadMessages = true;
    conversation.activeRunId = input.runId;
    conversation.phase = 'streaming';
    conversation.summary = {
      ...conversation.summary,
      updatedAt: Date.now(),
    };
    this.refreshPinnedTodoInput(conversation);
    this.emitChange();
    return cloneMessage(message);
  }

  applyAgentEvent(runId: string, event: AgentEvent): void {
    const target = this.findAssistantMessage(runId);
    if (!target) return;

    const current = target.conversation.messages[target.messageIndex];
    if (!current) return;

    const events = [...current.events, cloneValue(event)];
    const content =
      event.type === 'text_delta' ? `${current.content}${event.delta}` : current.content;
    let nextMessage: ChatTimelineMessage = {
      ...current,
      content,
      events,
      blocks: buildMessageBlocks(events),
    };
    if (event.type === 'end') {
      nextMessage = {
        ...nextMessage,
        runStatus: event.status,
        endedAt: Date.now(),
      };
    }

    target.conversation.messages = replaceAt(target.conversation.messages, target.messageIndex, nextMessage);
    if (target.conversation.activeRunId === runId) {
      if (event.type === 'end') target.conversation.activeRunId = null;
      target.conversation.phase = phaseForEvent(event, target.conversation.phase);
    }
    target.conversation.summary = {
      ...target.conversation.summary,
      updatedAt: Date.now(),
    };
    this.refreshPinnedTodoInput(target.conversation);
    this.emitChange();
  }

  finishRun(runId: string, input: FinishRunInput): void {
    const target = this.findAssistantMessage(runId);
    if (!target) return;

    const current = target.conversation.messages[target.messageIndex];
    if (current) {
      const events = appendSyntheticEndEvent(current.events, input.status);
      target.conversation.messages = replaceAt(target.conversation.messages, target.messageIndex, {
        ...current,
        events,
        blocks: buildMessageBlocks(events),
        runStatus: input.status,
        endedAt: Date.now(),
      });
    }

    if (target.conversation.activeRunId === runId) {
      target.conversation.activeRunId = null;
      target.conversation.phase = phaseForRunStatus(input.status);
    }
    target.conversation.summary = {
      ...target.conversation.summary,
      updatedAt: Date.now(),
    };
    this.refreshPinnedTodoInput(target.conversation);
    this.emitChange();
  }

  private createMessageId(): string {
    const id = `message-${this.nextMessageId}`;
    this.nextMessageId += 1;
    return id;
  }

  private listConversationSummaries(): ChatConversationSummary[] {
    return Array.from(this.conversations.values())
      .map((conversation) => ({ ...conversation.summary }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private loadConversationMessagesIfNeeded(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.loaded) {
      return;
    }

    conversation.loaded = true;
    void this.api?.listMessages(conversationId).then((messages) => {
      const current = this.conversations.get(conversationId);
      if (!current) return;
      current.messages = messages;
      current.hasHadMessages = current.hasHadMessages || messages.length > 0 || Boolean(current.summary.agentTargetId);
      current.activeRunId =
        messages.find((message) => message.role === 'assistant' && message.runStatus === 'running' && message.runId)?.runId ??
        null;
      current.phase = current.activeRunId ? 'streaming' : 'idle';
      this.refreshPinnedTodoInput(current);
      this.emitChange();
    }).catch(() => undefined);
  }

  private getActiveConversation(): ConversationState | null {
    if (!this.activeConversationId) return null;
    return this.conversations.get(this.activeConversationId) ?? null;
  }

  private ensureActiveConversation(): ConversationState {
    const activeConversation = this.getActiveConversation();
    if (activeConversation) return activeConversation;

    const conversation = this.createConversationState();
    this.conversations.set(conversation.summary.id, conversation);
    this.activeConversationId = conversation.summary.id;
    return conversation;
  }

  private createConversationState(title?: string, persisted = true): ConversationState {
    const now = Date.now();
    const normalizedTitle = normalizeConversationTitle(title) ?? DEFAULT_CONVERSATION_TITLE;
    const conversationId = createLocalConversationId();
    return {
      summary: {
        id: conversationId,
        title: normalizedTitle,
        agentTargetId: null,
        provider: null,
        model: null,
        createdAt: now,
        updatedAt: now,
      },
      messages: [],
      activeRunId: null,
      phase: 'idle',
      pinnedTodoInput: null,
      customTitle: normalizedTitle !== DEFAULT_CONVERSATION_TITLE,
      loaded: true,
      hasHadMessages: false,
      persisted,
      persistPromise: null,
    };
  }

  private persistConversation(conversation: ConversationState): Promise<void> {
    if (!this.api || conversation.persisted) {
      return Promise.resolve();
    }
    if (conversation.persistPromise) {
      return conversation.persistPromise;
    }

    const conversationId = conversation.summary.id;
    const title = conversation.customTitle ? conversation.summary.title : undefined;
    const persistPromise = this.api
      .createConversation({ id: conversationId, title })
      .then((summary) => {
        const current = this.conversations.get(conversationId);
        if (!current) {
          return;
        }
        current.summary = {
          ...current.summary,
          title: summary.title,
          agentTargetId: summary.agentTargetId,
          provider: summary.provider,
          model: summary.model,
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt,
        };
        current.persisted = true;
        current.persistPromise = null;
        this.emitChange();
      })
      .catch((error: unknown) => {
        const current = this.conversations.get(conversationId);
        if (current) {
          current.persistPromise = null;
        }
        throw error;
      });

    conversation.persistPromise = persistPromise;
    return persistPromise;
  }

  private findAssistantMessage(runId: string): { conversation: ConversationState; messageIndex: number } | null {
    for (const conversation of this.conversations.values()) {
      for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
        const message = conversation.messages[index];
        if (message?.role === 'assistant' && message.runId === runId) {
          return { conversation, messageIndex: index };
        }
      }
    }
    return null;
  }

  private findMessage(messageId: string): { conversation: ConversationState; messageIndex: number } | null {
    for (const conversation of this.conversations.values()) {
      const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
      if (messageIndex !== -1) {
        return { conversation, messageIndex };
      }
    }
    return null;
  }

  private refreshPinnedTodoInput(conversation: ConversationState): void {
    conversation.pinnedTodoInput = latestTodoWriteInputForPinnedCard(conversation.messages);
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createLocalConversationId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `conversation-${randomUuid.slice(0, 8)}`;
  }

  const randomPart = Math.random().toString(36).slice(2, 10);
  const timePart = Date.now().toString(36).slice(-4);
  return `conversation-${randomPart}${timePart}`;
}

interface ConversationState {
  summary: ChatConversationSummary;
  messages: ChatTimelineMessage[];
  activeRunId: string | null;
  phase: RunPhase;
  pinnedTodoInput: unknown | null;
  customTitle: boolean;
  loaded: boolean;
  hasHadMessages: boolean;
  persisted: boolean;
  persistPromise: Promise<void> | null;
}

export interface ChatTimelineServiceOptions {
  initialSnapshot?: ChatTimelineSnapshot;
  api?: ChatTimelineApi;
}

const DEFAULT_CONVERSATION_TITLE = 'New conversation';

function phaseForEvent(event: AgentEvent, current: RunPhase): RunPhase {
  if (event.type === 'thinking_delta' || event.type === 'thinking_start') return 'thinking';
  if (event.type === 'tool_use' || event.type === 'tool_result') return 'working';
  if (event.type === 'text_delta') return 'streaming';
  if (event.type === 'end') return phaseForRunStatus(event.status);
  if (event.type === 'error') return 'failed';
  if (event.type !== 'status') return current;

  if (isRunPhase(event.label)) return event.label;
  return current;
}

function phaseForRunStatus(status: RunStatus): RunPhase {
  if (status === 'running') return 'streaming';
  return status;
}

function isRunPhase(value: string): value is RunPhase {
  return (
    value === 'idle' ||
    value === 'queued' ||
    value === 'initializing' ||
    value === 'requesting' ||
    value === 'thinking' ||
    value === 'working' ||
    value === 'streaming' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'canceled'
  );
}

function appendSyntheticEndEvent(events: AgentEvent[], status: RunStatus): AgentEvent[] {
  if (events.some((event) => event.type === 'end')) return events;
  return [...events, { type: 'end', code: status === 'succeeded' ? 0 : null, signal: null, status }];
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  return [...items.slice(0, index), value, ...items.slice(index + 1)];
}

function cloneSnapshot(snapshot: ChatTimelineSnapshot): ChatTimelineSnapshot {
  return {
    conversations: snapshot.conversations.map((conversation) => ({ ...conversation })),
    activeConversationId: snapshot.activeConversationId,
    activeConversationTitle: snapshot.activeConversationTitle,
    messages: snapshot.messages.map(cloneMessage),
    activeRunId: snapshot.activeRunId,
    phase: snapshot.phase,
    pinnedTodoInput: cloneValue(snapshot.pinnedTodoInput),
  };
}

function cloneMessage(message: ChatTimelineMessage): ChatTimelineMessage {
  return {
    ...message,
    attachments: message.attachments ? cloneAttachments(message.attachments) : undefined,
    commentAttachments: message.commentAttachments ? cloneValue(message.commentAttachments) : undefined,
    context: message.context ? cloneValue(message.context) : undefined,
    events: cloneValue(message.events),
    blocks: cloneBlocks(message.blocks),
  };
}

function normalizeInitialMessage(message: ChatTimelineMessage): ChatTimelineMessage {
  const cloned = cloneMessage(message);
  if (cloned.role !== 'assistant' || cloned.events.length === 0) return cloned;
  return {
    ...cloned,
    blocks: buildMessageBlocks(cloned.events),
  };
}

function restoredActiveRunId(messages: ChatTimelineMessage[]): string | null {
  return (
    messages.find((message) => message.role === 'assistant' && message.runStatus === 'running' && message.runId)?.runId ??
    null
  );
}

function restoredPhase(phase: RunPhase, activeRunId: string | null): RunPhase {
  return activeRunId && phase === 'idle' ? 'streaming' : phase;
}

function cloneAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map((attachment) => ({ ...attachment }));
}

function cloneBlocks(blocks: MessageBlock[]): MessageBlock[] {
  return cloneValue(blocks);
}

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  try {
    return structuredClone(value);
  } catch {
    return Array.isArray(value) ? ([...value] as T) : ({ ...(value as object) } as T);
  }
}

function normalizeConversationTitle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveConversationTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return DEFAULT_CONVERSATION_TITLE;
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}
