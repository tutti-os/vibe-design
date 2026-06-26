import { createDecorator } from '@tutti-os/infra/di';
import type { WorkspaceTabsState } from '../../features/canvas-workspace';

export interface CreateProjectInput {
  title?: string;
  prompt: string;
  projectKind: string;
  designSystemId?: string | null;
  agentId?: string;
  model?: string;
}

export interface CreatedProject {
  id: string;
  title: string;
  prompt: string;
  projectKind: string;
  designSystemId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface IProjectService {
  readonly _serviceBrand: undefined;
  createProject(input: CreateProjectInput): Promise<CreatedProject>;
  deleteProject(projectId: string): Promise<void>;
  updateProjectTabsState(projectId: string, tabsState: WorkspaceTabsState): Promise<void>;
  updateProjectTitle(projectId: string, title: string): Promise<CreatedProject>;
  updateProjectDesignSystem(projectId: string, designSystemId: string | null): Promise<CreatedProject>;
}

export const IProjectService = createDecorator<IProjectService>('project-service');
