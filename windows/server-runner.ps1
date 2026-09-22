[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Continue"
$InstallRoot = Join-Path $env:ProgramData "Operis"
$LogsRoot = Join-Path $InstallRoot "Logs"
$NodePathFile = Join-Path $InstallRoot "node-path.txt"
$ServerFile = Join-Path $InstallRoot "server\dist\index.js"
$LogFile = Join-Path $LogsRoot "Server.log"
$EnvFile = Join-Path $InstallRoot "server\.env"
$PostgresqlBinFile = Join-Path $InstallRoot "Data\postgresql-bin.txt"
New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
if (-not (Test-Path $NodePathFile)) { Add-Content $LogFile "$(Get-Date -Format o) Node path file missing"; exit 2 }
$NodePath = (Get-Content $NodePathFile -Raw).Trim()
if (-not (Test-Path $NodePath)) { Add-Content $LogFile "$(Get-Date -Format o) node.exe missing: $NodePath"; exit 3 }
if (-not (Test-Path $ServerFile)) { Add-Content $LogFile "$(Get-Date -Format o) server file missing: $ServerFile"; exit 4 }
if (-not (Test-Path $EnvFile)) { Add-Content $LogFile "$(Get-Date -Format o) server .env missing"; exit 5 }
if (-not (Test-Path $PostgresqlBinFile)) { Add-Content $LogFile "$(Get-Date -Format o) postgresql-bin.txt missing"; exit 6 }

$DatabaseUrlLine = Get-Content $EnvFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $DatabaseUrlLine) { Add-Content $LogFile "$(Get-Date -Format o) DATABASE_URL missing"; exit 7 }
$DatabaseUrl = $DatabaseUrlLine.Substring('DATABASE_URL='.Length).Trim().Trim([char]34).Trim([char]39)
try { $DatabaseUri = [Uri]$DatabaseUrl } catch { Add-Content $LogFile "$(Get-Date -Format o) DATABASE_URL invalid"; exit 8 }
$DatabaseHost = if ([string]::IsNullOrWhiteSpace($DatabaseUri.Host)) { '127.0.0.1' } else { $DatabaseUri.Host }
$DatabasePort = if ($DatabaseUri.Port -gt 0) { $DatabaseUri.Port } else { 5432 }
$PostgresqlBin = (Get-Content $PostgresqlBinFile -Raw).Trim()
$PgIsReady = Join-Path $PostgresqlBin 'pg_isready.exe'
if (-not (Test-Path $PgIsReady)) { Add-Content $LogFile "$(Get-Date -Format o) pg_isready.exe missing: $PgIsReady"; exit 9 }

$ReadyDeadline = (Get-Date).AddSeconds(120)
$Ready = $false
do {
    & $PgIsReady -h $DatabaseHost -p $DatabasePort -t 2 *> $null
    if ($LASTEXITCODE -eq 0) { $Ready = $true; break }
    Add-Content $LogFile "$(Get-Date -Format o) PostgreSQL hazır değil; bekleniyor"
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $ReadyDeadline)
if (-not $Ready) { Add-Content $LogFile "$(Get-Date -Format o) PostgreSQL 120 saniye içinde hazır olmadı"; exit 10 }

Set-Location $InstallRoot
$env:DOTENV_CONFIG_PATH = $EnvFile
$env:OPERIS_DATA_DIR = Join-Path $InstallRoot "Data"
$env:OPERIS_ENABLE_FIREWALL_SYNC = "1"
Add-Content $LogFile "$(Get-Date -Format o) Operis server starting"
& $NodePath $ServerFile *>> $LogFile
$exitCode = $LASTEXITCODE
Add-Content $LogFile "$(Get-Date -Format o) Operis server exited: $exitCode"
exit $exitCode
