const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const agentPath = path.join(root, 'scripts', 'qa', 'operis-qa-agent.cjs');
assert.ok(fs.existsSync(agentPath), 'OPERIS QA agent orchestrator is missing');

const agent = require(agentPath);
assert.deepEqual(
  [...agent.VALID_STATUSES].sort(),
  ['BLOCKED', 'FAIL', 'NOT_APPLICABLE', 'PASS'].sort(),
  'agent status enum changed',
);

const ids = agent.STAGES.map(stage => stage.id);
for (const required of [
  'source',
  'typecheck',
  'build',
  'frontend-artifact',
  'settings-static',
  'domain-sync-contracts',
  'startup-resilience',
  'migration-contracts',
  'windows-contracts',
  'security-root',
  'security-server',
]) {
  assert.ok(ids.includes(required), 'missing required QA stage: ' + required);
}
assert.equal(new Set(ids).size, ids.length, 'QA stage ids must be unique');

for (const stage of agent.STAGES) {
  assert.equal(typeof stage.id, 'string');
  assert.equal(typeof stage.label, 'string');
  assert.ok(stage.command || stage.inspect, 'stage must define command or inspect: ' + stage.id);
}

const dry = agent.buildDryRunEvidence({
  sourceSha: 'abc123',
  platform: 'win32',
  startedAt: '2026-09-18T00:00:00.000Z',
});
assert.equal(dry.sourceSha, 'abc123');
assert.equal(dry.mode, 'dry-run');
assert.equal(dry.overall, 'NOT_APPLICABLE');
assert.equal(dry.stages.length, agent.STAGES.length);
assert.ok(dry.stages.every(stage => stage.status === 'NOT_APPLICABLE'));
assert.ok(dry.stages.every(stage => stage.command || stage.inspect));

const fail = agent.summarizeOverall([
  { status: 'PASS' },
  { status: 'BLOCKED' },
  { status: 'FAIL' },
]);
assert.equal(fail, 'FAIL');
assert.equal(agent.summarizeOverall([{ status: 'PASS' }, { status: 'BLOCKED' }]), 'BLOCKED');
assert.equal(agent.summarizeOverall([{ status: 'PASS' }, { status: 'NOT_APPLICABLE' }]), 'PASS');

console.log('OPERIS_QA_AGENT_CONTRACT_PASS');
