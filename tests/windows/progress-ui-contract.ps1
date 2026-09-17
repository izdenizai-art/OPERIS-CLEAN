$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$hostScript = Join-Path $repo 'windows\operation-host.ps1'
$uiScript = Join-Path $repo 'windows\progress-ui.ps1'
$iss = Join-Path $repo 'installer\OPERIS.iss'

foreach ($path in @($hostScript, $uiScript, $iss)) {
    if (-not (Test-Path $path)) { throw "PROGRESS_UI_REQUIRED_FILE_MISSING: $path" }
}

$hostText = Get-Content $hostScript -Raw
foreach ($needle in @(
    'SessionId', 'EventFile', 'LogFile', 'CancelRequestFile',
    'Mask-SensitiveText', 'ConvertTo-Json -Compress',
    'RedirectStandardOutput', 'RedirectStandardError',
    'cancelSafe', 'lastSuccessfulStep', 'rollbackStatus', 'rollbackHealth',
    'PRIVATE KEY', 'DATABASE_URL', 'SNMP',
    'InstallRootExistedAtStart', 'Operis-Setup'
)) {
    if ($hostText -notmatch [regex]::Escape($needle)) { throw "PROGRESS_HOST_CONTRACT_MISSING: $needle" }
}
if ($hostText -notmatch 'credentials\\+\.dpapi') { throw 'PROGRESS_HOST_CONTRACT_MISSING: credentials.dpapi masking regex' }
if ($hostText -notmatch 'exit\s+(?:\(\[int\]\s*)?\$exitCode\)?') { throw 'PROGRESS_HOST_CONTRACT_MISSING: child exit code propagation' }

$uiText = Get-Content $uiScript -Raw
foreach ($needle in @(
    'System.Windows.Forms', 'ProgressBar', 'TextBox', 'ShortcutsEnabled',
    'Tümünü Kopyala', 'Log Klasörünü Aç', 'Detayları Göster',
    'Cancel', 'Başarıyla tamamlandı', 'İşlem başarısız',
    'ProbeOnly', 'Silent', 'operation-host.ps1', 'exit $engineExitCode',
    'InstallRootExistedAtStart', 'Operis-Setup',
    'Invoke-RestMethod', 'database.provider', 'database.connected',
    'Health:', 'DB:', 'MistyRose', 'DarkRed', 'rollbackHealth',
    'IsNullOrWhiteSpace($env:ProgramData)', 'CommonApplicationData'
)) {
    if ($uiText -notmatch [regex]::Escape($needle)) { throw "PROGRESS_UI_CONTRACT_MISSING: $needle" }
}

$issText = Get-Content $iss -Raw
foreach ($needle in @(
    'progress-ui.ps1', 'operation-host.ps1', 'OPERISPROGRESSUI',
    'REPAIR', 'REFRESH', 'UNINSTALL', 'InstallerExitCode', 'GetCustomSetupExitCode'
)) {
    if ($issText -notmatch [regex]::Escape($needle)) { throw "PROGRESS_INNO_CONTRACT_MISSING: $needle" }
}

if ($hostText -match '(?i)Write-(Host|Output).*\$.*(password|token|secret|community)') {
    throw 'PROGRESS_HOST_POTENTIAL_RAW_SECRET_OUTPUT'
}

Write-Output 'OPERIS_PROGRESS_UI_CONTRACT_PASS'