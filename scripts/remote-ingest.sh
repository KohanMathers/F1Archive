#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${F1ARCHIVE_REMOTE_ENV:-.env.remote}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE: copy .env.remote.example and fill it in." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${DATABASE_URL:?set DATABASE_URL in $ENV_FILE}"
: "${SOURCE_DB:?set SOURCE_DB in $ENV_FILE}"
if [[ ! -f "$SOURCE_DB" ]]; then
  echo "No archive at $SOURCE_DB" >&2
  exit 1
fi

[[ -d node_modules ]] || pnpm install --frozen-lockfile
exec pnpm --silent --filter @f1archive/worker dev ingest --no-radio-scan --source "$(realpath "$SOURCE_DB")" "$@"
