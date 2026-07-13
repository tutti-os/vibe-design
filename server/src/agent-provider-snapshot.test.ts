import { describe, expect, it, vi } from 'vitest';

import {
  createAgentProviderSnapshotDetector,
  type AgentProviderSnapshot,
} from './agent-provider-snapshot.js';

const PROVIDERS: AgentProviderSnapshot[] = [{
  id: 'codex',
  label: 'Codex',
  supported: true,
  authState: 'ok',
  models: [{ id: 'default', label: 'Default' }],
  defaultModelId: 'default',
}];

describe('createAgentProviderSnapshotDetector', () => {
  it('joins identical in-flight managed refreshes', async () => {
    const pending = deferred<AgentProviderSnapshot[]>();
    const detect = vi.fn(() => pending.promise);
    const snapshots = createAgentProviderSnapshotDetector(detect);
    const context = {
      cwd: '/workspace/one',
      refresh: true,
      managedAgentInvocation: { cwd: '/workspace/one', credential: 'secret-one' },
    };

    const first = snapshots.detect(context);
    const second = snapshots.detect({ ...context });

    await Promise.resolve();
    expect(detect).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    pending.resolve(PROVIDERS);
    await expect(first).resolves.toEqual(PROVIDERS);
  });

  it('separates credentials, workspaces, and refresh modes', async () => {
    const detect = vi.fn(async () => PROVIDERS);
    const snapshots = createAgentProviderSnapshotDetector(detect);
    await Promise.all([
      snapshots.detect({
        managedAgentInvocation: { cwd: '/workspace/one', credential: 'secret-one' },
      }),
      snapshots.detect({
        managedAgentInvocation: { cwd: '/workspace/one', credential: 'secret-two' },
      }),
      snapshots.detect({
        managedAgentInvocation: { cwd: '/workspace/two', credential: 'secret-one' },
      }),
      snapshots.detect({
        refresh: true,
        managedAgentInvocation: { cwd: '/workspace/one', credential: 'secret-one' },
      }),
    ]);

    expect(detect).toHaveBeenCalledTimes(4);
  });

  it('removes rejected operations so the same context can retry', async () => {
    const detect = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(PROVIDERS);
    const snapshots = createAgentProviderSnapshotDetector(detect);
    const context = { cwd: '/workspace/retry', refresh: true };

    await expect(snapshots.detect(context)).rejects.toThrow('temporary failure');
    await expect(snapshots.detect(context)).resolves.toEqual(PROVIDERS);
    expect(detect).toHaveBeenCalledTimes(2);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
