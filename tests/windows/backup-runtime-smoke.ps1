$ErrorActionPreference = "Stop"

$originalProgramData = $env:ProgramData
$testRoot = Join-Path $env:RUNNER_TEMP "OperisBackupSmoke"
$env:ProgramData = $testRoot

try {
    $operisRoot = Join-Path $env:ProgramData "Operis"
    $dbDir = Join-Path $operisRoot "server\prisma"
    $attachmentDir = Join-Path $operisRoot "Data\helpdesk-attachments"
    New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
    New-Item -ItemType Directory -Path $attachmentDir -Force | Out-Null

    [IO.File]::WriteAllBytes((Join-Path $dbDir "yaklasan-isler.db"), [byte[]](1,2,3,4,5,6,7,8))
    Set-Content (Join-Path $attachmentDir "sample.txt") "OPERIS Help Desk attachment smoke" -Encoding UTF8

    & "$PSScriptRoot\..\..\windows\scheduled-backup.ps1" `
        -NetworkEnabled "False" `
        -NetworkPath "\\unused\share" `
        -RetentionDays 30

    $zip = Get-ChildItem (Join-Path $operisRoot "Backups\Scheduled") -Filter "operis-*.zip" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $zip) { throw "Scheduled backup ZIP oluşturulmadı." }

    $expand = Join-Path $env:RUNNER_TEMP "OperisBackupExpanded"
    Remove-Item $expand -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip.FullName $expand -Force

    $db = Join-Path $expand "database\yaklasan-isler.db"
    $attachment = Join-Path $expand "helpdesk-attachments\sample.txt"
    $metadataPath = Join-Path $expand "metadata.json"

    if (-not (Test-Path $db)) { throw "ZIP içinde veritabanı bulunamadı." }
    if (-not (Test-Path $attachment)) { throw "ZIP içinde Help Desk attachment bulunamadı." }
    if (-not (Test-Path $metadataPath)) { throw "ZIP içinde metadata bulunamadı." }

    $metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
    if ($metadata.product -ne "OPERIS") { throw "Metadata product yanlış: $($metadata.product)" }
    if ($metadata.version -ne "6.3.63") { throw "Metadata version yanlış: $($metadata.version)" }
    if ($metadata.formatVersion -ne 2) { throw "Metadata formatVersion yanlış: $($metadata.formatVersion)" }

    $manifestItem = @($metadata.helpDeskAttachments) | Where-Object { $_.name -eq "sample.txt" } | Select-Object -First 1
    if (-not $manifestItem) { throw "Attachment manifest kaydı bulunamadı." }

    $actualHash = (Get-FileHash $attachment -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestItem.sha256 -ne $actualHash) { throw "Attachment hash uyuşmuyor." }
    if ([int64]$manifestItem.size -ne (Get-Item $attachment).Length) { throw "Attachment size uyuşmuyor." }

    Write-Host "OPERIS scheduled-backup runtime smoke PASS"
}
finally {
    $env:ProgramData = $originalProgramData
    Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
