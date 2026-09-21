const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const workflow = read('.github/workflows/operis-postgresql-backup-restore.yml');
const backup = read('windows/postgresql-backup.ps1');
const restore = read('windows/postgresql-restore-test.ps1');
const evidence = read('tests/verify-postgresql-candidate-evidence.cjs');

const checks = [
  ['Backup/restore workflow candidate branch only', workflow.includes('postgresql-candidate-validation') && !workflow.includes('branches:\n      - main')],
  ['PostgreSQL 16 service used', workflow.includes('image: postgres:16')],
  ['Workflow creates schema from PostgreSQL Prisma schema', workflow.includes('prisma db push --schema prisma/schema.postgresql.prisma') || workflow.includes('prisma db push --skip-generate')],
  ['Sentinel inserted before backup', /wtd5[89]-backup-restore-sentinel/.test(workflow)],
  ['OPERIS backup script executed', workflow.includes('postgresql-backup.ps1')],
  ['OPERIS isolated restore test executed', workflow.includes('postgresql-restore-test.ps1')],
  ['Independent pg_restore verification exists', workflow.includes('operis_restore_verify') && workflow.includes('pg_restore')],
  ['Restored sentinel independently checked', /WHERE \\\"key\\\"='wtd5[89]-backup-restore-sentinel'/.test(workflow)],
  ['Backup evidence artifact uploaded', workflow.includes('operis-postgresql-backup-restore-evidence')],
  ['Backup script produces JSON manifest', backup.includes('.manifest.json') && backup.includes('POSTGRESQL_BACKUP')],
  ['Restore test requires manifest', restore.includes('Backup manifesti bulunamadı')],
  ['Restore test verifies SHA', restore.includes('Get-FileHash')],
  ['Candidate evidence verifies PostgreSQL health', evidence.includes('PostgreSQL health ok')],
  ['Candidate evidence verifies both partial indexes', evidence.includes('Asset_active_serialNumber_unique') && evidence.includes('Asset_active_barcode_unique')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log(`\nWTD58 backup/restore gates PASS ${checks.length}/${checks.length}`);
