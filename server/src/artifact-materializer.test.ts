import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeArtifactRunEvent } from './artifact-materializer.js';
import type { ChatRun } from './types/run.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function run(projectId: string, id: string): ChatRun {
  return { id, projectId } as ChatRun;
}

function artifact(identifier: string, body: string) {
  return {
    type: 'text_delta',
    delta: `<artifact identifier="${identifier}" type="text/html" title="${identifier}"><!doctype html><html><body>${body}</body></html></artifact>`,
  };
}

describe('materializeArtifactRunEvent', () => {
  it('isolates a failed project queue entry so a later event can materialize', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-artifact-queue-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-1';
    const projectDir = join(projectsDir, projectId);
    await mkdir(projectDir, { recursive: true });
    // Force the first mkdir(assets) to fail.
    await writeFile(join(projectDir, 'assets'), 'not a directory', 'utf8');

    const failed = materializeArtifactRunEvent(
      projectsDir,
      run(projectId, 'run-1'),
      artifact('first', 'first'),
    );
    const queuedBehindFailure = materializeArtifactRunEvent(
      projectsDir,
      run(projectId, 'run-2'),
      { type: 'status' },
    );
    await expect(failed).rejects.toBeDefined();
    await expect(queuedBehindFailure).resolves.toBeUndefined();

    await unlink(join(projectDir, 'assets'));
    await expect(
      materializeArtifactRunEvent(projectsDir, run(projectId, 'run-3'), artifact('second', 'second')),
    ).resolves.toBeUndefined();
    await expect(readFile(join(projectDir, 'assets', 'second.html'), 'utf8')).resolves.toContain(
      '<body>second</body>',
    );
  });
});
