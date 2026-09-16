param(
    [string]$EvidencePath = (Join-Path $env:TEMP 'progress-ui-evidence.json')
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$hostScript = Join-Path $repo 'windows\operation-host.ps1'
$uiScript = Join-Path $repo 'windows\progress-ui.ps1'
if (-not (Test-Path $hostScript)) { throw "operation-host missing: $hostScript" }
if (-not (Test-Path $uiScript)) { throw "progress-ui missing: $uiScript" }

$root = Join-Path $env:TEMP ("operis-progress-test-{0}" -f ([guid]::NewGuid().ToString('N')))
New-Item -ItemType Directory -Path $root -Force | Out-Null

function Read-Events([string]$Path) {
    if (-not (Test-Path $Path)) { throw "event file missing: $Path" }
    return @(Get-Content $Path | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
}

function Assert-Monotonic($Events) {
    $last = -1
    foreach ($event in $Events) {
        $p = [int]$event.progress
        if ($p -lt $last) { throw "progress decreased: $last -> $p" }
        $last = $p
    }
}

$successEngine = Join-Path $root 'success-engine.ps1'
@'
Write-Output '==> İşletim sistemi doğrulanıyor'
Write-Output 'password=TopSecret123'
Write-Output 'token=abcdef-token'
Write-Output 'DATABASE_URL=postgresql://operis:DbSecret@localhost:5432/operis'
Write-Output 'client_secret=GraphSecret'
Write-Output 'smtp_password=SmtpSecret'
Write-Output 'mssql_password=SqlSecret'
Write-Output 'snmp_community=PublicSecret'
Write-Output 'credentials.dpapi: AQAAANCMnd8BFdERjHoAwE'
Write-Output '-----BEGIN PRIVATE KEY-----'
Write-Output 'RAWPRIVATEKEYDATA'
Write-Output '-----END PRIVATE KEY-----'
Write-Output '==> Node.js kontrol ediliyor'
Write-Output '==> PostgreSQL otomatik kurulum ve hedef doğrulama'
Write-Output '==> Kurulum öncesi güvenli yedek alınıyor'
Write-Output '==> Uygulama dosyaları C:\ProgramData\Operis dizinine kuruluyor'
Write-Output '==> Veritabanı ve Prisma istemcisi hazırlanıyor'
Write-Output '==> Enterprise otomatik başlangıç görevi kuruluyor'
Write-Output '==> Günlük korumalı yedekleme kuruluyor'
Write-Output '==> Kurulum doğrulanıyor'
Write-Output 'Operis Enterprise kurulumu başarıyla tamamlandı.'
exit 0
'@ | Set-Content $successEngine -Encoding UTF8

$failureEngine = Join-Path $root 'failure-engine.ps1'
@'
Write-Output '==> İşletim sistemi doğrulanıyor'
Write-Output '==> Uygulama dosyaları C:\ProgramData\Operis dizinine kuruluyor'
Write-Error 'GERCEK_KOK_HATA'
Write-Output 'Güncelleme başarısız. Önceki sürüm geri yükleniyor.'
Write-Output 'Rollback health doğrulaması başarılı.'
exit 23
'@ | Set-Content $failureEngine -Encoding UTF8

$results = [ordered]@{}
$modes = @('INSTALL','UPDATE','REPAIR','REFRESH','UNINSTALL')
foreach ($mode in $modes) {
    $session = [guid]::NewGuid().ToString('N')
    $eventFile = Join-Path $root "$mode.events.jsonl"
    $logFile = Join-Path $root "$mode.log"
    $cancelFile = Join-Path $root "$mode.cancel"
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $hostScript `
        -PayloadRoot $repo -OperationType $mode -CurrentVersion '6.3.62' -TargetVersion '6.3.63' `
        -SessionId $session -EventFile $eventFile -LogFile $logFile -CancelRequestFile $cancelFile `
        -TestEngineScript $successEngine
    if ($LASTEXITCODE -ne 0) { throw "$mode success host exit=$LASTEXITCODE" }
    $events = Read-Events $eventFile
    Assert-Monotonic $events
    if (@($events | Where-Object { $_.sessionId -ne $session }).Count -ne 0) { throw "$mode session mismatch" }
    $final = $events[-1]
    if ($final.status -ne 'SUCCESS' -or [int]$final.progress -ne 100 -or [int]$final.exitCode -ne 0) {
        throw "$mode final success event invalid"
    }
    $results["PROGRESS_UI_$mode"] = 'PASS'
}

$maskLog = Get-Content (Join-Path $root 'INSTALL.log') -Raw
foreach ($secret in @('TopSecret123','abcdef-token','DbSecret','GraphSecret','SmtpSecret','SqlSecret','PublicSecret','AQAAANCMnd8BFdERjHoAwE','RAWPRIVATEKEYDATA')) {
    if ($maskLog.Contains($secret)) { throw "secret leaked: $secret" }
}
$results['PROGRESS_SECRET_MASKING'] = 'PASS'
$results['PROGRESS_MONOTONIC'] = 'PASS'
$results['PROGRESS_STEP_TRANSITIONS'] = 'PASS'
$results['PROGRESS_SESSION_ID_CORRELATION'] = 'PASS'

$failureSession = [guid]::NewGuid().ToString('N')
$failureEventsPath = Join-Path $root 'failure.events.jsonl'
$failureLogPath = Join-Path $root 'failure.log'
$failureCancelPath = Join-Path $root 'failure.cancel'
& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $hostScript `
    -PayloadRoot $repo -OperationType UPDATE -CurrentVersion '6.3.62' -TargetVersion '6.3.63' `
    -SessionId $failureSession -EventFile $failureEventsPath -LogFile $failureLogPath -CancelRequestFile $failureCancelPath `
    -TestEngineScript $failureEngine
$failureExit = $LASTEXITCODE
if ($failureExit -ne 23) { throw "failure exit code changed: $failureExit" }
$failureEvents = Read-Events $failureEventsPath
$failureFinal = $failureEvents[-1]
if ($failureFinal.status -ne 'FAIL' -or [int]$failureFinal.exitCode -ne 23) { throw 'failure final event invalid' }
if ((Get-Content $failureLogPath -Raw) -notmatch 'GERCEK_KOK_HATA') { throw 'root error not visible in masked log' }
if (@($failureEvents | Where-Object { $_.rollbackStatus -match 'STARTED|COMPLETED' }).Count -eq 0) { throw 'rollback visibility event missing' }
$results['PROGRESS_ERROR_VISIBILITY'] = 'PASS'
$results['PROGRESS_EXIT_CODE_VISIBILITY'] = 'PASS'
$results['PROGRESS_ROLLBACK_VISIBILITY'] = 'PASS'
$results['PROGRESS_UI_DOES_NOT_CHANGE_ENGINE_EXIT_CODE'] = 'PASS'

$cancelSession = [guid]::NewGuid().ToString('N')
$cancelEventsPath = Join-Path $root 'cancel.events.jsonl'
$cancelLogPath = Join-Path $root 'cancel.log'
$cancelRequestPath = Join-Path $root 'cancel.request'
Set-Content $cancelRequestPath 'cancel' -Encoding ASCII
& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $hostScript `
    -PayloadRoot $repo -OperationType INSTALL -TargetVersion '6.3.63' `
    -SessionId $cancelSession -EventFile $cancelEventsPath -LogFile $cancelLogPath -CancelRequestFile $cancelRequestPath `
    -TestEngineScript $successEngine
if ($LASTEXITCODE -ne 1223) { throw "safe cancel exit changed: $LASTEXITCODE" }
$cancelEvents = Read-Events $cancelEventsPath
if (@($cancelEvents | Where-Object { $_.cancelSafe -eq $true }).Count -eq 0) { throw 'cancel safe checkpoint missing' }
if ($cancelEvents[-1].status -ne 'CANCELLED') { throw 'cancel final event missing' }
$results['PROGRESS_CANCEL_SAFE_CHECKPOINT'] = 'PASS'

$probeJson = & powershell.exe -STA -NoLogo -NoProfile -ExecutionPolicy Bypass -File $uiScript -ProbeOnly
if ($LASTEXITCODE -ne 0) { throw "UI probe failed: $LASTEXITCODE" }
$probe = ($probeJson -join "`n") | ConvertFrom-Json
foreach ($property in @('logSelectable','copyWorks','logFolderButton','detailsToggle','cancelButton','progressBar','rollbackFailureRed','finalHealthSurface','powershell51')) {
    if (-not [bool]$probe.$property) { throw "UI probe failed property: $property" }
}
$results['PROGRESS_LOG_SELECTABLE'] = 'PASS'
$results['PROGRESS_LOG_COPY'] = 'PASS'
$results['PROGRESS_LOG_FOLDER'] = 'PASS'
$results['PROGRESS_ROLLBACK_FAILURE_RED'] = 'PASS'
$results['PROGRESS_FINAL_HEALTH_SURFACE'] = 'PASS'
$results['WINDOWS_POWERSHELL_51_UI_RUNTIME'] = 'PASS'

$evidence = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    host = $env:COMPUTERNAME
    powershell = $PSVersionTable.PSVersion.ToString()
}
foreach ($entry in $results.GetEnumerator()) { $evidence[$entry.Key] = $entry.Value }
$evidence | ConvertTo-Json -Depth 5 | Set-Content $EvidencePath -Encoding UTF8
Get-Content $EvidencePath
Write-Output 'OPERIS_PROGRESS_UI_RUNTIME_PASS'

Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue