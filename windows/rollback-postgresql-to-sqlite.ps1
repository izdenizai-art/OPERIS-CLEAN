param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$BackupDb,
  [Parameter(Mandatory=$true)][ValidateSet("YES")][string]$ConfirmRestore
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupDb)) {
  throw "SQLite rollback yedeği bulunamadı: $BackupDb"
}

$serverRoot = Join-Path $InstallRoot "server"
$prismaRoot = Join-Path $serverRoot "prisma"
$sqliteSchema = Join-Path $prismaRoot "schema.sqlite.prisma"
$activeSchema = Join-Path $prismaRoot "schema.prisma"
$targetDb = Join-Path $prismaRoot "yaklasan-isler.db"
$envFile = Join-Path $serverRoot ".env"

if (-not (Test-Path $sqliteSchema)) {
  throw "SQLite Prisma şeması bulunamadı: $sqliteSchema"
}

$expectedHash = (Get-FileHash $BackupDb -Algorithm SHA256).Hash

Copy-Item $BackupDb $targetDb -Force
$copiedHash = (Get-FileHash $targetDb -Algorithm SHA256).Hash
if ($expectedHash -ne $copiedHash) {
  throw "Rollback DB kopyası SHA256 doğrulamasından geçemedi."
}

Copy-Item $sqliteSchema $activeSchema -Force

$envLines = @()
if (Test-Path $envFile) {
  $envLines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' }
}
$envLines += 'DATABASE_URL="file:./yaklasan-isler.db"'
Set-Content -Path $envFile -Value $envLines -Encoding UTF8

Push-Location $serverRoot
try {
  npm run prisma:generate
} finally {
  Pop-Location
}

$finalHash = (Get-FileHash $targetDb -Algorithm SHA256).Hash
if ($expectedHash -ne $finalHash) {
  throw "Prisma Client üretiminden sonra SQLite DB beklenmedik biçimde değişti."
}

Write-Host "SQLite rollback byte-for-byte geri yüklendi; prisma db push ÇALIŞTIRILMADI." -ForegroundColor Green
Write-Host "Servisi kontrollü başlatın; /api/health, login ve kritik veri sayımlarını doğrulayın." -ForegroundColor Yellow
