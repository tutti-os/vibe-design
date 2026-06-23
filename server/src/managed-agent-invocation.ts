import type { ManagedAgentInvocation } from '@tutti-os/agent-acp-kit';

export function createManagedAgentInvocation(
  credential: string | null,
  cwd?: string,
): ManagedAgentInvocation | undefined {
  if (!credential) {
    return undefined;
  }

  const resolvedCwd = cwd?.trim();
  if (!resolvedCwd) {
    return undefined;
  }

  return {
    credential,
    cwd: resolvedCwd,
  };
}
