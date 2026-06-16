import type { AgentEvent } from '../../types';
import { buildMessageBlocks } from './internal/message-blocks';
import type { ChatConversationSummary, ChatTimelineMessage } from './chat-timeline-types';

type MessageContextSkill = NonNullable<NonNullable<ChatTimelineMessage['context']>['selectedSkills']>[number];
type MessageContextDesignFile = NonNullable<NonNullable<ChatTimelineMessage['context']>['selectedDesignFiles']>[number];

export interface ChatTimelineApi {
  createConversation(input: { id: string; title?: string }): Promise<ChatConversationSummary>;
  renameConversation(conversationId: string, title: string): Promise<ChatConversationSummary>;
  deleteConversation(conversationId: string): Promise<void>;
  listMessages(conversationId: string): Promise<ChatTimelineMessage[]>;
}

export class FetchChatTimelineApi implements ChatTimelineApi {
  constructor(private readonly projectId: string | null = null) {}

  async createConversation(input: { id: string; title?: string }): Promise<ChatConversationSummary> {
    if (!this.projectId) throw new Error('Could not create conversation.');
    const response = await fetch(`/api/projects/${encodeURIComponent(this.projectId)}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readErrorMessage(data, 'Could not create conversation.'));
    return readConversation(data) ?? fallbackConversation(input.id, input.title);
  }

  async renameConversation(conversationId: string, title: string): Promise<ChatConversationSummary> {
    if (!this.projectId) throw new Error('Could not rename conversation.');
    const response = await fetch(
      `/api/projects/${encodeURIComponent(this.projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readErrorMessage(data, 'Could not rename conversation.'));
    return readConversation(data) ?? fallbackConversation(conversationId, title);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (!this.projectId) throw new Error('Could not delete conversation.');
    const response = await fetch(
      `/api/projects/${encodeURIComponent(this.projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readErrorMessage(data, 'Could not delete conversation.'));
  }

  async listMessages(conversationId: string): Promise<ChatTimelineMessage[]> {
    if (!this.projectId) return [];
    const response = await fetch(
      `/api/projects/${encodeURIComponent(this.projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readErrorMessage(data, 'Could not list conversation messages.'));
    const rows = isObject(data) && Array.isArray(data.messages) ? data.messages : [];
    return rows.flatMap((row) => {
      const message = readMessage(row);
      return message ? [message] : [];
    });
  }
}

function readConversation(data: unknown): ChatConversationSummary | null {
  const value = isObject(data) && isObject(data.conversation) ? data.conversation : data;
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }

  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title.trim() ? value.title : 'New conversation',
    provider: typeof value.provider === 'string' && value.provider.trim() ? value.provider : null,
    model: typeof value.model === 'string' && value.model.trim() ? value.model : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readMessage(value: unknown): ChatTimelineMessage | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.role !== 'string' || typeof value.content !== 'string') {
    return null;
  }
  if (value.role !== 'user' && value.role !== 'assistant') return null;

  const events = Array.isArray(value.events) ? (value.events as AgentEvent[]) : [];
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    commentAttachments: Array.isArray(value.commentAttachments) ? value.commentAttachments : [],
    context: readMessageContext(value.context),
    events,
    blocks: buildMessageBlocks(events),
    runId: typeof value.runId === 'string' ? value.runId : undefined,
    runStatus: isRunStatus(value.runStatus) ? value.runStatus : undefined,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : undefined,
    startedAt: typeof value.startedAt === 'number' ? value.startedAt : undefined,
    endedAt: typeof value.endedAt === 'number' ? value.endedAt : undefined,
  };
}

function readMessageContext(value: unknown): ChatTimelineMessage['context'] | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const selectedSkills = readMessageContextSkills(value.selectedSkills);
  const selectedDesignFiles = readMessageContextDesignFiles(value.selectedDesignFiles);
  if (selectedSkills.length === 0 && selectedDesignFiles.length === 0) {
    return undefined;
  }

  return {
    ...(selectedSkills.length > 0 ? { selectedSkills } : {}),
    ...(selectedDesignFiles.length > 0 ? { selectedDesignFiles } : {}),
  };
}

function readMessageContextSkills(value: unknown): MessageContextSkill[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((skill) => {
    if (!isObject(skill) || typeof skill.id !== 'string' || typeof skill.name !== 'string') {
      return [];
    }
    return [{
      id: skill.id,
      name: skill.name,
      ...(typeof skill.description === 'string' ? { description: skill.description } : {}),
      ...(Array.isArray(skill.triggers)
        ? { triggers: skill.triggers.filter((trigger): trigger is string => typeof trigger === 'string') }
        : {}),
    }];
  });
}

const MESSAGE_CONTEXT_FILE_KINDS = new Set([
  'html',
  'image',
  'video',
  'audio',
  'sketch',
  'text',
  'code',
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'binary',
]);

function readMessageContextDesignFiles(value: unknown): MessageContextDesignFile[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((file) => {
    if (
      !isObject(file) ||
      typeof file.name !== 'string' ||
      typeof file.kind !== 'string' ||
      typeof file.mime !== 'string' ||
      !MESSAGE_CONTEXT_FILE_KINDS.has(file.kind)
    ) {
      return [];
    }

    return [{
      ...(typeof file.id === 'string' ? { id: file.id } : {}),
      name: file.name,
      ...(typeof file.path === 'string' ? { path: file.path } : {}),
      size: typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0,
      mtime: typeof file.mtime === 'number' && Number.isFinite(file.mtime) ? file.mtime : 0,
      kind: file.kind as MessageContextDesignFile['kind'],
      mime: file.mime,
      ...(typeof file.updatedAt === 'number' && Number.isFinite(file.updatedAt) ? { updatedAt: file.updatedAt } : {}),
    }];
  });
}

function fallbackConversation(id: string, title?: string): ChatConversationSummary {
  const now = Date.now();
  return { id, title: title?.trim() || 'New conversation', provider: null, model: null, createdAt: now, updatedAt: now };
}

function readErrorMessage(data: unknown, fallbackMessage: string): string {
  if (isObject(data) && isObject(data.error) && typeof data.error.message === 'string') {
    return data.error.message;
  }
  if (isObject(data) && typeof data.message === 'string') {
    return data.message;
  }
  return fallbackMessage;
}

function isRunStatus(value: unknown): value is ChatTimelineMessage['runStatus'] {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'canceled';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
