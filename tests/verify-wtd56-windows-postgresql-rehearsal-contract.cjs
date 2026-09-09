const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const full = read('windows/pre-postgresql-full-backup.ps1');
const verify = read('windows/verify-pre-postgresql-full-backup.ps1');
const rollback = read('windows/rollback-postgresql-to-sqlite.ps1');
const pgBackup = read('windows/postgresql-backup.ps1');
const pgRestore = read('windows/postgresql-restore.ps1');
const pgRestoreTest = read('windows/postgresql-restore-test.ps1');
const rehearsal = read('migration/rehearse-sqlite-copy-to-postgresql.sh');
const normalizer = read('migration/normalize-prisma-sqlite-datetimes.sh');
const workflow = read('.github/workflows/operis-windows-postgresql-rehearsal.yml');

const checks = [
  ['Full backup excludes raw server.env', !full.includes('Copy-Item $envFile') && full.includes('server-config-presence.json')],
  ['Full backup manifest declares no secrets', full.includes('secretsIncluded = $false')],
  ['Full backup still includes SQLite DB', full.includes('yaklasan-isler.db')],
  ['Full backup still includes Help Desk attachments', full.includes('helpdesk-attachments')],
  ['Full backup still includes SQLite schema', full.includes('schema.sqlite.prisma')],

  ['Backup verifier checks manifest', verify.includes('manifest.json')],
  ['Backup verifier checks per-file SHA256', verify.includes('Get-FileHash')],
  ['Backup verifier rejects raw server.env', verify.includes('ham server.env')],
  ['Backup verifier requires SQLite DB', verify.includes('Rollback SQLite DB pakette yok')],
  ['Backup verifier requires SQLite schema', verify.includes('schema.sqlite.prisma pakette yok')],

  ['Rollback uses npm.cmd on Windows', rollback.includes('npm.cmd run prisma:generate')],
  ['Rollback never runs prisma db push', !/^\s*(npm(\.cmd)?\s+run\s+prisma:push|npx(\.cmd)?\s+prisma\s+db\s+push)\b/im.test(rollback)],
  ['Rollback verifies SQLite SHA before/after generate', rollback.includes('copiedHash') && rollback.includes('finalHash')],

  ['PostgreSQL backup writes JSON manifest', pgBackup.includes('POSTGRESQL_BACKUP') && pgBackup.includes('.manifest.json')],
  ['PostgreSQL backup manifest includes SHA256', pgBackup.includes('sha256 = $hash')],
  ['PostgreSQL restore requires manifest', pgRestore.includes('Backup manifesti bulunamadı')],
  ['PostgreSQL restore validates manifest purpose', pgRestore.includes('POSTGRESQL_BACKUP')],
  ['PostgreSQL restore validates SHA256', pgRestore.includes('Get-FileHash')],

  ['Restore test creates isolated database', pgRestoreTest.includes('createdb')],
  ['Restore test destroys isolated database', pgRestoreTest.includes('dropdb')],
  ['Restore test checks public table count', pgRestoreTest.includes("pg_tables WHERE schemaname='public'")],

  ['Date normalizer refuses in-place mutation', normalizer.includes('Kaynak SQLite dosyası yerinde değiştirilemez')],
  ['Rehearsal hashes source before/after', rehearsal.includes('source_hash_before') && rehearsal.includes('source_hash_after')],
  ['Rehearsal uses normalized temp copy', rehearsal.includes('OPERIS_SQLITE_NORMALIZED_FILE')],
  ['Rehearsal verifies row counts', rehearsal.includes('verify-row-counts.sh')],
  ['Rehearsal verifies primary keys', rehearsal.includes('verify-primary-keys.sh')],
  ['Rehearsal verifies FK validation state', rehearsal.includes('NOT convalidated')],

  ['Windows workflow targets candidate branch', workflow.includes('postgresql-candidate-validation')],
  ['Windows workflow parses PowerShell scripts', workflow.includes('Language.Parser')],
  ['Windows workflow uses npm.cmd', workflow.includes('npm.cmd ci')],
  ['Windows workflow runs full backup', workflow.includes('pre-postgresql-full-backup.ps1')],
  ['Windows workflow verifies backup', workflow.includes('verify-pre-postgresql-full-backup.ps1')],
  ['Windows workflow rejects raw server.env', workflow.includes('raw server.env backup ZIP içinde')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log(`\nWTD56 Windows/PostgreSQL rehearsal contract PASS ${checks.length}/${checks.length}`);
