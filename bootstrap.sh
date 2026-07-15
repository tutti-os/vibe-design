#!/bin/sh
set -eu

: "${TUTTI_APP_PACKAGE_DIR:?}"
: "${TUTTI_APP_ID:?}"
: "${TUTTI_WORKSPACE_ID:?}"
: "${TUTTI_WORKSPACE_NAME:?}"
: "${TUTTI_APP_HOST:?}"
: "${TUTTI_APP_RUNTIME_DIR:?}"
: "${TUTTI_APP_DATA_DIR:?}"
: "${TUTTI_APP_LOG_DIR:?}"
: "${TUTTI_APP_PORT:?}"
: "${TUTTI_APP_BASE_URL:?}"
: "${TUTTI_APP_NODE:?}"

export TUTTI_APP_PACKAGE_DIR TUTTI_APP_ID TUTTI_WORKSPACE_ID TUTTI_WORKSPACE_NAME
export TUTTI_APP_HOST TUTTI_APP_RUNTIME_DIR TUTTI_APP_DATA_DIR TUTTI_APP_LOG_DIR
export TUTTI_APP_PORT TUTTI_APP_BASE_URL TUTTI_APP_NODE
export TUTTI_APP_DATABASE_DIR="${TUTTI_APP_DATABASE_DIR:-$TUTTI_APP_DATA_DIR}"
export VIBE_WORKSPACE_ROOT="${TUTTI_WORKSPACE_ROOT:-$TUTTI_APP_DATA_DIR}"

mkdir -p "$TUTTI_APP_DATA_DIR" "$TUTTI_APP_DATABASE_DIR" "$TUTTI_APP_LOG_DIR" "$TUTTI_APP_RUNTIME_DIR"
legacy_db="$TUTTI_APP_DATA_DIR/vibe-design.sqlite"
database_db="$TUTTI_APP_DATABASE_DIR/vibe-design.sqlite"
if [ "$legacy_db" != "$database_db" ] && [ ! -e "$database_db" ] && [ -f "$legacy_db" ]; then
  database_tmp="$database_db.migrate-$$"
  wal_tmp="$database_db-wal.migrate-$$"
  rm -f "$database_tmp" "$wal_tmp"
  if [ -f "$legacy_db-wal" ]; then
    cp "$legacy_db-wal" "$wal_tmp"
    mv "$wal_tmp" "$database_db-wal"
  fi
  cp "$legacy_db" "$database_tmp"
  mv "$database_tmp" "$database_db"
fi
cd "$TUTTI_APP_PACKAGE_DIR"

exec "$TUTTI_APP_NODE" "$TUTTI_APP_PACKAGE_DIR/server/dist/main.js"
