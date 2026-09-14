param(
  [Parameter(Mandatory=$true)][string]$DatabaseUrl,
  [Parameter(Mandatory=$true)][string]$DestinationRoot,
  [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'sha256-compat.ps1')


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

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  throw "pg_dump bulunamadı. PostgreSQL client tools kurulmalıdır."
}

New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $DestinationRoot "operis-postgresql-$stamp.dump"
$manifest = "$backup.manifest.json"

$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $connection.Password
  & $pgDump.Source `
    --host=$($connection.Host) `
    --port=$($connection.Port) `
    --username=$($connection.User) `
    --dbname=$($connection.Database) `
    --format=custom `
    --no-owner `
    --no-privileges `
    --file=$backup
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump başarısız oldu. ExitCode=$LASTEXITCODE"
  }
} finally {
  if ($null -eq $previousPassword) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:PGPASSWORD = $previousPassword
  }
}

$hash = (Get-FileHash $backup -Algorithm SHA256).Hash
$pgDumpVersion = (& $pgDump.Source --version | Out-String).Trim()
$manifestObject = [PSCustomObject]@{
  product = "OPERIS"
  purpose = "POSTGRESQL_BACKUP"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  database = $connection.Database
  host = $connection.Host
  port = $connection.Port
  bytes = (Get-Item $backup).Length
  sha256 = $hash
  pgDumpVersion = $pgDumpVersion
}
$manifestObject | ConvertTo-Json -Depth 5 | Set-Content -Path $manifest -Encoding UTF8

$cutoff = (Get-Date).AddDays(-[Math]::Max(1, $RetentionDays))
Get-ChildItem $DestinationRoot -Filter "operis-postgresql-*.dump" -File |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Remove-Item $_.FullName -Force
    Remove-Item "$($_.FullName).manifest.json" -Force -ErrorAction SilentlyContinue
  }

Write-Host "PostgreSQL backup PASS: $backup"
Write-Host "SHA256: $hash"
