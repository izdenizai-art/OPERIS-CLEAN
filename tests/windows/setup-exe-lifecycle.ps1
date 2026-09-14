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
    $p = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Setup EXE failed: exit=$($p.ExitCode)" }
}
function Get-Binding {
    $path = Join-Path $InstallRoot 'Data\NetworkBinding.json'
    if (-not (Test-Path $path)) { throw 'NetworkBinding.json missing.' }
    return Get-Content $path -Raw | ConvertFrom-Json
}
function Assert-Health {
    $binding = Get-Binding
    $last = $null
    for ($i=0; $i -lt 30; $i++) {
        try {
            $h = Invoke-RestMethod -Uri "http://$($binding.ip):$($binding.port)/api/health" -TimeoutSec 5
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

$sentinelInsertSql = ('INSERT INTO {q}SystemMigration{q} ({q}key{q},{q}appliedAt{q},{q}note{q}) VALUES (''setup-exe-db-survival'', CURRENT_TIMESTAMP, ''exe lifecycle'') ON CONFLICT ({q}key{q}) DO UPDATE SET {q}note{q}=EXCLUDED.{q}note{q};').Replace('{q}', [string][char]34)
$sentinelSelectSql = ('SELECT count(*) FROM {q}SystemMigration{q} WHERE {q}key{q}=''setup-exe-db-survival'';').Replace('{q}', [string][char]34)

$result = [ordered]@{
    sourceSha = $env:GITHUB_SHA
    cleanInstall = 'NOT_RUN'
    reinstall = 'NOT_RUN'
    upgradePath = 'NOT_RUN'
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

    Invoke-SetupExe
    Assert-Health | Out-Null
    if ((Get-FileHash (Join-Path $PgRoot 'credentials.dpapi') -Algorithm SHA256).Hash -ne $credentialHash) { throw 'Reinstall rotated PostgreSQL credentials.' }
    $result.reinstall = 'PASS'

    Set-Content (Join-Path $InstallRoot 'VERSION.txt') '6.3.62' -Encoding ASCII
    Invoke-SetupExe
    Assert-Health | Out-Null
    if ((Get-Content (Join-Path $InstallRoot 'VERSION.txt') -Raw).Trim() -ne '6.3.63') { throw 'Upgrade path did not restore target version.' }
    $result.upgradePath = 'PASS_SIMULATED_PREVIOUS_VERSION_MARKER'

    Remove-Item (Join-Path $InstallRoot 'VERSION.txt') -Force
    Remove-Item (Join-Path $InstallRoot 'server\dist') -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-SetupExe
    Assert-Health | Out-Null
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
    $dump = Get-ChildItem (Join-Path $InstallRoot 'Backups') -Recurse -Filter 'operis-postgresql-*.dump' -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $dump) { throw 'Scheduled pg_dump output missing.' }
    $state = Read-PgState
    $adminUrl = "postgresql://postgres:$($state.adminPassword)@127.0.0.1:$($state.port)/postgres"
    & (Join-Path $InstallRoot 'windows\postgresql-restore-test.ps1') -AdminDatabaseUrl $adminUrl -BackupFile $dump.FullName -TestDatabaseName 'operis_release_restore_test'
    if ($LASTEXITCODE -ne 0) { throw 'Isolated backup restore test failed.' }
    $result.backupRestore = 'PASS'

    Invoke-AppSql $sentinelInsertSql | Out-Null
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

if ($result.cleanInstall -ne 'PASS' -or $result.reinstall -ne 'PASS' -or $result.upgradePath -notlike 'PASS*' -or $result.repair -ne 'PASS' -or $result.startupTask -ne 'PASS' -or $result.uninstall -ne 'PASS' -or $result.dbSurvival -ne 'PASS' -or $result.backupRestore -ne 'PASS') {
    throw 'Setup EXE lifecycle gate failed.'
}
Write-Output 'OPERIS_SETUP_EXE_LIFECYCLE_PASS'
