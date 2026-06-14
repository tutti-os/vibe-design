import type { AgentEvent, CanvasCommentAttachment, ChatAttachment, ChatMessage, ChatMessageContext, RunPhase, RunStatus } from '../../types';
import type { FileOpEntry } from '../../runtime/file-ops';
import type { QuestionFormDefinition } from '../../runtime/question-form';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export type AskUserQuestionInput = Record<string, unknown>;

export interface GeneratedFileEntry {
  name: string;
  artifactType?: string;
  title?: string;
}

export type MessageBlock =
  | { kind: 'text'; content: string; markdown: boolean }
  | { kind: 'thinking'; content: string }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'tool-group'; calls: ToolCall[]; results: ToolResult[]; running?: boolean }
  | { kind: 'file-ops'; ops: FileOpEntry[] }
  | { kind: 'generated-files'; files: GeneratedFileEntry[] }
  | { kind: 'ask-user-question'; toolUseId: string; input: AskUserQuestionInput }
  | { kind: 'question-form'; form: QuestionFormDefinition }
  | { kind: 'todo-write'; toolUseId: string; input: unknown };

export interface ChatTimelineMessage extends ChatMessage {
  events: AgentEvent[];
  blocks: MessageBlock[];
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  provider?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatTimelineSnapshot {
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  activeConversationTitle: string;
  messages: ChatTimelineMessage[];
  activeRunId: string | null;
  phase: RunPhase;
  pinnedTodoInput: unknown | null;
}

export interface AppendUserMessageInput {
  content: string;
  attachments?: ChatAttachment[];
  commentAttachments?: CanvasCommentAttachment[];
  context?: ChatMessageContext;
  conversationId?: string | null;
}

export interface SetUserMessageTurnStatusInput {
  messageId: string;
  turnStatus: 'queued' | null;
}

export interface SetConversationProviderInput {
  conversationId: string;
  provider: string;
}

export interface StartAssistantRunInput {
  runId: string;
  conversationId?: string | null;
}

export interface FinishRunInput {
  status: RunStatus;
}
