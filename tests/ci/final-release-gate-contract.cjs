const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builderPath = path.resolve(__dirname, 'build-final-release-gate.cjs');
assert.ok(fs.existsSync(builderPath), 'final release gate builder is missing');
const gateBuilder = require(builderPath);
assert.equal(typeof gateBuilder.buildGate, 'function', 'buildGate export missing');

const gate = gateBuilder.buildGate({
  sourceSha: 'abc123',
  agentEvidence: { overall: 'PASS', jsonPath: 'agent.json' },
  evidence: {
    scheduledPostgresqlBackup: { status: 'PASS', evidence: 'daily-backup.json' },
    realInstallerRepair: { status: 'PASS', evidence: 'repair.json' },
  },
});

assert.equal(gate.sourceSha, 'abc123');
assert.equal(gate.items.autonomousQaAgent.status, 'PASS');
assert.equal(gate.items.scheduledPostgresqlBackup.status, 'PASS');
assert.equal(gate.items.realInstallerRepair.status, 'PASS');
assert.equal(gate.items.rebootStartup.status, 'PENDING');
assert.equal(gate.items.sqliteToPostgresqlStaging.status, 'NOT_APPLICABLE');
assert.equal(gate.items.concurrentCapacity.status, 'PENDING');
assert.equal(gate.items.productionCutover.status, 'NOT_APPLICABLE');
assert.notEqual(gate.overall, 'PASS', 'missing mandatory evidence must prevent final PASS');

const legacyCapacityGate = gateBuilder.buildGate({
  sourceSha: 'abc123',
  evidence: {
    load100Users: { status: 'PASS', evidence: 'legacy-capacity.json' },
  },
});
assert.equal(legacyCapacityGate.items.concurrentCapacity.status, 'PASS');

const failGate = gateBuilder.buildGate({
  sourceSha: 'abc123',
  evidence: { finalSecurity: { status: 'FAIL', evidence: 'security.json' } },
});
assert.equal(failGate.overall, 'FAIL');

assert.throws(
  () => gateBuilder.buildGate({ evidence: { smtp: { status: 'SUCCESS' } } }),
  /Invalid release gate status/,
);

console.log('FINAL_RELEASE_GATE_CONTRACT_PASS');
