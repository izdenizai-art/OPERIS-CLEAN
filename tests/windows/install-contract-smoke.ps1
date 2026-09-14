$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$installer = Join-Path $repo "windows\install-enterprise.ps1"
$config = Join-Path $repo "OPERIS_SERVER_CONFIG.ini"
$diagnostic = Join-Path $repo "AG_TANILAMA.cmd"
$versionFile = Join-Path $repo "VERSION.txt"

foreach ($required in @($installer,$config,$diagnostic,$versionFile)) {
    if (-not (Test-Path $required)) { throw "Zorunlu kurulum dosyası yok: $required" }
}

$installerText = (Get-Content $installer -Raw) + (Get-Content (Join-Path $repo 'windows\installer-postgresql.ps1') -Raw)
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
    PostgreSQLIntegration = ((Get-Content $installer -Raw) -match '(?m)^    Initialize-OperisPostgresql\s*$')
    PrismaGenerate = ($installerText -match 'prisma:generate')
    PrismaPush = ($installerText -match 'prisma:push')
    Build = ($installerText -match '@\("run",\s*"build"\)')
    Health = ($installerText -match '/api/health')
    DomainPrivateFirewall = ($installerText -match 'Operis Enterprise TCP \$Port - DomainPrivate')
    PublicSubnetFirewall = ($installerText -match 'Operis Enterprise TCP \$Port - PublicLocalSubnet')
    ForceCleanExplicit = ($configText -match '(?m)^FORCE_CLEAN_INSTALL=(YES|NO)\s*$')
    DiagnosticHealth = ($diagnosticText -match 'localhost:3001/api/health')
    DiagnosticCurrentFirewall = (
        $diagnosticText -match 'Operis Enterprise TCP 3001 - DomainPrivate' -and
        $diagnosticText -match 'Operis Enterprise TCP 3001 - PublicLocalSubnet'
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
