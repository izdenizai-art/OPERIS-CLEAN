const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync('server/src/domain-sync.ts','utf8');
assert.ok(source.includes("HResult.ToString('X8')"), 'domain diagnostics must format signed HRESULT without UInt32 cast');
assert.ok(!source.includes('[uint32]$ex.HResult'), 'unsafe UInt32 HRESULT cast must not remain');

const command = "$ex=New-Object System.Runtime.InteropServices.COMException('ldap',-2147463168); $value='0x'+$ex.HResult.ToString('X8'); Write-Output $value";
const output = execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8'}).trim();
assert.equal(output,'0x80005000');
console.log('DOMAIN_SYNC_ERROR_DIAGNOSTIC_PASS');
