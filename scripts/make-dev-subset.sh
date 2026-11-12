#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-/mnt/data/f1-telem.db}"
OUT="${2:-$(dirname "$0")/../data/dev/f1-telem-dev.db}"

SESSIONS=(
  "2018|1|Australian Grand Prix|Race"
  "2018|2|Bahrain Grand Prix|Race"
  "2021|10|British Grand Prix|Sprint Qualifying"
  "2021|10|British Grand Prix|Race"
  "2021|22|Abu Dhabi Grand Prix|Qualifying"
  "2021|22|Abu Dhabi Grand Prix|Race"
  "2023|15|Singapore Grand Prix|Race"
  "2024|21|São Paulo Grand Prix|Race"
  "2026|14|Spanish Grand Prix|Race"
  "2026|20|São Paulo Grand Prix|Race"
)

if [[ -e "$OUT" ]]; then
  echo "Refusing to overwrite existing $OUT, delete it first." >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"

esc() { printf "%s" "${1//\'/\'\'}"; }

{
  echo "ATTACH 'file:${SRC}?immutable=1' AS src;"
  echo "PRAGMA main.journal_mode=OFF; PRAGMA main.synchronous=OFF;"
  echo "CREATE TABLE _subset_manifest (year INT, round INT, event TEXT, session TEXT);"
  for s in "${SESSIONS[@]}"; do
    IFS='|' read -r y r e n <<<"$s"
    echo "INSERT INTO _subset_manifest VALUES ($y, $r, '$(esc "$e")', '$(esc "$n")');"
  done
  echo "CREATE TABLE _subset_info AS SELECT 'source' AS key, '$(esc "$SRC")' AS value UNION ALL SELECT 'created_utc', strftime('%Y-%m-%dT%H:%M:%SZ','now');"
  sqlite3 "file:${SRC}?immutable=1" "SELECT sql || ';' FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  for t in $(sqlite3 "file:${SRC}?immutable=1" "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 't\_%' ESCAPE '\\'"); do
    echo "INSERT INTO main.\"$t\" SELECT * FROM src.\"$t\";"
  done
  for s in "${SESSIONS[@]}"; do
    IFS='|' read -r y r e n <<<"$s"
    echo "INSERT INTO main.telemetry SELECT * FROM src.telemetry INDEXED BY telemetry_lookup
          WHERE year = $y AND round = $r AND session = '$(esc "$n")' AND event = '$(esc "$e")'
          ORDER BY driver, ts;"
  done
  sqlite3 "file:${SRC}?immutable=1" "SELECT sql || ';' FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
} | sqlite3 "$OUT"

echo "Wrote $OUT"
sqlite3 "$OUT" "SELECT 'telemetry rows', count(*) FROM telemetry; SELECT 'radio rows', count(*) FROM t_session_team_radio;"
