param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$DestinationRoot,
  [string]$DataRoot = ""
)

$ErrorActionPreference = "Stop"

$serverRoot = Join-Path $InstallRoot "server"
$prismaRoot = Join-Path $serverRoot "prisma"
$dbFile = Join-Path $prismaRoot "yaklasan-isler.db"
$envFile = Join-Path $serverRoot ".env"

if (-not (Test-Path $dbFile)) {
  throw "SQLite DB bulunamadı: $dbFile"
}

New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stage = Join-Path $DestinationRoot "pre-postgresql-$stamp"
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$dbBackup = Join-Path $stage "yaklasan-isler.db"
$manifest = Join-Path $stage "manifest.json"

Push-Location $serverRoot
try {
  $env:DATABASE_URL = "file:./yaklasan-isler.db"
  $env:OPERIS_SQLITE_BACKUP_DIR = $stage
  node scripts/backup-sqlite-before-postgresql.mjs | Out-Host
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:OPERIS_SQLITE_BACKUP_DIR -ErrorAction SilentlyContinue
  Pop-Location
}

$generatedDb = Get-ChildItem $stage -Filter "yaklasan-isler-*.db" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $generatedDb) {
  throw "Transaction-consistent SQLite backup üretilemedi."
}
Copy-Item $generatedDb.FullName $dbBackup -Force

if (Test-Path $envFile) {
  Copy-Item $envFile (Join-Path $stage "server.env") -Force
}

if (-not $DataRoot) {
  $DataRoot = Join-Path $InstallRoot "data"
}
$attachments = Join-Path $DataRoot "helpdesk-attachments"
if (Test-Path $attachments) {
  Copy-Item $attachments (Join-Path $stage "helpdesk-attachments") -Recurse -Force
}

Copy-Item (Join-Path $prismaRoot "schema.sqlite.prisma") (Join-Path $stage "schema.sqlite.prisma") -Force

$files = Get-ChildItem $stage -File -Recurse |
  Where-Object { $_.FullName -ne $manifest } |
  ForEach-Object {
    [PSCustomObject]@{
      path = $_.FullName.Substring($stage.Length).TrimStart('\')
      bytes = $_.Length
      sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    }
  }

$manifestObject = [PSCustomObject]@{
  product = "OPERIS"
  purpose = "PRE_POSTGRESQL_FULL_ROLLBACK_BACKUP"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  installRoot = $InstallRoot
  dataRoot = $DataRoot
  files = @($files)
}
$manifestObject | ConvertTo-Json -Depth 6 | Set-Content $manifest -Encoding UTF8

$zip = "$stage.zip"
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal -Force
$zipHash = (Get-FileHash $zip -Algorithm SHA256).Hash

Write-Host "FULL PRE-POSTGRESQL BACKUP PASS" -ForegroundColor Green
Write-Host "ZIP: $zip"
Write-Host "SHA256: $zipHash"
Write-Host "Bu ZIP farklı fiziksel diske/kopyaya da alınmadan production cutover yapılmamalıdır." -ForegroundColor Yellow
