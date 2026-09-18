const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server/src/domain-sync.ts','utf8');

const signingCount = (source.match(/AuthenticationTypes\]::Signing/g) || []).length;
const sealingCount = (source.match(/AuthenticationTypes\]::Sealing/g) || []).length;
assert.ok(signingCount >= 3, 'all non-LDAPS DirectoryEntry flows must request Signing');
assert.ok(sealingCount >= 3, 'all non-LDAPS DirectoryEntry flows must request Sealing');
assert.ok(source.includes("if($protocol -eq 'LDAPS')"), 'LDAPS branch must remain explicit');
assert.ok(source.includes("if($protocol -eq 'LDAP')"), 'sealed LDAP branch must remain explicit');

console.log('DOMAIN_SYNC_SECURE_LDAP389_PASS');
