const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const load = read('tests/load/operis-100-vu.js');
const loadWorkflow = read('.github/workflows/operis-load-test.yml');
const integration = read('tests/integration/operis-integration-smoke.ps1');
const integrationWorkflow = read('.github/workflows/operis-integration-smoke.yml');

const checks = [
  ['Load test requires at least 100 unique users', load.includes('uniqueUsernames.size < 100')],
  ['Load test maps credentials by VU', load.includes('users[(__VU - 1) % users.length]')],
  ['Load test verifies logged-in identity', load.includes('kullanıcı kimliği uyuşmuyor') && load.includes('meBody?.user?.username')],
  ['Load test verifies branch context', load.includes('şube bağlamı uyuşmuyor')],
  ['Load test verifies PostgreSQL provider', load.includes('OPERIS_EXPECTED_DATABASE_PROVIDER') && load.includes('database?.provider')],
  ['Load test verifies DB connected', load.includes('database?.connected') || load.includes('database.connected')],
  ['Load test covers normal mode', load.includes('normalUserCycle')],
  ['Load test covers helpdesk mode', load.includes('helpDeskCycle')],
  ['Load test covers mixed mode', load.includes('mixedCrudCycle')],
  ['Load test has 100-VU plateau', load.includes("target: 100")],
  ['Load test has failure thresholds', load.includes("http_req_failed: ['rate<0.01']") && load.includes('operis_server_failures')],
  ['Load test emits non-sensitive summary', load.includes('handleSummary') && load.includes('operis-load-summary.json')],
  ['Load workflow requires non-production confirmation', loadWorkflow.includes('I_CONFIRM_NON_PRODUCTION')],
  ['Load workflow forces PostgreSQL provider', loadWorkflow.includes('OPERIS_EXPECTED_DATABASE_PROVIDER: postgresql')],
  ['Load workflow uploads summary only', loadWorkflow.includes('operis-load-summary.json')],

  ['Integration script verifies PostgreSQL health', integration.includes('database.provider -ne "postgresql"')],
  ['Integration script covers AD/DC', integration.includes('/api/admin/domain-sync/test')],
  ['Integration script covers SMTP', integration.includes('/api/mail-settings/verify')],
  ['Integration script covers Graph', integration.includes('/api/graph-mail-settings/test')],
  ['Integration script covers MSSQL', integration.includes('/api/assets/external-connections/$AssetConnectionId/test')],
  ['Integration script covers SNMP', integration.includes('/api/network-monitors/$NetworkMonitorId/snmp/test')],
  ['Integration workflow is manual only', integrationWorkflow.includes('workflow_dispatch:') && !integrationWorkflow.includes('\n  push:')],
  ['Integration workflow self-hosted Windows staging only', integrationWorkflow.includes('runs-on: [self-hosted, windows, operis-staging]')],
  ['Integration workflow protected staging environment', integrationWorkflow.includes('environment: operis-staging')],
  ['Integration workflow requires candidate branch', integrationWorkflow.includes('refs/heads/postgresql-candidate-validation')],
  ['Integration workflow requires explicit non-production confirmation', integrationWorkflow.includes('I_CONFIRM_NON_PRODUCTION')],
  ['Integration workflow credentials are secrets', integrationWorkflow.includes('secrets.OPERIS_STAGING_ADMIN_USERNAME') && integrationWorkflow.includes('secrets.OPERIS_STAGING_ADMIN_PASSWORD')],
  ['Integration result artifact excludes credentials', integrationWorkflow.includes('operis-integration-smoke-summary.json') && !integration.includes('Password = "PASS"')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log(`\nWTD61 load/integration contract PASS ${checks.length}/${checks.length}`);
