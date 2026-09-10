const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const pg = read('.github/workflows/operis-postgresql-backup-restore.yml');
const win = read('.github/workflows/operis-windows-postgresql-rehearsal.yml');

const customStep = pg.indexOf('Apply OPERIS custom PostgreSQL objects and insert restore sentinel');
const backupStep = pg.indexOf('Run OPERIS PostgreSQL backup script');

const checks = [
  ['Custom PostgreSQL indexes applied before backup', pg.includes('-f migration/postgresql-custom.sql')],
  ['Backup source verifies serial partial index exists', pg.includes("Asset_active_serialNumber_unique")],
  ['Backup source verifies barcode partial index exists', pg.includes("Asset_active_barcode_unique")],
  ['Custom/sentinel step occurs before backup step', customStep >= 0 && backupStep > customStep],
  ['Independent restore checks sentinel', pg.includes('wtd59-backup-restore-sentinel') && pg.includes('operis_restore_verify')],
  ['Independent restore checks exactly 50 base tables', pg.includes("table_type='BASE TABLE'") && pg.includes('test "$table_count" = "50"')],
  ['Independent restore checks serial partial index', pg.includes("indexname='Asset_active_serialNumber_unique'")],
  ['Independent restore checks barcode partial index', pg.includes("indexname='Asset_active_barcode_unique'")],
  ['Windows workflow deliberately corrupts target DB', win.includes('INTENTIONALLY_CORRUPTED_FOR_ROLLBACK_TEST')],
  ['Windows workflow runs guarded rollback script', win.includes('rollback-postgresql-to-sqlite.ps1') && win.includes('-ConfirmRestore YES')],
  ['Windows workflow verifies restored SHA256', win.includes('restoredHash') && win.includes('expectedHash')],
  ['Windows workflow emits rollback PASS marker', win.includes('WINDOWS_SQLITE_ROLLBACK_REHEARSAL_PASS')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log(`\nWTD59 rollback/restore contract PASS ${checks.length}/${checks.length}`);
