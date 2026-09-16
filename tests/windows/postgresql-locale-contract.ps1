$ErrorActionPreference = 'Stop'
$provision = Get-Content (Join-Path $PSScriptRoot '..\..\windows\postgresql-provision.ps1') -Raw
if ($provision -notmatch "'locale=C'") {
    throw 'PostgreSQL installer must force an ASCII-safe locale for unattended Windows provisioning.'
}
Write-Output 'POSTGRESQL_ASCII_SAFE_LOCALE_CONTRACT_PASS'
