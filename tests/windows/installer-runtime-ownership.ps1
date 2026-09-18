$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable Windows runner required.' }
$repo=Resolve-Path (Join-Path $PSScriptRoot '..\..')
$source=Join-Path $repo 'windows\install-enterprise.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Installer parse failed.' }
$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stop-OperisRuntime'},$true)
$sourceText = Get-Content $source -Raw
if ($sourceText -notmatch 'Wait-OperisPortClosed') { throw 'Stop-OperisRuntime must use bounded port-close wait.' }
if ($sourceText -notmatch 'Runtime stop timeout') { throw 'Runtime stop timeout diagnostic missing.' }
if (-not $fn) { throw 'Stop-OperisRuntime missing.' }
. ([scriptblock]::Create($fn.Extent.Text))
$env:ProgramData = if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }
$env:RUNNER_TEMP = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$TaskName='OperisOwnershipTestTask'; $Port=33101
$InstallRoot=Join-Path $env:ProgramData 'Operis'
$listener=Join-Path $env:RUNNER_TEMP 'foreign-listener.cjs'
Set-Content $listener "require('net').createServer().listen($Port,'127.0.0.1')"
$foreign=Start-Process node.exe -ArgumentList $listener -PassThru -NoNewWindow
try {
  for($i=0;$i -lt 20;$i++){if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){break};Start-Sleep -Milliseconds 250}
  $dummyAction=New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'
  $dummyTrigger=New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName $TaskName -Action $dummyAction -Trigger $dummyTrigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  $refused=$false
  try { Stop-OperisRuntime } catch { $refused=$_.Exception.Message -match 'başka bir uygulama' }
  if (-not $refused -or $foreign.HasExited) { throw 'Foreign listener was not safely preserved.' }
  if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { throw 'Runtime task was removed before foreign listener safety was established.' }
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
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'Owned listener port remained open after Stop-OperisRuntime returned.' }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Runtime task was not removed after owned listener shutdown completed.' }
  Write-Host 'INSTALLER_OWNED_LISTENER_STOP_PASS'
} finally {
  Stop-Process -Id $owned.Id -Force -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
}
