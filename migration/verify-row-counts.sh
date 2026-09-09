#!/usr/bin/env bash
set -euo pipefail

: "${OPERIS_SQLITE_FILE:?OPERIS_SQLITE_FILE zorunludur}"
: "${OPERIS_POSTGRES_URL:?OPERIS_POSTGRES_URL zorunludur}"

failed=0
printf "table\tsqlite\tpostgres\n"

while IFS= read -r table; do
  sqlite_count="$(sqlite3 "$OPERIS_SQLITE_FILE" "SELECT COUNT(*) FROM \"$table\";")"
  escaped_table="${table//\"/\"\"}"
  postgres_count="$(psql "$OPERIS_POSTGRES_URL" -Atqc "SELECT COUNT(*) FROM \"$escaped_table\";")"
  printf "%s\t%s\t%s\n" "$table" "$sqlite_count" "$postgres_count"

  if [[ "$sqlite_count" != "$postgres_count" ]]; then
    echo "COUNT_MISMATCH: $table SQLite=$sqlite_count PostgreSQL=$postgres_count" >&2
    failed=1
  fi
done < <(
  sqlite3 "$OPERIS_SQLITE_FILE" \
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
)

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "ROW_COUNT_VALIDATION_PASS"
