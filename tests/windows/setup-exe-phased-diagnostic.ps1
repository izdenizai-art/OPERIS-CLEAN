param(
    [Parameter(Mandatory = $true)][ValidateSet('clean','reinstall','upgrade','repair','startup-backup','uninstall','db-survival-reinstall')][string]$Phase,
    [Parameter(Mandatory = $true)][string]$SetupExe,
    [string]$StatePath = (Join-Path $env:RUNNER_TEMP 'operis-phased-state.json'),
    [string]$EvidencePath = (Join-Path $env:RUNNER_TEMP 'operis-phased-evidence.json')
)
$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramData 'Operis'
$PgRoot = Join-Path $env:ProgramData 'OperisPostgreSQL'
$SetupRoot = Join-Path $env:ProgramData 'Operis-Setup'
$TaskName = 'OperisEnterpriseServer'
$BackupTaskName = 'OperisEnterpriseDailyBackup'

function Write-Phase([string]$Message) {
    Write-Host ("DIAG_PHASE {0} {1} {2}" -f $Phase,(Get-Date).ToString('o'),$Message)
}
function Dump-Diagnostics {
    Write-Host '===== PROCESS SNAPSHOT ====='
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'OPERIS|setup|unins|node|postgres|msedge|powershell|pwsh' } | Select-Object Id,ProcessName,StartTime | Format-Table -AutoSize | Out-String | Write-Host
    foreach ($log in @(
        (Join-Path $InstallRoot 'Logs\Install.log'),
        (Join-Path $InstallRoot 'Logs\Install-Transcript.log')
    )) {
        if (Test-Path $log) {
            Write-Host "===== $log ====="
            Get-Content $log -Tail 120 -ErrorAction SilentlyContinue
        }
    }
}
function Invoke-SetupExe {
    Write-Phase 'setup-start'
    $processName = [IO.Path]::GetFileNameWithoutExtension($SetupExe)
    $setupLog = Join-Path $env:RUNNER_TEMP ("$processName-$Phase-$([guid]::NewGuid().ToString('N')).log")
    $p = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',("/LOG=$setupLog") -PassThru
    if (-not $p.WaitForExit(15 * 60 * 1000)) {
        Dump-Diagnostics
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
        throw "Setup EXE timeout in phase $Phase."
    }
    $p.Refresh()
    if ($p.ExitCode -ne 0) {
        Dump-Diagnostics
        throw "Setup EXE failed in phase ${Phase}: exit=$($p.ExitCode)"
    }
    $childDeadline = (Get-Date).AddMinutes(3)
    do {
        $remaining = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID })
        if ($remaining.Count -eq 0) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $childDeadline)
    if ($remaining.Count -gt 0) {
        Dump-Diagnostics
        throw "Setup same-name child timeout in phase $Phase."
    }
    $bindingPath = Join-Path $InstallRoot 'Data\NetworkBinding.json'
    $bindingDeadline = (Get-Date).AddMinutes(3)
    while (-not (Test-Path $bindingPath) -and (Get-Date) -lt $bindingDeadline) { Start-Sleep -Seconds 2 }
    if (-not (Test-Path $bindingPath)) {
        if (Test-Path $setupLog) { Get-Content $setupLog -Tail 120 -ErrorAction SilentlyContinue }
        Dump-Diagnostics
        throw "NetworkBinding.json missing in phase $Phase."
    }
    Write-Phase 'setup-complete'
}
function Get-Binding {
    $path = Join-Path $InstallRoot 'Data\NetworkBinding.json'
    if (-not (Test-Path $path)) { throw 'NetworkBinding.json missing.' }
    Get-Content $path -Raw | ConvertFrom-Json
}
function Assert-Health {
    $binding = Get-Binding
    $last = $null
    for ($i=0; $i -lt 30; $i++) {
        try {
            $h = Invoke-RestMethod -Uri "http://$($binding.ipAddress):$($binding.port)/api/health" -TimeoutSec 5
            if ($h.ok -and $h.version -eq '6.3.63' -and $h.database.provider -eq 'postgresql' -and $h.database.connected) { return }
            $last = $h | ConvertTo-Json -Compress
        } catch { $last = $_.Exception.Message }
        Start-Sleep -Seconds 2
    }
    Dump-Diagnostics
    throw "Health failed in phase ${Phase}: $last"
}
function Read-PgState {
    Add-Type -AssemblyName System.Security
    $stateFile = Join-Path $PgRoot 'credentials.dpapi'
    if (-not (Test-Path $stateFile)) { throw 'credentials.dpapi missing.' }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($stateFile),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { ([Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json) }
    finally { [Array]::Clear($plain,0,$plain.Length) }
}
function Invoke-AppSql([string]$Sql) {
    $state = Read-PgState
    $psql = Join-Path $PgRoot 'server\bin\psql.exe'
    $old = $env:PGPASSWORD
    $env:PGPASSWORD = $state.appPassword
    try {
        $out = & $psql -X -w -h 127.0.0.1 -p $state.port -U operis -d operis -v ON_ERROR_STOP=1 -t -A -c $Sql
        if ($LASTEXITCODE -ne 0) { throw 'psql application query failed.' }
        (($out | Out-String).Trim())
    } finally { $env:PGPASSWORD = $old }
}
function Read-State {
    if (-not (Test-Path $StatePath)) { throw "State file missing: $StatePath" }
    Get-Content $StatePath -Raw | ConvertFrom-Json
}
function Set-Evidence([string]$Key,[string]$Value) {
    $obj = if (Test-Path $EvidencePath) { Get-Content $EvidencePath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if ($obj.PSObject.Properties.Name -contains $Key) { $obj.$Key = $Value } else { $obj | Add-Member -NotePropertyName $Key -NotePropertyValue $Value }
    $obj | ConvertTo-Json -Depth 5 | Set-Content $EvidencePath -Encoding UTF8
}

$sentinelInsertSql = ('INSERT INTO {q}SystemMigration{q} ({q}key{q},{q}appliedAt{q},{q}note{q}) VALUES (''setup-exe-db-survival'', CURRENT_TIMESTAMP, ''phased diagnostic'') ON CONFLICT ({q}key{q}) DO UPDATE SET {q}note{q}=EXCLUDED.{q}note{q};').Replace('{q}', [string][char]34)
$sentinelSelectSql = ('SELECT count(*) FROM {q}SystemMigration{q} WHERE {q}key{q}=''setup-exe-db-survival'';').Replace('{q}', [string][char]34)

Write-Phase 'begin'
switch ($Phase) {
    'clean' {
        if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
        if (Test-Path $SetupRoot) { Remove-Item $SetupRoot -Recurse -Force }
        if (Test-Path $PgRoot) { throw 'Fresh runner expected; managed PostgreSQL root already exists.' }
        Invoke-SetupExe
        Assert-Health
        $credentialHash = (Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash
        [pscustomobject]@{ credentialHash = $credentialHash } | ConvertTo-Json | Set-Content $StatePath -Encoding UTF8
        Set-Evidence 'cleanInstall' 'PASS'
    }
    'reinstall' {
        $state = Read-State
        Invoke-SetupExe
        Assert-Health
        if ((Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash -ne $state.credentialHash) { throw 'Reinstall rotated PostgreSQL credentials.' }
        Set-Evidence 'reinstall' 'PASS'
    }
    'upgrade' {
        Set-Content (Join-Path $InstallRoot 'VERSION.txt') '6.3.62' -Encoding ASCII
        Invoke-SetupExe
        Assert-Health
        if ((Get-Content (Join-Path $InstallRoot 'VERSION.txt') -Raw).Trim() -ne '6.3.63') { throw 'Upgrade marker not restored.' }
        Set-Evidence 'upgradePath' 'PASS_SIMULATED_PREVIOUS_VERSION_MARKER'
    }
    'repair' {
        Remove-Item (Join-Path $InstallRoot 'VERSION.txt') -Force
        Remove-Item (Join-Path $InstallRoot 'server\dist') -Recurse -Force -ErrorAction SilentlyContinue
        Invoke-SetupExe
        Assert-Health
        if (-not (Test-Path (Join-Path $InstallRoot 'server\dist'))) { throw 'Repair did not rebuild server/dist.' }
        Set-Evidence 'repair' 'PASS'
    }
    'startup-backup' {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $null = Get-ScheduledTask -TaskName $BackupTaskName -ErrorAction Stop
        if (-not ($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' })) { throw 'Server task has no boot trigger.' }
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName $TaskName
        Assert-Health
        Set-Evidence 'startupTask' 'PASS'
        & (Join-Path $InstallRoot 'windows\postgresql-daily-backup.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Scheduled PostgreSQL backup failed.' }
        $dump = Get-ChildItem (Join-Path $InstallRoot 'Backups') -Recurse -Filter 'operis-postgresql-*.dump' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $dump) { throw 'Scheduled pg_dump output missing.' }
        $pg = Read-PgState
        $adminUrl = "postgresql://postgres:$($pg.adminPassword)@127.0.0.1:$($pg.port)/postgres"
        & (Join-Path $InstallRoot 'windows\postgresql-restore-test.ps1') -AdminDatabaseUrl $adminUrl -BackupFile $dump.FullName -TestDatabaseName 'operis_release_diag_restore_test'
        if ($LASTEXITCODE -ne 0) { throw 'Isolated backup restore test failed.' }
        Set-Evidence 'backupRestore' 'PASS'
    }
    'uninstall' {
        $state = Read-State
        Invoke-AppSql $sentinelInsertSql | Out-Null
        $uninstaller = Join-Path $SetupRoot 'unins000.exe'
        if (-not (Test-Path $uninstaller)) { throw 'Inno uninstaller missing.' }
        Write-Phase 'uninstall-start'
        $u = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru
        if (-not $u.WaitForExit(10 * 60 * 1000)) {
            Dump-Diagnostics
            try { Stop-Process -Id $u.Id -Force -ErrorAction SilentlyContinue } catch {}
            throw 'Uninstall timeout.'
        }
        $u.Refresh()
        if ($u.ExitCode -ne 0) { throw "Uninstall failed: exit=$($u.ExitCode)" }
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Runtime task survived uninstall.' }
        if (-not (Test-Path $PgRoot)) { throw 'Managed PostgreSQL root was deleted by uninstall.' }
        if ((Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash -ne $state.credentialHash) { throw 'PostgreSQL credentials changed during uninstall.' }
        if ((Invoke-AppSql $sentinelSelectSql) -ne '1') { throw 'Database sentinel did not survive uninstall.' }
        Set-Evidence 'uninstall' 'PASS'
        Set-Evidence 'dbSurvival' 'PASS'
    }
    'db-survival-reinstall' {
        Invoke-SetupExe
        Assert-Health
        if ((Invoke-AppSql $sentinelSelectSql) -ne '1') { throw 'Database sentinel did not survive reinstall after uninstall.' }
        Set-Evidence 'reinstallAfterUninstall' 'PASS'
    }
}
Write-Phase 'pass'
if (Test-Path $EvidencePath) { Get-Content $EvidencePath }
