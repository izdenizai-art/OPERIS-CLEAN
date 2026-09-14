$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable Windows runner required.' }
$repo=Resolve-Path (Join-Path $PSScriptRoot '..\..')
$source=Join-Path $repo 'windows\install-enterprise.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Installer parse failed.' }
$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stop-OperisRuntime'},$true)
if (-not $fn) { throw 'Stop-OperisRuntime missing.' }
. ([scriptblock]::Create($fn.Extent.Text))
$TaskName='OperisOwnershipTestTask'; $Port=33101
$InstallRoot=Join-Path $env:ProgramData 'Operis'
$listener=Join-Path $env:RUNNER_TEMP 'foreign-listener.cjs'
Set-Content $listener "require('net').createServer().listen($Port,'127.0.0.1')"
$foreign=Start-Process node.exe -ArgumentList $listener -PassThru -NoNewWindow
try {
  for($i=0;$i -lt 20;$i++){if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){break};Start-Sleep -Milliseconds 250}
  $refused=$false
  try { Stop-OperisRuntime } catch { $refused=$_.Exception.Message -match 'başka bir uygulama' }
  if (-not $refused -or $foreign.HasExited) { throw 'Foreign listener was not safely preserved.' }
  Write-Host 'INSTALLER_FOREIGN_LISTENER_REFUSAL_PASS'
} finally { Stop-Process -Id $foreign.Id -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory $InstallRoot -Force | Out-Null
$ownedScript=Join-Path $InstallRoot 'ownership-listener.cjs'
Set-Content $ownedScript "require('net').createServer().listen($Port,'127.0.0.1')"
$owned=Start-Process node.exe -ArgumentList $ownedScript -PassThru -NoNewWindow
try {
  for($i=0;$i -lt 20;$i++){if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){break};Start-Sleep -Milliseconds 250}
  Stop-OperisRuntime; $owned.WaitForExit(10000) | Out-Null
  if (-not $owned.HasExited) { throw 'Owned listener was not stopped.' }
  Write-Host 'INSTALLER_OWNED_LISTENER_STOP_PASS'
} finally { Stop-Process -Id $owned.Id -Force -ErrorAction SilentlyContinue; Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue }
