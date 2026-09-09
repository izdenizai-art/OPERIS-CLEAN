const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const sqliteSchema = read('server/prisma/schema.sqlite.prisma');
const postgresSchema = read('server/prisma/schema.postgresql.prisma');
const activeSchema = read('server/prisma/schema.prisma');
const index = read('server/src/index.ts');
const workflow = read('.github/workflows/operis-postgresql-candidate.yml');
const backupScript = read('server/scripts/backup-sqlite-before-postgresql.mjs');
const providerScript = read('server/scripts/prepare-db-provider.cjs');
const rollback = read('windows/rollback-postgresql-to-sqlite.ps1');
const pgBackup = read('windows/postgresql-backup.ps1');
const pgRestore = read('windows/postgresql-restore.ps1');
const pgloader = read('migration/sqlite-to-postgresql.pgloader.load');

const normalizeProvider = value => value
  .replace('provider = "sqlite"', 'provider = "__DB_PROVIDER__"')
  .replace('provider = "postgresql"', 'provider = "__DB_PROVIDER__"');

const checks = [
  ['Active provider remains SQLite before cutover', activeSchema.includes('provider = "sqlite"')],
  ['SQLite rollback schema preserved', sqliteSchema.includes('provider = "sqlite"')],
  ['PostgreSQL candidate schema exists', postgresSchema.includes('provider = "postgresql"')],
  ['Model schemas otherwise identical', normalizeProvider(sqliteSchema) === normalizeProvider(postgresSchema)],

  ['PostgreSQL activation requires explicit confirmation', providerScript.includes('OPERIS_CONFIRM_POSTGRESQL') && providerScript.includes("!== 'YES'")],
  ['SQLite backup uses integrity_check', backupScript.includes('PRAGMA integrity_check')],
  ['SQLite backup uses VACUUM INTO', backupScript.includes('VACUUM INTO')],
  ['SQLite backup verifies row counts', backupScript.includes('Backup satır sayıları kaynak SQLite ile eşleşmiyor.')],
  ['Rollback requires explicit YES', rollback.includes('ValidateSet("YES")')],
  ['Rollback restores SQLite schema', rollback.includes('schema.sqlite.prisma')],

  ['Health performs DB query', index.includes("prisma.$queryRawUnsafe('SELECT 1')")],
  ['Health reports DB unavailable as 503', index.includes("code: 'DATABASE_UNAVAILABLE'") && index.includes('res.status(503)')],
  ['SQLite file backup is blocked under PostgreSQL', index.includes("code: provider === 'postgresql' ? 'POSTGRESQL_BACKUP_PROVIDER'")],
  ['PostgreSQL backup uses pg_dump custom archive', pgBackup.includes('pg_dump') && pgBackup.includes('--format=custom')],
  ['PostgreSQL restore validates SHA when present', pgRestore.includes('Get-FileHash') && pgRestore.includes('pg_restore')],

  ['CI uses PostgreSQL service', workflow.includes('image: postgres:16')],
  ['CI validates PostgreSQL Prisma schema', workflow.includes('prisma validate --schema prisma/schema.postgresql.prisma')],
  ['CI creates PostgreSQL schema', workflow.includes('prisma db push --schema prisma/schema.postgresql.prisma')],
  ['CI runs application against PostgreSQL', workflow.includes('Start OPERIS against PostgreSQL')],
  ['CI includes SQLite migration smoke', workflow.includes('sqlite-data-migration-smoke')],
  ['Migration preserves identifier case', pgloader.includes('quote identifiers')],
  ['Migration does not recreate target Prisma tables', pgloader.includes('create no tables')],
  ['Migration row counts are verified', workflow.includes('verify-row-counts.sh')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log(`\nWTD53 PostgreSQL contract PASS ${checks.length}/${checks.length}`);
