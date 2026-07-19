import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentProviderSnapshotDetector,
  detectLocalAgentProviders,
  type AgentProviderSnapshot,
} from './agent-provider-snapshot.js';

const originalTuttiCli = process.env.TUTTI_CLI;

afterEach(() => {
  if (originalTuttiCli === undefined) delete process.env.TUTTI_CLI;
  else process.env.TUTTI_CLI = originalTuttiCli;
});

const PROVIDERS: AgentProviderSnapshot[] = [{
  id: 'codex',
  label: 'Codex',
  supported: true,
  authState: 'ok',
  models: [{ id: 'default', label: 'Default' }],
  defaultModelId: 'default',
}];

describe('createAgentProviderSnapshotDetector', () => {
  it('joins identical in-flight standalone refreshes', async () => {
    const pending = deferred<AgentProviderSnapshot[]>();
    const detect = vi.fn(() => pending.promise);
    const snapshots = createAgentProviderSnapshotDetector(detect);
    const context = {
      cwd: '/workspace/one',
      refresh: true,
      env: { PATH: '/opt/bin', TSH_WORKSPACE_ID: 'workspace-one' },
    };

    const first = snapshots.detect(context);
    const second = snapshots.detect({
      ...context,
      env: { TSH_WORKSPACE_ID: 'workspace-one', PATH: '/opt/bin' },
    });

    await Promise.resolve();
    expect(detect).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    pending.resolve(PROVIDERS);
    await expect(first).resolves.toEqual(PROVIDERS);
  });

  it('separates workspaces and refresh modes', async () => {
    const detect = vi.fn(async () => PROVIDERS);
    const snapshots = createAgentProviderSnapshotDetector(detect);
    await Promise.all([
      snapshots.detect({ cwd: '/workspace/one' }),
      snapshots.detect({ cwd: '/workspace/two' }),
      snapshots.detect({ cwd: '/workspace/one', refresh: true }),
    ]);

    expect(detect).toHaveBeenCalledTimes(3);
  });

  it('separates in-flight detections whose effective environments differ', async () => {
    const pending = deferred<AgentProviderSnapshot[]>();
    const detect = vi.fn(() => pending.promise);
    const snapshots = createAgentProviderSnapshotDetector(detect);

    const first = snapshots.detect({
      cwd: '/workspace/one',
      env: { PATH: '/opt/first/bin', TSH_WORKSPACE_ID: 'workspace-one' },
    });
    const second = snapshots.detect({
      cwd: '/workspace/one',
      env: { PATH: '/opt/second/bin', TSH_WORKSPACE_ID: 'workspace-one' },
    });

    await Promise.resolve();
    expect(first).not.toBe(second);
    expect(detect).toHaveBeenCalledTimes(2);
    pending.resolve(PROVIDERS);
    await expect(Promise.all([first, second])).resolves.toEqual([
      PROVIDERS,
      PROVIDERS,
    ]);
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

describe('detectLocalAgentProviders', () => {
  it('projects target-specific models from one runtime detection when two targets share a provider', async () => {
    const runtime = {
      detect: vi.fn(async () => [
        {
          agentTargetId: 'team:writer', provider: 'codex', displayName: 'Writer', supported: true,
          authState: 'ok', models: [{ id: 'writer-model', label: 'Writer Model' }],
          defaultModelId: 'writer-model', isDefault: true as const,
        },
        {
          agentTargetId: 'team:reviewer', provider: 'codex', displayName: 'Reviewer', supported: false,
          authState: 'missing', models: [{ id: 'reviewer-model', label: 'Reviewer Model' }],
          reason: 'Reviewer is unavailable.',
        },
      ]),
      listProviders: () => [{ id: 'codex', displayName: 'Codex' }],
      cancel: vi.fn(async () => undefined),
      run: vi.fn(),
    };

    await expect(detectLocalAgentProviders({ cwd: '/workspace/project' }, runtime as never)).resolves.toEqual([
      expect.objectContaining({
        agentTargetId: 'team:writer', providerId: 'codex', label: 'Writer', supported: true,
        models: [{ id: 'writer-model', label: 'Writer Model' }], defaultModelId: 'writer-model', isDefault: true,
      }),
      expect.objectContaining({
        agentTargetId: 'team:reviewer', providerId: 'codex', label: 'Reviewer', supported: false,
        models: [{ id: 'reviewer-model', label: 'Reviewer Model' }], reason: 'Reviewer is unavailable.',
      }),
    ]);
    expect(runtime.detect).toHaveBeenCalledTimes(1);
    expect(runtime.detect).toHaveBeenCalledWith({ cwd: '/workspace/project' });
  });

  it('uses the process cwd when none is explicit', async () => {
    const runtime = {
      detect: vi.fn(async () => []),
      listProviders: () => [],
      cancel: vi.fn(async () => undefined),
      run: vi.fn(),
    };
    await detectLocalAgentProviders(undefined, runtime as never);
    expect(runtime.detect).toHaveBeenCalledWith({ cwd: process.cwd() });
  });

  it('fails closed by omitting detections without an exact agent target id', async () => {
    const runtime = {
      detect: vi.fn(async () => [{
        provider: 'codex', displayName: 'Codex', supported: false, authState: 'unknown', models: [],
        reason: 'Tutti Agent catalog is unavailable.',
      }]),
      listProviders: () => [{ id: 'codex', displayName: 'Codex' }],
      cancel: vi.fn(async () => undefined),
      run: vi.fn(),
    };

    await expect(detectLocalAgentProviders({ cwd: '/workspace/project' }, runtime as never)).resolves.toEqual([]);
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
