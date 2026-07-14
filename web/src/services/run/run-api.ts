import type { CreateRunInput, CreateRunResult, IDisposable, RunApi, RunStreamHandlers } from './run-types';
import { createSseParseState, parseSseChunkLines } from './internal/sse-parser';

export class FetchRunApi implements RunApi {
  async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    const fetchApi = getFetchApi();
    const response = await fetchApi('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || typeof data?.runId !== 'string') {
      throw new Error(readErrorMessage(data, 'Could not create run.'));
    }

    return {
      runId: data.runId,
      ...(typeof data.agentTargetId === 'string' ? { agentTargetId: data.agentTargetId } : {}),
      ...(typeof data.provider === 'string' ? { provider: data.provider } : {}),
    };
  }

  streamRun(runId: string, handlers: RunStreamHandlers, lastEventId: number | string | null = null): IDisposable {
    const controller = new AbortController();
    void streamRunWithFetch(runId, handlers, lastEventId, controller.signal);
    return { dispose: () => controller.abort() };
  }

  async stopRun(runId: string): Promise<void> {
    const response = await getFetchApi()(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    await assertOk(response, 'Could not stop run.');
  }

  async submitToolResult(runId: string, toolUseId: string, content: string): Promise<void> {
    const response = await getFetchApi()(`/api/runs/${encodeURIComponent(runId)}/tool-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolUseId, content }),
    });
    await assertOk(response, 'Could not submit tool result.');
  }
}

async function streamRunWithFetch(
  runId: string,
  handlers: RunStreamHandlers,
  lastEventId: number | string | null,
  signal: AbortSignal,
): Promise<void> {
  let sawTerminalEnd = false;

  try {
    const response = await getFetchApi()(buildRunStreamUrl(runId, lastEventId), {
      method: 'GET',
      signal,
      ...(lastEventId === null
        ? {}
        : { headers: { 'Last-Event-ID': String(lastEventId) } }),
    });
    if (!response.ok || !response.body) {
      throw new Error(await readResponseError(response, 'Could not stream run.'));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state = createSseParseState();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      const events = parseSseChunkLines(state, decoder.decode(value, { stream: true }));
      for (const event of events) {
        handlers.onEvent(event);
        if (event.type === 'end') {
          sawTerminalEnd = true;
          handlers.onEnd(event.status);
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
    }

    const trailingEvents = parseSseChunkLines(state, `${decoder.decode()}\n\n`);
    for (const event of trailingEvents) {
      handlers.onEvent(event);
      if (event.type === 'end') {
        sawTerminalEnd = true;
        handlers.onEnd(event.status);
        return;
      }
    }

    if (!sawTerminalEnd) {
      handlers.onError(new Error('Run stream ended before terminal end event.'));
    }
  } catch (error) {
    if (sawTerminalEnd) {
      return;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    handlers.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

function getFetchApi(): typeof fetch {
  if (typeof fetch !== 'function') {
    throw new Error('Browser request API is unavailable.');
  }
  return fetch;
}

function buildRunStreamUrl(runId: string, lastEventId: number | string | null): string {
  const url = `/api/runs/${encodeURIComponent(runId)}/events`;
  if (lastEventId === null) {
    return url;
  }
  return `${url}?after=${encodeURIComponent(String(lastEventId))}`;
}

async function assertOk(response: Response, fallbackMessage: string): Promise<void> {
  if (!response.ok) {
    throw new Error(await readResponseError(response, fallbackMessage));
  }
}

async function readResponseError(response: Response, fallbackMessage: string): Promise<string> {
  const data = await response.json().catch(() => null);
  return readErrorMessage(data, fallbackMessage);
}

function readErrorMessage(data: unknown, fallbackMessage: string): string {
  if (!isObject(data)) {
    return fallbackMessage;
  }

  const nestedError = isObject(data.error) ? data.error : null;
  if (typeof nestedError?.message === 'string' && nestedError.message.trim()) {
    return nestedError.message;
  }

  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }

  return fallbackMessage;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
