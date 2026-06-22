import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunStreamHandlers } from '../run-types';
import { RunService } from './run-service';

describe('RunService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delegates createRun through the API contract', async () => {
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => ({ dispose: vi.fn() })),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const service = new RunService(api);

    await expect(service.createRun({ projectId: 'demo-project', prompt: 'hello' })).resolves.toEqual({ runId: 'run-1' });

    expect(api.createRun).toHaveBeenCalledWith({ projectId: 'demo-project', prompt: 'hello' });
  });

  it('adds a managed agent credential from the bridge when creating a run', async () => {
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => ({ dispose: vi.fn() })),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const service = new RunService(api, async () => 'credential-run-1');

    await service.createRun({ projectId: 'demo-project', prompt: 'hello' });

    expect(api.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      prompt: 'hello',
      managedAgentInvocationCredential: 'credential-run-1',
    });
  });

  it('does not replace an explicit managed agent credential when creating a run', async () => {
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => ({ dispose: vi.fn() })),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const service = new RunService(api, async () => 'credential-from-bridge');

    await service.createRun({
      projectId: 'demo-project',
      prompt: 'hello',
      managedAgentInvocationCredential: 'credential-explicit',
    });

    expect(api.createRun).toHaveBeenCalledWith({
      projectId: 'demo-project',
      prompt: 'hello',
      managedAgentInvocationCredential: 'credential-explicit',
    });
  });

  it('streams through the API contract and disposes the active stream', () => {
    const disposable = { dispose: vi.fn() };
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => disposable),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const handlers = {
      onEvent: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    };
    const service = new RunService(api);

    const subscription = service.streamRun('run-1', handlers, 12);

    expect(api.streamRun).toHaveBeenCalledWith('run-1', expect.any(Object), 12);
    subscription.dispose();
    expect(disposable.dispose).toHaveBeenCalledOnce();
  });

  it('reconnects with the last event id after transient stream errors', async () => {
    vi.useFakeTimers();
    const disposables = [{ dispose: vi.fn() }, { dispose: vi.fn() }];
    const streamHandlers: RunStreamHandlers[] = [];
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn((_runId: string, handlers: RunStreamHandlers) => {
        streamHandlers.push(handlers);
        return disposables[streamHandlers.length - 1] ?? { dispose: vi.fn() };
      }),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const handlers = {
      onEvent: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    };
    const service = new RunService(api);

    service.streamRun('run-1', handlers);
    streamHandlers[0]?.onEvent({ type: 'status', eventId: 41, label: 'streaming' });
    streamHandlers[0]?.onError(new Error('disconnect'));
    await vi.advanceTimersByTimeAsync(250);

    expect(api.streamRun).toHaveBeenNthCalledWith(2, 'run-1', expect.any(Object), 41);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('surfaces stream errors after reconnect attempts are exhausted', async () => {
    vi.useFakeTimers();
    const streamHandlers: RunStreamHandlers[] = [];
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn((_runId: string, handlers: RunStreamHandlers) => {
        streamHandlers.push(handlers);
        return { dispose: vi.fn() };
      }),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const handlers = {
      onEvent: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    };
    const service = new RunService(api);

    service.streamRun('run-1', handlers);
    for (let index = 0; index < 5; index += 1) {
      streamHandlers[index]?.onError(new Error(`disconnect ${index}`));
      await vi.runOnlyPendingTimersAsync();
    }

    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disconnect 4' }));
  });

  it('delegates stopRun through the API contract', async () => {
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => ({ dispose: vi.fn() })),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const service = new RunService(api);

    await service.stopRun('run-1');

    expect(api.stopRun).toHaveBeenCalledWith('run-1');
  });

  it('delegates submitToolResult through the API contract', async () => {
    const api = {
      createRun: vi.fn(async () => ({ runId: 'run-1' })),
      streamRun: vi.fn(() => ({ dispose: vi.fn() })),
      stopRun: vi.fn(async () => undefined),
      submitToolResult: vi.fn(async () => undefined),
    };
    const service = new RunService(api);

    await service.submitToolResult('run-1', 'tool-1', 'answer');

    expect(api.submitToolResult).toHaveBeenCalledWith('run-1', 'tool-1', 'answer');
  });
});
