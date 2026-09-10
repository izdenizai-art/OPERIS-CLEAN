const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const rehearsal = read('migration/rehearse-sqlite-copy-to-postgresql.sh');
const critical = read('migration/verify-critical-business-data.sh');
const workflow = read('.github/workflows/operis-staging-sqlite-postgresql-rehearsal.yml');
const uploadBlock = workflow.slice(workflow.indexOf('- name: Upload non-sensitive rehearsal log'));

const checks = [
  ['Rehearsal requires explicit staging confirmation', rehearsal.includes('I_CONFIRM_STAGING_COPY_ONLY')],
  ['Rehearsal checks exact target database identity', rehearsal.includes('OPERIS_EXPECTED_TARGET_DATABASE') && rehearsal.includes('current_database()')],
  ['Rehearsal requires exactly 50 target tables', rehearsal.includes('target_table_count') && rehearsal.includes('!= "50"')],
  ['Rehearsal refuses non-empty staging target', rehearsal.includes('target_row_total') && rehearsal.includes('staging hedef DB boş değil')],
  ['Rehearsal checks SQLite integrity', rehearsal.includes('PRAGMA integrity_check')],
  ['Rehearsal requires exactly 50 SQLite source tables', rehearsal.includes('source_table_count') && rehearsal.includes('!= "50"')],
  ['Rehearsal hashes SQLite source before and after', rehearsal.includes('source_hash_before') && rehearsal.includes('source_hash_final')],
  ['Rehearsal normalizes only a temporary SQLite copy', rehearsal.includes('OPERIS_SQLITE_NORMALIZED_FILE') && rehearsal.includes('operis-normalized.db')],
  ['Rehearsal does not materialize PostgreSQL URL with sed', !rehearsal.includes('s|{{OPERIS_POSTGRES_URL}}|')],
  ['Rehearsal passes SQLite URL through environment', rehearsal.includes('OPERIS_SQLITE_SOURCE_URL="sqlite://$normalized"')],
  ['Rehearsal drops FKs before pgloader', rehearsal.includes('DROP CONSTRAINT') && rehearsal.indexOf('DROP CONSTRAINT') < rehearsal.indexOf('pgloader --on-error-stop')],
  ['Rehearsal restores FKs after pgloader', rehearsal.includes('ADD CONSTRAINT') && rehearsal.indexOf('ADD CONSTRAINT') < rehearsal.indexOf('pgloader --on-error-stop') && rehearsal.includes('psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$restore_fk"')],
  ['Rehearsal validates restored FKs', rehearsal.includes('VALIDATE CONSTRAINT')],
  ['Rehearsal applies custom partial indexes after load', rehearsal.indexOf('postgresql-custom.sql') > rehearsal.indexOf('pgloader --on-error-stop')],
  ['Rehearsal verifies row counts', rehearsal.includes('verify-row-counts.sh')],
  ['Rehearsal verifies PK sets', rehearsal.includes('verify-primary-keys.sh')],
  ['Rehearsal verifies critical business data', rehearsal.includes('verify-critical-business-data.sh')],
  ['Critical verifier covers users', critical.includes('compare_dataset "users"')],
  ['Critical verifier covers branches and memberships', critical.includes('compare_dataset "branches"') && critical.includes('compare_dataset "user_branches"')],
  ['Critical verifier covers assets', critical.includes('compare_dataset "assets"')],
  ['Critical verifier covers Help Desk', critical.includes('compare_dataset "helpdesk_tickets"')],
  ['Critical verifier covers messages and announcements', critical.includes('compare_dataset "messages"') && critical.includes('compare_dataset "announcements"')],
  ['Workflow is manual only', workflow.includes('workflow_dispatch:') && !workflow.includes('\n  push:')],
  ['Workflow requires self-hosted Linux staging runner', workflow.includes('runs-on: [self-hosted, linux, operis-staging]')],
  ['Workflow uses protected operis-staging environment', workflow.includes('environment: operis-staging')],
  ['Workflow gets SQLite path from environment var', workflow.includes('vars.OPERIS_STAGING_SQLITE_FILE')],
  ['Workflow gets PostgreSQL URL from secret', workflow.includes('secrets.OPERIS_STAGING_POSTGRES_URL')],
  ['Workflow checks exact target DB variable', workflow.includes('vars.OPERIS_STAGING_TARGET_DB')],
  ['Workflow refuses non-empty DB before db push', workflow.indexOf('Refuse non-empty target before schema creation') < workflow.indexOf('prisma db push')],
  ['Workflow does not upload SQLite DB', !uploadBlock.includes('OPERIS_STAGING_SQLITE_FILE') && !uploadBlock.includes('.db')],
  ['Workflow uploads only non-sensitive rehearsal log', workflow.includes('operis-staging-rehearsal-evidence') && workflow.includes('operis-staging-rehearsal.log')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log(`\nWTD60 staging-copy contract PASS ${checks.length}/${checks.length}`);
