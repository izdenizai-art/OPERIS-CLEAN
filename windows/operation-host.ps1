param(
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [ValidateSet('AUTO','INSTALL','UPDATE','REPAIR','REFRESH','UNINSTALL')][string]$OperationType = 'AUTO',
    [string]$CurrentVersion = '',
    [string]$TargetVersion = '6.3.63',
    [string]$SessionId = '',
    [string]$EventFile = '',
    [string]$LogFile = '',
    [string]$CancelRequestFile = '',
    [string]$TestEngineScript = ''
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

if ([string]::IsNullOrWhiteSpace($SessionId)) { $SessionId = [guid]::NewGuid().ToString('N') }
$installRoot = Join-Path $env:ProgramData 'Operis'
$logsRoot = Join-Path $installRoot 'Logs'
New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
if ([string]::IsNullOrWhiteSpace($EventFile)) { $EventFile = Join-Path $logsRoot ("Operation-{0}.events.jsonl" -f $SessionId) }
if ([string]::IsNullOrWhiteSpace($LogFile)) { $LogFile = Join-Path $logsRoot ("Operation-{0}.log" -f $SessionId) }
if ([string]::IsNullOrWhiteSpace($CancelRequestFile)) { $CancelRequestFile = Join-Path $logsRoot ("Operation-{0}.cancel" -f $SessionId) }

$script:Progress = 0
$script:CurrentStep = 'Başlatılıyor'
$script:LastSuccessfulStep = ''
$script:RollbackStatus = 'NOT_STARTED'
$script:RollbackHealth = 'NOT_RUN'
$script:CancelSafe = $true
$script:ErrorMessage = ''
$script:PrivateKeyBlock = $false

function Mask-SensitiveText([string]$Text) {
    if ($null -eq $Text) { return '' }
    $value = [string]$Text

    if ($script:PrivateKeyBlock) {
        if ($value -match '-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----') { $script:PrivateKeyBlock = $false }
        return '[PRIVATE KEY REDACTED]'
    }
    if ($value -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----') {
        $script:PrivateKeyBlock = $true
        return '[PRIVATE KEY REDACTED]'
    }

    if ($value -match '(?i)credentials\.dpapi') {
        return [regex]::Replace($value, '(?i)(credentials\.dpapi\s*[:=]?\s*).+$', '$1[REDACTED]')
    }

    $value = [regex]::Replace(
        $value,
        '(?i)\b(postgres(?:ql)?://[^\s:@/]+:)([^@\s/]+)(@)',
        '$1***$3'
    )
    $value = [regex]::Replace(
        $value,
        '(?i)\b(DATABASE_URL\s*=\s*["'']?[^\s:@/]+://[^\s:@/]+:)([^@\s/"'']+)(@)',
        '$1***$3'
    )
    $value = [regex]::Replace(
        $value,
        '(?i)\b(password|passwd|pwd|token|access_token|refresh_token|client_secret|clientsecret|smtp_password|smtp_pass|graph_secret|mssql_password|mssql_pass|snmp_community|snmp_secret|community)\b(\s*[:=]\s*)([^\s,;]+)',
        '$1$2[REDACTED]'
    )
    return $value
}

function Write-SessionLog([string]$Text) {
    $masked = Mask-SensitiveText $Text
    $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $SessionId, $masked
    [System.IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine, $utf8NoBom)
    Write-Output $masked
}

function Write-ProgressEvent(
    [string]$Status,
    [string]$Message,
    [Nullable[int]]$ExitCode = $null
) {
    $event = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        sessionId = $SessionId
        operationType = $script:ResolvedOperationType
        currentVersion = $CurrentVersion
        targetVersion = $TargetVersion
        step = $script:CurrentStep
        progress = [int]$script:Progress
        lastSuccessfulStep = $script:LastSuccessfulStep
        status = $Status
        message = (Mask-SensitiveText $Message)
        exitCode = $ExitCode
        rollbackStatus = $script:RollbackStatus
        rollbackHealth = $script:RollbackHealth
        cancelSafe = [bool]$script:CancelSafe
        logPath = $LogFile
    }
    $json = $event | ConvertTo-Json -Compress
    [System.IO.File]::AppendAllText($EventFile, $json + [Environment]::NewLine, $utf8NoBom)
}

function Resolve-DisplayOperation {
    if ($OperationType -ne 'AUTO') { return $OperationType }
    $versionFile = Join-Path $installRoot 'VERSION.txt'
    if (-not (Test-Path $versionFile)) {
        if (Test-Path $installRoot) { return 'REPAIR' }
        return 'INSTALL'
    }
    try {
        $existing = (Get-Content $versionFile -Raw).Trim()
        if ([string]::IsNullOrWhiteSpace($CurrentVersion)) { $script:DetectedCurrentVersion = $existing }
        $installedVersion = [version]$existing
        $target = [version]$TargetVersion
        if ($installedVersion -lt $target) { return 'UPDATE' }
        if ($installedVersion -eq $target) { return 'REPAIR' }
        return 'UPDATE'
    } catch {
        return 'REPAIR'
    }
}

function Update-Step([string]$Step, [int]$Progress, [string]$Line) {
    if ($script:CurrentStep -and $script:CurrentStep -ne 'Başlatılıyor' -and $script:CurrentStep -ne $Step) {
        $script:LastSuccessfulStep = $script:CurrentStep
    }
    $script:CurrentStep = $Step
    if ($Progress -gt [int]$script:Progress) { $script:Progress = $Progress }
    Write-ProgressEvent 'RUNNING' $Line
}

function Set-ProgressFromLine([string]$Line) {
    $stepMap = @(
        @{ Pattern = 'İşletim sistemi doğrulanıyor'; Step = 'Sistem doğrulanıyor'; Progress = 5 },
        @{ Pattern = 'Kurulum modu belirleniyor'; Step = 'Mevcut kurulum algılanıyor'; Progress = 10 },
        @{ Pattern = 'Sunucu yayın IP adresi seçiliyor|NetworkBinding'; Step = 'Network binding doğrulanıyor'; Progress = 15 },
        @{ Pattern = 'Node\.js'; Step = 'Node.js kontrol ediliyor'; Progress = 22 },
        @{ Pattern = 'PostgreSQL otomatik kurulum|PostgreSQL.*hedef doğrulama'; Step = 'PostgreSQL kontrol ediliyor'; Progress = 32 },
        @{ Pattern = 'yedek|Yedek'; Step = 'Yedek alınıyor'; Progress = 40 },
        @{ Pattern = 'Mevcut Operis durduruluyor'; Step = 'Uygulama durduruluyor'; Progress = 48 },
        @{ Pattern = 'Uygulama dosyaları'; Step = 'Dosyalar güncelleniyor'; Progress = 58 },
        @{ Pattern = 'Bağımlılıklar kuruluyor'; Step = 'Bağımlılıklar hazırlanıyor'; Progress = 66 },
        @{ Pattern = 'Prisma'; Step = 'Prisma client hazırlanıyor'; Progress = 74 },
        @{ Pattern = 'Enterprise otomatik başlangıç'; Step = 'Uygulama başlatılıyor'; Progress = 82 },
        @{ Pattern = 'Günlük korumalı yedekleme'; Step = 'Backup görevi doğrulanıyor'; Progress = 88 },
        @{ Pattern = 'Kurulum doğrulanıyor|Sağlık kontrolü'; Step = 'Health kontrolü yapılıyor'; Progress = 94 },
        @{ Pattern = 'başarıyla tamamlandı'; Step = 'İşlem tamamlandı'; Progress = 100 }
    )

    $uninstallMap = @(
        @{ Pattern = 'Kaldırma: sistem doğrulanıyor'; Step = 'Sistem doğrulanıyor'; Progress = 5 },
        @{ Pattern = 'Kaldırma: görevler durduruluyor'; Step = 'Uygulama durduruluyor'; Progress = 20 },
        @{ Pattern = 'Kaldırma: güvenlik duvarı kuralları temizleniyor'; Step = 'Güvenlik duvarı temizleniyor'; Progress = 35 },
        @{ Pattern = 'Kaldırma: kısayollar kaldırılıyor'; Step = 'Kısayollar kaldırılıyor'; Progress = 45 },
        @{ Pattern = 'Kaldırma: veri ve yapılandırma korunuyor'; Step = 'Veri ve yapılandırma korunuyor'; Progress = 60 },
        @{ Pattern = 'Kaldırma: uygulama dosyaları kaldırılıyor'; Step = 'Uygulama dosyaları kaldırılıyor'; Progress = 75 },
        @{ Pattern = 'Kaldırma: PostgreSQL veri sürekliliği doğrulanıyor'; Step = 'PostgreSQL veri sürekliliği doğrulanıyor'; Progress = 90 },
        @{ Pattern = 'Kaldırma: işlem tamamlandı|OPERIS_UNINSTALL_APP_REMOVED_DATABASE_PRESERVED_PASS'; Step = 'İşlem tamamlandı'; Progress = 100 }
    )

    $map = if ($script:ResolvedOperationType -eq 'UNINSTALL') { $uninstallMap } else { $stepMap }
    foreach ($entry in $map) {
        if ($Line -match $entry.Pattern) {
            Update-Step $entry.Step ([int]$entry.Progress) $Line
            break
        }
    }

    if ($Line -match 'Güncelleme başarısız\. Önceki sürüm geri yükleniyor|geri alma.*başlat') {
        $script:RollbackStatus = 'STARTED'
        Write-ProgressEvent 'ROLLBACK' $Line
    }
    if ($Line -match 'Rollback health doğrulaması başarılı|Önceki sürüm geri yüklendi ve health doğrulandı') {
        $script:RollbackStatus = 'COMPLETED'
        $script:RollbackHealth = 'PASS'
        Write-ProgressEvent 'ROLLBACK' $Line
    }
    if ($Line -match 'Otomatik geri alma başarısız|Rollback health doğrulaması başarısız') {
        $script:RollbackStatus = 'FAILED'
        $script:RollbackHealth = 'FAIL'
        Write-ProgressEvent 'ROLLBACK' $Line
    }
    if ($Line -match '(?i)KURULUM BAŞARISIZ|\[ERROR\]|GERCEK_KOK_HATA|Exception|Write-Error') {
        $script:ErrorMessage = (Mask-SensitiveText $Line)
    }
}

$script:DetectedCurrentVersion = ''
$script:ResolvedOperationType = Resolve-DisplayOperation
if ([string]::IsNullOrWhiteSpace($CurrentVersion)) {
    if (-not [string]::IsNullOrWhiteSpace($script:DetectedCurrentVersion)) {
        $CurrentVersion = $script:DetectedCurrentVersion
    } else {
        $versionFile = Join-Path $installRoot 'VERSION.txt'
        if (Test-Path $versionFile) { $CurrentVersion = (Get-Content $versionFile -Raw -ErrorAction SilentlyContinue).Trim() }
    }
}

if ($script:ResolvedOperationType -eq 'UNINSTALL') {
    $script:CancelSafe = $false
    Write-ProgressEvent 'STARTING' 'Kaldırma işlemi hazırlanıyor; veri koruma semantiği nedeniyle cancel devre dışı.'
} else {
    $script:CancelSafe = $true
    Write-ProgressEvent 'STARTING' 'İşlem hazırlanıyor; bu güvenli checkpoint sırasında iptal edilebilir.'
    for ($cancelPoll = 0; $cancelPoll -lt 5; $cancelPoll++) {
        if (Test-Path $CancelRequestFile) {
            Write-SessionLog 'İşlem güvenli başlangıç noktasında kullanıcı tarafından iptal edildi.'
            Write-ProgressEvent 'CANCELLED' 'İşlem başlatılmadan iptal edildi.' 1223
            exit 1223
        }
        Start-Sleep -Milliseconds 200
    }
}

$script:CancelSafe = $false
Write-ProgressEvent 'RUNNING' 'Engine başlatılıyor; güvenli iptal penceresi kapandı.'

$engineScript = ''
$engineArgs = @()
if (-not [string]::IsNullOrWhiteSpace($TestEngineScript)) {
    $engineScript = $TestEngineScript
} elseif ($script:ResolvedOperationType -eq 'UNINSTALL') {
    $engineScript = Join-Path $PayloadRoot 'windows\uninstall-enterprise.ps1'
} else {
    $engineScript = Join-Path $PayloadRoot 'windows\setup-launch.ps1'
    $engineArgs += @('-PayloadRoot', $PayloadRoot)
    if ($script:ResolvedOperationType -in @('REPAIR','REFRESH')) {
        $engineArgs += @('-MaintenanceAction', $script:ResolvedOperationType)
    }
}
if (-not (Test-Path $engineScript)) {
    $script:ErrorMessage = "Engine bulunamadı: $engineScript"
    Write-SessionLog $script:ErrorMessage
    Write-ProgressEvent 'FAIL' $script:ErrorMessage 2
    exit 2
}

$tempRoot = Join-Path $env:TEMP ("Operis-Operation-{0}" -f $SessionId)
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$stdoutFile = Join-Path $tempRoot 'stdout.log'
$stderrFile = Join-Path $tempRoot 'stderr.log'
$exitCode = 1

try {
    $argumentList = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $engineScript))
    foreach ($arg in $engineArgs) { $argumentList += ('"{0}"' -f ([string]$arg).Replace('"','\"')) }

    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
        -ArgumentList $argumentList -WorkingDirectory $PayloadRoot `
        -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile `
        -WindowStyle Hidden -PassThru

    $stdoutIndex = 0
    $stderrIndex = 0
    while (-not $process.HasExited) {
        foreach ($item in @(@{ Path = $stdoutFile; IsError = $false }, @{ Path = $stderrFile; IsError = $true })) {
            if (-not (Test-Path $item.Path)) { continue }
            $lines = @(Get-Content $item.Path -ErrorAction SilentlyContinue)
            $index = if ($item.IsError) { $stderrIndex } else { $stdoutIndex }
            while ($index -lt $lines.Count) {
                $line = [string]$lines[$index]
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $masked = Mask-SensitiveText $line
                    Write-SessionLog $masked
                    Set-ProgressFromLine $masked
                    if ($item.IsError -and [string]::IsNullOrWhiteSpace($script:ErrorMessage)) { $script:ErrorMessage = $masked }
                }
                $index++
            }
            if ($item.IsError) { $stderrIndex = $index } else { $stdoutIndex = $index }
        }
        Start-Sleep -Milliseconds 200
        $process.Refresh()
    }

    # Windows PowerShell 5.1 can expose a stale/default ExitCode on the
    # Start-Process wrapper until the process handle is fully signalled and
    # refreshed. Wait for the handle, refresh it again, then capture the code
    # before any other command can affect process state.
    $process.WaitForExit()
    $process.Refresh()
    $childExitCode = [int]$process.ExitCode

    foreach ($item in @(@{ Path = $stdoutFile; IsError = $false }, @{ Path = $stderrFile; IsError = $true })) {
        if (-not (Test-Path $item.Path)) { continue }
        $lines = @(Get-Content $item.Path -ErrorAction SilentlyContinue)
        $index = if ($item.IsError) { $stderrIndex } else { $stdoutIndex }
        while ($index -lt $lines.Count) {
            $line = [string]$lines[$index]
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                $masked = Mask-SensitiveText $line
                Write-SessionLog $masked
                Set-ProgressFromLine $masked
                if ($item.IsError -and [string]::IsNullOrWhiteSpace($script:ErrorMessage)) { $script:ErrorMessage = $masked }
            }
            $index++
        }
    }

    $exitCode = $childExitCode
    Write-SessionLog ("Child process exit code: {0}" -f $exitCode)
    if ($exitCode -eq 0) {
        $script:LastSuccessfulStep = $script:CurrentStep
        $script:CurrentStep = 'İşlem tamamlandı'
        $script:Progress = 100
        Write-ProgressEvent 'SUCCESS' 'Başarıyla tamamlandı.' 0
    } else {
        if ([string]::IsNullOrWhiteSpace($script:ErrorMessage)) { $script:ErrorMessage = "Engine başarısız. ExitCode=$exitCode" }
        Write-ProgressEvent 'FAIL' $script:ErrorMessage $exitCode
    }
} catch {
    $exitCode = 3
    $script:ErrorMessage = Mask-SensitiveText $_.Exception.Message
    try { Write-SessionLog $script:ErrorMessage } catch {}
    try { Write-ProgressEvent 'FAIL' $script:ErrorMessage $exitCode } catch {}
} finally {
    Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

exit ([int]$exitCode)
