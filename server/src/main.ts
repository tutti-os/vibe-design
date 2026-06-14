import { pathToFileURL } from 'node:url';
import { createServer } from './server.js';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

export interface RuntimeConfig {
  host: string;
  port: number;
  runtimeDir?: string;
}

function resolvePort(value: string | undefined, fallback = DEFAULT_PORT): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    host: env.TUTTI_APP_HOST?.trim() || env.HOST?.trim() || DEFAULT_HOST,
    port: resolvePort(env.TUTTI_APP_PORT, resolvePort(env.PORT)),
    runtimeDir: env.TUTTI_APP_DATA_DIR?.trim() || undefined,
  };
}

export { createServer };

const entrypointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (import.meta.url === entrypointUrl) {
  const runtime = resolveRuntimeConfig();
  createServer({ runtimeDir: runtime.runtimeDir }).listen(runtime.port, runtime.host, () => {
    console.log(
      JSON.stringify({
        host: runtime.host,
        message: 'listening',
        port: runtime.port,
        prefix: 'vibe-design-server',
        runtimeDir: runtime.runtimeDir ?? null,
      }),
    );
  });
}
