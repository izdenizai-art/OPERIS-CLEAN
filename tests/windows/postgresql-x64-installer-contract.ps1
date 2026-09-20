$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot '..\..\windows\postgresql-provision.ps1'
$sourceText = Get-Content $source -Raw

. $source

if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'This contract requires 64-bit Windows.'
}

$envHelper = Get-Command Get-OperisPostgresqlX64InstallerEnvironment -ErrorAction SilentlyContinue
if (-not $envHelper) {
    throw 'Missing Get-OperisPostgresqlX64InstallerEnvironment helper.'
}

$installerHelper = Get-Command Invoke-OperisPostgresqlX64Installer -ErrorAction SilentlyContinue
if (-not $installerHelper) {
    throw 'Missing Invoke-OperisPostgresqlX64Installer helper.'
}

$names = @(
    'PROCESSOR_ARCHITECTURE',
    'PROCESSOR_ARCHITEW6432',
    'ProgramFiles',
    'ProgramW6432',
    'ProgramFiles(x86)',
    'CommonProgramFiles',
    'CommonProgramW6432',
    'CommonProgramFiles(x86)'
)

$backup = @{}
foreach ($name in $names) {
    $item = Get-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue
    $backup[$name] = if ($item) { [string]$item.Value } else { $null }
}

try {
    foreach ($name in @('PROCESSOR_ARCHITEW6432','ProgramW6432','ProgramFiles(x86)','CommonProgramW6432','CommonProgramFiles(x86)')) {
        Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue
    }

    $profile = Get-OperisPostgresqlX64InstallerEnvironment

    if ($profile.PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw "Expected AMD64 architecture, got '$($profile.PROCESSOR_ARCHITECTURE)'."
    }
    if ($profile.PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
        throw "Expected PROCESSOR_ARCHITEW6432=AMD64 for x64 bootstrap detection."
    }
    if ([string]::IsNullOrWhiteSpace([string]$profile.ProgramFiles)) {
        throw 'ProgramFiles was not normalized.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$profile.ProgramW6432)) {
        throw 'ProgramW6432 was not normalized.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$profile.'ProgramFiles(x86)')) {
        throw 'ProgramFiles(x86) was not normalized.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$profile.CommonProgramFiles)) {
        throw 'CommonProgramFiles was not normalized.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$profile.CommonProgramW6432)) {
        throw 'CommonProgramW6432 was not normalized.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$profile.'CommonProgramFiles(x86)')) {
        throw 'CommonProgramFiles(x86) was not normalized.'
    }

    foreach ($path in @(
        [string]$profile.ProgramFiles,
        [string]$profile.ProgramW6432,
        [string]$profile.'ProgramFiles(x86)'
    )) {
        if (-not (Test-Path $path)) {
            throw "Normalized architecture path does not exist: $path"
        }
    }
}
finally {
    foreach ($name in $names) {
        if ($null -eq $backup[$name]) {
            Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue
        } else {
            Set-Item -LiteralPath ("Env:" + $name) -Value $backup[$name]
        }
    }
}

if ($sourceText -notmatch 'Invoke-OperisPostgresqlX64Installer\s+-Installer\s+\$installer\s+-OptionFile\s+\$optionFile') {
    throw 'Ensure-OperisPostgresql must invoke the x64 installer wrapper.'
}

if ($sourceText -match 'Start-Process\s+\$installer\s+-ArgumentList\s+"--optionfile') {
    throw 'Direct PostgreSQL installer Start-Process call remains.'
}

if ($sourceText -notmatch '\[string\]\$BundledInstallerPath\s*=\s*''''') {
    throw 'Ensure-OperisPostgresql must accept BundledInstallerPath for offline clean install.'
}
if ($sourceText -notmatch 'Test-Path\s+\$BundledInstallerPath') {
    throw 'Bundled PostgreSQL installer is not checked before network download.'
}
if ($sourceText -notmatch 'Copy-Item\s+\$BundledInstallerPath\s+\$installer') {
    throw 'Bundled PostgreSQL installer is not copied into the managed PostgreSQL root.'
}

$releaseWorkflow = Get-Content (Join-Path $PSScriptRoot '..\..\.github\workflows\operis-release-finalization.yml') -Raw
if ($releaseWorkflow -notmatch 'Stage bundled PostgreSQL x64 installer') {
    throw 'Release workflow does not stage the PostgreSQL x64 installer into setup payload.'
}
if ($releaseWorkflow -notmatch '6D3919BC23CFB45E79C6E391DE8B689C32101F2C1B73377AA26E4CE593C0EF28') {
    throw 'Release workflow does not pin the PostgreSQL installer SHA256.'
}
if ($releaseWorkflow -notmatch 'vendor\\postgresql\\postgresql-16\.14-2-windows-x64\.exe') {
    throw 'Release workflow does not place the PostgreSQL installer in the bundled vendor path.'
}

Write-Output 'POSTGRESQL_X64_INSTALLER_ENVIRONMENT_CONTRACT_PASS'
