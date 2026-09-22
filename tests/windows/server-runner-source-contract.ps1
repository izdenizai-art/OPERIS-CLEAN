$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$installer = Join-Path $repoRoot 'windows\install-enterprise.ps1'
$runner = Join-Path $repoRoot 'windows\server-runner.ps1'

if (-not (Test-Path -LiteralPath $installer)) {
    throw "install-enterprise.ps1 not found: $installer"
}
if (-not (Test-Path -LiteralPath $runner)) {
    throw "server-runner.ps1 must exist as a real repository source file: $runner"
}

$installerText = Get-Content -LiteralPath $installer -Raw
$runnerText = Get-Content -LiteralPath $runner -Raw

if ($installerText -match '(?s)\$runner\s*=\s*@''') {
    throw 'install-enterprise.ps1 must not embed server-runner.ps1 as a here-string.'
}

$requiredInstallerFragments = @(
    '$runnerSource = Join-Path $PSScriptRoot "server-runner.ps1"',
    '$runnerTarget = Join-Path $InstallRoot "windows\server-runner.ps1"',
    'Test-Path -LiteralPath $runnerSource',
    'Copy-Item -LiteralPath $runnerSource -Destination $runnerTarget -Force',
    '$InstallRoot\windows\server-runner.ps1'
)
foreach ($fragment in $requiredInstallerFragments) {
    if (-not $installerText.Contains($fragment)) {
        throw "install-enterprise.ps1 runner source contract missing: $fragment"
    }
}

$requiredRunnerFragments = @(
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'server\dist\index.js',
    'node-path.txt',
    'postgresql-bin.txt',
    'pg_isready.exe',
    'OPERIS_ENABLE_FIREWALL_SYNC',
    '& $NodePath $ServerFile'
)
foreach ($fragment in $requiredRunnerFragments) {
    if (-not $runnerText.Contains($fragment)) {
        throw "server-runner.ps1 required runtime behavior missing: $fragment"
    }
}

Write-Output 'OPERIS_SERVER_RUNNER_SOURCE_CONTRACT_PASS'
