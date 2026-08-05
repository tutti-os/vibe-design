import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectFromStore } from './sqlite-store.js';

/** Legacy non-TSH project directory under the private projects tree. */
export function legacyProjectDir(projectsDir: string, projectId: string): string {
  return join(projectsDir, projectId);
}

/**
 * Resolve the on-disk workspace for a project.
 * TSH-bound projects use `workspace_root`; others use `projectsDir/<id>`.
 */
export function resolveProjectWorkspaceDir(
  projectsDir: string,
  projectId: string,
): string {
  const project = getProjectFromStore(projectsDir, projectId);
  const bound = project?.workspaceRoot?.trim();
  if (bound) return bound;
  return legacyProjectDir(projectsDir, projectId);
}

export function ensureProjectWorkspaceDir(
  projectsDir: string,
  projectId: string,
): string {
  const root = resolveProjectWorkspaceDir(projectsDir, projectId);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  return root;
}

export function projectAssetsDir(projectsDir: string, projectId: string): string {
  return join(resolveProjectWorkspaceDir(projectsDir, projectId), 'assets');
}

export function projectAssetFilePath(
  projectsDir: string,
  projectId: string,
  name: string,
): string {
  return join(projectAssetsDir(projectsDir, projectId), name);
}
