import type { IRunService } from '../run-service.interface';
import type { CreateRunInput, CreateRunResult, IDisposable, RunApi, RunStreamHandlers } from '../run-types';

export class RunService implements IRunService {
  readonly _serviceBrand = undefined;

  constructor(private readonly api: RunApi) {}

  createRun(input: CreateRunInput): Promise<CreateRunResult> {
    return this.api.createRun(input);
  }

  streamRun(runId: string, handlers: RunStreamHandlers, lastEventId?: number | string | null): IDisposable {
    let disposed = false;
    let currentStream: IDisposable | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let cursor = lastEventId ?? null;

    const clearReconnectTimer = (): void => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const disposeCurrentStream = (): void => {
      currentStream?.dispose();
      currentStream = null;
    };

    const connect = (): void => {
      if (disposed) return;
      disposeCurrentStream();
      currentStream = this.api.streamRun(
        runId,
        {
          onEvent: (event) => {
            const eventId = 'eventId' in event ? event.eventId : null;
            if (eventId !== undefined && eventId !== null) {
              cursor = eventId;
            }
            reconnectAttempt = 0;
            handlers.onEvent(event);
          },
          onEnd: (status) => {
            disposed = true;
            clearReconnectTimer();
            disposeCurrentStream();
            handlers.onEnd(status);
          },
          onError: (error) => {
            if (disposed) return;
            reconnectAttempt += 1;
            const delayMs = reconnectDelayMs(reconnectAttempt);
            clearReconnectTimer();
            reconnectTimer = setTimeout(connect, delayMs);
            if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
              disposed = true;
              clearReconnectTimer();
              disposeCurrentStream();
              handlers.onError(error);
            }
          },
        },
        cursor,
      );
    };

    connect();

    return {
      dispose: () => {
        disposed = true;
        clearReconnectTimer();
        disposeCurrentStream();
      },
    };
  }

  stopRun(runId: string): Promise<void> {
    return this.api.stopRun(runId);
  }

  submitToolResult(runId: string, toolUseId: string, content: string): Promise<void> {
    return this.api.submitToolResult(runId, toolUseId, content);
  }
}

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 4_000;

function reconnectDelayMs(attempt: number): number {
  return Math.min(MAX_RECONNECT_DELAY_MS, INITIAL_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}
