import { randomUUID } from 'node:crypto';
import type { EventRecord, RunStatus } from './types/run.js';
import type { ChatRun } from './types/run.js';
import { materializeArtifactRunEvent } from './artifact-materializer.js';
import {
  appendRunEventToMessageInStore,
  bindConversationAgentTargetInStore,
  createConversationInStore,
  deleteConversationFromStore,
  type DeleteConversationFromStoreResult,
  getFirstConversationFromStore,
  listConversationMessagesFromStore,
  listConversationsFromStore,
  upsertMessageInStore,
  updateConversationResumeMetadataInStore,
  updateConversationTitleInStore,
  type StoredConversation,
  type StoredConversationMessage,
} from './sqlite-store.js';

export type ConversationMessageRole = 'user' | 'assistant';
export type { StoredConversation, StoredConversationMessage };

const STREAM_AGENT_EVENT_TYPES = new Set([
  'text_delta',
  'thinking_delta',
  'thinking_start',
  'tool_use',
  'tool_result',
  'usage',
  'turn_end',
  'raw',
]);

interface UpsertMessageInput {
  id: string;
  role: ConversationMessageRole;
  content?: string;
  attachments?: unknown[];
  commentAttachments?: unknown[];
  context?: unknown | null;
  events?: unknown[];
  runId?: string | null;
  runStatus?: RunStatus | null;
  startedAt?: number | null;
  endedAt?: number | null;
}

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function createConversationId(): string {
  return `conversation-${randomUUID().slice(0, 8)}`;
}

export function createAssistantMessageId(): string {
  return `assistant-${randomUUID().slice(0, 8)}`;
}

export function createUserMessageId(): string {
  return `user-${randomUUID().slice(0, 8)}`;
}

export function createInitialUserMessageId(): string {
  return 'initial-user-message';
}

export function isSafeConversationId(id: string): boolean {
  return id.length >= 1 && id.length <= 128 && CONVERSATION_ID_PATTERN.test(id) && !/^\.+$/.test(id);
}

export async function ensureDefaultConversation(
  projectsDir: string,
  projectId: string,
  title: string | null = null,
): Promise<StoredConversation> {
  const existing = getFirstConversationFromStore(projectsDir, projectId);
  if (existing) {
    return existing;
  }

  return createConversationInStore(projectsDir, projectId, createConversationId(), title);
}

export async function listConversations(projectsDir: string, projectId: string): Promise<StoredConversation[]> {
  return listConversationsFromStore(projectsDir, projectId);
}

export async function createConversation(
  projectsDir: string,
  projectId: string,
  title: string | null = null,
  id = createConversationId(),
): Promise<StoredConversation> {
  return createConversationInStore(projectsDir, projectId, id, title);
}

export async function bindConversationAgentTarget(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  agentTargetId: string,
  provider: string,
  model?: string | null,
): Promise<StoredConversation | null> {
  return bindConversationAgentTargetInStore(
    projectsDir,
    projectId,
    conversationId,
    agentTargetId,
    provider,
    model,
  );
}

export async function updateConversationResumeMetadata(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  input: {
    providerSessionId?: string | null;
    resumeToken?: string | null;
    agentTargetId?: string | null;
    provider?: string | null;
  },
): Promise<StoredConversation | null> {
  return updateConversationResumeMetadataInStore(projectsDir, projectId, conversationId, input);
}

export async function renameConversation(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  title: string | null,
): Promise<StoredConversation | null> {
  return updateConversationTitleInStore(projectsDir, projectId, conversationId, title);
}

export async function deleteConversation(
  projectsDir: string,
  projectId: string,
  conversationId: string,
): Promise<DeleteConversationFromStoreResult> {
  return deleteConversationFromStore(projectsDir, projectId, conversationId);
}

export async function listConversationMessages(
  projectsDir: string,
  projectId: string,
  conversationId: string,
): Promise<StoredConversationMessage[] | null> {
  return listConversationMessagesFromStore(projectsDir, projectId, conversationId);
}

export async function upsertConversationMessage(
  projectsDir: string,
  projectId: string,
  conversationId: string,
  input: UpsertMessageInput,
): Promise<StoredConversationMessage> {
  return upsertMessageInStore(projectsDir, projectId, conversationId, input);
}

export async function persistRunEventToConversation(
  projectsDir: string,
  run: ChatRun,
  record: EventRecord,
): Promise<void> {
  if (!run.projectId || !run.conversationId || !run.assistantMessageId) {
    return;
  }

  const event = conversationEventFromRunRecord(record);
  if (!event) {
    return;
  }

  appendRunEventToMessageInStore(
    projectsDir,
    run.projectId,
    run.conversationId,
    run.assistantMessageId,
    event,
    record.timestamp,
  );
  materializeArtifactRunEvent(projectsDir, run, event);
}

function conversationEventFromRunRecord(record: EventRecord): unknown | null {
  if (record.event === 'agent') {
    return isRecord(record.data) ? { ...record.data, eventId: record.id } : record.data;
  }

  if (STREAM_AGENT_EVENT_TYPES.has(record.event) && isRecord(record.data)) {
    return { ...record.data, type: record.event, eventId: record.id };
  }

  if (record.event === 'end' && isRecord(record.data)) {
    const status = isRunStatus(record.data.status) ? record.data.status : 'failed';
    return { type: 'end', eventId: record.id, status };
  }

  if (record.event === 'error') {
    return { type: 'error', eventId: record.id, error: record.data };
  }

  if (record.event === 'status' && isRecord(record.data) && typeof record.data.label === 'string') {
    return { type: 'status', eventId: record.id, label: record.data.label };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'canceled';
}
