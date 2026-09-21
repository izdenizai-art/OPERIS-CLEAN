const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const workflow = read('.github/workflows/operis-staging-sqlite-postgresql-rehearsal.yml');
const windowsMigration = read('server/scripts/migrate-sqlite-windows.mjs');
const uploadBlock = workflow.slice(workflow.indexOf('- name: Upload non-sensitive rehearsal evidence'));

const checks = [
  ['Workflow is manual only', workflow.includes('workflow_dispatch:') && !workflow.includes('\n  push:')],
  ['Workflow requires self-hosted Windows staging runner', workflow.includes('runs-on: [self-hosted, windows, operis-staging]')],
  ['Workflow does not require Linux staging runner', !workflow.includes('runs-on: [self-hosted, linux, operis-staging]')],
  ['Workflow uses protected operis-staging environment', workflow.includes('environment: operis-staging')],
  ['Workflow requires explicit staging confirmation', workflow.includes('I_CONFIRM_STAGING_COPY_ONLY')],
  ['Workflow gets SQLite path from environment var', workflow.includes('vars.OPERIS_STAGING_SQLITE_FILE')],
  ['Workflow gets PostgreSQL URL from secret', workflow.includes('secrets.OPERIS_STAGING_POSTGRES_URL')],
  ['Workflow checks exact target DB variable', workflow.includes('vars.OPERIS_STAGING_TARGET_DB')],
  ['Workflow pins Node 24.21.0', workflow.includes('node-version: "24.21.0"')],
  ['Workflow locates OPERIS managed or standard Windows psql client', workflow.includes('C:\\ProgramData\\OperisPostgreSQL\\server\\bin\\psql.exe') && workflow.includes('PostgreSQL\\\\*\\\\bin\\\\psql.exe') && workflow.includes('OPERIS_PSQL')],
  ['Workflow rejects workspace SQLite source', workflow.includes('GITHUB_WORKSPACE') && workflow.includes('Resolve') === false && workflow.includes('GetFullPath')],
  ['Workflow rejects reparse-point SQLite source', workflow.includes('ReparsePoint')],
  ['Workflow hashes SQLite source before migration', workflow.includes('Get-FileHash') && workflow.includes('OPERIS_SOURCE_SHA256')],
  ['Workflow verifies exact PostgreSQL target identity', workflow.includes('current_database()') && workflow.includes('Target identity mismatch')],
  ['Workflow refuses non-empty DB before db push', workflow.indexOf('refuse non-empty target') < workflow.indexOf('prisma db push')],
  ['Workflow uses Windows-native migration script', workflow.includes('server\\scripts\\migrate-sqlite-windows.mjs')],
  ['Workflow does not invoke pgloader', !workflow.includes('pgloader')],
  ['Workflow does not invoke bash migration scripts', !workflow.includes('bash migration/') && !workflow.includes('.sh')],
  ['Workflow requires full-row migration evidence', workflow.includes('FULL_ROWS_AND_PRIMARY_KEYS')],
  ['Workflow requires exactly 50 target tables', workflow.includes("$tables -ne '50'")],
  ['Workflow validates restored foreign keys', workflow.includes("$invalidFks -ne '0'")],
  ['Workflow verifies required partial indexes', workflow.includes('Asset_active_serialNumber_unique') && workflow.includes('Asset_active_barcode_unique')],
  ['Workflow verifies source hash after migration', workflow.includes('SOURCE_SQLITE_UNCHANGED_PASS') && workflow.includes('sourceSha256')],
  ['Workflow does not upload SQLite DB', !uploadBlock.includes('OPERIS_SQLITE_FILE') && !uploadBlock.includes('.db')],
  ['Workflow uploads only non-sensitive log/evidence', uploadBlock.includes('operis-staging-rehearsal.log') && uploadBlock.includes('operis-staging-migration-evidence.json')],
  ['Windows migration checks SQLite integrity', windowsMigration.includes('PRAGMA integrity_check')],
  ['Windows migration refuses populated target', windowsMigration.includes('Refusing migration into a populated target')],
  ['Windows migration rejects extra source columns', windowsMigration.includes('extraSourceColumns.length') && windowsMigration.includes('Source columns differ from the supported schema')],
  ['Windows migration rejects missing required no-default columns', windowsMigration.includes('f.isRequired && !f.hasDefaultValue') && windowsMigration.includes('Source missing required column without default')],
  ['Windows migration permits only safe legacy backfill fields', windowsMigration.includes('missingFields') && windowsMigration.includes('migratedFields') && windowsMigration.includes('backfilledColumns')],
  ['Windows migration verifies migrated rows by full-row digest', windowsMigration.includes('digest(canonicalRows)') && windowsMigration.includes('digest(canonicalTarget)')],
  ['Windows migration hashes source before and after', windowsMigration.includes('beforeHash') && windowsMigration.includes('Source changed during migration')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log(`\nWTD60 Windows staging-copy contract PASS ${checks.length}/${checks.length}`);
