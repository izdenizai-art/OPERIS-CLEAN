param(
    [Parameter(Mandatory = $true)][string]$SetupExe,
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [switch]$BootstrapIfMissing
)
$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramData 'Operis'
$PgRoot = Join-Path $env:ProgramData 'OperisPostgreSQL'
$SetupRoot = Join-Path $env:ProgramData 'Operis-Setup'

function Write-SetupDiagnostics([string]$SetupLog) {
    if (Test-Path $SetupLog) {
        Write-Host "===== INNO SETUP LOG: $SetupLog ====="
        Get-Content $SetupLog -Tail 250 -ErrorAction SilentlyContinue
    }
    $logsRoot = Join-Path $InstallRoot 'Logs'
    if (Test-Path $logsRoot) {
        $operationFiles = @(
            Get-ChildItem $logsRoot -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like 'Operation-*.log' -or $_.Name -like 'Operation-*.events.jsonl' } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 8
        )
        foreach ($file in $operationFiles) {
            Write-Host "===== MASKED OPERATION LOG: $($file.FullName) ====="
            Get-Content $file.FullName -Tail 250 -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-SetupExe {
    $setupLog = Join-Path $env:RUNNER_TEMP 'operis-forced-rollback-bootstrap.log'
    $p = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',("/LOG=$setupLog") -PassThru
    if (-not $p.WaitForExit(30 * 60 * 1000)) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
        Write-SetupDiagnostics $setupLog
        throw 'Bootstrap setup timed out.'
    }
    $p.Refresh()
    if ($p.ExitCode -ne 0) {
        Write-SetupDiagnostics $setupLog
        throw "Bootstrap setup failed: exit=$($p.ExitCode)"
    }
}
function Get-Binding {
    $path = Join-Path $InstallRoot 'Data\NetworkBinding.json'
    if (-not (Test-Path $path)) { throw 'NetworkBinding.json missing before forced rollback test.' }
    Get-Content $path -Raw | ConvertFrom-Json
}
function Get-BindingSignature {
    $b = Get-Binding
    "$($b.ipAddress)|$($b.interfaceAlias)|$($b.port)|$($b.publicUrl)"
}
function Assert-Health {
    $binding = Get-Binding
    $last = ''
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $h = Invoke-RestMethod -Uri "http://$($binding.ipAddress):$($binding.port)/api/health" -TimeoutSec 5
            if ($h.ok -and $h.version -eq '6.3.63' -and $h.database.provider -eq 'postgresql' -and $h.database.connected) { return $h }
            $last = $h | ConvertTo-Json -Compress
        } catch { $last = $_.Exception.Message }
        Start-Sleep -Seconds 2
    }
    throw "Rollback health verification failed from test harness: $last"
}
function Read-PgState {
    Add-Type -AssemblyName System.Security
    $stateFile = Join-Path $PgRoot 'credentials.dpapi'
    if (-not (Test-Path $stateFile)) { throw 'credentials.dpapi missing.' }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($stateFile),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json }
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

if (-not (Test-Path $SetupExe)) { throw "Setup EXE missing: $SetupExe" }
$sentinelInsertSql = ('INSERT INTO {q}SystemMigration{q} ({q}key{q},{q}appliedAt{q},{q}note{q}) VALUES (''setup-exe-db-survival'', CURRENT_TIMESTAMP, ''forced rollback bootstrap'') ON CONFLICT ({q}key{q}) DO UPDATE SET {q}note{q}=EXCLUDED.{q}note{q};').Replace('{q}', [string][char]34)
$sentinelSelectSql = ('SELECT count(*) FROM {q}SystemMigration{q} WHERE {q}key{q}=''setup-exe-db-survival'';').Replace('{q}', [string][char]34)

if ($BootstrapIfMissing -and (-not (Test-Path (Join-Path $InstallRoot 'Data\NetworkBinding.json')))) {
    if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
    if (Test-Path $SetupRoot) { Remove-Item $SetupRoot -Recurse -Force }
    if (Test-Path $PgRoot) { throw 'Fresh hosted runner expected for rollback bootstrap.' }
    Invoke-SetupExe
    Assert-Health | Out-Null
    Invoke-AppSql $sentinelInsertSql | Out-Null
    [ordered]@{
        sourceSha = $env:GITHUB_SHA
        phase = 'ForcedRollback'
        cleanInstall = 'PASS'
        updateRollback = 'NOT_RUN'
        rollbackHealth = 'NOT_RUN'
        reboot = 'NOT_TESTED_HOSTED_RUNNER'
        realPreviousExeUpgrade = 'NOT_RUN_NO_REAL_PREVIOUS_EXE_ARTIFACT'
    } | ConvertTo-Json -Depth 5 | Set-Content $EvidencePath -Encoding UTF8
}

if (-not (Test-Path $EvidencePath)) { throw "Lifecycle evidence missing: $EvidencePath" }
$credentialPath = Join-Path $PgRoot 'credentials.dpapi'
$credentialHash = (Get-FileHash $credentialPath -Algorithm SHA256).Hash
$bindingSignature = Get-BindingSignature
if ((Invoke-AppSql $sentinelSelectSql) -ne '1') { throw 'Database sentinel missing before forced rollback test.' }

$oldMaintenance = $env:OPERIS_MAINTENANCE_ACTION
$oldFailure = $env:OPERIS_TEST_FORCE_UPDATE_FAILURE
try {
    $env:OPERIS_MAINTENANCE_ACTION = 'REFRESH'
    $env:OPERIS_TEST_FORCE_UPDATE_FAILURE = 'AFTER_COPY'
    if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Forced rollback validation is allowed only in GitHub Actions.' }

    $setupLog = Join-Path $env:RUNNER_TEMP 'operis-forced-rollback-setup.log'
    $p = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',("/LOG=$setupLog") -PassThru
    if (-not $p.WaitForExit(30 * 60 * 1000)) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
        throw 'Forced-failure setup timed out.'
    }
    $p.Refresh()
    if ($p.ExitCode -eq 0) { throw 'Forced update failure did not fail the Setup EXE.' }
} finally {
    if ($null -eq $oldMaintenance) { Remove-Item Env:OPERIS_MAINTENANCE_ACTION -ErrorAction SilentlyContinue } else { $env:OPERIS_MAINTENANCE_ACTION = $oldMaintenance }
    if ($null -eq $oldFailure) { Remove-Item Env:OPERIS_TEST_FORCE_UPDATE_FAILURE -ErrorAction SilentlyContinue } else { $env:OPERIS_TEST_FORCE_UPDATE_FAILURE = $oldFailure }
}

Assert-Health | Out-Null
if ((Get-FileHash $credentialPath -Algorithm SHA256).Hash -ne $credentialHash) { throw 'PostgreSQL credentials changed during failed update/rollback.' }
if ((Get-BindingSignature) -ne $bindingSignature) { throw 'NetworkBinding changed during failed update/rollback.' }
if ((Invoke-AppSql $sentinelSelectSql) -ne '1') { throw 'Database sentinel did not survive failed update/rollback.' }

$historyPath = Join-Path $InstallRoot 'Data\VersionHistory.json'
if (-not (Test-Path $historyPath)) { throw 'VersionHistory.json missing after forced rollback.' }
$history = @(Get-Content $historyPath -Raw | ConvertFrom-Json)
if ($history.Count -lt 1) { throw 'VersionHistory.json empty after forced rollback.' }
$last = $history[-1]
if ([string]$last.status -ne 'ROLLED_BACK') { throw "Forced rollback history status mismatch: $($last.status)" }
if ([string]$last.mode -ne 'REFRESH') { throw "Forced rollback history mode mismatch: $($last.mode)" }

$evidence = Get-Content $EvidencePath -Raw | ConvertFrom-Json
if ($evidence.PSObject.Properties.Name -contains 'updateRollback') { $evidence.updateRollback = 'PASS' }
else { $evidence | Add-Member -NotePropertyName updateRollback -NotePropertyValue 'PASS' }
if ($evidence.PSObject.Properties.Name -contains 'rollbackHealth') { $evidence.rollbackHealth = 'PASS' }
else { $evidence | Add-Member -NotePropertyName rollbackHealth -NotePropertyValue 'PASS' }
$evidence | ConvertTo-Json -Depth 6 | Set-Content $EvidencePath -Encoding UTF8
Get-Content $EvidencePath
Write-Output 'OPERIS_SETUP_EXE_FORCED_ROLLBACK_PASS'