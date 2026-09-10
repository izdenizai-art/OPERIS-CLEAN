#!/usr/bin/env bash
set -euo pipefail

: "${OPERIS_SQLITE_FILE:?OPERIS_SQLITE_FILE zorunludur}"
: "${OPERIS_POSTGRES_URL:?OPERIS_POSTGRES_URL zorunludur}"
: "${OPERIS_REHEARSAL_CONFIRM:?OPERIS_REHEARSAL_CONFIRM zorunludur}"
: "${OPERIS_EXPECTED_TARGET_DATABASE:?OPERIS_EXPECTED_TARGET_DATABASE zorunludur}"

if [[ "$OPERIS_REHEARSAL_CONFIRM" != "I_CONFIRM_STAGING_COPY_ONLY" ]]; then
  echo "Bu komut yalnız staging/test kopyası için I_CONFIRM_STAGING_COPY_ONLY ile çalıştırılabilir." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_sqlite="$(realpath "$OPERIS_SQLITE_FILE")"

if [[ ! -f "$source_sqlite" ]]; then
  echo "SQLite kaynak dosyası bulunamadı: $source_sqlite" >&2
  exit 2
fi

for tool in sqlite3 psql pgloader sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Gerekli araç eksik: $tool" >&2
    exit 3
  }
done

current_database="$(psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database();')"
if [[ "$current_database" != "$OPERIS_EXPECTED_TARGET_DATABASE" ]]; then
  echo "Hedef DB kimliği uyuşmuyor. Beklenen=$OPERIS_EXPECTED_TARGET_DATABASE Gerçek=$current_database" >&2
  exit 4
fi

target_table_count="$(psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
if [[ "$target_table_count" != "50" ]]; then
  echo "Hedef PostgreSQL şeması 50 base table içermeli; gerçek=$target_table_count" >&2
  exit 5
fi

target_row_total=0
while IFS= read -r table; do
  escaped_table="${table//\"/\"\"}"
  row_count="$(psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -Atqc \
    "SELECT COUNT(*) FROM \"$escaped_table\";")"
  target_row_total=$((target_row_total + row_count))
done < <(
  psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -Atqc \
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
)

if [[ "$target_row_total" != "0" ]]; then
  echo "GÜVENLİK BLOĞU: staging hedef DB boş değil; toplam satır=$target_row_total" >&2
  exit 6
fi

source_hash_before="$(sha256sum "$source_sqlite" | awk '{print $1}')"
integrity="$(sqlite3 "$source_sqlite" 'PRAGMA integrity_check;')"
if [[ "$integrity" != "ok" ]]; then
  echo "SQLite integrity_check başarısız: $integrity" >&2
  exit 7
fi

source_table_count="$(sqlite3 "$source_sqlite" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"
if [[ "$source_table_count" != "50" ]]; then
  echo "Kaynak SQLite beklenen 50 tabloyu içermiyor; gerçek=$source_table_count" >&2
  exit 8
fi

tmp="$(mktemp -d)"
normalized="$tmp/operis-normalized.db"
drop_fk="$tmp/drop-fks.sql"
restore_fk="$tmp/restore-fks.sql"
fk_dropped=0
fk_restored=0

cleanup() {
  status=$?
  if [[ "$fk_dropped" == "1" && "$fk_restored" != "1" ]]; then
    echo "Uyarı: hata sonrası FK'ler geri yüklenmeye çalışılıyor." >&2
    psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$restore_fk" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT

export OPERIS_SQLITE_NORMALIZED_FILE="$normalized"
bash "$repo_root/migration/normalize-prisma-sqlite-datetimes.sh"

source_hash_after_normalize="$(sha256sum "$source_sqlite" | awk '{print $1}')"
if [[ "$source_hash_before" != "$source_hash_after_normalize" ]]; then
  echo "GÜVENLİK HATASI: kaynak SQLite dosyası normalizasyon sırasında değişti." >&2
  exit 9
fi

psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL' > "$tmp/fks.tsv"
SELECT
  format('ALTER TABLE %s DROP CONSTRAINT %I;', conrelid::regclass, conname),
  format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID;', conrelid::regclass, conname, pg_get_constraintdef(oid))
FROM pg_constraint
WHERE contype='f'
ORDER BY conrelid::regclass::text, conname;
SQL

cut -f1 "$tmp/fks.tsv" > "$drop_fk"
cut -f2 "$tmp/fks.tsv" > "$restore_fk"

psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$drop_fk"
fk_dropped=1

export OPERIS_SQLITE_SOURCE_URL="sqlite://$normalized"
pgloader --on-error-stop "$repo_root/migration/sqlite-to-postgresql.pgloader.load"

psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$restore_fk"
fk_restored=1

while IFS=$'\t' read -r table constraint; do
  [[ -n "$table" && -n "$constraint" ]] || continue
  psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 \
    -c "ALTER TABLE $table VALIDATE CONSTRAINT \"$constraint\";"
done < <(
  psql "$OPERIS_POSTGRES_URL" -At -F $'\t' -c \
    "SELECT conrelid::regclass::text, conname FROM pg_constraint WHERE contype='f' AND NOT convalidated ORDER BY 1,2;"
)

psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$repo_root/migration/postgresql-custom.sql"

export OPERIS_SQLITE_FILE="$source_sqlite"
bash "$repo_root/migration/verify-row-counts.sh"
bash "$repo_root/migration/verify-primary-keys.sh"
bash "$repo_root/migration/verify-critical-business-data.sh"

invalid_fk_count="$(psql "$OPERIS_POSTGRES_URL" -Atqc \
  "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated;")"
if [[ "$invalid_fk_count" != "0" ]]; then
  echo "VALIDATION HATASI: $invalid_fk_count foreign key doğrulanmamış." >&2
  exit 10
fi

serial_index="$(psql "$OPERIS_POSTGRES_URL" -Atqc \
  "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname='Asset_active_serialNumber_unique';")"
barcode_index="$(psql "$OPERIS_POSTGRES_URL" -Atqc \
  "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname='Asset_active_barcode_unique';")"
if [[ "$serial_index" != "1" || "$barcode_index" != "1" ]]; then
  echo "VALIDATION HATASI: Asset partial unique indexleri eksik." >&2
  exit 11
fi

source_hash_final="$(sha256sum "$source_sqlite" | awk '{print $1}')"
if [[ "$source_hash_before" != "$source_hash_final" ]]; then
  echo "GÜVENLİK HATASI: kaynak SQLite dosyası rehearsal sonunda değişti." >&2
  exit 12
fi

echo "SQLITE_SOURCE_SHA256=$source_hash_before"
echo "TARGET_DATABASE=$current_database"
echo "TABLE_COUNT=$target_table_count"
echo "SQLITE_COPY_TO_POSTGRESQL_REHEARSAL_PASS"
