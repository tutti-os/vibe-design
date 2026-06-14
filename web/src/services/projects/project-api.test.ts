import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchProjectApi } from './project-api';

describe('FetchProjectApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes the selected design system when creating a project', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        project: {
          id: 'project-1',
          designSystemId: 'default',
          createdAt: 1,
          updatedAt: 2,
          metadata: {
            title: 'Brand dashboard',
            prompt: 'Brand dashboard',
            projectKind: 'prototype',
          },
        },
      }, { status: 201 })
    );
    vi.stubGlobal('fetch', fetch);

    await new FetchProjectApi().createProject({
      prompt: 'Brand dashboard',
      projectKind: 'prototype',
      designSystemId: 'default',
    });

    const request = fetch.mock.calls[0]?.[1];
    if (!request) {
      throw new Error('expected create project request options');
    }
    expect(JSON.parse(String(request.body))).toMatchObject({
      prompt: 'Brand dashboard',
      projectKind: 'prototype',
      designSystemId: 'default',
    });
  });

  it('updates the project design system with a PATCH request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        project: {
          id: 'project-1',
          designSystemId: 'anthropic-web',
          createdAt: 1,
          updatedAt: 3,
          metadata: {
            title: 'Brand dashboard',
            prompt: 'Brand dashboard',
            projectKind: 'prototype',
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetch);

    const updatedProject = await new FetchProjectApi().updateProjectDesignSystem('project-1', 'anthropic-web');

    expect(updatedProject.designSystemId).toBe('anthropic-web');
    const [url, request] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/project-1');
    expect(request?.method).toBe('PATCH');
    expect(JSON.parse(String(request?.body))).toEqual({
      designSystemId: 'anthropic-web',
    });
  });

  it('updates the project title with a PATCH request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        project: {
          id: 'project-1',
          designSystemId: 'anthropic-web',
          createdAt: 1,
          updatedAt: 4,
          metadata: {
            title: 'Updated dashboard',
            prompt: 'Brand dashboard',
            projectKind: 'prototype',
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetch);

    const updatedProject = await new FetchProjectApi().updateProjectTitle('project-1', 'Updated dashboard');

    expect(updatedProject.title).toBe('Updated dashboard');
    const [url, request] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/project-1');
    expect(request?.method).toBe('PATCH');
    expect(JSON.parse(String(request?.body))).toEqual({
      title: 'Updated dashboard',
    });
  });
});
