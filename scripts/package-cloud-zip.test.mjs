import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanPreviousCloudZips,
  copyCloudZipToOutput,
  resolveCloudZipPaths,
} from './package-cloud-zip.mjs';

test('resolveCloudZipPaths uses the cloud upload output directory', () => {
  const paths = resolveCloudZipPaths({
    outputDir: '/tmp/vibe-output',
    version: '1.2.3',
  });

  assert.equal(
    paths.buildZipPath.endsWith('dist/tutti-app/vibe-design-1.2.3.zip'),
    true,
  );
  assert.equal(
    paths.packageRoot.endsWith('dist/tutti-app/vibe-design'),
    true,
  );
  assert.equal(
    paths.outputZipPath,
    '/tmp/vibe-output/vibe-design-1.2.3.zip',
  );
});

test('copyCloudZipToOutput replaces stale app zips without deleting other files', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'vibe-cloud-zip-'));
  try {
    const sourceZipPath = path.join(tempRoot, 'vibe-design-2.0.0.zip');
    const outputDir = path.join(tempRoot, 'output');

    await writeFile(sourceZipPath, 'new zip\n');
    await mkdir(outputDir);
    await writeFile(path.join(outputDir, 'vibe-design-1.0.0.zip'), 'old\n');
    await writeFile(path.join(outputDir, 'notes.txt'), 'keep\n');

    const outputZipPath = await copyCloudZipToOutput({
      outputDir,
      sourceZipPath,
    });

    assert.equal(
      outputZipPath,
      path.join(outputDir, 'vibe-design-2.0.0.zip'),
    );
    assert.equal(await readFile(outputZipPath, 'utf8'), 'new zip\n');
    await assert.rejects(
      readFile(path.join(outputDir, 'vibe-design-1.0.0.zip'), 'utf8'),
      /ENOENT/,
    );
    assert.equal(
      await readFile(path.join(outputDir, 'notes.txt'), 'utf8'),
      'keep\n',
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('cleanPreviousCloudZips tolerates a missing output directory', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'vibe-cloud-zip-'));
  try {
    await cleanPreviousCloudZips(path.join(tempRoot, 'missing-output'));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
