param(
  [Parameter(Mandatory=$true)][string]$BackupZip
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'sha256-compat.ps1')

if (-not (Test-Path $BackupZip)) {
  throw "Backup ZIP bulunamadı: $BackupZip"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("operis-prepg-verify-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
  Expand-Archive -Path $BackupZip -DestinationPath $tempRoot -Force

  $manifestPath = Join-Path $tempRoot "manifest.json"
  if (-not (Test-Path $manifestPath)) {
    throw "manifest.json bulunamadı."
  }

  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.product -ne "OPERIS" -or $manifest.purpose -ne "PRE_POSTGRESQL_FULL_ROLLBACK_BACKUP") {
    throw "Backup manifest kimliği geçersiz."
  }
  if ($manifest.secretsIncluded -ne $false) {
    throw "Backup paketi secretsIncluded=false sözleşmesini sağlamıyor."
  }

  foreach ($item in @($manifest.files)) {
    $relative = [string]$item.path
    if (-not $relative -or $relative.Contains("..")) {
      throw "Manifest path geçersiz: $relative"
    }

    $full = Join-Path $tempRoot $relative
    if (-not (Test-Path $full -PathType Leaf)) {
      throw "Manifest dosyası ZIP içinde yok: $relative"
    }

    $actualBytes = (Get-Item $full).Length
    if ([int64]$item.bytes -ne $actualBytes) {
      throw "Boyut uyuşmazlığı: $relative"
    }

    $actualHash = (Get-FileHash $full -Algorithm SHA256).Hash
    if ([string]$item.sha256 -ne $actualHash) {
      throw "SHA256 uyuşmazlığı: $relative"
    }
  }

  $db = Join-Path $tempRoot "yaklasan-isler.db"
  $schema = Join-Path $tempRoot "schema.sqlite.prisma"
  if (-not (Test-Path $db)) {
    throw "Rollback SQLite DB pakette yok."
  }
  if (-not (Test-Path $schema)) {
    throw "schema.sqlite.prisma pakette yok."
  }

  if (Test-Path (Join-Path $tempRoot "server.env")) {
    throw "Güvenlik ihlali: ham server.env backup paketinde bulunmamalı."
  }

  Write-Host "PRE_POSTGRESQL_FULL_BACKUP_VERIFY_PASS" -ForegroundColor Green
  Write-Host "ZIP SHA256: $((Get-FileHash $BackupZip -Algorithm SHA256).Hash)"
  Write-Host "Manifest files: $(@($manifest.files).Count)"
} finally {
  Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
