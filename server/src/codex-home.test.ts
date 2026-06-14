import { lstat, mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareAppDataCodexHome } from './codex-home';

describe('prepareAppDataCodexHome', () => {
  let root: string;
  let runtimeDir: string;
  let userCodexHome: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibe-codex-home-'));
    runtimeDir = join(root, 'data');
    userCodexHome = join(root, 'user-codex');
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(userCodexHome, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns null when the user has no auth.json so the platform default applies', async () => {
    const result = await prepareAppDataCodexHome(runtimeDir, userCodexHome);
    expect(result).toBeNull();
  });

  it('creates a persistent sessions dir and shares auth/config from the user home', async () => {
    await writeFile(join(userCodexHome, 'auth.json'), '{}', 'utf8');
    await writeFile(join(userCodexHome, 'config.toml'), 'model = "x"', 'utf8');

    const codexHome = await prepareAppDataCodexHome(runtimeDir, userCodexHome);
    expect(codexHome).toBe(join(runtimeDir, 'codex-home'));

    // sessions/ is a real, persistent directory so rollouts land in the app data dir.
    const sessions = await lstat(join(codexHome!, 'sessions'));
    expect(sessions.isDirectory()).toBe(true);

    // auth.json and config.toml are symlinked back to the user home.
    expect(await readlink(join(codexHome!, 'auth.json'))).toBe(join(userCodexHome, 'auth.json'));
    expect(await readlink(join(codexHome!, 'config.toml'))).toBe(join(userCodexHome, 'config.toml'));
  });

  it('is idempotent across runs and leaves existing links in place', async () => {
    await writeFile(join(userCodexHome, 'auth.json'), '{}', 'utf8');

    const first = await prepareAppDataCodexHome(runtimeDir, userCodexHome);
    const second = await prepareAppDataCodexHome(runtimeDir, userCodexHome);

    expect(second).toBe(first);
    expect(await readlink(join(first!, 'auth.json'))).toBe(join(userCodexHome, 'auth.json'));
  });
});
