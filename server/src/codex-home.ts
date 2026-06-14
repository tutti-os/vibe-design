import { copyFile, lstat, mkdir, stat, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// User-level Codex files that the persistent home must share so auth/config keep
// working. Sessions are deliberately excluded: those are the rollouts we want to
// persist under the app data dir, not borrow from ~/.codex.
const SHARED_USER_CODEX_FILES = ['auth.json', 'config.toml'] as const;

const CODEX_HOME_DIR_NAME = 'codex-home';

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function alreadyMaterialized(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function exposeUserCodexFile(source: string, target: string): Promise<void> {
  if (!(await pathExists(source))) {
    return;
  }
  if (await alreadyMaterialized(target)) {
    return;
  }
  try {
    await symlink(source, target);
  } catch {
    // Symlinks can be unavailable (e.g. Windows without privileges); a copy still
    // lets Codex read the file. Auth refreshes won't propagate back in that case,
    // but that matches the host platform's own fallback behavior.
    await copyFile(source, target);
  }
}

/**
 * Prepare a persistent CODEX_HOME under the app data directory.
 *
 * The host platform points Codex at a per-run, ephemeral CODEX_HOME, so rollouts
 * (the conversation's native context) are discarded after each run and resume
 * fails with "no rollout found". By pointing Codex at <runtimeDir>/codex-home
 * instead — with a real sessions/ directory and auth/config shared from ~/.codex —
 * agent-acp-kit symlinks that sessions/ into its scratch home, so rollouts land in
 * the app data dir and survive across runs and resume.
 *
 * Returns the prepared CODEX_HOME path, or null when ~/.codex/auth.json is missing
 * (agent-acp-kit requires it under the source home); callers then leave CODEX_HOME
 * untouched and fall back to the platform default.
 */
export async function prepareAppDataCodexHome(
  runtimeDir: string,
  userCodexHome: string = join(homedir(), '.codex'),
): Promise<string | null> {
  if (!(await pathExists(join(userCodexHome, 'auth.json')))) {
    return null;
  }

  const codexHome = join(runtimeDir, CODEX_HOME_DIR_NAME);
  await mkdir(join(codexHome, 'sessions'), { recursive: true });

  for (const name of SHARED_USER_CODEX_FILES) {
    await exposeUserCodexFile(join(userCodexHome, name), join(codexHome, name));
  }

  return codexHome;
}
