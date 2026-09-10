#!/usr/bin/env bash
set -euo pipefail
# Dedicated synthetic database only; never use the staging/production URL.
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || { echo 'CI-only test'; exit 2; }
export PGPASSWORD=operis_ci_password
db="operis_push_safety_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
tmp="$(mktemp -d)"
createdb -h localhost -U operis "$db"
cleanup() { dropdb -h localhost -U operis "$db"; rm -rf "$tmp"; }
trap cleanup EXIT
export DATABASE_URL="postgresql://operis:operis_ci_password@localhost:5432/$db"
cat > "$tmp/schema.prisma" <<'SCHEMA'
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}
model SafetyRecord {
  id Int @id
  retained String
}
SCHEMA
push() { npm --prefix server run prisma:push -- --schema "$tmp/schema.prisma" --skip-generate; }
push
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'INSERT INTO "SafetyRecord" VALUES (1, '\''must-survive'\'');'
push
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'ALTER TABLE "SafetyRecord" ADD COLUMN legacy text; UPDATE "SafetyRecord" SET legacy = '\''must-not-be-dropped'\'';'
pg_dump "$DATABASE_URL" --no-owner --no-privileges > "$tmp/before.sql"
if push > "$tmp/rejected.log" 2>&1; then
  echo 'FAIL: destructive schema change was accepted' >&2
  exit 1
fi
grep -q -- '--accept-data-loss' "$tmp/rejected.log" || { cat "$tmp/rejected.log"; exit 1; }
pg_dump "$DATABASE_URL" --no-owner --no-privileges > "$tmp/after.sql"
# New pg_dump versions emit a random \restrict token unrelated to DB contents.
sed '/^\\restrict /d; /^\\unrestrict /d' "$tmp/before.sql" > "$tmp/before-normalized.sql"
sed '/^\\restrict /d; /^\\unrestrict /d' "$tmp/after.sql" > "$tmp/after-normalized.sql"
cmp "$tmp/before-normalized.sql" "$tmp/after-normalized.sql"
echo 'PRISMA_PUSH_CLEAN_CURRENT_SCHEMA_PASS'
echo 'PRISMA_PUSH_DESTRUCTIVE_REFUSED_DB_UNCHANGED_PASS'
