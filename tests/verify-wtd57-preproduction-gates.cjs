const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const pg = read('.github/workflows/operis-postgresql-candidate.yml');
const win = read('.github/workflows/operis-windows-postgresql-rehearsal.yml');
const load = read('.github/workflows/operis-load-test.yml');
const seed = read('server/scripts/seed-migration-smoke.mjs');
const norm = read('migration/normalize-prisma-sqlite-datetimes.sh');
const restore = read('windows/postgresql-restore-test.ps1');

const checks = [
  ['Candidate branch only', pg.includes('postgresql-candidate-validation') && !pg.includes('branches:\n      - main')],
  ['Candidate uses npm ci', pg.includes('npm ci')],
  ['Candidate seeds synthetic SQLite', pg.includes('seed-migration-smoke.mjs')],
  ['Candidate normalizes SQLite timestamps on copy', pg.includes('normalize-prisma-sqlite-datetimes.sh')],
  ['Candidate verifies row count and PK', pg.includes('verify-row-counts.sh') && pg.includes('verify-primary-keys.sh')],
  ['Candidate proves PostgreSQL login', pg.includes('/api/auth/login')],
  ['Candidate proves temporary SQLite rollback', pg.includes('Prove temporary SQLite rollback path')],
  ['Seed has deterministic balamir', seed.includes("username: 'balamir'") && seed.includes("const userId = '00000000-0000-4000-8000-000000000001'")],
  ['Normalizer refuses in-place mutation', norm.includes('Kaynak SQLite dosyası yerinde değiştirilemez')],
  ['Windows rehearsal candidate branch only', win.includes('postgresql-candidate-validation')],
  ['Windows rehearsal verifies backup', win.includes('verify-pre-postgresql-full-backup.ps1')],
  ['Restore rehearsal uses isolated DB', restore.includes('createdb') && restore.includes('dropdb')],
  ['100-user load requires explicit non-production confirmation', load.includes('I_CONFIRM_NON_PRODUCTION')],
  ['100-user load uses checkout v6', load.includes('actions/checkout@v6')],
  ['100-user load keeps 100 unique user gate', load.includes('OPERIS_REQUIRE_UNIQUE_USERS')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log(`\nWTD57 pre-production gates PASS ${checks.length}/${checks.length}`);
