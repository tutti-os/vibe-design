import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it('joins identical in-flight managed refreshes', async () => {
    const pending = deferred<AgentProviderSnapshot[]>();
    const detect = vi.fn(() => pending.promise);
    const snapshots = createAgentProviderSnapshotDetector(detect);
    const context = {
      cwd: '/workspace/one',
      refresh: true,
      env: { PATH: '/opt/bin', TSH_WORKSPACE_ID: 'workspace-one' },
      managedAgentInvocation: { cwd: '/workspace/one', credential: 'secret-one' },
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
  it('detects once and keeps target-specific models when two targets share a provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-provider-snapshot-'));
    try {
      const cliPath = join(root, 'tutti-cli.mjs');
      const invocationLog = join(root, 'cli-invocations.jsonl');
      const workspaceCwd = join(root, 'workspace');
      await writeFile(cliPath, [
        '#!/usr/bin/env node',
        'import { appendFileSync } from "node:fs";',
        'const args = process.argv.slice(2);',
        `appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");`,
        'if (args.includes("list")) {',
        '  process.stdout.write(JSON.stringify({ schemaVersion: 1, defaultAgentTargetId: "team:writer", agents: [',
        '    { id: "team:writer", provider: "codex", name: "Writer", availability: { status: "available", reasonCode: "", detail: "" } },',
        '    { id: "team:reviewer", provider: "codex", name: "Reviewer", availability: { status: "available", reasonCode: "", detail: "" } }',
        '  ] }));',
        '} else {',
        '  const target = args[args.indexOf("--agent-id") + 1];',
        '  const model = target === "team:writer" ? "writer-model" : "reviewer-model";',
        '  const config = { configurable: true, currentValue: model, defaultValue: model, options: [{ id: model, value: model, label: model }] };',
        '  const empty = { configurable: false, currentValue: "", defaultValue: "", options: [] };',
        '  process.stdout.write(JSON.stringify({ schemaVersion: 2, agentTargetId: target, providerId: "codex", effectiveSettings: {},',
        '    modelConfig: config, permissionConfig: { configurable: false, defaultValue: "", modes: [] }, reasoningConfig: empty, speedConfig: empty }));',
        '}',
      ].join('\n'));
      await chmod(cliPath, 0o755);
      await mkdir(workspaceCwd, { recursive: true });
      process.env.TUTTI_CLI = cliPath;

      const detect = vi.fn(async () => [{
        provider: 'codex', displayName: 'Codex', supported: true, authState: 'ok', models: [],
      }]);
      const runtime = {
        detect,
        listProviders: () => [{ id: 'codex', displayName: 'Codex' }],
        cancel: vi.fn(async () => undefined),
        run: vi.fn(),
      };

      await expect(detectLocalAgentProviders({ cwd: workspaceCwd }, runtime as never)).resolves.toEqual([
        expect.objectContaining({
          agentTargetId: 'team:writer', providerId: 'codex', isDefault: true,
          models: [{ id: 'writer-model', label: 'writer-model' }], defaultModelId: 'writer-model',
        }),
        expect.objectContaining({
          agentTargetId: 'team:reviewer', providerId: 'codex',
          models: [{ id: 'reviewer-model', label: 'reviewer-model' }], defaultModelId: 'reviewer-model',
        }),
      ]);
      expect(detect).toHaveBeenCalledTimes(1);
      expect(detect).toHaveBeenCalledWith({ cwd: workspaceCwd });
      const canonicalWorkspaceCwd = await realpath(workspaceCwd);
      const invocations = (await readFile(invocationLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { cwd: string });
      expect(invocations.length).toBeGreaterThan(0);
      expect(invocations.every((invocation) => invocation.cwd === canonicalWorkspaceCwd)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
