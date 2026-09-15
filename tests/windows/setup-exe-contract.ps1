$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$iss = Join-Path $repo 'installer\OPERIS.iss'
$launcher = Join-Path $repo 'windows\setup-launch.ps1'
$uninstall = Join-Path $repo 'windows\uninstall-enterprise.ps1'
$workflow = Join-Path $repo '.github\workflows\operis-release-finalization.yml'
$lifecycle = Join-Path $repo 'tests\windows\setup-exe-lifecycle.ps1'
$rollback = Join-Path $repo 'tests\windows\setup-exe-forced-rollback.ps1'

foreach ($path in @($iss, $launcher, $uninstall, $workflow, $lifecycle, $rollback)) {
    if (-not (Test-Path $path)) { throw "Required release file missing: $path" }
}

$issText = Get-Content $iss -Raw
foreach ($needle in @(
    'AppVersion=6.3.63',
    'OutputBaseFilename=OPERIS_Setup_v6.3.63',
    'PrivilegesRequired=admin',
    'SetupMutex=Global\OPERIS_ENTERPRISE_SETUP',
    'install-enterprise.ps1',
    'uninstall-enterprise.ps1',
    'CreateInputOptionPage',
    'REPAIR',
    'REFRESH',
    'UNINSTALL',
    'MaintenanceAction'
)) {
    if ($issText -notmatch [regex]::Escape($needle)) { throw "Installer contract missing: $needle" }
}
if ($issText -match '--accept-data-loss') { throw 'Installer must never use --accept-data-loss.' }

$launcherText = Get-Content $launcher -Raw
foreach ($needle in @('MaintenanceAction','OPERIS_MAINTENANCE_ACTION','NetworkBinding.json')) {
    if ($launcherText -notmatch [regex]::Escape($needle)) { throw "Setup launcher maintenance contract missing: $needle" }
}

$uninstallText = Get-Content $uninstall -Raw
foreach ($needle in @('OperisEnterpriseServer','OperisEnterpriseDailyBackup','server\.env','OperisPostgreSQL')) {
    if ($uninstallText -notmatch [regex]::Escape($needle)) { throw "Uninstall DB-survival contract missing: $needle" }
}
if ($uninstallText -match 'Remove-Item\s+.*OperisPostgreSQL') { throw 'Managed PostgreSQL root must survive uninstall.' }

$workflowText = Get-Content $workflow -Raw
foreach ($needle in @('OPERIS_Setup_v6.3.63.exe','setup-exe-lifecycle.ps1','setup-exe-forced-rollback.ps1','Get-FileHash','npm audit')) {
    if ($workflowText -notmatch [regex]::Escape($needle)) { throw "Release workflow contract missing: $needle" }
}
if ($workflowText -match '--accept-data-loss') { throw 'Release workflow must never use --accept-data-loss.' }

$parallelWorkflowPatterns = [ordered]@{
    BuildJob = '(?m)^  build-setup:\s*$'
    MaintenanceJob = '(?m)^  lifecycle-maintenance:\s*$'
    PersistenceJob = '(?m)^  lifecycle-persistence:\s*$'
    RollbackJob = '(?m)^  forced-rollback:\s*$'
    PackageJob = '(?m)^  package-evidence:\s*$'
    DownloadArtifactV8 = 'actions/download-artifact@v8'
    MaintenancePhase = '(?s)setup-exe-lifecycle\.ps1.*?-Phase\s+Maintenance'
    PersistencePhase = '(?s)setup-exe-lifecycle\.ps1.*?-Phase\s+Persistence'
}
$parallelFailures = @()
foreach ($entry in $parallelWorkflowPatterns.GetEnumerator()) {
    if ($workflowText -notmatch $entry.Value) { $parallelFailures += $entry.Key }
}
if ($parallelFailures.Count -gt 0) {
    throw "Release parallelization contract missing: $($parallelFailures -join ', ')"
}

$lifecycleText = Get-Content $lifecycle -Raw
if ($lifecycleText -notmatch "ValidateSet\('All','Maintenance','Persistence'\)") {
    throw 'Lifecycle phase contract missing: All/Maintenance/Persistence.'
}

$rollbackText = Get-Content $rollback -Raw
if ($rollbackText -notmatch 'BootstrapIfMissing') {
    throw 'Forced rollback bootstrap contract missing.'
}

Write-Output 'OPERIS_SETUP_EXE_CONTRACT_PASS'
