param(
  [Parameter(Mandatory=$true)][string]$DatabaseUrl,
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [Parameter(Mandatory=$true)][ValidateSet("YES")][string]$ConfirmRestore
)

$ErrorActionPreference = "Stop"


function Parse-PostgresUrl([string]$Url) {
  $uri = [System.Uri]$Url
  if ($uri.Scheme -notin @("postgres", "postgresql")) {
    throw "PostgreSQL URL bekleniyordu."
  }

  $userInfo = $uri.UserInfo.Split(':', 2)
  if ($userInfo.Count -lt 2) {
    throw "PostgreSQL URL kullanıcı/parola içermelidir."
  }

  $user = [System.Uri]::UnescapeDataString($userInfo[0])
  $password = [System.Uri]::UnescapeDataString($userInfo[1])
  $database = $uri.AbsolutePath.TrimStart('/')
  if (-not $database) {
    throw "PostgreSQL database adı boş."
  }

  [PSCustomObject]@{
    Host = $uri.Host
    Port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    User = $user
    Password = $password
    Database = $database
  }
}


$connection = Parse-PostgresUrl $DatabaseUrl

if (-not (Test-Path $BackupFile)) {
  throw "Backup bulunamadı: $BackupFile"
}

$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if (-not $pgRestore) {
  throw "pg_restore bulunamadı. PostgreSQL client tools kurulmalıdır."
}

$manifestFile = "$BackupFile.manifest.json"
if (-not (Test-Path $manifestFile)) {
  throw "Backup manifesti bulunamadı: $manifestFile"
}
$manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
if ($manifest.product -ne "OPERIS" -or $manifest.purpose -ne "POSTGRESQL_BACKUP") {
  throw "Geçersiz PostgreSQL backup manifesti."
}
$expected = [string]$manifest.sha256
$actual = (Get-FileHash $BackupFile -Algorithm SHA256).Hash
if (-not $expected -or $expected -ne $actual) {
  throw "Backup SHA256 doğrulaması başarısız."
}

$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $connection.Password
  & $pgRestore.Source `
    --host=$($connection.Host) `
    --port=$($connection.Port) `
    --username=$($connection.User) `
    --dbname=$($connection.Database) `
    --clean `
    --if-exists `
    --no-owner `
    --no-privileges `
    $BackupFile
  if ($LASTEXITCODE -ne 0) {
    throw "pg_restore başarısız oldu. ExitCode=$LASTEXITCODE"
  }
} finally {
  if ($null -eq $previousPassword) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:PGPASSWORD = $previousPassword
  }
}

Write-Host "PostgreSQL restore tamamlandı. Smoke testler yapılmadan trafik açılmamalıdır." -ForegroundColor Yellow
