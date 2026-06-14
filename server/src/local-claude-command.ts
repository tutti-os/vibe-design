import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLAUDE_COMMAND_NAME = 'claude';

export function resolveClaudeCommand(): string {
  const explicitPath = process.env.CLAUDE_CODE_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  for (const candidate of claudeExecutableCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return CLAUDE_COMMAND_NAME;
}

export function ensureClaudeInstallPathInProcessEnv(): void {
  const pathEntries = new Set((process.env.PATH ?? '').split(delimiter).filter(Boolean));
  let changed = false;

  for (const dir of claudeInstallPathCandidates()) {
    if (!pathEntries.has(dir) && existsSync(join(dir, CLAUDE_COMMAND_NAME))) {
      pathEntries.add(dir);
      changed = true;
    }
  }

  if (changed) {
    process.env.PATH = Array.from(pathEntries).join(delimiter);
  }
}

function claudeExecutableCandidates(): string[] {
  return claudeInstallPathCandidates().map((dir) => join(dir, CLAUDE_COMMAND_NAME));
}

function claudeInstallPathCandidates(): string[] {
  return [
    join(homedir(), '.local', 'bin'),
    join(homedir(), 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}
