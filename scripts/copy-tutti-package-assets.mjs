import { copyFile, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const target = process.argv[2] ?? 'all';

if (!['all', 'server', 'web'].includes(target)) {
  throw new Error('usage: node ./scripts/copy-tutti-package-assets.mjs [all|server|web]');
}

if (target === 'all' || target === 'server') {
  await copyServerAssets();
}

if (target === 'all' || target === 'web') {
  await copyWebAssets();
}

async function copyServerAssets() {
  const serverRequire = createRequire(path.join(REPO_ROOT, 'server/package.json'));
  await copyAsset(
    serverRequire.resolve('sql.js/dist/sql-wasm.wasm'),
    path.join(REPO_ROOT, 'server/dist/sql-wasm.wasm'),
  );
}

async function copyWebAssets() {
  const webRequire = createRequire(path.join(REPO_ROOT, 'web/package.json'));
  await copyAsset(
    webRequire.resolve('@tutti-os/ui-system/styles.css'),
    path.join(REPO_ROOT, 'web/dist/ui-system-styles.css'),
  );
  await copyAsset(
    path.join(REPO_ROOT, 'web/src/components/chat-ui.css'),
    path.join(REPO_ROOT, 'web/dist/assets/chat-ui.css'),
  );
  await cp(
    path.join(REPO_ROOT, 'web/src/assets'),
    path.join(REPO_ROOT, 'web/dist/assets'),
    { recursive: true, force: true },
  );
}

async function copyAsset(source, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(source, targetPath);
}
