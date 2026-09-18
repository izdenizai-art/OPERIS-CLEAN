const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server/src/domain-sync.ts','utf8');

assert.ok(!source.includes("$scheme='\${secret.useLdaps?'LDAPS':'LDAP'}'"), 'ADSI provider path must not switch to LDAPS://');
const providerCount = (source.match(/\$provider='LDAP'/g) || []).length;
assert.ok(providerCount >= 3, 'all DirectoryEntry scripts must use LDAP ADSI provider');
assert.ok(source.includes("$protocol='\${secret.useLdaps?'LDAPS':'LDAP'}'"), 'reported protocol must still distinguish LDAPS from LDAP');
assert.ok(source.includes("SecureSocketsLayer"), 'LDAPS must still enable AuthenticationTypes.SecureSocketsLayer');
assert.ok(source.includes('$path="${provider}://${controller}:$port/$baseDn"'), 'DirectoryEntry path must use LDAP provider with explicit port and Base DN');

console.log('DOMAIN_SYNC_LDAPS_PROVIDER_PATH_PASS');
