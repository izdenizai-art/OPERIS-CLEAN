param(
  [Parameter(Mandatory=$true)][ValidateSet('clean','repair','refresh','concurrency','upgrade','repair-missing','startup-backup','uninstall','reinstall-after-uninstall')][string]$Phase,
  [Parameter(Mandatory=$true)][string]$SetupExe,
  [string]$StatePath=(Join-Path $env:RUNNER_TEMP 'operis-hardening-phase-state.json')
)
$ErrorActionPreference='Stop'
$InstallRoot=Join-Path $env:ProgramData 'Operis'
$PgRoot=Join-Path $env:ProgramData 'OperisPostgreSQL'
$SetupRoot=Join-Path $env:ProgramData 'Operis-Setup'
$TaskName='OperisEnterpriseServer'
$BackupTaskName='OperisEnterpriseDailyBackup'

function Mark([string]$m){ Write-Host ("HARDENING_PHASE {0} {1} {2}" -f $Phase,(Get-Date).ToString('o'),$m) }
function Dump-Diagnostics {
  Write-Host '===== PROCESS SNAPSHOT ====='
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'OPERIS|setup|unins|node|postgres|msedge|powershell|pwsh' } | Select-Object Id,ProcessName,StartTime | Format-Table -AutoSize | Out-String | Write-Host
  foreach($log in @((Join-Path $InstallRoot 'Logs\Install.log'),(Join-Path $InstallRoot 'Logs\Install-Transcript.log'))){
    if(Test-Path $log){ Write-Host "===== $log ====="; Get-Content $log -Tail 120 -ErrorAction SilentlyContinue }
  }
}
function Invoke-Setup([string]$Maintenance=''){
  $old=$env:OPERIS_MAINTENANCE_ACTION
  try{
    if($Maintenance){$env:OPERIS_MAINTENANCE_ACTION=$Maintenance}else{Remove-Item Env:OPERIS_MAINTENANCE_ACTION -ErrorAction SilentlyContinue}
    Mark "setup-$Maintenance-start"
    $log=Join-Path $env:RUNNER_TEMP ("operis-$Phase-$([guid]::NewGuid().ToString('N')).log")
    $p=Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',("/LOG=$log") -PassThru
    if(-not $p.WaitForExit(15*60*1000)){Dump-Diagnostics; try{Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}catch{}; throw "Setup timeout phase=$Phase maintenance=$Maintenance"}
    $p.Refresh(); if($p.ExitCode -ne 0){Dump-Diagnostics; throw "Setup failed phase=$Phase maintenance=$Maintenance exit=$($p.ExitCode)"}
    Mark "setup-$Maintenance-exit0"
  } finally { if($null -eq $old){Remove-Item Env:OPERIS_MAINTENANCE_ACTION -ErrorAction SilentlyContinue}else{$env:OPERIS_MAINTENANCE_ACTION=$old} }
}
function Get-Binding { $p=Join-Path $InstallRoot 'Data\NetworkBinding.json'; if(-not(Test-Path $p)){throw 'binding missing'}; Get-Content $p -Raw|ConvertFrom-Json }
function Assert-Health {
  $b=Get-Binding; $last=''
  for($i=0;$i -lt 30;$i++){ try{$h=Invoke-RestMethod -Uri "http://$($b.ipAddress):$($b.port)/api/health" -TimeoutSec 5; if($h.ok -and $h.version -eq '6.3.63' -and $h.database.provider -eq 'postgresql' -and $h.database.connected){Mark 'health-pass'; return}}catch{$last=$_.Exception.Message}; Start-Sleep 2 }
  Dump-Diagnostics; throw "health failed: $last"
}
function Read-State { if(-not(Test-Path $StatePath)){throw 'state missing'}; Get-Content $StatePath -Raw|ConvertFrom-Json }
function Save-State($o){$o|ConvertTo-Json -Depth 5|Set-Content $StatePath -Encoding UTF8}
function CredentialHash { (Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash }

Mark 'begin'
switch($Phase){
 'clean' {
   if(Test-Path $InstallRoot){Remove-Item $InstallRoot -Recurse -Force}; if(Test-Path $SetupRoot){Remove-Item $SetupRoot -Recurse -Force}; if(Test-Path $PgRoot){throw 'fresh runner expected'}
   Invoke-Setup; Assert-Health
   $b=Get-Binding; Save-State ([pscustomobject]@{credentialHash=(CredentialHash);bindingIp=$b.ipAddress;bindingPort=$b.port})
 }
 'repair' {
   $s=Read-State; Invoke-Setup 'REPAIR'; Assert-Health; if((CredentialHash)-ne $s.credentialHash){throw 'credential changed in repair'}
 }
 'refresh' {
   $s=Read-State; Invoke-Setup 'REFRESH'; Assert-Health; if((CredentialHash)-ne $s.credentialHash){throw 'credential changed in refresh'}
 }
 'concurrency' {
   $old=$env:OPERIS_MAINTENANCE_ACTION; $env:OPERIS_MAINTENANCE_ACTION='REPAIR'
   try{
     Mark 'primary-start'; $p1=Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -PassThru; Start-Sleep 5
     if($p1.HasExited){throw "primary ended early exit=$($p1.ExitCode)"}
     Mark 'secondary-start'; $p2=Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -PassThru
     if(-not $p2.WaitForExit(60*1000)){Dump-Diagnostics; try{Stop-Process -Id $p2.Id -Force}catch{}; throw 'secondary not rejected in 60s'}
     $p2.Refresh(); if($p2.ExitCode -eq 0){throw 'secondary unexpectedly succeeded'}; Mark "secondary-blocked-exit-$($p2.ExitCode)"
     if(-not $p1.WaitForExit(15*60*1000)){Dump-Diagnostics; try{Stop-Process -Id $p1.Id -Force}catch{}; throw 'primary concurrency timeout'}
     $p1.Refresh(); if($p1.ExitCode -ne 0){throw "primary failed exit=$($p1.ExitCode)"}; Assert-Health
   } finally { if($null -eq $old){Remove-Item Env:OPERIS_MAINTENANCE_ACTION -ErrorAction SilentlyContinue}else{$env:OPERIS_MAINTENANCE_ACTION=$old} }
 }
 'upgrade' { Set-Content (Join-Path $InstallRoot 'VERSION.txt') '6.3.62' -Encoding ASCII; Invoke-Setup; Assert-Health }
 'repair-missing' { Remove-Item (Join-Path $InstallRoot 'VERSION.txt') -Force; Remove-Item (Join-Path $InstallRoot 'server\dist') -Recurse -Force -ErrorAction SilentlyContinue; Invoke-Setup; Assert-Health; if(-not(Test-Path (Join-Path $InstallRoot 'server\dist'))){throw 'dist missing after repair'} }
 'startup-backup' {
   $t=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop; $null=Get-ScheduledTask -TaskName $BackupTaskName -ErrorAction Stop; if(-not($t.Triggers|Where-Object{$_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger'})){throw 'boot trigger missing'}
   Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName $TaskName; Assert-Health
   & (Join-Path $InstallRoot 'windows\postgresql-daily-backup.ps1'); if($LASTEXITCODE -ne 0){throw 'backup failed'}
 }
 'uninstall' {
   $uPath=Join-Path $SetupRoot 'unins000.exe'; if(-not(Test-Path $uPath)){throw 'uninstaller missing'}; Mark 'uninstall-start'
   $u=Start-Process -FilePath $uPath -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru
   if(-not $u.WaitForExit(10*60*1000)){Dump-Diagnostics; try{Stop-Process -Id $u.Id -Force}catch{}; throw 'uninstall timeout'}
   $u.Refresh(); if($u.ExitCode -ne 0){throw "uninstall exit=$($u.ExitCode)"}; if(-not(Test-Path $PgRoot)){throw 'postgres root removed'}
 }
 'reinstall-after-uninstall' { Invoke-Setup; Assert-Health }
}
Mark 'pass'
