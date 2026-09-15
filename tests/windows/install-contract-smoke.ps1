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
    PrismaGenerate = ($installerText -match 'prisma:generate')
    PrismaPush = ($installerText -match 'prisma:push')
    Build = ($installerText -match '@\("run",\s*"build"\)')
    Health = ($installerText -match '/api/health')
    RollbackHealthVerification = (
        $installerSource -match 'function\s+Verify-RollbackHealth' -and
        $installerSource -match 'Rollback health' -and
        $installerSource -match 'database\.connected'
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

Write-Host "OPERIS Windows install contract PASS"
