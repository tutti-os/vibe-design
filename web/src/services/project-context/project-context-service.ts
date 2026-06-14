import type { IProjectContextService } from './project-context-service.interface';

export class ProjectContextService implements IProjectContextService {
  readonly _serviceBrand = undefined;

  constructor(private readonly projectId: string) {}

  getProjectId(): string {
    return this.projectId;
  }
}
