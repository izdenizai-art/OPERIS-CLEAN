$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$installer = Join-Path $repo "windows\install-enterprise.ps1"
$postgresProvision = Join-Path $repo 'windows\postgresql-provision.ps1'
$postgresInstaller = Join-Path $repo 'windows\installer-postgresql.ps1'
$launcher = Join-Path $repo 'windows\setup-launch.ps1'
$iss = Join-Path $repo 'installer\OPERIS.iss'
$config = Join-Path $repo "OPERIS_SERVER_CONFIG.ini"
$diagnostic = Join-Path $repo "AG_TANILAMA.cmd"
$versionFile = Join-Path $repo "VERSION.txt"

foreach ($required in @($installer,$postgresProvision,$postgresInstaller,$launcher,$iss,$config,$diagnostic,$versionFile)) {
    if (-not (Test-Path $required)) { throw "Zorunlu kurulum dosyası yok: $required" }
}

$installerSource = Get-Content $installer -Raw
$postgresProvisionSource = Get-Content $postgresProvision -Raw
$postgresInstallerSource = Get-Content $postgresInstaller -Raw
$launcherText = Get-Content $launcher -Raw
$issText = Get-Content $iss -Raw
$installerText = $installerSource + $postgresInstallerSource
$configText = Get-Content $config -Raw
$diagnosticText = Get-Content $diagnostic -Raw
$version = (Get-Content $versionFile -Raw).Trim()

$assertions = [ordered]@{
    VersionFile = ($version -eq "6.3.63")
    InstallerVersion = ($installerText -match '\$Version\s*=\s*"6\.3\.63"')
    InstallRoot = ($installerText -match 'ProgramData\s+"Operis"')
    ServerTask = ($installerText -match '\$TaskName\s*=\s*"OperisEnterpriseServer"')
    BackupTask = ($installerText -match '\$BackupTaskName\s*=\s*"OperisEnterpriseDailyBackup"')
    Port = ($installerText -match '\$Port\s*=\s*3001')
    ExactNodeRuntime = ($installerSource -match "nodeVersion -ne 'v24\.21\.0'")
    PostgreSQLIntegration = (
        $installerSource -match 'Initialize-OperisPostgresql' -and
        $installerSource -match '\$script:SameVersionMaintenance' -and
        $installerSource -match 'db push uygulanmayacak'
    )
    SameVersionRegeneratesPostgresqlPrismaClient = (
        $installerSource -match '(?s)if\s*\(\$script:SameVersionMaintenance\s+-and\s+\$script:DatabaseState\s+-and\s+-not\s+\$script:DatabaseState\.SQLite\)\s*\{.*?schema\.postgresql\.prisma.*?prisma:generate.*?\}\s*else\s*\{\s*Initialize-OperisPostgresql'
    )
    SameVersionSqliteStillMigratesToPostgresql = (
        $installerSource -match '(?s)if\s*\(\$script:SameVersionMaintenance\s+-and\s+\$script:DatabaseState\s+-and\s+-not\s+\$script:DatabaseState\.SQLite\)\s*\{.*?\}\s*else\s*\{\s*Initialize-OperisPostgresql'
    )
    PrismaGenerate = ($installerText -match 'prisma:generate')
    PrismaPush = ($installerText -match 'prisma:push')
    Build = ($installerText -match '@\("run",\s*"build"\)')
    ShortcutDoesNotReferenceMissingIcon = ($installerSource -notmatch 'IconFile=\$InstallRoot\\public\\icons\\operis\.ico')
    Health = ($installerText -match '/api/health')
    RollbackHealthVerification = (
        $installerSource -match 'function\s+Verify-RollbackHealth' -and
        $installerSource -match '\$expectsPostgresql\s*=\s*\$script:DatabaseState\s+-and\s+-not\s+\$script:DatabaseState\.SQLite' -and
        $installerSource -match '(?s)\$databaseOk\s*=\s*if\s*\(\$expectsPostgresql\).*?database\.provider.*?database\.connected.*?else\s*\{\s*\$true\s*\}' -and
        $installerSource -match 'if\s*\(\$health\.ok\s+-and\s+\$versionOk\s+-and\s+\$databaseOk\)'
    )
    CIOnlyFailureInjection = (
        $installerSource -match 'OPERIS_TEST_FORCE_UPDATE_FAILURE' -and
        $installerSource -match '\$env:GITHUB_ACTIONS\s+-eq\s+''true''' -and
        $installerSource -match 'OPERIS_TEST_FORCED_UPDATE_FAILURE'
    )
    DomainPrivateFirewall = ($installerText -match 'Operis Enterprise TCP \$Port - DomainPrivate')
    PublicSubnetFirewall = ($installerText -match 'Operis Enterprise TCP \$Port - PublicLocalSubnet')
    ForceCleanExplicit = ($configText -match '(?m)^FORCE_CLEAN_INSTALL=(YES|NO)\s*$')
    DiagnosticHealth = ($diagnosticText -match 'localhost:3001/api/health')
    DiagnosticCurrentFirewall = (
        $diagnosticText -match 'Operis Enterprise TCP 3001 - DomainPrivate' -and
        $diagnosticText -match 'Operis Enterprise TCP 3001 - PublicLocalSubnet'
    )
    MachineWideSetupMutex = ($issText -match '(?m)^SetupMutex=Global\\OPERIS_ENTERPRISE_SETUP\s*$')
    PostgreSQLProvisionMutex = ($postgresProvisionSource -match 'Global\\OPERIS_POSTGRESQL_PROVISION')
    SameVersionMaintenanceMode = (
        $installerSource -match 'SAME_VERSION' -and
        $installerSource -match 'OPERIS_MAINTENANCE_ACTION' -and
        $installerSource -match '@\("REPAIR",\s*"REFRESH"\)'
    )
    ExistingNetworkBindingHelper = ($installerSource -match 'function\s+Get-ExistingOperisNetworkBinding')
    ExistingNetworkBindingPriority = ($installerSource -match 'Mevcut NetworkBinding\.json korunuyor')
    LauncherPreservesExistingBindingBeforeAskFallback = (
        $launcherText -match 'NetworkBinding\.json' -and
        $launcherText -match 'BIND_IP=ASK' -and
        $launcherText -match 'existingBinding'
    )
}

$failed = @($assertions.GetEnumerator() | Where-Object { -not $_.Value })
$assertions.GetEnumerator() | ForEach-Object {
    Write-Host ("{0}: {1}" -f $_.Key, $(if ($_.Value) { "PASS" } else { "FAIL" }))
}

if ($failed.Count -gt 0) {
    throw "Windows install contract FAIL: $($failed.Key -join ', ')"
}

# Runtime regression: VersionHistory.json may be transiently locked by another process
# immediately after the server health check. The installer must retry and preserve history.
$tokens = $null
$parseErrors = $null
$installerAst = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw "Installer parse error before VersionHistory lock test." }
$historyFunction = $installerAst.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Save-VersionHistory'
}, $true)
if (-not $historyFunction) { throw 'Save-VersionHistory function not found.' }
Invoke-Expression $historyFunction.Extent.Text

$historyTestRoot = Join-Path $env:TEMP ('operis-version-history-lock-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $historyTestRoot -Force | Out-Null
$script:DataRoot = $historyTestRoot
$script:InstallMode = 'REPAIR'
$script:PreviousVersion = '6.3.63'
$BackupsRoot = Join-Path $historyTestRoot 'Backups'
function Ensure-Directories { New-Item -ItemType Directory -Path $script:DataRoot -Force | Out-Null }
function Write-Log([string]$Message,[string]$Level='INFO') { }

$historyFile = Join-Path $historyTestRoot 'VersionHistory.json'
@([pscustomobject]@{
    installedAt = '2026-09-18T00:00:00+03:00'
    computer = 'TEST'
    user = 'TEST'
    mode = 'REPAIR'
    previousVersion = '6.3.63'
    newVersion = '6.3.63'
    status = 'SUCCESS'
    backupRoot = ''
    message = 'existing'
}) | ConvertTo-Json -Depth 5 | Set-Content $historyFile -Encoding UTF8

$lockMarker = Join-Path $historyTestRoot 'lock.marker'
$lockJob = Start-Job -ArgumentList $historyFile,$lockMarker -ScriptBlock {
    param($file,$markerPath)
    $stream = [System.IO.File]::Open($file,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
    try {
        [System.IO.File]::WriteAllText($markerPath,'locked')
        Start-Sleep -Milliseconds 1600
    } finally {
        $stream.Dispose()
    }
}

try {
    $lockDeadline = (Get-Date).AddSeconds(5)
    while (-not (Test-Path $lockMarker) -and (Get-Date) -lt $lockDeadline) { Start-Sleep -Milliseconds 50 }
    if (-not (Test-Path $lockMarker)) { throw 'VersionHistory test lock was not acquired.' }

    $historyFailure = $null
    try { Save-VersionHistory 'SUCCESS' 'lock-retry-test' } catch { $historyFailure = $_ }
    Wait-Job $lockJob -Timeout 5 | Out-Null
    if ($historyFailure) { throw $historyFailure }

    $historyRows = @(Get-Content $historyFile -Raw | ConvertFrom-Json)
    if ($historyRows.Count -ne 2) { throw "VersionHistory transient-lock retry did not preserve the existing row." }
    if ($historyRows[-1].status -ne 'SUCCESS' -or $historyRows[-1].message -ne 'lock-retry-test') {
        throw 'VersionHistory transient-lock retry did not append the new row.'
    }
    Write-Host 'VersionHistoryTransientLockRetry: PASS'
} finally {
    Stop-Job $lockJob -ErrorAction SilentlyContinue
    Remove-Job $lockJob -Force -ErrorAction SilentlyContinue
    Remove-Item $historyTestRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "OPERIS Windows install contract PASS"