const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'windows', 'install-enterprise.ps1'), 'utf8');
const runnerStart = source.indexOf('function Install-Runner');
const runnerEnd = source.indexOf('function Install-DailyBackup', runnerStart);
if (runnerStart < 0 || runnerEnd <= runnerStart) throw new Error('Install-Runner block not found');
const runner = source.slice(runnerStart, runnerEnd);

const checks = [
  ['runner reads DATABASE_URL', runner.includes('DATABASE_URL')],
  ['runner reads postgresql-bin.txt', runner.includes('postgresql-bin.txt')],
  ['runner uses pg_isready.exe', runner.includes('pg_isready.exe')],
  ['runner has bounded readiness deadline', /AddSeconds\((90|120|180)\)/.test(runner)],
  ['runner logs PostgreSQL readiness wait', /PostgreSQL.*hazır/i.test(runner)],
  ['runner checks readiness before Node start', runner.indexOf('pg_isready.exe') >= 0 && runner.indexOf('pg_isready.exe') < runner.indexOf('Operis server starting')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? 'OK' : 'FAIL') + ': ' + name);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('STARTUP_POSTGRESQL_READINESS_CONTRACT_PASS');
