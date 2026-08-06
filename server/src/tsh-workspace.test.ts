import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import {
  allocateTshProjectRoot,
  assertAllowedTshParentPath,
  formatTshArtifactDateSlug,
  formatTshArtifactDatedStem,
  isTshWorkspaceAppHost,
  resolveTshParentPath,
  safeTshFileStem,
  tshProjectDisplayTitle,
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

  it('allocates design-YYYY-MM-DD-n under /workspace', () => {
    const now = new Date('2026-08-06T12:00:00.000Z');
    const stem = formatTshArtifactDatedStem('design', now);
    expect(stem).toBe(`design-${formatTshArtifactDateSlug(now)}`);
    expect(allocateTshProjectRoot('/workspace', { now })).toBe(
      join(resolve('/workspace'), `${stem}-1`),
    );
  });

  it('tshProjectDisplayTitle returns the directory basename helper', () => {
    expect(tshProjectDisplayTitle('/workspace/design-2026-08-06-1')).toBe(
      'design-2026-08-06-1',
    );
  });
});
