#!/usr/bin/env bash
set -euo pipefail

: "${OPERIS_SQLITE_FILE:?OPERIS_SQLITE_FILE zorunludur}"
: "${OPERIS_POSTGRES_URL:?OPERIS_POSTGRES_URL zorunludur}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_sqlite="$(realpath "$OPERIS_SQLITE_FILE")"

if [[ ! -f "$source_sqlite" ]]; then
  echo "SQLite kaynak dosyası bulunamadı: $source_sqlite" >&2
  exit 2
fi

for tool in sqlite3 psql pgloader node; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Gerekli araç eksik: $tool" >&2
    exit 3
  }
done

source_hash_before="$(sha256sum "$source_sqlite" | awk '{print $1}')"
integrity="$(sqlite3 "$source_sqlite" 'PRAGMA integrity_check;')"
if [[ "$integrity" != "ok" ]]; then
  echo "SQLite integrity_check başarısız: $integrity" >&2
  exit 4
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

normalized="$tmp/operis-normalized.db"
load_file="$tmp/sqlite-to-postgresql.load"
source_counts="$tmp/source-counts.tsv"
target_counts="$tmp/target-counts.tsv"

export OPERIS_SQLITE_NORMALIZED_FILE="$normalized"
bash "$repo_root/migration/normalize-prisma-sqlite-datetimes.sh"

source_hash_after="$(sha256sum "$source_sqlite" | awk '{print $1}')"
if [[ "$source_hash_before" != "$source_hash_after" ]]; then
  echo "GÜVENLİK HATASI: kaynak SQLite dosyası değişti." >&2
  exit 5
fi

sqlite3 "$source_sqlite" \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;" |
while IFS= read -r table; do
  count="$(sqlite3 "$source_sqlite" "SELECT COUNT(*) FROM \"${table//\"/\"\"}\";")"
  printf "%s\t%s\n" "$table" "$count"
done > "$source_counts"

psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public';" >/dev/null

sed \
  -e "s|{{OPERIS_SQLITE_SOURCE_URL}}|sqlite://$normalized|g" \
  -e "s|{{OPERIS_POSTGRES_URL}}|$OPERIS_POSTGRES_URL|g" \
  "$repo_root/migration/sqlite-to-postgresql.pgloader.load" > "$load_file"

pgloader --on-error-stop "$load_file"

export OPERIS_SQLITE_FILE="$source_sqlite"
bash "$repo_root/migration/verify-row-counts.sh"
bash "$repo_root/migration/verify-primary-keys.sh"

invalid_fk_count="$(psql "$OPERIS_POSTGRES_URL" -Atqc \
  "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated;")"
if [[ "$invalid_fk_count" != "0" ]]; then
  echo "VALIDATION HATASI: $invalid_fk_count foreign key doğrulanmamış." >&2
  exit 6
fi

sqlite3 "$source_sqlite" \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;" |
while IFS= read -r table; do
  count="$(psql "$OPERIS_POSTGRES_URL" -Atqc "SELECT COUNT(*) FROM \"${table//\"/\"\"}\";")"
  printf "%s\t%s\n" "$table" "$count"
done > "$target_counts"

if ! cmp -s "$source_counts" "$target_counts"; then
  echo "Final kaynak/hedef tablo sayıları uyuşmuyor." >&2
  diff -u "$source_counts" "$target_counts" >&2 || true
  exit 7
fi

echo "SQLITE_SOURCE_SHA256=$source_hash_before"
echo "SQLITE_COPY_TO_POSTGRESQL_REHEARSAL_PASS"
