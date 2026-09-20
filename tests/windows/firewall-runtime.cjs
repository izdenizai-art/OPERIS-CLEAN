const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const ts = require('../../server/node_modules/typescript');

async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const sourcePath = path.resolve('server/src/index.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'syncRemoteAccessFirewall');
  assert.ok(fn, 'Actual application firewall function is required');
  const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const records = [];
  let diagnosticTimeout;
  const context = vm.createContext({ process, port: 3001, bindHost: '127.0.0.1', execFile(file, args, options, callback) {
    const started = Date.now();
    execFile(file, args, { ...options, ...(diagnosticTimeout ? { timeout: diagnosticTimeout } : {}) }, (error, stdout, stderr) => {
      const record = { sourceSha: process.env.GITHUB_SHA, file, args,
        configuredTimeoutMs: options.timeout, diagnosticTimeoutMs: diagnosticTimeout ?? null,
        elapsedMs: Date.now() - started, exitCode: error?.code ?? 0,
        killed: error?.killed ?? false, signal: error?.signal ?? null, stdout, stderr };
      records.push(record);
      console.log('FIREWALL_PROCESS_EVIDENCE=' + JSON.stringify(record));
      callback(error, stdout, stderr);
    });
  }});
  vm.runInContext(code, context);

  const originalFirewallFlag = process.env.OPERIS_ENABLE_FIREWALL_SYNC;
  delete process.env.OPERIS_ENABLE_FIREWALL_SYNC;
  const disabledBefore = records.length;
  const disabledResult = await context.syncRemoteAccessFirewall('ALL_ALLOWED');
  assert.equal(disabledResult.applied, false, 'firewall sync must be disabled by default outside the managed runtime');
  assert.equal(records.length, disabledBefore, 'disabled firewall sync must not spawn PowerShell');
  process.env.OPERIS_ENABLE_FIREWALL_SYNC = '1';

  const failures = [];
  const staleRuleName = 'Operis Enterprise TCP 3999 - ManagedAccess';
  await new Promise((resolve, reject) => execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
      `Get-NetFirewallRule -DisplayName '${staleRuleName}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '${staleRuleName}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3999 -LocalAddress 127.0.0.1 -Profile Any | Out-Null`],
    { timeout: 90000 },
    (error, _stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(),
  ));
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { await context.syncRemoteAccessFirewall('ALL_ALLOWED'); }
      catch (error) { failures.push(`attempt ${attempt}: ${error.message}`); }
    }
    if (failures.length) {
      // Diagnostic only: never count this relaxed timeout as the production gate passing.
      diagnosticTimeout = 90000;
      try { await context.syncRemoteAccessFirewall('ALL_ALLOWED'); }
      catch (error) { console.error('FIREWALL_EXTENDED_DIAGNOSTIC_FAILED', error.message); }
    }
    const query = "$stale=@(Get-NetFirewallRule -DisplayName 'Operis Enterprise TCP 3999 - ManagedAccess' -ErrorAction SilentlyContinue); if($stale.Count -ne 0){throw 'Stale managed rule was not removed'}; $r=@(Get-NetFirewallRule -DisplayName 'Operis Enterprise TCP 3001 - ManagedAccess' -ErrorAction Stop); if($r.Count -ne 1){throw 'Expected exactly one managed rule'}; $p=$r|Get-NetFirewallPortFilter; if($p.LocalPort -ne '3001'){throw 'Wrong port'}; if($r.Enabled -ne 'True' -or $r.Direction -ne 'Inbound' -or $r.Action -ne 'Allow'){throw 'Wrong rule state'}; 'FIREWALL_STALE_RULE_CLEANUP_PASS'";
    await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: 90000 }, (e, out, err) => {
      console.log(out); if (e) reject(new Error(err || e.message)); else resolve();
    }));
    assert.equal(failures.length, 0, failures.join('\n'));
    console.log('FIREWALL_REPEATED_APPLICATION_PASS');
  } finally {
    if (originalFirewallFlag == null) delete process.env.OPERIS_ENABLE_FIREWALL_SYNC;
    else process.env.OPERIS_ENABLE_FIREWALL_SYNC = originalFirewallFlag;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-NetFirewallRule -DisplayName '${staleRuleName}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue`],
      { timeout: 90000 }, () => {});
    const dir = path.join(process.env.RUNNER_TEMP, 'operis-ci-diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'firewall-process-evidence.json'), JSON.stringify({ sourceSha: process.env.GITHUB_SHA, records, failures }, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
