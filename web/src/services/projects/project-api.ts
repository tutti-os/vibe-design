import type { CreateProjectInput, CreatedProject } from './project-service.interface';
import type { WorkspaceTabsState } from '../../features/canvas-workspace';

export interface ProjectApi {
  createProject(input: CreateProjectInput): Promise<CreatedProject>;
  deleteProject(projectId: string): Promise<void>;
  updateProjectTabsState(projectId: string, tabsState: WorkspaceTabsState): Promise<void>;
  updateProjectTitle(projectId: string, title: string): Promise<CreatedProject>;
  updateProjectDesignSystem(projectId: string, designSystemId: string | null): Promise<CreatedProject>;
}

export class FetchProjectApi implements ProjectApi {
  async createProject(input: CreateProjectInput): Promise<CreatedProject> {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not create project.'));
    }

    const project = readCreatedProject(data);
    if (!project) {
      throw new Error('Could not create project.');
    }

    return project;
  }

  async deleteProject(projectId: string): Promise<void> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(readErrorMessage(data, 'Could not delete project.'));
    }
  }

  async updateProjectTabsState(projectId: string, tabsState: WorkspaceTabsState): Promise<void> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tabsState),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(readErrorMessage(data, 'Could not update project tabs.'));
    }
  }

  async updateProjectTitle(projectId: string, title: string): Promise<CreatedProject> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not update project title.'));
    }

    const project = readCreatedProject(data);
    if (!project) {
      throw new Error('Could not update project title.');
    }

    return project;
  }

  async updateProjectDesignSystem(projectId: string, designSystemId: string | null): Promise<CreatedProject> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designSystemId }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not update project design system.'));
    }

    const project = readCreatedProject(data);
    if (!project) {
      throw new Error('Could not update project design system.');
    }

    return project;
  }
}

function readCreatedProject(data: unknown): CreatedProject | null {
  const project = isObject(data) ? data.project : null;
  if (!isObject(project)) {
    return null;
  }

  const metadata = isObject(project.metadata) ? project.metadata : {};
  if (
    typeof project.id !== 'string' ||
    typeof project.createdAt !== 'number' ||
    typeof project.updatedAt !== 'number' ||
    typeof metadata.title !== 'string' ||
    typeof metadata.prompt !== 'string' ||
    typeof metadata.projectKind !== 'string'
  ) {
    return null;
  }

  return {
    id: project.id,
    title: metadata.title,
    prompt: metadata.prompt,
    projectKind: metadata.projectKind,
    designSystemId: typeof project.designSystemId === 'string' ? project.designSystemId : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function readErrorMessage(data: unknown, fallbackMessage: string): string {
  const error = isObject(data) ? data.error : null;
  if (isObject(error) && typeof error.message === 'string') {
    return error.message;
  }

  if (isObject(data) && typeof data.message === 'string') {
    return data.message;
  }

  return fallbackMessage;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
