import { createDecorator } from '@tutti-os/infra/di';

export interface IProjectContextService {
  readonly _serviceBrand: undefined;
  getProjectId(): string;
}

export const IProjectContextService = createDecorator<IProjectContextService>('project-context-service');
