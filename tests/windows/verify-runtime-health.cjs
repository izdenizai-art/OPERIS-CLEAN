const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  assert.equal(process.platform, 'win32', 'This gate requires actual Windows');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.version, 'v24.21.0');
  const base = 'http://127.0.0.1:3001';
  assert.equal(process.env.OPERIS_BASE_URL, base);
  // Exercise the OS call that is unavailable in the local sandbox, without mocking it.
  const interfaces = os.networkInterfaces();
  assert.ok(Object.values(interfaces).some(items => items?.length));
  const response = await fetch(`${base}/api/health`, {
    headers: { Origin: base }, signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), base);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.version, '6.3.63');
  assert.equal(health.database?.provider, 'sqlite');
  assert.equal(health.database?.connected, true);
  const rejectedOrigin = await fetch(`${base}/api/health`, {
    headers: { Origin: 'https://untrusted.invalid' }, signal: AbortSignal.timeout(10000),
  });
  assert.equal(rejectedOrigin.status, 200);
  assert.equal(rejectedOrigin.headers.get('access-control-allow-origin'), null);
  const status = await fetch(`${base}/api/auth/status`, { signal: AbortSignal.timeout(10000) });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).hasUsers, false);
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/);
  const dir = path.join(process.env.RUNNER_TEMP, 'operis-ci-diagnostics');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'windows-runtime-health.json'), JSON.stringify({
    sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    node: process.version,
    platform: process.platform,
    networkInterfaces: 'PASS',
    applicationHealth: 'PASS',
    provider: health.database.provider,
    databaseConnected: true,
    firstRunStatus: 'PASS',
    corsAllowedOrigin: 'PASS',
    corsUntrustedOrigin: 'PASS',
    setupExeLifecycle: 'NOT_TESTED',
  }, null, 2) + '\n');
  console.log('WINDOWS_NETWORK_INTERFACES_PASS');
  console.log('WINDOWS_SQLITE_APPLICATION_HEALTH_PASS');
  console.log('WINDOWS_FIRST_RUN_AND_CORS_PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
