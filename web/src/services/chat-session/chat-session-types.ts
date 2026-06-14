import type { CanvasCommentAttachment, ChatAttachment, ChatMessageContext } from '../../types';

export interface SendTurnInput {
  draft: string;
  displayDraft?: string;
  files: File[];
  attachments?: ChatAttachment[];
  agentId?: string;
  commentAttachments?: CanvasCommentAttachment[];
}

export interface QueuedTurnPreview {
  id: string;
  content: string;
  prompt?: string;
  conversationId: string | null;
  attachments: ChatAttachment[];
  commentAttachments: CanvasCommentAttachment[];
  messageContext?: ChatMessageContext;
}

export interface ChatSessionSnapshot {
  startingRun: boolean;
  queuedTurns: QueuedTurnPreview[];
}
