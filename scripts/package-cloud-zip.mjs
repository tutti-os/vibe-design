import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'output');
const APP_ID = 'vibe-design';
const OUTPUT_ZIP_PATTERN = /^vibe-design-.+\.zip$/;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export async function readPackageVersion() {
  const manifest = JSON.parse(await readFile(path.join(REPO_ROOT, 'tutti.app.json'), 'utf8'));
  return manifest.version ?? '0.0.0';
}

export function resolveCloudZipPaths({
  outputDir = DEFAULT_OUTPUT_DIR,
  version,
} = {}) {
  if (!version) {
    throw new Error('version is required.');
  }
  const fileName = `${APP_ID}-${version}.zip`;
  return {
    buildZipPath: path.join(REPO_ROOT, 'dist', 'tutti-app', fileName),
    packageRoot: path.join(REPO_ROOT, 'dist', 'tutti-app', APP_ID),
    outputZipPath: path.join(outputDir, fileName),
  };
}

export async function cleanPreviousCloudZips(outputDir = DEFAULT_OUTPUT_DIR) {
  let entries;
  try {
    entries = await readdir(outputDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && OUTPUT_ZIP_PATTERN.test(entry.name))
      .map((entry) => rm(path.join(outputDir, entry.name), { force: true })),
  );
}

export async function createCloudZip({
  buildZipPath,
  packageRoot,
} = {}) {
  if (!buildZipPath) {
    throw new Error('buildZipPath is required.');
  }
  if (!packageRoot) {
    throw new Error('packageRoot is required.');
  }

  await stat(packageRoot);
  await rm(buildZipPath, { force: true });
  await mkdir(path.dirname(buildZipPath), { recursive: true });
  await run('zip', ['-qr', buildZipPath, '.'], { cwd: packageRoot });
  return buildZipPath;
}

export async function copyCloudZipToOutput({
  outputDir = DEFAULT_OUTPUT_DIR,
  sourceZipPath,
} = {}) {
  if (!sourceZipPath) {
    throw new Error('sourceZipPath is required.');
  }

  await stat(sourceZipPath);
  await mkdir(outputDir, { recursive: true });
  await cleanPreviousCloudZips(outputDir);

  const outputZipPath = path.join(outputDir, path.basename(sourceZipPath));
  await copyFile(sourceZipPath, outputZipPath);
  return outputZipPath;
}

export async function packageCloudZip({ outputDir = DEFAULT_OUTPUT_DIR } = {}) {
  const version = await readPackageVersion();
  const { buildZipPath, packageRoot } = resolveCloudZipPaths({ version });

  await run('pnpm', ['package:tutti-app']);
  await createCloudZip({ buildZipPath, packageRoot });
  const outputZipPath = await copyCloudZipToOutput({
    outputDir,
    sourceZipPath: buildZipPath,
  });

  console.log(`Created ${outputZipPath}`);
  return outputZipPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  packageCloudZip().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
