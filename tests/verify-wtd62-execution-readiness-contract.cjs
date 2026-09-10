const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const loadWorkflow = read('.github/workflows/operis-load-test.yml');
const load = read('tests/load/operis-100-vu.js');
const integrationWorkflow = read('.github/workflows/operis-integration-smoke.yml');
const integration = read('tests/integration/operis-integration-smoke.ps1');

const summaryStart = integration.indexOf('$results = [ordered]@{');
const summaryEnd = integration.indexOf('if ($TestDomain -eq "true")');
const summaryBlock = summaryStart >= 0 && summaryEnd > summaryStart
  ? integration.slice(summaryStart, summaryEnd)
  : '';

const checks = [
  ['100-user certification requires exact non-production confirmation',
    loadWorkflow.includes('I_CONFIRM_NON_PRODUCTION')],
  ['100-user certification cannot disable unique-user requirement',
    loadWorkflow.includes('require_unique_users=true zorunludur')],
  ['k6 verifies at least 100 unique usernames',
    load.includes('uniqueUsernames.size < 100')],
  ['k6 verifies each VU identity',
    load.includes('kullanıcı kimliği uyuşmuyor')],
  ['k6 verifies branch context',
    load.includes('şube bağlamı uyuşmuyor')],
  ['k6 requires PostgreSQL provider',
    load.includes('OPERIS_EXPECTED_DATABASE_PROVIDER')],
  ['k6 writes non-sensitive summary artifact',
    load.includes('operis-load-summary.json')],

  ['Integration workflow candidate branch only',
    integrationWorkflow.includes('refs/heads/postgresql-candidate-validation')],
  ['Integration workflow protected staging environment',
    integrationWorkflow.includes('environment: operis-staging')],
  ['Integration workflow self-hosted Windows staging',
    integrationWorkflow.includes('runs-on: [self-hosted, windows, operis-staging]')],
  ['Integration workflow requires at least one actual integration',
    integrationWorkflow.includes('en az bir entegrasyon seçilmelidir')],
  ['Admin password is not passed as a PowerShell CLI argument',
    !integrationWorkflow.includes('-Password $env:OPERIS_STAGING_ADMIN_PASSWORD')],
  ['Admin password is read from environment inside smoke script',
    integration.includes('$Password = $env:OPERIS_STAGING_ADMIN_PASSWORD')],
  ['Integration smoke verifies PostgreSQL health',
    integration.includes('database.provider -ne "postgresql"')],
  ['Integration smoke covers AD/DC',
    integration.includes('/api/admin/domain-sync/test')],
  ['Integration smoke covers SMTP',
    integration.includes('/api/mail-settings/verify')],
  ['Integration smoke covers Graph',
    integration.includes('/api/graph-mail-settings/test')],
  ['Integration smoke covers MSSQL',
    integration.includes('/api/assets/external-connections/$AssetConnectionId/test')],
  ['Integration smoke covers SNMP',
    integration.includes('/api/network-monitors/$NetworkMonitorId/snmp/test')],
  ['Integration initial summary states are PASS/SKIP only',
    summaryBlock.includes('health = "PASS"') &&
    summaryBlock.includes('login = "PASS"') &&
    summaryBlock.includes('domain = "SKIP"') &&
    summaryBlock.includes('smtp = "SKIP"') &&
    summaryBlock.includes('graph = "SKIP"') &&
    summaryBlock.includes('mssql = "SKIP"') &&
    summaryBlock.includes('snmp = "SKIP"')],
  ['Integration summary file is non-secret',
    integration.includes('operis-integration-smoke-summary.json') &&
    !summaryBlock.toLowerCase().includes('password') &&
    !summaryBlock.toLowerCase().includes('username')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log(`\nWTD62 execution-readiness contract PASS ${checks.length}/${checks.length}`);
