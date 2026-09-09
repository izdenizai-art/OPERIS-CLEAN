const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const workflow = read('.github/workflows/operis-postgresql-candidate.yml');
const customSql = read('migration/postgresql-custom.sql');
const pgloader = read('migration/sqlite-to-postgresql.pgloader.load');
const verifier = read('tests/verify-postgresql-initial-sql.cjs');

const checks = [
  ['Synthetic SQLite path uses github workspace', workflow.includes('${{ github.workspace }}/server/prisma/migration-smoke.db')],
  ['Old /github/workspace path removed', !workflow.includes('sqlite:///github/workspace/')],
  ['pgloader Mustache source env retained', pgloader.includes("{{OPERIS_SQLITE_SOURCE_URL}}")],
  ['pgloader Mustache target env retained', pgloader.includes("{{OPERIS_POSTGRES_URL}}")],
  ['pgloader is fail-fast', workflow.includes('pgloader --on-error-stop')],
  ['Source timestamps normalized on temporary copy', workflow.includes('Normalize Prisma SQLite timestamps') && workflow.includes('${{ runner.temp }}/migration-smoke-normalized.db')],
  ['Original SQLite source remains distinct from normalized copy', workflow.includes('${{ github.workspace }}/server/prisma/migration-smoke.db') && workflow.includes('$RUNNER_TEMP/migration-smoke-normalized.db')],
  ['Post-migration row counts verified', workflow.includes('verify-row-counts.sh')],
  ['Post-migration PK sets verified', workflow.includes('verify-primary-keys.sh')],
  ['PostgreSQL FK validation state checked', workflow.includes("NOT convalidated") && workflow.includes('invalid_fk_count')],
  ['Custom partial indexes source-controlled', customSql.includes('Asset_active_serialNumber_unique') && customSql.includes('Asset_active_barcode_unique')],
  ['Custom indexes appended to generated initial SQL', workflow.includes('cat ../migration/postgresql-custom.sql >> ../migration/generated/000000000000_postgresql_init.sql')],
  ['Initial SQL structural verifier runs in CI', workflow.includes('verify-postgresql-initial-sql.cjs')],
  ['Initial SQL verifier checks model/table parity', verifier.includes('Every Prisma model has PostgreSQL table')],
  ['Initial SQL verifier rejects SQLite tokens', verifier.includes('No SQLite-only SQL token')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log(`\nWTD55 PostgreSQL migration contract PASS ${checks.length}/${checks.length}`);
