const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'src', 'tbldemirmas-sync.ts'), 'utf8');
const tickStart = source.indexOf('const tick = async () => {');
const intervalStart = source.indexOf('setInterval(() => void tick()', tickStart);
if (tickStart < 0 || intervalStart <= tickStart) throw new Error('TBLDEMIRMAS scheduler tick not found');
const tick = source.slice(tickStart, intervalStart);

const queryIndex = tick.indexOf('prisma.assetExternalConnection.findMany');
const outerTryIndex = tick.indexOf('try {');
const schedulerCatch = /catch\\s*\\(error\\)\\s*\\{[\\s\\S]*?console\\.error\\(\\`\\[TBLDEMIRMAS SYNC\\] scheduler\\`/.test(tick);

const checks = [
  ['scheduler queries connections', queryIndex >= 0],
  ['scheduler wraps database query in outer try', outerTryIndex >= 0 && outerTryIndex < queryIndex],
  ['scheduler catches database outage', schedulerCatch],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? 'OK' : 'FAIL') + ': ' + name);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('TBLDEMIRMAS_DB_OUTAGE_CONTRACT_PASS');
