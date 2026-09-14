param(
  [Parameter(Mandatory=$true)][string]$NetworkEnabled,
  [Parameter(Mandatory=$true)][AllowEmptyString()][string]$NetworkPath,
  [Parameter(Mandatory=$true)][ValidateRange(1,3650)][int]$RetentionDays
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'installer-postgresql.ps1')
$currentUrl = Read-OperisDatabaseUrl (Join-Path $env:ProgramData 'Operis\server\.env')
if ($currentUrl -match '^postgres(ql)?://') {
    & (Join-Path $PSScriptRoot 'postgresql-daily-backup.ps1') -RetentionDays $RetentionDays -NetworkEnabled $NetworkEnabled -NetworkPath $NetworkPath
    return
}

$root = Join-Path $env:ProgramData "Operis"
$server = Join-Path $root "server"
$db = Join-Path $server "prisma\yaklasan-isler.db"
$envFile = Join-Path $server ".env"
$attachments = Join-Path $root "Data\helpdesk-attachments"
$local = Join-Path $root "Backups\Scheduled"
$log = Join-Path $root "Logs\Backup.log"

New-Item -ItemType Directory -Path $local -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
if (-not (Test-Path $db)) { throw "Veritabanı bulunamadı: $db" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$staging = Join-Path $env:TEMP "OperisScheduledBackup-$stamp"
$zip = Join-Path $local "operis-$stamp.zip"

try {
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $staging "database") -Force | Out-Null
  Copy-Item $db (Join-Path $staging "database\yaklasan-isler.db") -Force

  if (Test-Path $envFile) {
    New-Item -ItemType Directory -Path (Join-Path $staging "config") -Force | Out-Null
    Copy-Item $envFile (Join-Path $staging "config\server.env") -Force
  }

  if (Test-Path $attachments) {
    Copy-Item $attachments (Join-Path $staging "helpdesk-attachments") -Recurse -Force
  }

  $dbHash = (Get-FileHash (Join-Path $staging "database\yaklasan-isler.db") -Algorithm SHA256).Hash.ToLowerInvariant()
  $attachmentManifest = @()
  $stagedAttachments = Join-Path $staging "helpdesk-attachments"
  if (Test-Path $stagedAttachments) {
    $attachmentManifest = @(
      Get-ChildItem $stagedAttachments -File -ErrorAction SilentlyContinue |
        Sort-Object Name |
        ForEach-Object {
          [ordered]@{
            name = $_.Name
            size = $_.Length
            sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
          }
        }
    )
  }

  [ordered]@{
    formatVersion = 2
    product = "OPERIS"
    version = "6.3.63"
    createdAt = (Get-Date).ToString("o")
    databaseSha256 = $dbHash
    helpDeskAttachments = $attachmentManifest
  } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $staging "metadata.json") -Encoding UTF8

  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -CompressionLevel Optimal -Force

  $cutoff = (Get-Date).AddDays(-$RetentionDays)
  Get-ChildItem $local -Filter "operis-*.zip" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  if ($NetworkEnabled -eq "True") {
    if ([string]::IsNullOrWhiteSpace($NetworkPath) -or $NetworkPath -notmatch '^\\\\[^\\]+\\[^\\]+') {
      throw "Network yedek yolu geçersiz: $NetworkPath"
    }
    if (-not (Test-Path $NetworkPath)) {
      throw "Network yedek yolu erişilemiyor: $NetworkPath"
    }
    $networkTarget = Join-Path $NetworkPath "OPERIS-Backups"
    New-Item -ItemType Directory -Path $networkTarget -Force | Out-Null
    Copy-Item $zip (Join-Path $networkTarget (Split-Path $zip -Leaf)) -Force

    Get-ChildItem $networkTarget -Filter "operis-*.zip" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }

  Add-Content $log "$(Get-Date -Format o) Scheduled backup completed: $zip | Network=$NetworkEnabled | RetentionDays=$RetentionDays"
}
catch {
  Add-Content $log "$(Get-Date -Format o) Scheduled backup FAILED: $($_.Exception.Message)"
  throw
}
finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
