import { createDecorator } from '@tutti-os/infra/di';
import type { ChatSessionSnapshot, SendTurnInput } from './chat-session-types';

export interface IChatSessionService {
  readonly _serviceBrand: undefined;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChatSessionSnapshot;
  sendTurn(input: SendTurnInput): Promise<void>;
  deleteQueuedTurn(queueId: string): void;
  sendQueuedTurnNext(queueId: string): Promise<void>;
  stopActiveRun(): Promise<void>;
  answerToolQuestion(toolUseId: string, content: string): Promise<void>;
}

export const IChatSessionService =
  createDecorator<IChatSessionService>('chat-session-service');
