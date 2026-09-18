$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:OS -ne 'Windows_NT') { throw 'Disposable GitHub Windows runner required.' }
$provisionSource = Get-Content (Join-Path $PSScriptRoot '..\..\windows\postgresql-provision.ps1') -Raw
if ($provisionSource -match '\$env:OS\s+-ne\s+''Windows_NT''' -or
    $provisionSource -notmatch 'OSVersion\.Platform' -or
    $provisionSource -notmatch 'PlatformID\]::Win32NT') {
    throw 'PostgreSQL Windows detection must use the .NET platform, not the OS environment variable.'
}
Write-Output 'POSTGRESQL_WINDOWS_PLATFORM_DETECTION_PASS'
. "$PSScriptRoot\..\..\windows\postgresql-provision.ps1"
$root = Join-Path $env:RUNNER_TEMP 'OperisPostgreSQLProvisionTest'
$first = Ensure-OperisPostgresql -Root $root -ServiceName OperisPostgreSQLTest16 -DatabasePort 55432
Write-Output "::add-mask::$($first.DatabaseUrl)"
$uri = [Uri]$first.DatabaseUrl
$password = $uri.UserInfo.Split(':',2)[1]
Write-Output "::add-mask::$password"
$credentialHash = (Get-FileHash (Join-Path $root 'credentials.dpapi')).Hash
$env:PGPASSWORD = $password
try {
    $psql = Join-Path $first.Bin 'psql.exe'
    & $psql -X -w -h 127.0.0.1 -p 55432 -U operis -d operis -v ON_ERROR_STOP=1 -c "CREATE TABLE provisioning_sentinel(id integer PRIMARY KEY, value text); INSERT INTO provisioning_sentinel VALUES(1,'preserve-me');" | Out-Null
    $second = Ensure-OperisPostgresql -Root $root -ServiceName OperisPostgreSQLTest16 -DatabasePort 55432
    if ($first.DatabaseUrl -ne $second.DatabaseUrl) { throw 'Credentials changed during provisioning reuse.' }
    if ($credentialHash -ne (Get-FileHash (Join-Path $root 'credentials.dpapi')).Hash) { throw 'Credential file changed.' }
    $value = & $psql -X -w -h 127.0.0.1 -p 55432 -U operis -d operis -t -A -c 'SELECT value FROM provisioning_sentinel WHERE id=1'
    if ($LASTEXITCODE -ne 0 -or $value.Trim() -ne 'preserve-me') { throw 'Provisioning reuse lost data.' }
    if (@(Get-Service -Name OperisPostgreSQLTest16).Count -ne 1) { throw 'Service identity invalid.' }
    if (Test-Path (Join-Path $root 'installer-options.txt')) { throw 'Plaintext installer options remain.' }
    Write-Output 'POSTGRESQL_AUTOMATIC_PROVISIONING_PASS'
    Write-Output 'POSTGRESQL_REUSE_CREDENTIALS_AND_DATA_PASS'
    New-Item -ItemType Directory -Path "$env:RUNNER_TEMP\operis-provision-evidence" -Force | Out-Null
    @{ sourceSha=$env:GITHUB_SHA; provisioning='PASS'; reuse='PASS'; sentinel='PASS'; setupExeLifecycle='NOT_TESTED' } |
        ConvertTo-Json | Set-Content "$env:RUNNER_TEMP\operis-provision-evidence\result.json"
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
