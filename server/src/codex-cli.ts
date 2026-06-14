import { spawn } from 'node:child_process';

export interface CodexRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CodexRunner {
  run(args: string[], opts?: { env?: Record<string, string> }): Promise<CodexRunnerResult>;
}

export interface CodexInstallStatus {
  available: boolean;
  installed: boolean;
}

export interface CodexInstallSpec {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

const CODEX_TIMEOUT_MS = 30_000;

export const defaultCodexRunner: CodexRunner = {
  run(args, opts) {
    return new Promise((resolve, reject) => {
      const child = spawn('codex', args, {
        env: { ...process.env, ...opts?.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill('SIGKILL');
        reject(new Error(timeoutFailureDetail(args, stdout, stderr)));
      }, CODEX_TIMEOUT_MS);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.once('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      });

      child.once('close', (exitCode) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
  },
};

let codexRunner: CodexRunner = defaultCodexRunner;

export function setCodexRunner(runner: CodexRunner | null): void {
  codexRunner = runner ?? defaultCodexRunner;
}

export async function probeCodexInstall(name: string): Promise<CodexInstallStatus> {
  try {
    const result = await codexRunner.run(['mcp', 'get', name]);
    if (result.exitCode === 0) {
      return { available: true, installed: true };
    }

    if (isMissingServerResult(result)) {
      return { available: true, installed: false };
    }

    throw new Error(`codex mcp get failed: ${failureDetail(result)}`);
  } catch (error) {
    if (isMissingBinaryError(error)) {
      return { available: false, installed: false };
    }

    throw error;
  }
}

export async function installCodexMcp(spec: CodexInstallSpec): Promise<void> {
  const args = ['mcp', 'add', spec.name];
  for (const [key, value] of Object.entries(spec.env)) {
    args.push('--env', `${key}=${value}`);
  }
  args.push('--', spec.command, ...spec.args);

  const result = await codexRunner.run(args);
  if (result.exitCode !== 0) {
    throw new Error(`codex mcp add failed: ${failureDetail(result)}`);
  }
}

export async function uninstallCodexMcp(name: string): Promise<void> {
  const result = await codexRunner.run(['mcp', 'remove', name]);
  if (result.exitCode !== 0) {
    throw new Error(`codex mcp remove failed: ${failureDetail(result)}`);
  }
}

function failureDetail(result: CodexRunnerResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
}

function timeoutFailureDetail(args: string[], stdout: string, stderr: string): string {
  const details = [`codex ${args.join(' ')} timed out after ${CODEX_TIMEOUT_MS}ms`];
  if (stdout.trim().length > 0) {
    details.push(`stdout: ${stdout.trim()}`);
  }
  if (stderr.trim().length > 0) {
    details.push(`stderr: ${stderr.trim()}`);
  }

  return details.join('; ');
}

function isMissingServerResult(result: CodexRunnerResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`;
  return /No MCP server named/i.test(output);
}

function isMissingBinaryError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
