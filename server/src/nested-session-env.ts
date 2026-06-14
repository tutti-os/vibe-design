/**
 * Claude Code refuses to start when it detects it is already running inside
 * another Claude Code session: it checks the `CLAUDECODE` environment variable
 * and aborts with
 *
 *   "Claude Code cannot be launched inside another Claude Code session."
 *
 * to avoid nested sessions sharing (and crashing) runtime resources.
 *
 * When the vibe-design server is itself started from within a Claude Code
 * session, those variables leak into our own `process.env` and are then
 * inherited by every `claude` child process we spawn — so the spawned agents
 * fail before they ever run.
 *
 * The agent runtime spawns children via `{ ...process.env, ...launchPlan.env }`
 * (see @tutti-os/agent-acp-kit's process supervisor), so a launch-plan `env`
 * override can only *set* values, never *delete* inherited keys. We therefore
 * scrub these variables from our own `process.env` before spawning, which
 * guarantees no spawned agent inherits them regardless of how the parent
 * session's CLI happens to detect nesting.
 */
export const NESTED_CLAUDE_SESSION_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
] as const;

/**
 * Remove the leaked nested-session variables from the given environment
 * (defaults to the current process environment). Returns the names that were
 * actually removed, which is handy for logging/diagnostics.
 */
export function scrubNestedClaudeSessionEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const key of NESTED_CLAUDE_SESSION_ENV_VARS) {
    if (env[key] !== undefined) {
      delete env[key];
      removed.push(key);
    }
  }
  return removed;
}
