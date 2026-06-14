import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureClaudeInstallPathInProcessEnv } from './local-claude-command.js';

const execFileAsync = promisify(execFile);
const CLAUDE_NATIVE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';

export async function installClaudeCode(): Promise<void> {
  await execFileAsync('bash', ['-lc', CLAUDE_NATIVE_INSTALL_COMMAND], {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 5 * 60_000,
  });
  ensureClaudeInstallPathInProcessEnv();
}
