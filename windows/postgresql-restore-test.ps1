param(
  [Parameter(Mandatory=$true)][string]$AdminDatabaseUrl,
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [string]$TestDatabaseName = ""
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

  [PSCustomObject]@{
    Host = $uri.Host
    Port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    User = [System.Uri]::UnescapeDataString($userInfo[0])
    Password = [System.Uri]::UnescapeDataString($userInfo[1])
    Database = $uri.AbsolutePath.TrimStart('/')
  }
}

$connection = Parse-PostgresUrl $AdminDatabaseUrl
if (-not $connection.Database) {
  throw "AdminDatabaseUrl database adı içermelidir."
}
if (-not (Test-Path $BackupFile)) {
  throw "Backup bulunamadı: $BackupFile"
}

$manifestFile = "$BackupFile.manifest.json"
if (-not (Test-Path $manifestFile)) {
  throw "Backup manifesti bulunamadı: $manifestFile"
}
$manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
$actualHash = (Get-FileHash $BackupFile -Algorithm SHA256).Hash
if ($manifest.product -ne "OPERIS" -or $manifest.purpose -ne "POSTGRESQL_BACKUP" -or [string]$manifest.sha256 -ne $actualHash) {
  throw "Backup manifest/SHA doğrulaması başarısız."
}

$createdb = Get-Command createdb -ErrorAction SilentlyContinue
$dropdb = Get-Command dropdb -ErrorAction SilentlyContinue
$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $createdb -or -not $dropdb -or -not $pgRestore -or -not $psql) {
  throw "createdb/dropdb/pg_restore/psql PostgreSQL client araçları eksik."
}

if (-not $TestDatabaseName) {
  $TestDatabaseName = "operis_restore_test_" + (Get-Date -Format "yyyyMMddHHmmss")
}
if ($TestDatabaseName -notmatch '^[a-zA-Z0-9_]+$') {
  throw "TestDatabaseName yalnız harf/rakam/alt çizgi içerebilir."
}

$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $connection.Password

  & $createdb.Source `
    --host=$($connection.Host) `
    --port=$($connection.Port) `
    --username=$($connection.User) `
    $TestDatabaseName
  if ($LASTEXITCODE -ne 0) { throw "Test DB oluşturulamadı." }

  try {
    & $pgRestore.Source `
      --host=$($connection.Host) `
      --port=$($connection.Port) `
      --username=$($connection.User) `
      --dbname=$TestDatabaseName `
      --no-owner `
      --no-privileges `
      $BackupFile
    if ($LASTEXITCODE -ne 0) { throw "Test restore başarısız." }

    $tableCount = & $psql.Source `
      --host=$($connection.Host) `
      --port=$($connection.Port) `
      --username=$($connection.User) `
      --dbname=$TestDatabaseName `
      -Atqc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public';"

    if (-not $tableCount -or [int]$tableCount -le 0) {
      throw "Restore edilen test DB'de public tablo bulunamadı."
    }

    & $psql.Source `
      --host=$($connection.Host) `
      --port=$($connection.Port) `
      --username=$($connection.User) `
      --dbname=$TestDatabaseName `
      -v ON_ERROR_STOP=1 `
      -Atqc 'SELECT 1;' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Restore test DB bağlantı doğrulaması başarısız." }

    Write-Host "POSTGRESQL_RESTORE_TEST_PASS" -ForegroundColor Green
    Write-Host "Test DB: $TestDatabaseName"
    Write-Host "Public table count: $tableCount"
  } finally {
    & $dropdb.Source `
      --host=$($connection.Host) `
      --port=$($connection.Port) `
      --username=$($connection.User) `
      --if-exists `
      $TestDatabaseName
  }
} finally {
  if ($null -eq $previousPassword) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:PGPASSWORD = $previousPassword
  }
}
