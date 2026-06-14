import { afterEach, describe, expect, it } from 'vitest';
import {
  installCodexMcp,
  probeCodexInstall,
  setCodexRunner,
  uninstallCodexMcp,
  type CodexRunner,
} from './codex-cli.js';

type RecordedCall = { args: string[]; env?: Record<string, string> };

function makeRunner(
  result: (call: RecordedCall) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
): CodexRunner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(args, opts) {
      const call = opts?.env ? { args, env: opts.env } : { args };
      calls.push(call);
      return result(call);
    },
  };
}

afterEach(() => setCodexRunner(null));

describe('probeCodexInstall', () => {
  it('reports missing binary on ENOENT', async () => {
    const runner = makeRunner(async () => {
      const err = new Error('spawn codex ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    setCodexRunner(runner);
    await expect(probeCodexInstall('vibe-design')).resolves.toEqual({ available: false, installed: false });
    expect(runner.calls[0]?.args).toEqual(['mcp', 'get', 'vibe-design']);
  });

  it('reports installed from exit code zero', async () => {
    const runner = makeRunner(async () => ({ exitCode: 0, stdout: 'vibe-design', stderr: '' }));
    setCodexRunner(runner);
    await expect(probeCodexInstall('vibe-design')).resolves.toEqual({ available: true, installed: true });
  });

  it('reports not installed from known missing server output', async () => {
    const runner = makeRunner(async () => ({ exitCode: 1, stdout: '', stderr: 'No MCP server named vibe-design' }));
    setCodexRunner(runner);
    await expect(probeCodexInstall('vibe-design')).resolves.toEqual({ available: true, installed: false });
  });

  it('throws with stderr detail on unexpected get failure', async () => {
    const runner = makeRunner(async () => ({ exitCode: 1, stdout: '', stderr: 'permission denied' }));
    setCodexRunner(runner);
    await expect(probeCodexInstall('vibe-design')).rejects.toThrow('codex mcp get failed: permission denied');
  });
});

describe('installCodexMcp and uninstallCodexMcp', () => {
  it('builds codex mcp add argv with env before command separator', async () => {
    const runner = makeRunner(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    setCodexRunner(runner);
    await installCodexMcp({
      name: 'vibe-design',
      command: '/usr/bin/node',
      args: ['/app/cli.js', 'mcp'],
      env: { VIBE_DATA_DIR: '/tmp/vibe' },
    });
    expect(runner.calls[0]?.args).toEqual([
      'mcp',
      'add',
      'vibe-design',
      '--env',
      'VIBE_DATA_DIR=/tmp/vibe',
      '--',
      '/usr/bin/node',
      '/app/cli.js',
      'mcp',
    ]);
  });

  it('throws with stderr detail on install failure', async () => {
    const runner = makeRunner(async () => ({ exitCode: 1, stdout: '', stderr: 'already exists' }));
    setCodexRunner(runner);
    await expect(installCodexMcp({ name: 'vibe-design', command: 'node', args: ['cli.js'], env: {} })).rejects.toThrow(
      'already exists',
    );
  });

  it('builds codex mcp remove argv', async () => {
    const runner = makeRunner(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    setCodexRunner(runner);
    await uninstallCodexMcp('vibe-design');
    expect(runner.calls[0]?.args).toEqual(['mcp', 'remove', 'vibe-design']);
  });
});
