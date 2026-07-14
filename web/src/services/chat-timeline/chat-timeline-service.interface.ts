import { createDecorator } from '@tutti-os/infra/di';
import type { AgentEvent, ChatMessage } from '../../types';
import type {
  AppendUserMessageInput,
  ChatConversationSummary,
  ChatTimelineSnapshot,
  FinishRunInput,
  SetConversationAgentInput,
  SetUserMessageTurnStatusInput,
  StartAssistantRunInput,
} from './chat-timeline-types';

export interface IChatTimelineService {
  readonly _serviceBrand: undefined;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChatTimelineSnapshot;
  createConversation(title?: string): ChatConversationSummary;
  ensureConversationPersisted(conversationId: string): Promise<void>;
  selectConversation(conversationId: string): void;
  renameConversation(conversationId: string, title: string): void;
  deleteConversation(conversationId: string): void;
  appendUserMessage(input: AppendUserMessageInput): ChatMessage;
  removeMessage(messageId: string): void;
  setConversationAgent(input: SetConversationAgentInput): void;
  setUserMessageTurnStatus(input: SetUserMessageTurnStatusInput): void;
  startAssistantRun(input: StartAssistantRunInput): ChatMessage;
  applyAgentEvent(runId: string, event: AgentEvent): void;
  finishRun(runId: string, input: FinishRunInput): void;
}

export const IChatTimelineService =
  createDecorator<IChatTimelineService>('chat-timeline-service');
