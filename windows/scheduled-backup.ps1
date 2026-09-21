param(
  [Parameter(Mandatory=$true)][string]$NetworkEnabled,
  [Parameter(Mandatory=$true)][AllowEmptyString()][string]$NetworkPath,
  [Parameter(Mandatory=$true)][ValidateRange(1,3650)][int]$RetentionDays
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'installer-postgresql.ps1')

$currentUrl = Read-OperisDatabaseUrl (Join-Path $env:ProgramData 'Operis\server\.env')
if ($currentUrl -notmatch '^postgres(ql)?://') {
    throw 'OPERIS PostgreSQL-only: scheduled backup requires an active PostgreSQL configuration.'
}

& (Join-Path $PSScriptRoot 'postgresql-daily-backup.ps1') -RetentionDays $RetentionDays -NetworkEnabled $NetworkEnabled -NetworkPath $NetworkPath
