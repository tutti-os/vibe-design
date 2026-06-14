import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_PACKAGE_ROOT = path.join(REPO_ROOT, 'dist/tutti-app/vibe-design');
const REQUIRED_OUTPUT_FILES = [
  'AGENTS.md',
  'COMMANDS.md',
  'bootstrap.sh',
  'icon.png',
  'locales/zh-CN/manifest.json',
  'tutti.app.json',
  'tutti.cli.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'design-systems/default/DESIGN.md',
  'design-systems/default/manifest.json',
  'server/dist/main.js',
  'server/dist/sql-wasm.wasm',
  'server/package.json',
  'web/dist/assets/agent-icons/workspace-dock-agent-claude-code.png',
  'web/dist/assets/agent-icons/workspace-dock-agent-codex.png',
  'web/dist/assets/chat-ui.css',
  'web/dist/client.js',
  'web/dist/styles.css',
  'web/dist/ui-system-styles.css',
  'web/package.json',
];

const FORBIDDEN_OUTPUT_DIRECTORIES = ['node_modules', 'server/node_modules', 'web/node_modules'];

const INCLUDED_ROOT_FILES = new Set([
  'AGENTS.tutti-app.md',
  'COMMANDS.md',
  'bootstrap.sh',
  'icon.png',
  'tutti.app.json',
  'tutti.cli.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]);

const INCLUDED_ROOT_PREFIXES = ['design-systems/', 'locales/', 'server/dist/', 'skills/', 'web/dist/'];
const INCLUDED_PACKAGE_FILES = new Set(['server/package.json', 'web/package.json']);
const EXCLUDED_PREFIXES = [
  '.git/',
  '.superpowers/',
  '.worktrees/',
  'dist/',
  'node_modules/',
  'server/.vibe/',
  'server/node_modules/',
  'web/node_modules/',
];

export function validateTuttiManifest(manifest) {
  if (manifest?.schemaVersion !== 'tutti.app.manifest.v1') {
    throw new Error('schemaVersion must be tutti.app.manifest.v1');
  }
  if (manifest.appId !== 'vibe-design') {
    throw new Error('appId must be vibe-design');
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('name is required');
  }
  if (!manifest.description || typeof manifest.description !== 'string') {
    throw new Error('description is required');
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error('version is required');
  }
  if (!manifest.runtime || typeof manifest.runtime !== 'object') {
    throw new Error('runtime is required');
  }
  if (Object.hasOwn(manifest.runtime, 'kind')) {
    throw new Error('runtime.kind must be omitted');
  }
  if (!manifest.runtime.bootstrap || typeof manifest.runtime.bootstrap !== 'string') {
    throw new Error('runtime.bootstrap is required');
  }
  validateRelativeManifestPath(manifest.runtime.bootstrap, 'runtime.bootstrap');
  if (!manifest.runtime.healthcheckPath?.startsWith('/')) {
    throw new Error('runtime.healthcheckPath must start with /');
  }
  if (Object.hasOwn(manifest, 'launch')) {
    throw new Error('launch must be omitted');
  }
  if (manifest.cli !== undefined) {
    if (!manifest.cli || typeof manifest.cli !== 'object') {
      throw new Error('cli must be an object');
    }
    if (!manifest.cli.manifest || typeof manifest.cli.manifest !== 'string') {
      throw new Error('cli.manifest is required');
    }
    validateRelativeManifestPath(manifest.cli.manifest, 'cli.manifest');
  }
  if (manifest.icon !== undefined) {
    if (!manifest.icon || typeof manifest.icon !== 'object') {
      throw new Error('icon must be an object');
    }
    if (manifest.icon.type !== 'asset') {
      throw new Error('icon.type must be asset');
    }
    if (!manifest.icon.src || typeof manifest.icon.src !== 'string') {
      throw new Error('icon.src is required');
    }
    validateRelativeManifestPath(manifest.icon.src, 'icon.src');
  }
  if (manifest.localizationInfo !== undefined) {
    validateLocalizationInfo(manifest.localizationInfo);
  }
}

function validateLocalizationInfo(localizationInfo) {
  if (!localizationInfo || typeof localizationInfo !== 'object') {
    throw new Error('localizationInfo must be an object');
  }
  if (!localizationInfo.defaultLocale || typeof localizationInfo.defaultLocale !== 'string') {
    throw new Error('localizationInfo.defaultLocale is required');
  }
  if (!Array.isArray(localizationInfo.additionalLocales)) {
    throw new Error('localizationInfo.additionalLocales must be an array');
  }
  const seenLocales = new Set();
  for (const [index, entry] of localizationInfo.additionalLocales.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`localizationInfo.additionalLocales[${index}] must be an object`);
    }
    if (!entry.locale || typeof entry.locale !== 'string') {
      throw new Error(`localizationInfo.additionalLocales[${index}].locale is required`);
    }
    const localeKey = entry.locale.toLowerCase();
    if (seenLocales.has(localeKey)) {
      throw new Error(`localizationInfo locale ${entry.locale} is duplicated`);
    }
    seenLocales.add(localeKey);
    if (!entry.file || typeof entry.file !== 'string') {
      throw new Error(`localizationInfo.additionalLocales[${index}].file is required`);
    }
    validateRelativeManifestPath(entry.file, `localizationInfo.additionalLocales[${index}].file`);
  }
}

export function createPackageFilePlan(relativeFiles) {
  return relativeFiles
    .map(toPosixPath)
    .filter(shouldIncludePackageFile)
    .map((source) => ({
      source,
      target: source === 'AGENTS.tutti-app.md' ? 'AGENTS.md' : source,
    }))
    .sort((left, right) => left.target.localeCompare(right.target));
}

export async function validatePackageOutput(packageRoot) {
  for (const relativePath of REQUIRED_OUTPUT_FILES) {
    await assertFile(path.join(packageRoot, relativePath), `${relativePath} is required`);
  }

  for (const relativePath of FORBIDDEN_OUTPUT_DIRECTORIES) {
    await assertMissingDirectory(path.join(packageRoot, relativePath), `${relativePath} must not be included`);
  }

  const bootstrapPath = path.join(packageRoot, 'bootstrap.sh');
  await access(bootstrapPath, fsConstants.X_OK).catch(() => {
    throw new Error('bootstrap.sh must be executable');
  });

  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'tutti.app.json'), 'utf8'));
  validateTuttiManifest(manifest);
  if (manifest.icon?.type === 'asset' && typeof manifest.icon.src === 'string') {
    await assertFile(path.join(packageRoot, manifest.icon.src), `${manifest.icon.src} is required`);
  }
  for (const entry of manifest.localizationInfo?.additionalLocales ?? []) {
    await assertFile(path.join(packageRoot, entry.file), `${entry.file} is required`);
  }
  if (manifest.cli?.manifest && typeof manifest.cli.manifest === 'string') {
    const cliManifestPath = path.join(packageRoot, manifest.cli.manifest);
    await assertFile(cliManifestPath, `${manifest.cli.manifest} is required`);
    await validateCliManifest(cliManifestPath, packageRoot);
  }
}

function validateRelativeManifestPath(value, fieldName) {
  if (path.isAbsolute(value) || value.includes('..')) {
    throw new Error(`${fieldName} must be relative`);
  }
}

async function validateCliManifest(cliManifestPath, packageRoot) {
  const manifest = JSON.parse(await readFile(cliManifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 'tutti.app.cli.v1') {
    throw new Error('cli schemaVersion must be tutti.app.cli.v1');
  }
  if (manifest.scope !== 'vibe-design') {
    throw new Error('cli scope must be vibe-design');
  }
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    throw new Error('cli commands are required');
  }
  if (manifest.documentation?.file !== undefined) {
    if (typeof manifest.documentation.file !== 'string') {
      throw new Error('cli documentation.file must be a string');
    }
    validateRelativeManifestPath(manifest.documentation.file, 'cli documentation.file');
    await assertFile(path.join(packageRoot, manifest.documentation.file), `${manifest.documentation.file} is required`);
  }
  for (const command of manifest.commands) {
    if (!Array.isArray(command.path) || command.path.length === 0 || command.path.some((part) => typeof part !== 'string')) {
      throw new Error('cli command.path is required');
    }
    if (command.handler?.kind !== 'http' || command.handler.method !== 'POST' || typeof command.handler.path !== 'string') {
      throw new Error(`cli command ${command.path.join(' ')} must use a POST http handler`);
    }
    if (!command.handler.path.startsWith('/tutti/cli/')) {
      throw new Error(`cli command ${command.path.join(' ')} handler must be under /tutti/cli/`);
    }
  }
}

export async function packageTuttiApp(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT;

  await run('pnpm', ['build:web'], { cwd: repoRoot });
  await run('pnpm', ['build:server'], { cwd: repoRoot });
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });

  const files = await listFiles(repoRoot);
  const plan = createPackageFilePlan(files);
  for (const entry of plan) {
    await copyPlannedFile(repoRoot, packageRoot, entry);
  }
  await chmod(path.join(packageRoot, 'bootstrap.sh'), 0o755);

  await validatePackageOutput(packageRoot);

  return { packageRoot, files: plan.length };
}

function shouldIncludePackageFile(relativePath) {
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    if (!relativePath.startsWith('server/dist/') && !relativePath.startsWith('web/dist/')) {
      return false;
    }
  }
  if (INCLUDED_ROOT_FILES.has(relativePath) || INCLUDED_PACKAGE_FILES.has(relativePath)) {
    return true;
  }
  return INCLUDED_ROOT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

async function listFiles(root) {
  const result = [];
  await walk(root, '', result);
  return result;
}

async function walk(root, relativeDir, result) {
  const absoluteDir = path.join(root, relativeDir);
  for (const entry of await readdir(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosixPath(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(relativePath)) {
        continue;
      }
      await walk(root, relativePath, result);
      continue;
    }
    if (entry.isFile()) {
      result.push(relativePath);
    }
  }
}

function shouldSkipDirectory(relativePath) {
  const normalized = toPosixPath(relativePath);
  return [
    '.git',
    '.superpowers',
    '.worktrees',
    'dist',
    'node_modules',
    'server/.vibe',
    'server/node_modules',
    'web/node_modules',
  ].some((excluded) => normalized === excluded || normalized.startsWith(`${excluded}/`));
}

async function copyPlannedFile(repoRoot, packageRoot, entry) {
  const sourcePath = path.join(repoRoot, entry.source);
  const targetPath = path.join(packageRoot, entry.target);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function assertFile(filePath, message) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(message);
  }
}

async function assertMissingDirectory(filePath, message) {
  const info = await stat(filePath).catch(() => null);
  if (info?.isDirectory()) {
    throw new Error(message);
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'unknown status'}`));
    });
  });
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const result = await packageTuttiApp();
  console.log(`Packaged Tutti app at ${result.packageRoot} (${result.files} files).`);
}
