const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const active = read('server/prisma/schema.prisma');
const sqlite = read('server/prisma/schema.sqlite.prisma');
const pg = read('server/prisma/schema.postgresql.prisma');
const provider = read('server/scripts/prepare-db-provider.cjs');
const sqliteBackup = read('server/scripts/backup-sqlite-before-postgresql.mjs');
const rollback = read('windows/rollback-postgresql-to-sqlite.ps1');
const fullBackup = read('windows/pre-postgresql-full-backup.ps1');
const pgBackup = read('windows/postgresql-backup.ps1');
const pgRestore = read('windows/postgresql-restore.ps1');
const index = read('server/src/index.ts');
const workflow = read('.github/workflows/operis-postgresql-candidate.yml');
const pgloader = read('migration/sqlite-to-postgresql.pgloader.load');
const rowVerify = read('migration/verify-row-counts.sh');
const pkVerify = read('migration/verify-primary-keys.sh');
const compose = read('docker-compose.postgresql.candidate.yml');
const dockerPg = read('Dockerfile.postgresql');

const norm = x => x
  .replace('provider = "sqlite"', 'provider = "__PROVIDER__"')
  .replace('provider = "postgresql"', 'provider = "__PROVIDER__"');

const checks = [
  ['Active schema still SQLite', active.includes('provider = "sqlite"')],
  ['SQLite rollback schema preserved', sqlite.includes('provider = "sqlite"')],
  ['PostgreSQL candidate schema present', pg.includes('provider = "postgresql"')],
  ['Provider-only schema difference', norm(sqlite) === norm(pg)],
  ['PostgreSQL activation explicit YES', provider.includes('OPERIS_CONFIRM_POSTGRESQL') && provider.includes("!== 'YES'")],

  ['SQLite backup integrity_check', sqliteBackup.includes('PRAGMA integrity_check')],
  ['SQLite backup VACUUM INTO', sqliteBackup.includes('VACUUM INTO')],
  ['SQLite backup row-count compare', sqliteBackup.includes('Backup satır sayıları kaynak SQLite ile eşleşmiyor.')],
  ['Full backup includes Help Desk attachments', fullBackup.includes('helpdesk-attachments')],
  ['Full backup has file SHA manifest', fullBackup.includes('Get-FileHash') && fullBackup.includes('manifest.json')],

  ['Rollback explicit YES', rollback.includes('ValidateSet("YES")')],
  ['Rollback byte-for-byte SHA check', rollback.includes('copiedHash') && rollback.includes('finalHash')],
  ['Rollback never runs prisma db push', !/^\s*(npm\s+run\s+prisma:push|npx\s+prisma\s+db\s+push|prisma\s+db\s+push)\b/im.test(rollback)],

  ['Health queries actual DB', index.includes("prisma.$queryRawUnsafe('SELECT 1')")],
  ['Health DB fail is 503', index.includes("DATABASE_UNAVAILABLE") && index.includes('res.status(503)')],
  ['SQLite file backup blocked on PostgreSQL', index.includes('POSTGRESQL_BACKUP_PROVIDER')],

  ['PostgreSQL backup uses custom pg_dump', pgBackup.includes('--format=custom')],
  ['PostgreSQL dump password not in process URL', pgBackup.includes('PGPASSWORD') && pgBackup.includes('--dbname=$($connection.Database)')],
  ['PostgreSQL restore verifies SHA', pgRestore.includes('Get-FileHash') && pgRestore.includes('pg_restore')],
  ['PostgreSQL restore password not in process URL', pgRestore.includes('PGPASSWORD') && pgRestore.includes('--dbname=$($connection.Database)')],

  ['PostgreSQL Docker is separate from SQLite Docker', fs.existsSync(path.join(repo,'Dockerfile')) && fs.existsSync(path.join(repo,'Dockerfile.postgresql'))],
  ['PostgreSQL Docker refuses non-PostgreSQL URL', dockerPg.includes('DATABASE_URL PostgreSQL değil')],
  ['Compose requires explicit encoded DATABASE_URL', compose.includes('OPERIS_POSTGRES_DATABASE_URL') && !compose.includes('${OPERIS_POSTGRES_PASSWORD}@postgres')],
  ['Postgres persistent data volume', compose.includes('operis_postgresql_data:/var/lib/postgresql/data')],
  ['App data volume kept separate', compose.includes('operis_app_data:/data')],

  ['CI PostgreSQL service container', workflow.includes('image: postgres:16')],
  ['CI validates PostgreSQL schema', workflow.includes('prisma validate --schema prisma/schema.postgresql.prisma')],
  ['CI generates reviewable initial migration SQL', workflow.includes('prisma migrate diff') && workflow.includes('000000000000_postgresql_init.sql')],
  ['CI applies initial SQL to second clean DB', workflow.includes('operis_migration_sql_ci')],
  ['CI exports migration SQL artifact', workflow.includes('operis-postgresql-initial-migration-sql')],

  ['pgloader target schema not recreated', pgloader.includes('create no tables')],
  ['pgloader identifier case preserved', pgloader.includes('quote identifiers')],
  ['pgloader avoids DISABLE TRIGGER ALL', !pgloader.includes('disable triggers')],
  ['All table row counts checked', rowVerify.includes('ROW_COUNT_VALIDATION_PASS')],
  ['Primary key sets checked', pkVerify.includes('PRIMARY_KEY_VALIDATION_PASS')],
  ['CI runs PK-set verifier', workflow.includes('verify-primary-keys.sh')],
  ['CI validates FK constraints', workflow.includes('VALIDATE CONSTRAINT')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log(`\nWTD54 PostgreSQL hardening contract PASS ${checks.length}/${checks.length}`);
