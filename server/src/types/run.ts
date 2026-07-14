import type { ChildProcess } from 'node:child_process';
import type { Request, Response } from 'express';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'canceled']);

export interface SseClient {
  send(event: string, data: unknown, id?: string | number | null): boolean;
  end(): void;
  cleanup(): void;
}

export interface EventRecord {
  id: number;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface ChatRun {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  assistantMessageId: string | null;
  clientRequestId: string | null;
  agentTargetId: string | null;
  provider: string | null;
  /** @deprecated Internal test compatibility; runtime selection uses agentTargetId. */
  agentId: string | null;
  providerSessionId: string | null;
  resumeToken: string | null;
  appliedPluginSnapshotId: string | null;
  pluginId: string | null;
  mediaExecution: unknown;
  toolBundle: unknown;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  events: EventRecord[];
  nextEventId: number;
  clients: Set<SseClient>;
  waiters: Set<(body: RunStatusBody) => void>;
  child: ChildProcess | null;
  acpSession: { abort?: () => void | Promise<void> } | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  errorCode: string | null;
  cancelRequested: boolean;
  eventsLogPath: string | null;
  eventsLogStream: NodeJS.WritableStream | null;
  pendingHostAnswers: Set<string>;
  stdinOpen: boolean;
}

export interface ChatRunCreateMeta {
  projectId?: unknown;
  conversationId?: unknown;
  assistantMessageId?: unknown;
  clientRequestId?: unknown;
  agentTargetId?: unknown;
  provider?: unknown;
  /** @deprecated Internal test compatibility. */
  agentId?: unknown;
  providerSessionId?: unknown;
  resumeToken?: unknown;
  appliedPluginSnapshotId?: unknown;
  pluginId?: unknown;
  mediaExecution?: unknown;
  toolBundle?: unknown;
}

export interface RunStatusBody {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  assistantMessageId: string | null;
  agentTargetId: string | null;
  provider: string | null;
  providerSessionId: string | null;
  resumeToken: string | null;
  appliedPluginSnapshotId: string | null;
  pluginId: string | null;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  errorCode: string | null;
  eventsLogPath: string | null;
  mediaExecution: unknown;
  toolBundle: unknown;
}

export interface ChatRunService {
  create(meta?: ChatRunCreateMeta): ChatRun;
  start(run: ChatRun, starter: (run: ChatRun) => Promise<void> | void): ChatRun;
  get(id: string): ChatRun | null;
  list(filter?: { projectId?: unknown; conversationId?: unknown; status?: unknown }): ChatRun[];
  stream(run: ChatRun, req: Request, res: Response): void;
  cancel(run: ChatRun): void;
  shutdownActive(options?: { graceMs?: number }): Promise<void>;
  wait(run: ChatRun): Promise<RunStatusBody>;
  emit(run: ChatRun, event: string, data: unknown): EventRecord;
  finish(run: ChatRun, status: RunStatus, code?: number | null, signal?: string | null): void;
  fail(run: ChatRun, code: string, message: string, init?: Record<string, unknown>): void;
  drop(run: ChatRun | null | undefined): void;
  statusBody(run: ChatRun): RunStatusBody;
  isTerminal(status: unknown): boolean;
}
