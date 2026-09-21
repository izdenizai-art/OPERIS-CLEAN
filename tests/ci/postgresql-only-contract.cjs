const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const schema = read('server/prisma/schema.prisma');
const db = read('server/src/db.ts');
const installer = read('windows/install-enterprise.ps1');
const pgInstaller = read('windows/installer-postgresql.ps1');
const load = read('tests/load/operis-capacity.js');
const loadWorkflow = read('.github/workflows/operis-load-test.yml');
const candidate = read('.github/workflows/operis-postgresql-candidate.yml');

const checks = [
  ['Canonical Prisma provider is PostgreSQL', /provider\s*=\s*"postgresql"/.test(schema)],
  ['Canonical Prisma provider is not SQLite', !/provider\s*=\s*"sqlite"/.test(schema)],
  ['Runtime rejects non-PostgreSQL DATABASE_URL', db.includes('OPERIS PostgreSQL-only') && db.includes('postgres(?:ql)?')],
  ['Installer new env uses managed PostgreSQL URL', installer.includes('DATABASE_URL=$($script:Postgres.DatabaseUrl)')],
  ['Installer has no SQLite migration source', !installer.includes('SQLiteMigrationSource') && !pgInstaller.includes('SQLiteMigrationSource')],
  ['Installer has no SQLite migration execution', !pgInstaller.includes('migrate-sqlite') && !pgInstaller.includes('backup-sqlite')],
  ['Capacity test preserves cookies between iterations', load.includes('noCookiesReset: true')],
  ['Capacity ladder includes 75 through 750 users', [75,100,150,300,500,750].every(v => load.includes(String(v)))],
  ['Capacity test separates login and API duration', load.includes('operis_login_duration') && load.includes('operis_api_duration')],
  ['Capacity workflow uses Windows staging runner', loadWorkflow.includes('runs-on: [self-hosted, windows, operis-staging]')],
  ['Capacity workflow seeds temporary users', loadWorkflow.includes('seed-capacity-users.mjs')],
  ['Candidate workflow contains no SQLite migration', !/sqlite|pgloader/i.test(candidate)],
];

let failed = false;
for (const [name, ok] of checks) { console.log((ok ? 'OK' : 'FAIL') + ': ' + name); if (!ok) failed = true; }
if (failed) process.exit(1);
console.log('POSTGRESQL_ONLY_CONTRACT_PASS ' + checks.length + '/' + checks.length);
