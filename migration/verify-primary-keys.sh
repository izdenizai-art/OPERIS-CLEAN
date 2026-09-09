#!/usr/bin/env bash
set -euo pipefail

: "${OPERIS_SQLITE_FILE:?OPERIS_SQLITE_FILE zorunludur}"
: "${OPERIS_POSTGRES_URL:?OPERIS_POSTGRES_URL zorunludur}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failed=0

while IFS= read -r table; do
  mapfile -t pk_cols < <(
    sqlite3 "$OPERIS_SQLITE_FILE" \
      "PRAGMA table_info(\"${table//\"/\"\"}\");" |
      awk -F'|' '$6 > 0 { print $2 "|" $6 }' |
      sort -t'|' -k2,2n |
      cut -d'|' -f1
  )

  if [[ "${#pk_cols[@]}" -eq 0 ]]; then
    echo "SKIP_NO_PK: $table"
    continue
  fi

  sqlite_expr=""
  postgres_expr=""
  for col in "${pk_cols[@]}"; do
    qcol="${col//\"/\"\"}"
    if [[ -n "$sqlite_expr" ]]; then
      sqlite_expr+=" || char(31) || "
      postgres_expr+=" || chr(31) || "
    fi
    sqlite_expr+="COALESCE(CAST(\"$qcol\" AS TEXT),'')"
    postgres_expr+="COALESCE(CAST(\"$qcol\" AS TEXT),'')"
  done

  safe_table="${table//\"/\"\"}"
  sqlite3 "$OPERIS_SQLITE_FILE" \
    "SELECT $sqlite_expr FROM \"$safe_table\" ORDER BY 1;" > "$tmp/sqlite.pk"

  psql "$OPERIS_POSTGRES_URL" -Atqc \
    "SELECT $postgres_expr FROM \"$safe_table\" ORDER BY 1;" > "$tmp/postgres.pk"

  if ! cmp -s "$tmp/sqlite.pk" "$tmp/postgres.pk"; then
    echo "PRIMARY_KEY_SET_MISMATCH: $table" >&2
    diff -u "$tmp/sqlite.pk" "$tmp/postgres.pk" | head -200 >&2 || true
    failed=1
  else
    echo "PK_PASS: $table"
  fi
done < <(
  sqlite3 "$OPERIS_SQLITE_FILE" \
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
)

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "PRIMARY_KEY_VALIDATION_PASS"
