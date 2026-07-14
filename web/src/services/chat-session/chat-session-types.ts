import type { CanvasCommentAttachment, ChatAttachment, ChatMessageContext } from '../../types';

export interface SendTurnInput {
  draft: string;
  displayDraft?: string;
  files: File[];
  attachments?: ChatAttachment[];
  agentTargetId?: string;
  model?: string;
  commentAttachments?: CanvasCommentAttachment[];
}

export interface QueuedTurnPreview {
  id: string;
  content: string;
  prompt?: string;
  model?: string;
  conversationId: string | null;
  attachments: ChatAttachment[];
  commentAttachments: CanvasCommentAttachment[];
  messageContext?: ChatMessageContext;
}

export interface ChatSessionSnapshot {
  startingRun: boolean;
  queuedTurns: QueuedTurnPreview[];
}
