$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$iss = Join-Path $repo 'installer\OPERIS.iss'
$launcher = Join-Path $repo 'windows\setup-launch.ps1'
$uninstall = Join-Path $repo 'windows\uninstall-enterprise.ps1'
$workflow = Join-Path $repo '.github\workflows\operis-release-finalization.yml'

foreach ($path in @($iss, $launcher, $uninstall, $workflow)) {
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

Write-Output 'OPERIS_SETUP_EXE_CONTRACT_PASS'
