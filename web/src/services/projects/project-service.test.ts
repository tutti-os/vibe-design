import { describe, expect, it, vi } from 'vitest';
import type { ProjectApi } from './project-api';
import { ProjectService } from './project-service';

describe('ProjectService', () => {
  it('preserves a dashboard-provided multilingual project title when creating a project', async () => {
    const createProject = vi.fn<ProjectApi['createProject']>(async (input) => ({
      id: 'project-1',
      title: input.title ?? input.prompt,
      prompt: input.prompt,
      projectKind: input.projectKind,
      createdAt: 1,
      updatedAt: 1,
    }));
    const api: ProjectApi = {
      createProject,
      deleteProject: vi.fn(),
      updateProjectTabsState: vi.fn(),
      updateProjectTitle: vi.fn(),
      updateProjectDesignSystem: vi.fn(),
    };

    await new ProjectService(api).createProject({
      title: '  品牌仪表盘  ',
      prompt: '  品牌仪表盘  ',
      projectKind: 'prototype',
    });

    expect(createProject).toHaveBeenCalledWith({
      title: '品牌仪表盘',
      prompt: '品牌仪表盘',
      projectKind: 'prototype',
    });
  });

  it('omits a blank project title so the API can fall back to the prompt', async () => {
    const createProject = vi.fn<ProjectApi['createProject']>(async (input) => ({
      id: 'project-1',
      title: input.title ?? input.prompt,
      prompt: input.prompt,
      projectKind: input.projectKind,
      createdAt: 1,
      updatedAt: 1,
    }));
    const api: ProjectApi = {
      createProject,
      deleteProject: vi.fn(),
      updateProjectTabsState: vi.fn(),
      updateProjectTitle: vi.fn(),
      updateProjectDesignSystem: vi.fn(),
    };

    await new ProjectService(api).createProject({
      title: '   ',
      prompt: '  Brand dashboard  ',
      projectKind: 'prototype',
    });

    expect(createProject).toHaveBeenCalledWith({
      prompt: 'Brand dashboard',
      projectKind: 'prototype',
    });
  });
});
