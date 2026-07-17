import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareProjectFilesWithHistory } from './project-file-preparation.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function artifact(identifier: string, body: string): unknown[] {
  return [
    {
      type: 'text_delta',
      delta: `<artifact identifier="${identifier}" type="text/html" title="${identifier}"><!doctype html><html><body>${body}</body></html></artifact>`,
    },
    { type: 'end' },
  ];
}

describe('prepareProjectFilesWithHistory', () => {
  it('deduplicates only in flight and processes event batches supplied later', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-project-preparation-'));
    roots.push(root);
    const projectsDir = join(root, 'projects');
    const projectId = 'project-1';

    await prepareProjectFilesWithHistory(projectsDir, projectId, [artifact('first', 'first')]);
    await prepareProjectFilesWithHistory(projectsDir, projectId, [artifact('second', 'second')]);

    await expect(readFile(join(projectsDir, projectId, 'assets', 'first.html'), 'utf8')).resolves.toContain(
      '<body>first</body>',
    );
    await expect(readFile(join(projectsDir, projectId, 'assets', 'second.html'), 'utf8')).resolves.toContain(
      '<body>second</body>',
    );
  });
});
