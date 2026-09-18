const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = '.github/workflows/operis-autonomous-qa-agent.yml';
assert.ok(fs.existsSync(workflow), 'autonomous QA workflow is missing');
const text = fs.readFileSync(workflow, 'utf8');

for (const required of [
  'name: OPERIS Autonomous QA Agent',
  'node-version: "24.21.0"',
  'node scripts/qa/operis-qa-agent.cjs',
  'if: always()',
  'operis-qa-agent-evidence-${{ github.sha }}',
  'run_real_windows:',
  'default: false',
  'self-hosted',
  'operis-staging',
  "OPERIS_ALLOW_PRODUCTION_CUTOVER: 'false'",
  'node tests/ci/build-final-release-gate.cjs',
  'FINAL_RELEASE_GATE.json',
]) {
  assert.ok(text.includes(required), 'workflow contract missing: ' + required);
}

assert.match(
  text,
  /if:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && inputs\.run_real_windows == true\s*\}\}/,
  'real Windows job must be explicit manual opt-in',
);
assert.doesNotMatch(
  text,
  /OPERIS_ALLOW_PRODUCTION_CUTOVER:\s*['"]?true/i,
  'autonomous workflow must never enable production cutover',
);

console.log('OPERIS_AUTONOMOUS_QA_WORKFLOW_CONTRACT_PASS');
