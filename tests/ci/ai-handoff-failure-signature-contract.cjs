const assert = require('node:assert/strict');
const handoff = require('./generate-ai-handoff.cjs');

assert.equal(typeof handoff.detectFailureSignatures, 'function', 'failure signature detector export missing');

const signatures = handoff.detectFailureSignatures([
  "TypeError: Cannot read properties of undefined (reading 'length')",
  'Runtime durdurulamadı; TCP 3001 dinleyicisi kapanmadı.',
  "The process cannot access the file because it is being used by another process.",
  'Production CSS still contains raw @tailwind directives.',
  'LOGIN_FAILED',
].join('\n'));

const codes = signatures.map(item => item.code);
for (const expected of [
  'FRONTEND_UNDEFINED_LENGTH',
  'WINDOWS_RUNTIME_SHUTDOWN',
  'WINDOWS_FILE_LOCK',
  'FRONTEND_CSS_ARTIFACT',
  'AUTH_LOGIN_FAILED',
]) {
  assert.ok(codes.includes(expected), 'missing failure signature: ' + expected);
}

for (const item of signatures) {
  assert.equal(typeof item.code, 'string');
  assert.equal(typeof item.area, 'string');
  assert.equal(typeof item.evidence, 'string');
  assert.equal(typeof item.nextCheck, 'string');
}

assert.deepEqual(handoff.detectFailureSignatures('unrelated output'), []);
console.log('AI_HANDOFF_FAILURE_SIGNATURE_CONTRACT_PASS');
