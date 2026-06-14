import type { CreateProjectInput, CreatedProject, IProjectService } from './project-service.interface';
import type { ProjectApi } from './project-api';

export class ProjectService implements IProjectService {
  readonly _serviceBrand: undefined;

  constructor(private readonly api: ProjectApi) {}

  async createProject(input: CreateProjectInput): Promise<CreatedProject> {
    return this.api.createProject({
      prompt: input.prompt.trim(),
      projectKind: input.projectKind,
      ...(input.designSystemId ? { designSystemId: input.designSystemId } : {}),
    });
  }

  async updateProjectTabsState(projectId: string, tabsState: Parameters<ProjectApi['updateProjectTabsState']>[1]): Promise<void> {
    await this.api.updateProjectTabsState(projectId, tabsState);
  }

  async updateProjectTitle(projectId: string, title: string): Promise<CreatedProject> {
    return this.api.updateProjectTitle(projectId, title.trim());
  }

  async updateProjectDesignSystem(projectId: string, designSystemId: string | null): Promise<CreatedProject> {
    return this.api.updateProjectDesignSystem(projectId, designSystemId?.trim() || null);
  }
}
