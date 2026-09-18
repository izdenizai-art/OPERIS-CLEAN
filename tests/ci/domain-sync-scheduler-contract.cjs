const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server/src/domain-sync.ts','utf8');

assert.ok(!source.includes('Math.min(minutes*60_000,15_000)'), 'domain sync scheduler must not collapse configured intervals to 15 seconds');
assert.ok(source.includes('const delayMs=minutes*60_000'), 'domain sync scheduler must derive delay from configured minutes');
assert.ok(source.includes('},delayMs)'), 'domain sync scheduler must use configured delay');

console.log('DOMAIN_SYNC_SCHEDULER_INTERVAL_PASS');
