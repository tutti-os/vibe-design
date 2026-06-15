import type { AgentEvent, CanvasCommentAttachment, ChatAttachment, ChatMessageContext, RunContextSelection, RunStatus } from '../../types';

export interface CreateRunInput {
  projectId: string;
  conversationId?: string;
  agentId?: string;
  model?: string;
  prompt: string;
  attachments?: ChatAttachment[];
  commentAttachments?: CanvasCommentAttachment[];
  context?: RunContextSelection;
  messageContext?: ChatMessageContext;
}

export interface CreateRunResult {
  runId: string;
  provider?: string | null;
}

export interface IDisposable {
  dispose(): void;
}

export interface RunStreamHandlers {
  onEvent(event: AgentEvent): void;
  onEnd(status: RunStatus): void;
  onError(error: Error): void;
}

export interface RunApi {
  createRun(input: CreateRunInput): Promise<CreateRunResult>;
  streamRun(runId: string, handlers: RunStreamHandlers, lastEventId?: number | string | null): IDisposable;
  stopRun(runId: string): Promise<void>;
  submitToolResult(runId: string, toolUseId: string, content: string): Promise<void>;
}
