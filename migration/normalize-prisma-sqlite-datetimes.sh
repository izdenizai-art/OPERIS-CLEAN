#!/usr/bin/env bash
set -euo pipefail

: "${OPERIS_SQLITE_FILE:?OPERIS_SQLITE_FILE zorunludur}"
: "${OPERIS_SQLITE_NORMALIZED_FILE:?OPERIS_SQLITE_NORMALIZED_FILE zorunludur}"

source_file="$OPERIS_SQLITE_FILE"
target_file="$OPERIS_SQLITE_NORMALIZED_FILE"

if [[ ! -f "$source_file" ]]; then
  echo "SQLite kaynak dosyası bulunamadı: $source_file" >&2
  exit 1
fi

if [[ "$source_file" == "$target_file" ]]; then
  echo "Kaynak SQLite dosyası yerinde değiştirilemez; ayrı bir geçici hedef kullanın." >&2
  exit 1
fi

cp -- "$source_file" "$target_file"

while IFS='|' read -r table column; do
  [[ -n "$table" && -n "$column" ]] || continue
  escaped_table="${table//\"/\"\"}"
  escaped_column="${column//\"/\"\"}"
  sqlite3 "$target_file" "
    UPDATE \"$escaped_table\"
       SET \"$escaped_column\" = strftime('%Y-%m-%d %H:%M:%f', \"$escaped_column\" / 1000.0, 'unixepoch')
     WHERE typeof(\"$escaped_column\") IN ('integer', 'real');
  "
done < <(
  sqlite3 -separator '|' "$target_file" "
    SELECT m.name, p.name
      FROM sqlite_master AS m,
           pragma_table_info(m.name) AS p
     WHERE m.type = 'table'
       AND m.name NOT LIKE 'sqlite_%'
       AND upper(p.type) IN ('DATETIME', 'TIMESTAMP', 'TIMESTAMPTZ')
     ORDER BY m.name, p.cid;
  "
)

echo "PRISMA_SQLITE_DATETIME_NORMALIZATION_PASS"
