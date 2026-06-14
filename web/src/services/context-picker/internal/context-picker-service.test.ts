import { describe, expect, it, vi } from 'vitest';
import { ContextPickerService } from './context-picker-service';
import type { ProjectFile } from '../../../types';

describe('ContextPickerService', () => {
  const api = {
    listSkills: async () => [
      { id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' },
      { id: 'skill-2', name: 'Form Builder', description: 'Build forms' },
    ],
    listDesignFiles: async () => [
      projectFile({ id: 'file-1', path: 'src/Hero.tsx', name: 'Hero.tsx' }),
      projectFile({ id: 'file-2', path: 'src/Form.tsx', name: 'Form.tsx' }),
    ],
  };

  it('builds structured run context from selected skills and files', async () => {
    const service = new ContextPickerService(api);

    await service.selectSkill('skill-1');
    await service.selectDesignFile('file-1');

    expect(service.buildRunContext()).toEqual({
      skillIds: ['skill-1'],
      designFileIds: ['file-1'],
      designFilePaths: ['src/Hero.tsx'],
    });
  });

  it('returns undefined when no run context is selected', () => {
    const service = new ContextPickerService(api);

    expect(service.buildRunContext()).toBeUndefined();
  });

  it('searches API skills and design files with mention filtering', async () => {
    const service = new ContextPickerService(api);

    await expect(service.search('hero')).resolves.toEqual({
      query: 'hero',
      items: [
        {
          id: 'skill:skill-1',
          kind: 'skill',
          label: 'Hero Builder',
          value: 'skill-1',
          description: 'Build hero sections',
        },
        {
          id: 'design-file:file-1',
          kind: 'design-file',
          label: 'Hero.tsx',
          value: 'file-1',
          path: 'src/Hero.tsx',
        },
      ],
    });
  });

  it('selectResult dispatches skill and design file selections', async () => {
    const service = new ContextPickerService(api);

    await service.selectResult({ id: 'skill:skill-1', kind: 'skill', label: 'Hero Builder', value: 'skill-1' });
    await service.selectResult({
      id: 'design-file:file-1',
      kind: 'design-file',
      label: 'Hero.tsx',
      value: 'file-1',
      path: 'src/Hero.tsx',
    });

    expect(service.buildRunContext()).toEqual({
      skillIds: ['skill-1'],
      designFileIds: ['file-1'],
      designFilePaths: ['src/Hero.tsx'],
    });
  });

  it('deduplicates concurrent skill selections after API resolution', async () => {
    const skillsRequest = deferred([
      { id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' },
    ]);
    const service = new ContextPickerService({
      listSkills: vi.fn(() => skillsRequest.promise),
      listDesignFiles: async () => [],
    });

    const firstSelection = service.selectSkill('skill-1');
    const secondSelection = service.selectSkill('skill-1');
    skillsRequest.resolve();
    await Promise.all([firstSelection, secondSelection]);

    expect(service.buildRunContext()).toEqual({ skillIds: ['skill-1'], designFileIds: [], designFilePaths: [] });
  });

  it('deduplicates concurrent design file selections after API resolution', async () => {
    const filesRequest = deferred([
      projectFile({ id: 'file-1', path: 'src/Hero.tsx', name: 'Hero.tsx' }),
    ]);
    const service = new ContextPickerService({
      listSkills: async () => [],
      listDesignFiles: vi.fn(() => filesRequest.promise),
    });

    const firstSelection = service.selectDesignFile('file-1');
    const secondSelection = service.selectDesignFile('file-1');
    filesRequest.resolve();
    await Promise.all([firstSelection, secondSelection]);

    expect(service.buildRunContext()).toEqual({
      skillIds: [],
      designFileIds: ['file-1'],
      designFilePaths: ['src/Hero.tsx'],
    });
  });

  it('removeSelection removes only the requested kind and id', async () => {
    const service = new ContextPickerService(api);

    await service.selectSkill('skill-1');
    await service.selectSkill('skill-2');
    await service.selectDesignFile('file-1');
    await service.selectDesignFile('file-2');

    service.removeSelection('skill', 'skill-1');
    service.removeSelection('design-file', 'file-2');

    expect(service.buildRunContext()).toEqual({
      skillIds: ['skill-2'],
      designFileIds: ['file-1'],
      designFilePaths: ['src/Hero.tsx'],
    });
  });

  it('getSnapshot reflects selected skills and design files', async () => {
    const service = new ContextPickerService(api);

    await service.selectSkill('skill-1');
    await service.selectDesignFile('file-1');

    expect(service.getSnapshot()).toEqual({
      selectedSkills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      selectedDesignFiles: [projectFile({ id: 'file-1', path: 'src/Hero.tsx', name: 'Hero.tsx' })],
    });
  });

  it('getSnapshot does not expose mutable selected item references', async () => {
    const service = new ContextPickerService(api);

    await service.selectSkill('skill-1');
    await service.selectDesignFile('file-1');

    const snapshot = service.getSnapshot();
    snapshot.selectedSkills[0].id = 'mutated-skill';
    snapshot.selectedDesignFiles[0].path = 'mutated/path.tsx';

    expect(service.buildRunContext()).toEqual({
      skillIds: ['skill-1'],
      designFileIds: ['file-1'],
      designFilePaths: ['src/Hero.tsx'],
    });
  });

  it('notifies subscribers only after context selection state changes', async () => {
    const service = new ContextPickerService(api);
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);

    await service.selectSkill('missing-skill');
    expect(listener).not.toHaveBeenCalled();

    await service.selectSkill('skill-1');
    await service.selectSkill('skill-1');
    await service.selectDesignFile('file-1');
    service.removeSelection('skill', 'missing-skill');
    service.removeSelection('skill', 'skill-1');

    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    await service.selectSkill('skill-2');
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

function deferred<T>(value: T): { promise: Promise<T>; resolve: () => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => resolvePromise(value),
  };
}

function projectFile(overrides: Pick<ProjectFile, 'id' | 'name' | 'path'>): ProjectFile {
  return {
    ...overrides,
    type: 'file',
    size: 0,
    mtime: 0,
    kind: 'code',
    mime: 'text/tsx',
  };
}
