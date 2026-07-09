import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createPackageFilePlan,
  validateTuttiManifest,
  validatePackageOutput,
} from './package-tutti-app.mjs';

test('validates the vibe-design Tutti app manifest contract', () => {
  assert.doesNotThrow(() =>
    validateTuttiManifest({
      appId: 'vibe-design',
      cli: { manifest: 'tutti.cli.json' },
      description: 'Create and iterate on design prototypes.',
      icon: { type: 'asset', src: 'icon.png' },
      name: 'Prototype Design',
      runtime: {
        bootstrap: 'bootstrap.sh',
        healthcheckPath: '/healthz',
      },
      schemaVersion: 'tutti.app.manifest.v1',
      version: '0.1.0',
    }),
  );

  assert.throws(
    () =>
      validateTuttiManifest({
        appId: 'vibe-design',
        description: 'Create and iterate on design prototypes.',
        name: 'Prototype Design',
        runtime: {
          bootstrap: '/bootstrap.sh',
          healthcheckPath: 'healthz',
        },
        schemaVersion: 'tutti.app.manifest.v1',
        version: '0.1.0',
      }),
    /runtime\.bootstrap must be relative/,
  );
});

test('keeps catalog display metadata in the source Tutti app manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../tutti.app.json', import.meta.url), 'utf8'));
  const zhCNManifest = JSON.parse(await readFile(new URL('../locales/zh-CN/manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.name, 'Prototype Design');
  assert.equal(manifest.description, 'Create and iterate on design prototypes.');
  assert.equal(zhCNManifest.name, '产品原型设计');
  assert.equal(zhCNManifest.description, '创建并迭代产品原型设计');
});

test('exposes the expected Tutti CLI capabilities', async () => {
  const manifest = JSON.parse(await readFile(new URL('../tutti.cli.json', import.meta.url), 'utf8'));
  const commandPaths = manifest.commands.map((command) => command.path.join(' '));

  assert.deepEqual(commandPaths, [
    'projects',
    'open',
    'project-create',
    'session-start',
    'conversations',
    'conversation-messages',
    'files',
    'file-get',
    'comments',
  ]);
  // Prototype creation is allowed; destructive verbs remain unavailable.
  assert.equal(commandPaths.some((command) => /update|delete|rename|project-data|project-get/.test(command)), false);
});

test('command handler timeouts stay within the Tutti release tooling bounds', async () => {
  // The publish pipeline rejects any handler.timeoutMs outside [1000, 300000].
  const manifest = JSON.parse(await readFile(new URL('../tutti.cli.json', import.meta.url), 'utf8'));
  for (const command of manifest.commands) {
    const timeoutMs = command.handler?.timeoutMs;
    if (timeoutMs === undefined) continue;
    assert.ok(
      Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000,
      `${command.path.join(' ')} handler.timeoutMs must be between 1000 and 300000, got ${timeoutMs}`,
    );
  }
});

test('plans only files that belong in the Tutti app package root', () => {
  const relativeFiles = [
    '.git/config',
    'AGENTS.tutti-app.md',
    'dist/old/file.txt',
    'design-systems/openai/DESIGN.md',
    'design-systems/openai/manifest.json',
    'design-systems/openai/tokens.css',
    'icon.png',
    'node_modules/.bin/tsx',
    'COMMANDS.md',
    'tutti.cli.json',
    'tutti.app.json',
    'locales/zh-CN/manifest.json',
    'package.json',
    'pnpm-lock.yaml',
    'server/.vibe/vibe-design.sqlite',
    'server/dist/main.js',
    'server/package.json',
    'skills/html-ppt/SKILL.md',
    'web/dist/assets/agent-icons/workspace-dock-agent-codex.png',
    'web/dist/assets/chat-ui.css',
    'web/dist/client.js',
    'web/node_modules/.bin/tailwindcss',
    'web/package.json',
    'web/src/render-page.tsx',
  ];

  assert.deepEqual(createPackageFilePlan(relativeFiles), [
    { source: 'AGENTS.tutti-app.md', target: 'AGENTS.md' },
    { source: 'COMMANDS.md', target: 'COMMANDS.md' },
    {
      source: 'design-systems/openai/DESIGN.md',
      target: 'design-systems/openai/DESIGN.md',
    },
    {
      source: 'design-systems/openai/manifest.json',
      target: 'design-systems/openai/manifest.json',
    },
    {
      source: 'design-systems/openai/tokens.css',
      target: 'design-systems/openai/tokens.css',
    },
    { source: 'icon.png', target: 'icon.png' },
    { source: 'locales/zh-CN/manifest.json', target: 'locales/zh-CN/manifest.json' },
    { source: 'package.json', target: 'package.json' },
    { source: 'pnpm-lock.yaml', target: 'pnpm-lock.yaml' },
    { source: 'server/dist/main.js', target: 'server/dist/main.js' },
    { source: 'server/package.json', target: 'server/package.json' },
    { source: 'skills/html-ppt/SKILL.md', target: 'skills/html-ppt/SKILL.md' },
    { source: 'tutti.app.json', target: 'tutti.app.json' },
    { source: 'tutti.cli.json', target: 'tutti.cli.json' },
    {
      source: 'web/dist/assets/agent-icons/workspace-dock-agent-codex.png',
      target: 'web/dist/assets/agent-icons/workspace-dock-agent-codex.png',
    },
    { source: 'web/dist/assets/chat-ui.css', target: 'web/dist/assets/chat-ui.css' },
    { source: 'web/dist/client.js', target: 'web/dist/client.js' },
    { source: 'web/package.json', target: 'web/package.json' },
  ]);
});

test('validates required package output files and executable bootstrap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-design-tutti-package-'));
  try {
    await mkdir(path.join(root, 'server/dist'), { recursive: true });
    await mkdir(path.join(root, 'web/dist/assets/agent-icons'), { recursive: true });
    await mkdir(path.join(root, 'web/dist'), { recursive: true });
    await mkdir(path.join(root, 'design-systems/default'), { recursive: true });
    await writeFile(path.join(root, 'AGENTS.md'), '');
    await writeFile(path.join(root, 'COMMANDS.md'), '# Prototype Design CLI Commands\n');
    await writeFile(path.join(root, 'icon.png'), 'icon');
    await mkdir(path.join(root, 'locales/zh-CN'), { recursive: true });
    await writeFile(
      path.join(root, 'locales/zh-CN/manifest.json'),
      JSON.stringify({
        name: '产品原型设计',
        description: '创建并迭代产品原型设计',
        tags: ['设计', '原型', '工作区'],
      }),
    );
    await writeFile(
      path.join(root, 'tutti.app.json'),
      JSON.stringify({
        appId: 'vibe-design',
        cli: { manifest: 'tutti.cli.json' },
        description: 'Create and iterate on design prototypes.',
        icon: { type: 'asset', src: 'icon.png' },
        localizationInfo: {
          defaultLocale: 'en',
          additionalLocales: [{ locale: 'zh-CN', file: 'locales/zh-CN/manifest.json' }],
        },
        name: 'Prototype Design',
        runtime: {
          bootstrap: 'bootstrap.sh',
          healthcheckPath: '/healthz',
        },
        schemaVersion: 'tutti.app.manifest.v1',
        version: '0.1.0',
      }),
    );
    await writeFile(
      path.join(root, 'tutti.cli.json'),
      JSON.stringify({
        schemaVersion: 'tutti.app.cli.v1',
        scope: 'vibe-design',
        documentation: { file: 'COMMANDS.md' },
        commands: [
          {
            path: ['projects'],
            summary: 'List Prototype Design projects',
            output: { defaultMode: 'json', json: true },
            handler: { kind: 'http', method: 'POST', path: '/tutti/cli/projects' },
          },
        ],
      }),
    );
    await writeFile(path.join(root, 'package.json'), '{}');
    await writeFile(path.join(root, 'pnpm-lock.yaml'), '');
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), '');
    await writeFile(path.join(root, 'bootstrap.sh'), '#!/bin/sh\n');
    await writeFile(path.join(root, 'design-systems/default/DESIGN.md'), '# Default\n');
    await writeFile(path.join(root, 'design-systems/default/manifest.json'), '{}');
    await writeFile(path.join(root, 'server/dist/main.js'), '');
    await writeFile(path.join(root, 'server/dist/sql-wasm.wasm'), '');
    await writeFile(path.join(root, 'server/package.json'), '{}');
    await writeFile(path.join(root, 'web/dist/assets/agent-icons/workspace-dock-agent-codex.png'), 'icon');
    await writeFile(path.join(root, 'web/dist/assets/agent-icons/workspace-dock-agent-claude-code.png'), 'icon');
    await writeFile(path.join(root, 'web/dist/assets/chat-ui.css'), '.chat-pane {}');
    await writeFile(path.join(root, 'web/dist/client.js'), '');
    await writeFile(path.join(root, 'web/dist/styles.css'), '');
    await writeFile(path.join(root, 'web/dist/ui-system-styles.css'), '');
    await writeFile(path.join(root, 'web/package.json'), '{}');

    await assert.rejects(() => validatePackageOutput(root), /bootstrap\.sh must be executable/);

    await chmod(path.join(root, 'bootstrap.sh'), 0o755);
    await assert.doesNotReject(() => validatePackageOutput(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects package output that contains installed node_modules', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-design-tutti-package-'));
  try {
    await mkdir(path.join(root, 'server/dist'), { recursive: true });
    await mkdir(path.join(root, 'web/dist/assets/agent-icons'), { recursive: true });
    await mkdir(path.join(root, 'web/dist'), { recursive: true });
    await mkdir(path.join(root, 'design-systems/default'), { recursive: true });
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'AGENTS.md'), '');
    await writeFile(path.join(root, 'COMMANDS.md'), '# Prototype Design CLI Commands\n');
    await writeFile(path.join(root, 'icon.png'), 'icon');
    await mkdir(path.join(root, 'locales/zh-CN'), { recursive: true });
    await writeFile(
      path.join(root, 'locales/zh-CN/manifest.json'),
      JSON.stringify({
        name: '产品原型设计',
        description: '创建并迭代产品原型设计',
        tags: ['设计', '原型', '工作区'],
      }),
    );
    await writeFile(
      path.join(root, 'tutti.app.json'),
      JSON.stringify({
        appId: 'vibe-design',
        cli: { manifest: 'tutti.cli.json' },
        description: 'Create and iterate on design prototypes.',
        icon: { type: 'asset', src: 'icon.png' },
        localizationInfo: {
          defaultLocale: 'en',
          additionalLocales: [{ locale: 'zh-CN', file: 'locales/zh-CN/manifest.json' }],
        },
        name: 'Prototype Design',
        runtime: {
          bootstrap: 'bootstrap.sh',
          healthcheckPath: '/healthz',
        },
        schemaVersion: 'tutti.app.manifest.v1',
        version: '0.1.0',
      }),
    );
    await writeFile(
      path.join(root, 'tutti.cli.json'),
      JSON.stringify({
        schemaVersion: 'tutti.app.cli.v1',
        scope: 'vibe-design',
        documentation: { file: 'COMMANDS.md' },
        commands: [
          {
            path: ['projects'],
            summary: 'List Prototype Design projects',
            output: { defaultMode: 'json', json: true },
            handler: { kind: 'http', method: 'POST', path: '/tutti/cli/projects' },
          },
        ],
      }),
    );
    await writeFile(path.join(root, 'package.json'), '{}');
    await writeFile(path.join(root, 'pnpm-lock.yaml'), '');
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), '');
    await writeFile(path.join(root, 'bootstrap.sh'), '#!/bin/sh\n');
    await chmod(path.join(root, 'bootstrap.sh'), 0o755);
    await writeFile(path.join(root, 'design-systems/default/DESIGN.md'), '# Default\n');
    await writeFile(path.join(root, 'design-systems/default/manifest.json'), '{}');
    await writeFile(path.join(root, 'server/dist/main.js'), '');
    await writeFile(path.join(root, 'server/dist/sql-wasm.wasm'), '');
    await writeFile(path.join(root, 'server/package.json'), '{}');
    await writeFile(path.join(root, 'web/dist/assets/agent-icons/workspace-dock-agent-codex.png'), 'icon');
    await writeFile(path.join(root, 'web/dist/assets/agent-icons/workspace-dock-agent-claude-code.png'), 'icon');
    await writeFile(path.join(root, 'web/dist/assets/chat-ui.css'), '.chat-pane {}');
    await writeFile(path.join(root, 'web/dist/client.js'), '');
    await writeFile(path.join(root, 'web/dist/styles.css'), '');
    await writeFile(path.join(root, 'web/dist/ui-system-styles.css'), '');
    await writeFile(path.join(root, 'web/package.json'), '{}');

    await assert.rejects(() => validatePackageOutput(root), /node_modules must not be included/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('package script does not rebuild or require native sqlite bindings', async () => {
  const source = await readFile(new URL('./package-tutti-app.mjs', import.meta.url), 'utf8');

  assert.equal(source.includes('rebuildBetterSqlite'), false);
  assert.equal(source.includes('better-sqlite3'), false);
});

test('package script applies the ACP compatibility patch before building', async () => {
  const source = await readFile(new URL('./package-tutti-app.mjs', import.meta.url), 'utf8');
  const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');

  assert.match(source, /patch-agent-acp-kit-base\.mjs/);
  assert.doesNotMatch(JSON.parse(packageSource).scripts['package:tutti-app'], /patch-agent-acp-kit-base/);

  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./patch-agent-acp-kit-base.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const restore = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./patch-agent-acp-kit-base.mjs', import.meta.url)), '--restore'],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
  );
  assert.equal(restore.status, 0, restore.stderr || restore.stdout);
});

test('package script does not install dependencies into package output', async () => {
  const source = await readFile(new URL('./package-tutti-app.mjs', import.meta.url), 'utf8');

  assert.equal(source.includes("['install', '--prod', '--frozen-lockfile']"), false);
  assert.equal(source.includes('pnpm install'), false);
});

test('bootstrap uses the managed Tutti Node runtime', async () => {
  const source = await readFile(new URL('../bootstrap.sh', import.meta.url), 'utf8');

  assert.equal(source.includes('TUTTI_APP_NODE'), true);
  assert.equal(source.includes('TUTTI_APP_NODE'), true);
  assert.equal(source.includes('VIBE_TUTTI_CLI="${TUTTI_CLI:-}"'), true);
  assert.equal(source.includes('exec node '), false);
});
