import { isAbsolute, posix, relative } from 'node:path';
import type { ManagedAgentInvocation } from '@tutti-os/agent-acp-kit';

const MANAGED_WORKSPACE_ROOT = '/workspace';

export function createManagedAgentInvocation(
  credential: string | null,
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env,
): ManagedAgentInvocation | undefined {
  if (!credential) {
    return undefined;
  }

  const resolvedCwd = resolveManagedAgentInvocationCwd(cwd, env);
  if (!resolvedCwd) {
    return undefined;
  }

  return {
    credential,
    cwd: resolvedCwd,
  };
}

export function resolveManagedAgentInvocationCwd(
  cwd: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidate = cwd?.trim();
  if (!candidate) {
    return null;
  }

  const workspaceRoot = firstNonEmpty(env.TUTTI_WORKSPACE_ROOT);
  const workspaceRelative = workspaceRoot ? relativeInside(candidate, workspaceRoot) : null;
  if (workspaceRelative !== null) {
    return joinManagedWorkspace(workspaceRelative);
  }

  const dataRoot = firstNonEmpty(env.TUTTI_APP_DATA_DIR);
  const dataRelative = dataRoot ? relativeInside(candidate, dataRoot) : null;
  if (dataRelative !== null) {
    return joinManagedWorkspace(dataRelative);
  }

  const normalized = normalizePosixPath(candidate);
  if (normalized === MANAGED_WORKSPACE_ROOT || normalized.startsWith(`${MANAGED_WORKSPACE_ROOT}/`)) {
    return stripWorkspaceIdSegment(normalized, env);
  }

  return null;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function relativeInside(child: string, parent: string): string | null {
  const relativePath = relative(parent, child);
  if (relativePath === '') {
    return '';
  }
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }
  return relativePath;
}

function joinManagedWorkspace(relativePath: string): string {
  const normalizedRelative = normalizePosixPath(relativePath);
  if (!normalizedRelative || normalizedRelative === '.') {
    return MANAGED_WORKSPACE_ROOT;
  }
  return posix.join(MANAGED_WORKSPACE_ROOT, normalizedRelative);
}

function normalizePosixPath(value: string): string {
  return posix.normalize(value.trim().replace(/\\/g, '/'));
}

function stripWorkspaceIdSegment(cwd: string, env: NodeJS.ProcessEnv): string {
  const workspaceId = firstNonEmpty(env.TUTTI_WORKSPACE_ID, env.TSH_WORKSPACE_ID);
  if (!workspaceId) {
    return cwd;
  }

  const physicalPrefix = `${MANAGED_WORKSPACE_ROOT}/${workspaceId}`;
  if (cwd === physicalPrefix) {
    return MANAGED_WORKSPACE_ROOT;
  }
  if (cwd.startsWith(`${physicalPrefix}/`)) {
    return `${MANAGED_WORKSPACE_ROOT}${cwd.slice(physicalPrefix.length)}`;
  }
  return cwd;
}
