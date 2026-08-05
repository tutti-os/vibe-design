import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import {
  allocateRenamedTshProjectRoot,
  allocateTshProjectRoot,
  assertAllowedTshParentPath,
  isTshWorkspaceAppHost,
  resolveTshParentPath,
  safeTshFileStem,
} from './tsh-workspace.js';

describe('tsh-workspace', () => {
  it('detects TSH_WORKSPACE_APP', () => {
    expect(isTshWorkspaceAppHost({ TSH_WORKSPACE_APP: '1' })).toBe(true);
    expect(isTshWorkspaceAppHost({ TSH_WORKSPACE_APP: '0' })).toBe(false);
    expect(isTshWorkspaceAppHost({})).toBe(false);
  });

  it('resolves parent paths only on TSH hosts', () => {
    const workspaceRoot = resolve('/workspace');
    expect(resolveTshParentPath(undefined, {})).toBeNull();
    expect(
      resolveTshParentPath(undefined, { TSH_WORKSPACE_APP: '1' }),
    ).toBe(workspaceRoot);
    expect(
      resolveTshParentPath('/workspace/docs', { TSH_WORKSPACE_APP: '1' }),
    ).toBe(join(workspaceRoot, 'docs'));
    expect(
      resolveTshParentPath(undefined, {
        TSH_WORKSPACE_APP: '1',
        TSH_WORKSPACE_ROOT: '/tmp/workspace-root',
      }),
    ).toBe(resolve('/tmp/workspace-root'));
  });

  it('rejects escapes and .tsh', () => {
    expect(() => assertAllowedTshParentPath('/tmp/out')).toThrow(`inside ${resolve('/workspace')}`);
    expect(() => assertAllowedTshParentPath('/workspace/.tsh')).toThrow(/\.tsh/);
    expect(() => assertAllowedTshParentPath('/workspace/.tsh/x')).toThrow(/\.tsh/);
  });

  it('keeps unicode stems', () => {
    expect(safeTshFileStem('猫猫插画')).toBe('猫猫插画');
  });

  it('allocates and renames while preserving short id', () => {
    const projectId = 'abcdef12-3456-7890-abcd-ef1234567890';
    expect(allocateTshProjectRoot('/workspace', '猫猫插画', projectId)).toBe(
      join(resolve('/workspace'), '猫猫插画-abcdef12'),
    );
    expect(
      allocateRenamedTshProjectRoot('/workspace/Untitled-abcdef12', '猫猫插画'),
    ).toBe(join(resolve('/workspace'), '猫猫插画-abcdef12'));
  });
});
