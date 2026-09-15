param(
    [Parameter(Mandatory = $true)][string]$SetupExe,
    [string]$EvidencePath = (Join-Path $env:RUNNER_TEMP 'operis-setup-exe-lifecycle.json')
)
$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramData 'Operis'
$PgRoot = Join-Path $env:ProgramData 'OperisPostgreSQL'
$SetupRoot = Join-Path $env:ProgramData 'Operis-Setup'
$TaskName = 'OperisEnterpriseServer'
$BackupTaskName = 'OperisEnterpriseDailyBackup'

function Invoke-SetupExe {
    param([string]$MaintenanceAction = '')
    $oldMaintenance = $env:OPERIS_MAINTENANCE_ACTION
    try {
        if ($MaintenanceAction) { $env:OPERIS_MAINTENANCE_ACTION = $MaintenanceAction }
        else { Remove-Item Env:OPERIS_MAINTENANCE_ACTION -ErrorAction SilentlyContinue }
        $processName = [IO.Path]::GetFileNameWithoutExtension($SetupExe)
        $setupLog = Join-Path $env:RUNNER_TEMP ("$processName-$([guid]::NewGuid().ToString('N')).log")
        $p = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',("/LOG=$setupLog") -PassThru
        $setupTimeoutMs = 30 * 60 * 1000
        if (-not $p.WaitForExit($setupTimeoutMs)) {
            try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
            throw 'Setup EXE process timeout.'
        }
        $p.Refresh()
        if ($p.ExitCode -ne 0) { throw "Setup EXE failed: exit=$($p.ExitCode)" }

        $deadline = (Get-Date).AddMinutes(30)
        do {
            $remaining = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID })
            if ($remaining.Count -eq 0) { break }
            foreach ($child in $remaining) {
                try { Wait-Process -Id $child.Id -Timeout 5 -ErrorAction SilentlyContinue } catch {}
            }
        } while ((Get-Date) -lt $deadline)
        if ((Get-Date) -ge $deadline) { throw 'Setup child process completion timeout.' }

        $bindingPath = Join-Path $InstallRoot 'Data\NetworkBinding.json'
        while (-not (Test-Path $bindingPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
        if (-not (Test-Path $bindingPath)) {
            foreach ($log in @($setupLog, (Join-Path $InstallRoot 'Logs\Install.log'), (Join-Path $InstallRoot 'Logs\Install-Transcript.log'))) {
                if (Test-Path $log) {
                    Write-Host "===== $log ====="
                    Get-Content $log -Tail 200 -ErrorAction SilentlyContinue
                }
            }
            throw 'Setup completed without NetworkBinding.json.'
        }
    } finally {
        if ($null -eq $oldMaintenance) { Remove-Item Env:OPERIS_MAINTENANCE_ACTION -ErrorAction SilentlyContinue }
        else { $env:OPERIS_MAINTENANCE_ACTION = $oldMaintenance }
    }
}
function Get-Binding {
    $path = Join-Path $InstallRoot 'Data\NetworkBinding.json'
    if (-not (Test-Path $path)) { throw 'NetworkBinding.json missing.' }
    return Get-Content $path -Raw | ConvertFrom-Json
}
function Get-BindingSignature {
    $b = Get-Binding
    return "$($b.ipAddress)|$($b.interfaceAlias)|$($b.port)|$($b.publicUrl)"
}
function Get-LastVersionMode {
    $path = Join-Path $InstallRoot 'Data\VersionHistory.json'
    if (-not (Test-Path $path)) { throw 'VersionHistory.json missing.' }
    $entries = @(Get-Content $path -Raw | ConvertFrom-Json)
    if ($entries.Count -lt 1) { throw 'VersionHistory.json empty.' }
    return [string]$entries[-1].mode
}
function Assert-Health {
    $binding = Get-Binding
    $last = $null
    for ($i=0; $i -lt 30; $i++) {
        try {
            $h = Invoke-RestMethod -Uri "http://$($binding.ipAddress):$($binding.port)/api/health" -TimeoutSec 5
            if ($h.ok -and $h.version -eq '6.3.63' -and $h.database.provider -eq 'postgresql' -and $h.database.connected) { return $h }
            $last = $h | ConvertTo-Json -Compress
        } catch { $last = $_.Exception.Message }
        Start-Sleep -Seconds 2
    }
    throw "Health verification failed: $last"
}
function Read-PgState {
    Add-Type -AssemblyName System.Security
    $stateFile = Join-Path $PgRoot 'credentials.dpapi'
    if (-not (Test-Path $stateFile)) { throw 'credentials.dpapi missing.' }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($stateFile),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { return ([Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json) }
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
        return (($out | Out-String).Trim())
    } finally { $env:PGPASSWORD = $old }
}
function Assert-PreservedState {
    param([string]$CredentialHash,[string]$BindingSignature,[string]$EnvMarker,[string]$BackupMarker,[string]$SentinelSql)
    Assert-Health | Out-Null
    if ((Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash -ne $CredentialHash) { throw 'PostgreSQL credentials changed.' }
    if ((Get-BindingSignature) -ne $BindingSignature) { throw 'NetworkBinding changed unexpectedly.' }
    if (-not ((Get-Content (Join-Path $InstallRoot 'server\.env') -Raw) -match [regex]::Escape($EnvMarker))) { throw '.env preservation marker missing.' }
    if (-not (Test-Path $BackupMarker)) { throw 'Backup history marker missing.' }
    if ((Invoke-AppSql $SentinelSql) -ne '1') { throw 'Database sentinel missing.' }
}
function Test-SetupConcurrency {
    param([string]$CredentialHash,[string]$BindingSignature,[string]$EnvMarker,[string]$BackupMarker,[string]$SentinelSql)
    $oldMaintenance = $env:OPERIS_MAINTENANCE_ACTION
    $env:OPERIS_MAINTENANCE_ACTION = 'REPAIR'
    try {
        $log1 = Join-Path $env:RUNNER_TEMP 'operis-concurrency-primary.log'
        $log2 = Join-Path $env:RUNNER_TEMP 'operis-concurrency-secondary.log'
        $primary = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',("/LOG=$log1") -PassThru
        Start-Sleep -Seconds 5
        if ($primary.HasExited) { throw "Primary setup ended too early: exit=$($primary.ExitCode)" }
        $secondary = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',("/LOG=$log2") -PassThru
        if (-not $secondary.WaitForExit(60 * 1000)) {
            try { Stop-Process -Id $secondary.Id -Force -ErrorAction SilentlyContinue } catch {}
            throw 'Second setup instance was not rejected promptly.'
        }
        $secondary.Refresh()
        if ($secondary.ExitCode -eq 0) { throw 'Second setup instance was not blocked by the machine-wide setup mutex.' }
        if (-not $primary.WaitForExit(30 * 60 * 1000)) {
            try { Stop-Process -Id $primary.Id -Force -ErrorAction SilentlyContinue } catch {}
            throw 'Primary setup timed out during concurrency validation.'
        }
        $primary.Refresh()
        if ($primary.ExitCode -ne 0) { throw "Primary setup failed during concurrency validation: exit=$($primary.ExitCode)" }
        Assert-PreservedState $CredentialHash $BindingSignature $EnvMarker $BackupMarker $SentinelSql
    } finally {
        if ($null -eq $oldMaintenance) { Remove-Item Env:OPERIS_MAINTENANCE_ACTION -ErrorAction SilentlyContinue }
        else { $env:OPERIS_MAINTENANCE_ACTION = $oldMaintenance }
    }
}

$sentinelInsertSql = ('INSERT INTO {q}SystemMigration{q} ({q}key{q},{q}appliedAt{q},{q}note{q}) VALUES (''setup-exe-db-survival'', CURRENT_TIMESTAMP, ''exe lifecycle'') ON CONFLICT ({q}key{q}) DO UPDATE SET {q}note{q}=EXCLUDED.{q}note{q};').Replace('{q}', [string][char]34)
$sentinelSelectSql = ('SELECT count(*) FROM {q}SystemMigration{q} WHERE {q}key{q}=''setup-exe-db-survival'';').Replace('{q}', [string][char]34)

$result = [ordered]@{
    sourceSha = $env:GITHUB_SHA
    cleanInstall = 'NOT_RUN'
    sameVersionRepair = 'NOT_RUN'
    sameVersionRefresh = 'NOT_RUN'
    setupConcurrency = 'NOT_RUN'
    ipPreservation = 'NOT_RUN'
    configSurvival = 'NOT_RUN'
    backupSurvival = 'NOT_RUN'
    reinstall = 'NOT_RUN'
    upgradePath = 'NOT_RUN'
    realPreviousExeUpgrade = 'NOT_RUN'
    repair = 'NOT_RUN'
    startupTask = 'NOT_RUN'
    reboot = 'NOT_TESTED_HOSTED_RUNNER'
    uninstall = 'NOT_RUN'
    dbSurvival = 'NOT_RUN'
    backupRestore = 'NOT_RUN'
}

try {
    if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
    if (Test-Path $SetupRoot) { Remove-Item $SetupRoot -Recurse -Force }
    if (Test-Path $PgRoot) { throw 'Fresh hosted runner expected; managed PostgreSQL root already exists.' }

    Invoke-SetupExe
    Assert-Health | Out-Null
    $result.cleanInstall = 'PASS'
    $credentialHash = (Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash
    $bindingSignature = Get-BindingSignature
    $envMarker = 'OPERIS_LIFECYCLE_PRESERVE=KEEP-ME'
    Add-Content (Join-Path $InstallRoot 'server\.env') $envMarker
    $backupMarker = Join-Path $InstallRoot 'Backups\lifecycle-preserve.marker'
    Set-Content $backupMarker 'KEEP-ME' -Encoding ASCII
    Invoke-AppSql $sentinelInsertSql | Out-Null

    Invoke-SetupExe -MaintenanceAction 'REPAIR'
    Assert-PreservedState $credentialHash $bindingSignature $envMarker $backupMarker $sentinelSelectSql
    if ((Get-LastVersionMode) -ne 'REPAIR') { throw 'Same-version default maintenance did not record REPAIR.' }
    $result.sameVersionRepair = 'PASS'
    $result.reinstall = 'PASS'
    $result.ipPreservation = 'PASS'
    $result.configSurvival = 'PASS'
    $result.backupSurvival = 'PASS'

    Invoke-SetupExe -MaintenanceAction 'REFRESH'
    Assert-PreservedState $credentialHash $bindingSignature $envMarker $backupMarker $sentinelSelectSql
    if ((Get-LastVersionMode) -ne 'REFRESH') { throw 'Same-version maintenance did not record REFRESH.' }
    $result.sameVersionRefresh = 'PASS'

    Test-SetupConcurrency $credentialHash $bindingSignature $envMarker $backupMarker $sentinelSelectSql
    $result.setupConcurrency = 'PASS'

    Set-Content (Join-Path $InstallRoot 'VERSION.txt') '6.3.62' -Encoding ASCII
    Invoke-SetupExe
    Assert-PreservedState $credentialHash $bindingSignature $envMarker $backupMarker $sentinelSelectSql
    if ((Get-Content (Join-Path $InstallRoot 'VERSION.txt') -Raw).Trim() -ne '6.3.63') { throw 'Upgrade path did not restore target version.' }
    $result.upgradePath = 'PASS_SIMULATED_PREVIOUS_VERSION_MARKER'

    Remove-Item (Join-Path $InstallRoot 'VERSION.txt') -Force
    Remove-Item (Join-Path $InstallRoot 'server\dist') -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-SetupExe
    Assert-PreservedState $credentialHash $bindingSignature $envMarker $backupMarker $sentinelSelectSql
    if (-not (Test-Path (Join-Path $InstallRoot 'server\dist'))) { throw 'Repair did not rebuild server/dist.' }
    $result.repair = 'PASS'

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $null = Get-ScheduledTask -TaskName $BackupTaskName -ErrorAction Stop
    if (-not ($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' })) { throw 'Server task has no boot trigger.' }
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $TaskName
    Assert-Health | Out-Null
    $result.startupTask = 'PASS'

    $dailyBackup = Join-Path $InstallRoot 'windows\postgresql-daily-backup.ps1'
    & $dailyBackup
    if ($LASTEXITCODE -ne 0) { throw 'Scheduled PostgreSQL backup script failed.' }
    $dump = Get-ChildItem (Join-Path $InstallRoot 'Backups') -Recurse -Filter 'operis-postgresql-*.dump' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $dump) { throw 'Scheduled pg_dump output missing.' }
    $state = Read-PgState
    $adminUrl = "postgresql://postgres:$($state.adminPassword)@127.0.0.1:$($state.port)/postgres"
    & (Join-Path $InstallRoot 'windows\postgresql-restore-test.ps1') -AdminDatabaseUrl $adminUrl -BackupFile $dump.FullName -TestDatabaseName 'operis_release_restore_test'
    if ($LASTEXITCODE -ne 0) { throw 'Isolated backup restore test failed.' }
    $result.backupRestore = 'PASS'

    $uninstaller = Join-Path $SetupRoot 'unins000.exe'
    if (-not (Test-Path $uninstaller)) { throw 'Inno uninstaller missing.' }
    $u = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru
    if ($u.ExitCode -ne 0) { throw "Uninstall failed: exit=$($u.ExitCode)" }
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Runtime task survived uninstall.' }
    if (-not (Test-Path $PgRoot)) { throw 'Managed PostgreSQL root was deleted by uninstall.' }
    if ((Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash -ne $credentialHash) { throw 'PostgreSQL credentials changed during uninstall.' }
    if ((Invoke-AppSql $sentinelSelectSql) -ne '1') { throw 'Database sentinel did not survive uninstall.' }
    $result.uninstall = 'PASS'
    $result.dbSurvival = 'PASS'

    Invoke-SetupExe
    Assert-Health | Out-Null
    if ((Invoke-AppSql $sentinelSelectSql) -ne '1') { throw 'Database sentinel did not survive reinstall after uninstall.' }
}
finally {
    $result | ConvertTo-Json -Depth 5 | Set-Content $EvidencePath -Encoding UTF8
    Get-Content $EvidencePath
}

$requiredPass = @('cleanInstall','sameVersionRepair','sameVersionRefresh','setupConcurrency','ipPreservation','configSurvival','backupSurvival','reinstall','repair','startupTask','uninstall','dbSurvival','backupRestore')
foreach ($key in $requiredPass) {
    if ($result[$key] -ne 'PASS') { throw "Setup EXE lifecycle gate failed: $key=$($result[$key])" }
}
if ($result.upgradePath -notlike 'PASS*') { throw 'Setup EXE lifecycle gate failed: simulated upgrade path.' }
Write-Output 'OPERIS_SETUP_EXE_LIFECYCLE_PASS'
