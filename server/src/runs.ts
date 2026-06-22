import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import type {
  ChatRun,
  ChatRunCreateMeta,
  ChatRunService,
  EventRecord,
  RunStatus,
  RunStatusBody,
  SseClient,
} from './types/run.js';
import { TERMINAL_RUN_STATUSES } from './types/run.js';
import type { SseResponse } from './http/sse.js';

export interface CreateChatRunServiceOptions {
  createSseResponse: (res: Response) => SseResponse;
  createSseErrorPayload: (code: string, message: string, init?: Record<string, unknown>) => unknown;
  maxEvents?: number;
  ttlMs?: number;
  shutdownGraceMs?: number;
  runsLogDir?: string | null;
  onEvent?: (run: ChatRun, record: EventRecord) => Promise<void> | void;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractErrorDetails(data: unknown): { error: string | null; errorCode: string | null } {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const nested = payload.error && typeof payload.error === 'object'
    ? (payload.error as Record<string, unknown>)
    : {};

  return {
    error: readString(nested.message) ?? readString(payload.message),
    errorCode: readString(nested.code) ?? readString(payload.code),
  };
}

function normalizeEventLimit(value: number | undefined): number {
  if (value === undefined) {
    return 2_000;
  }

  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 2_000;
}

function queryString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return null;
}

function parseEventCursor(value: unknown): number {
  const raw = queryString(value) ?? readString(value);
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isChildLive(child: ChildProcess | null): child is ChildProcess {
  return child !== null && child.exitCode === null && child.signalCode === null;
}

function safeEndLogStream(stream: NodeJS.WritableStream | null): void {
  if (!stream) {
    return;
  }

  try {
    stream.end();
  } catch {
    // Best-effort run logging should never affect run lifecycle handling.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export function createChatRunService(options: CreateChatRunServiceOptions): ChatRunService {
  const {
    createSseResponse,
    createSseErrorPayload,
    ttlMs = 30 * 60 * 1000,
    shutdownGraceMs = 3_000,
    runsLogDir = null,
  } = options;
  const maxStoredEvents = normalizeEventLimit(options.maxEvents);
  const runs = new Map<string, ChatRun>();
  const cancelFallbackRunIds = new Set<string>();

  function createEventLogPath(runId: string): string | null {
    if (!runsLogDir) {
      return null;
    }

    return path.join(runsLogDir, runId, 'events.jsonl');
  }

  function ensureEventLogStream(run: ChatRun): NodeJS.WritableStream | null {
    if (!run.eventsLogPath) {
      return null;
    }

    if (run.eventsLogStream) {
      return run.eventsLogStream;
    }

    try {
      mkdirSync(path.dirname(run.eventsLogPath), { recursive: true });
      const stream = createWriteStream(run.eventsLogPath, { flags: 'a' });
      stream.on('error', () => {
        if (run.eventsLogStream === stream) {
          try {
            stream.destroy();
          } catch {
            // Ignore stream cleanup errors; logging is best-effort.
          }
          run.eventsLogStream = null;
        }
      });
      run.eventsLogStream = stream;
      return stream;
    } catch {
      return null;
    }
  }

  function create(meta: ChatRunCreateMeta = {}): ChatRun {
    const id = randomUUID();
    const now = Date.now();
    const run: ChatRun = {
      id,
      projectId: readString(meta.projectId),
      conversationId: readString(meta.conversationId),
      assistantMessageId: readString(meta.assistantMessageId),
      clientRequestId: readString(meta.clientRequestId),
      agentId: readString(meta.agentId),
      providerSessionId: readString(meta.providerSessionId),
      resumeToken: readString(meta.resumeToken),
      managedAgentInvocationCredential: readString(meta.managedAgentInvocationCredential),
      appliedPluginSnapshotId: readString(meta.appliedPluginSnapshotId),
      pluginId: readString(meta.pluginId),
      mediaExecution: meta.mediaExecution ?? null,
      toolBundle: meta.toolBundle ?? null,
      managedAgentInvocationCredential: readString(meta.managedAgentInvocationCredential),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      events: [],
      nextEventId: 1,
      clients: new Set<SseClient>(),
      waiters: new Set<(body: RunStatusBody) => void>(),
      child: null,
      acpSession: null,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      cancelRequested: false,
      eventsLogPath: createEventLogPath(id),
      eventsLogStream: null,
      pendingHostAnswers: new Set<string>(),
      stdinOpen: false,
    };

    runs.set(id, run);
    return run;
  }

  function get(id: string): ChatRun | null {
    return runs.get(id) ?? null;
  }

  function list(filter: { projectId?: unknown; conversationId?: unknown; status?: unknown } = {}): ChatRun[] {
    const projectId = readString(filter.projectId);
    const conversationId = readString(filter.conversationId);
    const status = typeof filter.status === 'string' ? filter.status : null;

    return Array.from(runs.values()).filter((run) => {
      if (projectId !== null && run.projectId !== projectId) {
        return false;
      }

      if (conversationId !== null && run.conversationId !== conversationId) {
        return false;
      }

      if (status === 'active' && isTerminal(run.status)) {
        return false;
      }

      if (status !== null && status !== 'active' && run.status !== status) {
        return false;
      }

      return true;
    });
  }

  function statusBody(run: ChatRun): RunStatusBody {
    return {
      id: run.id,
      projectId: run.projectId,
      conversationId: run.conversationId,
      assistantMessageId: run.assistantMessageId,
      agentId: run.agentId,
      providerSessionId: run.providerSessionId,
      resumeToken: run.resumeToken,
      appliedPluginSnapshotId: run.appliedPluginSnapshotId,
      pluginId: run.pluginId,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      exitCode: run.exitCode,
      signal: run.signal,
      error: run.error,
      errorCode: run.errorCode,
      eventsLogPath: run.eventsLogPath,
      mediaExecution: run.mediaExecution,
      toolBundle: run.toolBundle,
    };
  }

  function writeEventLog(run: ChatRun, record: EventRecord): void {
    const stream = ensureEventLogStream(run);
    if (!stream) {
      return;
    }

    try {
      stream.write(`${JSON.stringify(record)}\n`);
    } catch {
      run.eventsLogStream = null;
    }
  }

  function removeClient(run: ChatRun, client: SseClient): void {
    run.clients.delete(client);
    client.cleanup();
  }

  function emit(run: ChatRun, event: string, data: unknown): EventRecord {
    const timestamp = Date.now();
    const record: EventRecord = {
      id: run.nextEventId,
      event,
      data,
      timestamp,
    };
    run.nextEventId += 1;
    run.updatedAt = timestamp;
    run.events.push(record);

    if (maxStoredEvents === 0) {
      run.events.length = 0;
    } else if (run.events.length > maxStoredEvents) {
      run.events.splice(0, run.events.length - maxStoredEvents);
    }

    if (event === 'error') {
      const details = extractErrorDetails(data);
      run.error = details.error;
      run.errorCode = details.errorCode;
    }

    writeEventLog(run, record);
    try {
      Promise.resolve(options.onEvent?.(run, record)).catch(() => undefined);
    } catch {
      // Conversation persistence is best-effort and must not affect live streaming.
    }

    for (const client of Array.from(run.clients)) {
      try {
        if (!client.send(event, data, record.id)) {
          removeClient(run, client);
        }
      } catch {
        removeClient(run, client);
      }
    }

    return record;
  }

  function stream(run: ChatRun, req: Request, res: Response): void {
    const lastEventId = req.get('last-event-id');
    const cursor = parseEventCursor(lastEventId ?? req.query.after);
    const client = createSseResponse(res);
    let replayed = false;

    for (const record of run.events) {
      if (record.id <= cursor) {
        continue;
      }

      replayed = true;
      if (!client.send(record.event, record.data, record.id)) {
        client.end();
        return;
      }
    }

    if (isTerminal(run.status)) {
      if (!replayed) {
        const last = run.events.at(-1);
        if (last) {
          client.send(last.event, last.data, last.id);
        }
      }

      client.end();
      return;
    }

    const cleanup = () => {
      res.off('close', cleanup);
      res.off('finish', cleanup);
      removeClient(run, client);
    };

    run.clients.add(client);
    res.on('close', cleanup);
    res.on('finish', cleanup);
  }

  function resolveWaiters(run: ChatRun): void {
    const body = statusBody(run);
    for (const waiter of run.waiters) {
      waiter(body);
    }
    run.waiters.clear();
  }

  function closeClients(run: ChatRun): void {
    for (const client of Array.from(run.clients)) {
      client.end();
    }
    run.clients.clear();
  }

  function scheduleTtlCleanup(run: ChatRun): void {
    if (ttlMs <= 0) {
      if (runs.get(run.id) === run) {
        runs.delete(run.id);
      }
      return;
    }

    const timer = setTimeout(() => {
      if (runs.get(run.id) === run && isTerminal(run.status)) {
        runs.delete(run.id);
      }
    }, ttlMs);
    timer.unref?.();
  }

  function finish(run: ChatRun, status: RunStatus, code: number | null = null, signal: string | null = null): void {
    if (isTerminal(run.status)) {
      return;
    }

    run.status = status;
    run.exitCode = code;
    run.signal = signal;
    emit(run, 'end', { code: run.exitCode, signal: run.signal, status: run.status });
    closeClients(run);
    resolveWaiters(run);
    safeEndLogStream(run.eventsLogStream);
    run.eventsLogStream = null;
    scheduleTtlCleanup(run);
  }

  function fail(run: ChatRun, code: string, message: string, init?: Record<string, unknown>): void {
    if (isTerminal(run.status)) {
      return;
    }

    emit(run, 'error', createSseErrorPayload(code, message, init));
    finish(run, 'failed');
  }

  function start(run: ChatRun, starter: (run: ChatRun) => Promise<void> | void): ChatRun {
    if (isTerminal(run.status)) {
      return run;
    }

    run.status = 'running';
    run.updatedAt = Date.now();

    try {
      Promise.resolve(starter(run)).catch((error: unknown) => {
        fail(run, 'RUN_START_FAILED', error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      fail(run, 'RUN_START_FAILED', error instanceof Error ? error.message : String(error));
    }

    return run;
  }

  function abortRunSession(run: ChatRun): void {
    const abort = run.acpSession?.abort;
    if (!abort) {
      return;
    }

    try {
      Promise.resolve(abort()).catch(() => undefined);
    } catch {
      // Abort is best-effort during cancellation.
    }
  }

  function killChild(child: ChildProcess, signal: NodeJS.Signals): void {
    try {
      child.kill(signal);
    } catch {
      // Process termination is best-effort; lifecycle state is handled separately.
    }
  }

  function scheduleCancelFallback(run: ChatRun): void {
    if (cancelFallbackRunIds.has(run.id)) {
      return;
    }

    cancelFallbackRunIds.add(run.id);
    const timer = setTimeout(() => {
      cancelFallbackRunIds.delete(run.id);
      if (isTerminal(run.status)) {
        return;
      }

      if (isChildLive(run.child)) {
        killChild(run.child, 'SIGKILL');
        finish(run, 'canceled', null, 'SIGKILL');
        return;
      }

      finish(run, 'canceled', null, 'SIGTERM');
    }, shutdownGraceMs);
    timer.unref?.();
  }

  function cancel(run: ChatRun): void {
    if (isTerminal(run.status)) {
      return;
    }

    run.cancelRequested = true;
    abortRunSession(run);

    if (isChildLive(run.child)) {
      killChild(run.child, 'SIGTERM');
      scheduleCancelFallback(run);
      return;
    }

    finish(run, 'canceled', null, 'SIGTERM');
  }

  async function shutdownActive(options: { graceMs?: number } = {}): Promise<void> {
    const activeRuns = Array.from(runs.values()).filter((run) => !isTerminal(run.status));
    const liveChildren: ChildProcess[] = [];

    for (const run of activeRuns) {
      run.cancelRequested = true;
      abortRunSession(run);

      if (isChildLive(run.child)) {
        liveChildren.push(run.child);
        killChild(run.child, 'SIGTERM');
      }

      finish(run, 'canceled');
    }

    await sleep(options.graceMs ?? shutdownGraceMs);

    for (const child of liveChildren) {
      if (isChildLive(child)) {
        killChild(child, 'SIGKILL');
      }
    }
  }

  function wait(run: ChatRun): Promise<RunStatusBody> {
    if (isTerminal(run.status)) {
      return Promise.resolve(statusBody(run));
    }

    return new Promise((resolve) => {
      run.waiters.add(resolve);
    });
  }

  function drop(run: ChatRun | null | undefined): void {
    if (!run || runs.get(run.id) !== run) {
      return;
    }

    runs.delete(run.id);
    if (!isTerminal(run.status)) {
      run.status = 'canceled';
      run.updatedAt = Date.now();
    }
    closeClients(run);
    resolveWaiters(run);
    safeEndLogStream(run.eventsLogStream);
    run.eventsLogStream = null;
  }

  function isTerminal(status: unknown): status is RunStatus {
    return TERMINAL_RUN_STATUSES.has(status as RunStatus);
  }

  return {
    create,
    start,
    get,
    list,
    stream,
    cancel,
    shutdownActive,
    wait,
    emit,
    finish,
    fail,
    drop,
    statusBody,
    isTerminal,
  };
}
