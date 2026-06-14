# Vibe Design Tutti App Package Design

## Goal

Ship `vibe-design` as a Tutti-standard workspace app package named `vibe-design`, with `bootstrap.sh` and the production package pipeline owned by this repository.

## Scope

- Modify only `vibe-design` for this track.
- Produce a package root that matches Tutti app expectations: `tutti.app.json`, executable `bootstrap.sh`, `AGENTS.md`, runtime server files, web assets, skills, and production dependencies.
- Do not change Tutti daemon runner, app-center UI, or package import APIs in this step.
- Do not install dependencies at app startup.

## Tutti Contract

The package must satisfy the Tutti app factory reference:

- `tutti.app.json` uses schema version `tutti.app.manifest.v1`.
- `runtime.bootstrap` is a relative package path.
- `runtime.healthcheckPath` starts with `/` and resolves to a 2xx endpoint.
- `bootstrap.sh` starts the server with no arguments from `TUTTI_APP_RUNTIME_DIR`.
- The server binds `TUTTI_APP_HOST:TUTTI_APP_PORT`.
- Durable data lives under `TUTTI_APP_DATA_DIR`.
- Runtime scratch data lives under `TUTTI_APP_RUNTIME_DIR`.
- Logs live under `TUTTI_APP_LOG_DIR`.

## Runtime Design

`server/src/main.ts` remains the process entrypoint. It will resolve runtime configuration from Tutti variables first and fall back to existing standalone variables:

- host: `TUTTI_APP_HOST` or `HOST` or `127.0.0.1`
- port: `TUTTI_APP_PORT` or `PORT` or `3000`
- runtimeDir: `TUTTI_APP_DATA_DIR` or existing default `process.cwd()/.vibe`

`server/src/server.ts` will expose `/healthz` for Tutti health checks.

## Package Pipeline

Add `scripts/package-tutti-app.mjs`. It will:

- clean `dist/tutti-app/vibe-design`
- run the existing web build before packaging
- copy app metadata, server source, web source/dist, skills, lockfile, and package manifests
- install package dependencies inside the package root with `pnpm install --prod=false --frozen-lockfile`
- run `pnpm --filter @vibe-design/server type-check` inside the package
- validate `tutti.app.json`, `bootstrap.sh` executable mode, built assets, and packaged server startup

The package output is intentionally self-contained enough for `bootstrap.sh` to execute without installing dependencies at runtime.

## Risks

- SQLite persistence uses `sql.js`, so the package must include production dependencies that provide `sql.js` and its WASM asset.
- The package currently includes source plus dependencies rather than a fully bundled single-file server. That is larger but lower risk for WASM asset resolution and workspace package resolution.
