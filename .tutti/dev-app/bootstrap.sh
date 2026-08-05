#!/usr/bin/env bash

set -euo pipefail

: "${TUTTI_APP_PORT:?TUTTI_APP_PORT is required}"
: "${TUTTI_APP_NODE:?TUTTI_APP_NODE is required}"

if [[ ! "${TUTTI_APP_PORT}" =~ ^[0-9]+$ ]]; then
  echo "TUTTI_APP_PORT must be a numeric TCP port." >&2
  exit 64
fi

APP_HOST="${TUTTI_APP_HOST:-127.0.0.1}"
APP_PORT="${TUTTI_APP_PORT}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
NODE_DIR="$(cd -- "$(dirname -- "$TUTTI_APP_NODE")" && pwd)"
COREPACK_CLI="$NODE_DIR/../lib/node_modules/corepack/dist/corepack.js"

if [[ ! -f "$COREPACK_CLI" ]]; then
  COREPACK_CLI="$NODE_DIR/corepack"
  if [[ ! -x "$COREPACK_CLI" ]]; then
    echo "Corepack was not found in the managed Tutti Node runtime." >&2
    exit 69
  fi
fi

run_package_manager() {
  "$TUTTI_APP_NODE" "$COREPACK_CLI" pnpm "$@"
}

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM
  for pid in "${SERVER_PID:-}" "${SERVER_BUILD_PID:-}" "${CLIENT_PID:-}" "${CSS_PID:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "${SERVER_PID:-}" "${SERVER_BUILD_PID:-}" "${CLIENT_PID:-}" "${CSS_PID:-}"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

echo "[vibe-design] project root: $PROJECT_ROOT"
echo "[vibe-design] app: http://$APP_HOST:$APP_PORT"

cd "$PROJECT_ROOT"
mkdir -p server/dist web/dist
"$TUTTI_APP_NODE" ./scripts/copy-tutti-package-assets.mjs server
"$TUTTI_APP_NODE" ./scripts/copy-tutti-package-assets.mjs web

SERVER_BANNER="import { createRequire as __createRequire } from 'node:module';import { dirname as __pathDirname } from 'node:path';import { fileURLToPath as __fileURLToPath } from 'node:url';const require = __createRequire(import.meta.url);const __filename = __fileURLToPath(import.meta.url);const __dirname = __pathDirname(__filename);"

(
  cd "$PROJECT_ROOT"
  run_package_manager exec esbuild \
    ./server/src/main.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node24 \
    "--banner:js=$SERVER_BANNER" \
    --outfile=./server/dist/main.js \
    --watch=forever
) &
SERVER_BUILD_PID=$!

(
  cd "$PROJECT_ROOT"
  run_package_manager --filter @vibe-design/web exec esbuild \
    ./src/client.tsx \
    --bundle \
    --format=esm \
    --jsx=automatic \
    --outfile=./dist/client.js \
    --watch=forever
) &
CLIENT_PID=$!

(
  cd "$PROJECT_ROOT"
  run_package_manager --filter @vibe-design/web exec tailwindcss \
    -i ./src/styles.css \
    -o ./dist/styles.css \
    --watch=always
) &
CSS_PID=$!

for _ in {1..150}; do
  if [[ -f "$PROJECT_ROOT/server/dist/main.js" && -f "$PROJECT_ROOT/web/dist/client.js" && -f "$PROJECT_ROOT/web/dist/styles.css" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -f "$PROJECT_ROOT/server/dist/main.js" || ! -f "$PROJECT_ROOT/web/dist/client.js" || ! -f "$PROJECT_ROOT/web/dist/styles.css" ]]; then
  echo "Timed out waiting for the initial development bundles." >&2
  exit 70
fi

(
  cd "$PROJECT_ROOT/server"
  export TUTTI_APP_HOST="$APP_HOST"
  export TUTTI_APP_PORT="$APP_PORT"
  export VIBE_DESIGN_DEV_LIVE_RELOAD=1
  exec "$TUTTI_APP_NODE" --watch ./dist/main.js
) &
SERVER_PID=$!

while true; do
  for pid in "$SERVER_PID" "$SERVER_BUILD_PID" "$CLIENT_PID" "$CSS_PID"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit $?
    fi
  done
  sleep 1
done
