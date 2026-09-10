[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProductName = "Operis Enterprise"
$Version = "6.3.63"
$Port = 3001
$TaskName = "OperisEnterpriseServer"
$BackupTaskName = "OperisEnterpriseDailyBackup"
$InstallRoot = Join-Path $env:ProgramData "Operis"
$LogsRoot = Join-Path $InstallRoot "Logs"
$BackupsRoot = Join-Path $InstallRoot "Backups"
$DataRoot = Join-Path $InstallRoot "Data"
$SourceRoot = Split-Path -Parent $PSScriptRoot
$InstallLog = Join-Path $LogsRoot "Install.log"
$TranscriptLog = Join-Path $LogsRoot "Install-Transcript.log"
$script:RollbackRoot = $null
$script:InstallMode = "NEW"
$script:PreviousVersion = ""
$script:UpgradeSucceeded = $false
$script:SelectedIPv4 = $null
$script:SelectedInterfaceAlias = ""
$script:PreservedSettingsRoot = $null
$script:PreservedSettingsDb = $null
$script:PreservedSettingsEnv = $null
$ExternalImportRoot = Join-Path $SourceRoot "IMPORT_CONFIG"

$ServerConfigFile = Join-Path $SourceRoot "OPERIS_SERVER_CONFIG.ini"


function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Directories {
    foreach ($path in @($InstallRoot, $LogsRoot, $BackupsRoot, $DataRoot)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

function Write-Log([string]$Message, [string]$Level = "INFO") {
    Ensure-Directories
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Level, $Message

    $written = $false
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            [System.IO.File]::AppendAllText(
                $InstallLog,
                $line + [Environment]::NewLine,
                [System.Text.UTF8Encoding]::new($false)
            )
            $written = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds (150 * $attempt)
        }
    }

    if (-not $written) {
        Write-Host "Log dosyasına yazılamadı: $line" -ForegroundColor Yellow
    }

    $color = if ($Level -eq "ERROR") { "Red" } elseif ($Level -eq "WARN") { "Yellow" } else { "Cyan" }
    Write-Host $line -ForegroundColor $color
}

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Log "==> $Message"
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Get-OperatingSystemInfo {
    $os = Get-CimInstance Win32_OperatingSystem
    $caption = [string]$os.Caption
    $version = [version]$os.Version
    $supported = (
        $caption -match "Windows 11" -or
        $caption -match "Windows Server 2019" -or
        $caption -match "Windows Server 2022" -or
        $caption -match "Windows Server 2025"
    )
    return [pscustomobject]@{
        Caption = $caption
        Version = $version
        Build = $os.BuildNumber
        Architecture = $os.OSArchitecture
        Supported = $supported
    }
}

function Get-InstallMode {
    $versionFile = Join-Path $InstallRoot "VERSION.txt"
    $database = Join-Path $InstallRoot "server\prisma\yaklasan-isler.db"
    $legacyDatabase = Join-Path $env:ProgramData "YaklasanIsler\server\prisma\yaklasan-isler.db"

    if (Test-Path $versionFile) {
        $script:PreviousVersion = (Get-Content $versionFile -Raw -ErrorAction SilentlyContinue).Trim()
        return "UPDATE"
    }
    if ((Test-Path $database) -or (Test-Path $legacyDatabase) -or (Test-Path $InstallRoot)) {
        return "REPAIR"
    }
    return "NEW"
}

function Create-RollbackSnapshot {
    if ($script:InstallMode -eq "NEW" -or -not (Test-Path $InstallRoot)) { return }

    $versionFile = Join-Path $InstallRoot "VERSION.txt"
    $serverFile = Join-Path $InstallRoot "server\dist\index.js"

    if (-not (Test-Path $versionFile) -or -not (Test-Path $serverFile)) {
        Write-Log "Kurulum eksik veya onarım durumunda. Uygulama dosyası geri alma kopyası atlandı; veritabanı ayrıca korunacak." "WARN"
        $script:RollbackRoot = $null
        return
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $script:RollbackRoot = Join-Path $env:TEMP "Operis-Rollback-$stamp"
    New-Item -ItemType Directory -Path $script:RollbackRoot -Force | Out-Null

    Write-Log "Çalışan sürüm geri alma için kopyalanıyor: $script:RollbackRoot"
    & robocopy.exe $InstallRoot $script:RollbackRoot /E /COPY:DAT /DCOPY:T /R:2 /W:1 `
        /XD (Join-Path $InstallRoot "Backups") (Join-Path $InstallRoot "Logs") | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Geri alma kopyası oluşturulamadı. Robocopy kodu: $LASTEXITCODE"
    }

    [ordered]@{
        createdAt = (Get-Date).ToString("o")
        mode = $script:InstallMode
        previousVersion = $script:PreviousVersion
        targetVersion = $Version
        source = $InstallRoot
    } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $script:RollbackRoot "rollback-manifest.json") -Encoding UTF8
}

function Restore-RollbackSnapshot {
    if (-not $script:RollbackRoot -or -not (Test-Path $script:RollbackRoot)) { return $false }

    try {
        Write-Log "Güncelleme başarısız. Önceki sürüm geri yükleniyor." "WARN"
        Stop-OperisRuntime
        Start-Sleep -Seconds 2

        if (Test-Path $InstallRoot) {
            Get-ChildItem $InstallRoot -Force |
                Where-Object { $_.Name -notin @("Backups", "Logs") } |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
        }

        & robocopy.exe $script:RollbackRoot $InstallRoot /E /COPY:DAT /DCOPY:T /R:2 /W:1 /XF rollback-manifest.json | Out-Null
        if ($LASTEXITCODE -ge 8) {
            throw "Geri yükleme kopyası başarısız. Robocopy kodu: $LASTEXITCODE"
        }

        $oldNodePath = Join-Path $InstallRoot "node-path.txt"
        if (Test-Path $oldNodePath) {
            $candidate = (Get-Content $oldNodePath -Raw).Trim()
            if (Test-Path $candidate) { $script:NodePath = $candidate }
        }

        Install-Runner
        Start-ScheduledTask -TaskName $TaskName
        Write-Log "Önceki sürüm geri yüklendi." "WARN"
        return $true
    }
    catch {
        Write-Log "Otomatik geri alma başarısız: $($_.Exception.Message)" "ERROR"
        return $false
    }
}

function Save-VersionHistory([string]$Status, [string]$Message = "") {
    Ensure-Directories
    $historyFile = Join-Path $DataRoot "VersionHistory.json"
    $history = @()
    if (Test-Path $historyFile) {
        try {
            $loaded = Get-Content $historyFile -Raw | ConvertFrom-Json
            if ($loaded) { $history = @($loaded) }
        } catch {
            Write-Log "Sürüm geçmişi okunamadı; yeni dosya oluşturulacak." "WARN"
        }
    }

    $history += [pscustomobject]@{
        installedAt = (Get-Date).ToString("o")
        computer = $env:COMPUTERNAME
        user = "$env:USERDOMAIN\$env:USERNAME"
        mode = $script:InstallMode
        previousVersion = $script:PreviousVersion
        newVersion = $Version
        status = $Status
        backupRoot = $BackupsRoot
        message = $Message
    }
    $history | ConvertTo-Json -Depth 5 | Set-Content $historyFile -Encoding UTF8
}

function Find-Node {
    Refresh-Path
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Join-Path $env:ProgramFiles "nodejs\node.exe"
    if (Test-Path $candidate) { return $candidate }
    return $null
}

function Install-NodeFromOfficialMsi {
    $downloadRoot = Join-Path $env:TEMP "Operis-NodeBootstrap"
    New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null

    $releaseBase = "https://nodejs.org/download/release/latest-v24.x"
    $checksumsUrl = "$releaseBase/SHASUMS256.txt"
    $checksumsFile = Join-Path $downloadRoot "SHASUMS256.txt"

    Write-Host ""
    Write-Host "Node.js LTS bu bilgisayarda bulunamadı." -ForegroundColor Yellow
    Write-Host "Operis kurulumu resmi Node.js paketini indirip kuracak." -ForegroundColor Yellow
    Write-Host "İndirme kaynağı: $releaseBase" -ForegroundColor DarkGray
    Write-Host ""

    Write-Log "Winget kullanılamıyor veya Node.js kurulamadı. Resmi Node.js MSI bootstrap yöntemi başlatılıyor." "WARN"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsFile -UseBasicParsing -TimeoutSec 120

        $checksumLines = Get-Content $checksumsFile
        $msiLine = $checksumLines |
            Where-Object { $_ -match "node-v24\.[0-9]+\.[0-9]+-x64\.msi$" } |
            Select-Object -First 1

        if (-not $msiLine) {
            throw "Resmi SHA256 listesinde Windows x64 Node.js v24 LTS MSI paketi bulunamadı."
        }

        $parts = $msiLine -split "\s+", 2
        $expectedHash = $parts[0].Trim().ToUpperInvariant()
        $msiName = $parts[1].Trim()
        $msiUrl = "$releaseBase/$msiName"
        $msiFile = Join-Path $downloadRoot $msiName

        Write-Step "Node.js LTS ek paketi indiriliyor"
        Write-Log "Node.js MSI: $msiUrl"
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiFile -UseBasicParsing -TimeoutSec 600

        if (-not (Test-Path $msiFile)) {
            throw "Node.js MSI paketi indirilemedi."
        }

        Write-Step "Node.js paketi doğrulanıyor"
        $actualHash = (Get-FileHash $msiFile -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) {
            Remove-Item $msiFile -Force -ErrorAction SilentlyContinue
            throw "Node.js MSI SHA256 doğrulaması başarısız. Beklenen: $expectedHash, Gelen: $actualHash"
        }

        Write-Log "Node.js MSI SHA256 doğrulaması başarılı: $actualHash"

        Write-Step "Node.js LTS kuruluyor"
        $msiProcess = Start-Process `
            -FilePath "msiexec.exe" `
            -ArgumentList @("/i", "`"$msiFile`"", "/qn", "/norestart", "ADDLOCAL=ALL") `
            -Wait `
            -PassThru

        if ($msiProcess.ExitCode -notin @(0, 3010, 1641)) {
            throw "Node.js MSI kurulumu başarısız. Windows Installer çıkış kodu: $($msiProcess.ExitCode)"
        }

        if ($msiProcess.ExitCode -in @(3010, 1641)) {
            Write-Log "Node.js kurulumu tamamlandı; Windows Installer yeniden başlatma önerdi." "WARN"
        }

        Refresh-Path
        Start-Sleep -Seconds 3

        $node = Find-Node
        if (-not $node) {
            throw "Node.js kuruldu ancak node.exe bulunamadı. Windows'u yeniden başlatıp Operis kurulumunu tekrar çalıştırın."
        }

        $major = [int]((& $node --version).TrimStart("v").Split(".")[0])
        if ($major -lt 20 -or $major -gt 24) {
            throw "Kurulan Node.js sürümü desteklenmiyor: $(& $node --version)"
        }

        Write-Log "Node.js ek paket kurulumu başarılı: $(& $node --version)"
        return $node
    }
    catch {
        Write-Log "Node.js ek paket kurulumu başarısız: $($_.Exception.Message)" "ERROR"
        Write-Host ""
        Write-Host "Node.js otomatik indirilemedi veya kurulamadı." -ForegroundColor Red
        Write-Host "Manuel indirme adresi:" -ForegroundColor Yellow
        Write-Host "https://nodejs.org/download/release/latest-v24.x/" -ForegroundColor Cyan
        Write-Host ""
        throw
    }
}

function Ensure-Node {
    $node = Find-Node
    if ($node) {
        $major = [int]((& $node --version).TrimStart("v").Split(".")[0])
        if ($major -ge 20 -and $major -le 24) { return $node }
        Write-Log "Node.js sürümü desteklenen aralıkta değil: $(& $node --version)" "WARN"
    }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Step "Node.js LTS Winget üzerinden kuruluyor"
        & winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
        $wingetExit = $LASTEXITCODE

        Refresh-Path
        Start-Sleep -Seconds 2
        $node = Find-Node

        if ($wingetExit -eq 0 -and $node) {
            $major = [int]((& $node --version).TrimStart("v").Split(".")[0])
            if ($major -ge 20 -and $major -le 24) {
                Write-Log "Node.js Winget kurulumu başarılı: $(& $node --version)"
                return $node
            }
        }

        Write-Log "Winget Node.js kurulumu tamamlanamadı. Çıkış kodu: $wingetExit" "WARN"
    }
    else {
        Write-Log "Winget bulunamadı. Windows Server için resmi MSI ek paket yöntemi kullanılacak." "WARN"
    }

    return Install-NodeFromOfficialMsi
}

function Invoke-Npm([string]$WorkingDirectory, [string[]]$Arguments) {
    $npm = Join-Path (Split-Path $script:NodePath) "npm.cmd"
    if (-not (Test-Path $npm)) { throw "npm.cmd bulunamadı: $npm" }

    $env:npm_config_registry = "https://registry.npmjs.org/"
    $stdoutFile = Join-Path $env:TEMP ("operis-npm-out-{0}.log" -f ([guid]::NewGuid().ToString("N")))
    $stderrFile = Join-Path $env:TEMP ("operis-npm-err-{0}.log" -f ([guid]::NewGuid().ToString("N")))

    try {
        Write-Log "npm $($Arguments -join ' ') [$WorkingDirectory]"

        $quotedArguments = @()
        foreach ($argument in $Arguments) {
            if ($argument -match '[\s"]') {
                $quotedArguments += ('"' + ($argument -replace '"', '\"') + '"')
            } else {
                $quotedArguments += $argument
            }
        }

        $process = Start-Process `
            -FilePath $npm `
            -ArgumentList $quotedArguments `
            -WorkingDirectory $WorkingDirectory `
            -RedirectStandardOutput $stdoutFile `
            -RedirectStandardError $stderrFile `
            -NoNewWindow `
            -Wait `
            -PassThru

        foreach ($file in @($stdoutFile, $stderrFile)) {
            if (Test-Path $file) {
                Get-Content $file -ErrorAction SilentlyContinue | ForEach-Object {
                    $line = [string]$_
                    if (-not [string]::IsNullOrWhiteSpace($line)) {
                        Write-Host $line
                        try {
                            [System.IO.File]::AppendAllText(
                                $InstallLog,
                                $line + [Environment]::NewLine,
                                [System.Text.UTF8Encoding]::new($false)
                            )
                        } catch {}
                    }
                }
            }
        }

        if ($process.ExitCode -ne 0) {
            throw "npm komutu başarısız. Çıkış kodu: $($process.ExitCode). Komut: npm $($Arguments -join ' ')"
        }
    }
    finally {
        Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
}

function Stop-OperisRuntime {
    foreach ($name in @($TaskName, "YaklasanIslerServer")) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
        }
    }
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.OwningProcess -and $_.OwningProcess -ne $PID) {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

function Backup-ExistingInstallation {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFolder = Join-Path $BackupsRoot "PreInstall-$stamp"
    New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null

    $candidates = @(
        (Join-Path $InstallRoot "server\prisma\yaklasan-isler.db"),
        (Join-Path $env:ProgramData "YaklasanIsler\server\prisma\yaklasan-isler.db")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            Copy-Item $candidate (Join-Path $backupFolder "yaklasan-isler.db") -Force
            break
        }
    }

    $envCandidates = @(
        (Join-Path $InstallRoot "server\.env"),
        (Join-Path $env:ProgramData "YaklasanIsler\server\.env")
    )
    foreach ($candidate in $envCandidates) {
        if (Test-Path $candidate) {
            Copy-Item $candidate (Join-Path $backupFolder "server.env") -Force
            break
        }
    }

    if (Test-Path (Join-Path $backupFolder "yaklasan-isler.db")) {
        $hash = (Get-FileHash (Join-Path $backupFolder "yaklasan-isler.db") -Algorithm SHA256).Hash
        Set-Content (Join-Path $backupFolder "SHA256.txt") $hash -Encoding ASCII
        Write-Log "Mevcut veritabanı yedeklendi: $backupFolder"
    }
    return $backupFolder
}

function Copy-ApplicationFiles([string]$BackupFolder) {
    $preserve = @("Backups", "Logs", "Data")
    Get-ChildItem $InstallRoot -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin $preserve } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    Get-ChildItem $SourceRoot -Force |
        Where-Object { $_.Name -notin @("node_modules", ".git", "dist", "server\dist", "server\public") } |
        ForEach-Object { Copy-Item $_.FullName -Destination $InstallRoot -Recurse -Force }

    $databaseBackup = Join-Path $BackupFolder "yaklasan-isler.db"
    if (Test-Path $databaseBackup) {
        $target = Join-Path $InstallRoot "server\prisma\yaklasan-isler.db"
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item $databaseBackup $target -Force
    }

    $envBackup = Join-Path $BackupFolder "server.env"
    if (Test-Path $envBackup) {
        Copy-Item $envBackup (Join-Path $InstallRoot "server\.env") -Force
    }
}



function Capture-PreservedSettings {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $safeRoot = Join-Path $env:ProgramData "Operis-Installer-State"
    $snapshot = Join-Path $safeRoot "Settings-$stamp"
    New-Item -ItemType Directory -Path $snapshot -Force | Out-Null

    $dbCandidates = @(
        (Join-Path $ExternalImportRoot "yaklasan-isler.db"),
        (Join-Path $ExternalImportRoot "server\prisma\yaklasan-isler.db"),
        (Join-Path $InstallRoot "server\prisma\yaklasan-isler.db"),
        (Join-Path $env:ProgramData "YaklasanIsler\server\prisma\yaklasan-isler.db")
    )
    $envCandidates = @(
        (Join-Path $ExternalImportRoot "server.env"),
        (Join-Path $ExternalImportRoot "server\.env"),
        (Join-Path $InstallRoot "server\.env"),
        (Join-Path $env:ProgramData "YaklasanIsler\server\.env")
    )

    foreach ($candidate in $dbCandidates) {
        if (Test-Path $candidate) {
            $target = Join-Path $snapshot "yaklasan-isler.db"
            Copy-Item $candidate $target -Force
            $script:PreservedSettingsDb = $target
            Write-Log "Mevcut bağlantı/ayar veritabanı korumaya alındı: $candidate"
            break
        }
    }

    foreach ($candidate in $envCandidates) {
        if (Test-Path $candidate) {
            $target = Join-Path $snapshot "server.env"
            Copy-Item $candidate $target -Force
            $script:PreservedSettingsEnv = $target
            Write-Log "Mevcut şifreleme anahtarı için .env korumaya alındı: $candidate"
            break
        }
    }

    if ($script:PreservedSettingsDb -or $script:PreservedSettingsEnv) {
        $script:PreservedSettingsRoot = $snapshot
    } else {
        Remove-Item $snapshot -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "Aktarılacak eski mail/veritabanı bağlantı ayarı bulunamadı." "WARN"
    }
}

function Restore-PreservedEncryptionKey {
    if (-not $script:PreservedSettingsEnv -or -not (Test-Path $script:PreservedSettingsEnv)) { return }
    $sourceText = Get-Content $script:PreservedSettingsEnv -Raw
    $match = [regex]::Match($sourceText, '(?m)^DATA_ENCRYPTION_KEY=(.+)$')
    if (-not $match.Success) {
        Write-Log "Eski .env içinde DATA_ENCRYPTION_KEY bulunamadı; şifreli bağlantı parolaları aktarılamayabilir." "WARN"
        return
    }

    $sourceKey = $match.Groups[1].Value.Trim()
    $targetEnv = Join-Path $InstallRoot "server\.env"
    if (-not (Test-Path $targetEnv)) { return }

    $text = Get-Content $targetEnv -Raw
    if ($text -match '(?m)^DATA_ENCRYPTION_KEY=') {
        $text = [regex]::Replace($text, '(?m)^DATA_ENCRYPTION_KEY=.*$', "DATA_ENCRYPTION_KEY=$sourceKey")
    } else {
        $text += "`r`nDATA_ENCRYPTION_KEY=$sourceKey"
    }
    [System.IO.File]::WriteAllText(
        $targetEnv,
        $text.Trim() + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Log "Eski DATA_ENCRYPTION_KEY korundu; SMTP/Graph/MSSQL şifreli parolaları çözülebilir kalacak."
}

function Clear-OneTimeImportConfig {
    $installedImport = Join-Path $InstallRoot "IMPORT_CONFIG"

    if (Test-Path $installedImport) {
        Remove-Item $installedImport -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $ExternalImportRoot) {
        Remove-Item $ExternalImportRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($script:PreservedSettingsRoot -and (Test-Path $script:PreservedSettingsRoot)) {
        Remove-Item $script:PreservedSettingsRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Log "Tek seferlik mail/MSSQL aktarım dosyaları başarılı kurulum sonrası temizlendi."
}

function Import-PreservedSettings {
    if (-not $script:PreservedSettingsDb -or -not (Test-Path $script:PreservedSettingsDb)) {
        Write-Log "Aktarılacak eski bağlantı ayarı veritabanı yok; temiz varsayılan ayarlarla devam ediliyor."
        return
    }

    $targetDb = Join-Path $InstallRoot "server\prisma\yaklasan-isler.db"
    $importScript = Join-Path $InstallRoot "server\scripts\import-preserved-settings.mjs"
    if (-not (Test-Path $targetDb)) { throw "Ayar aktarımı için hedef veritabanı bulunamadı: $targetDb" }
    if (-not (Test-Path $importScript)) { throw "Ayar aktarım scripti bulunamadı: $importScript" }

    Restore-PreservedEncryptionKey

    $oldSource = $env:OPERIS_SETTINGS_SOURCE_DB
    $oldTarget = $env:OPERIS_SETTINGS_TARGET_DB
    try {
        $env:OPERIS_SETTINGS_SOURCE_DB = $script:PreservedSettingsDb
        $env:OPERIS_SETTINGS_TARGET_DB = $targetDb
        Write-Log "Mevcut mail ve harici veritabanı bağlantıları yeni temiz kuruluma aktarılıyor."
        & $script:NodePath $importScript
        if ($LASTEXITCODE -ne 0) {
            throw "Bağlantı/ayar aktarımı başarısız. Node çıkış kodu: $LASTEXITCODE"
        }
    }
    finally {
        $env:OPERIS_SETTINGS_SOURCE_DB = $oldSource
        $env:OPERIS_SETTINGS_TARGET_DB = $oldTarget
    }
}

function Read-OperisServerConfig {
    $result = @{}
    if (-not (Test-Path $ServerConfigFile)) { return $result }

    foreach ($line in Get-Content $ServerConfigFile -ErrorAction SilentlyContinue) {
        $trimmed = ([string]$line).Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#") -or $trimmed.StartsWith(";")) { continue }
        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) { continue }
        $result[$parts[0].Trim().ToUpperInvariant()] = $parts[1].Trim()
    }
    return $result
}

function Get-OperisIPv4Candidates {
    $upAdapters = @{}
    Get-NetAdapter -ErrorAction SilentlyContinue |
        Where-Object { $_.Status -eq "Up" } |
        ForEach-Object { $upAdapters[[int]$_.ifIndex] = $_.Name }

    $rows = @(
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*" -and
                $_.IPAddress -ne "0.0.0.0" -and
                $upAdapters.ContainsKey([int]$_.InterfaceIndex)
            } |
            Sort-Object InterfaceMetric, InterfaceIndex, IPAddress |
            ForEach-Object {
                [pscustomobject]@{
                    IPAddress = [string]$_.IPAddress
                    PrefixLength = [int]$_.PrefixLength
                    InterfaceIndex = [int]$_.InterfaceIndex
                    InterfaceAlias = [string]$upAdapters[[int]$_.InterfaceIndex]
                    InterfaceMetric = [int]$_.InterfaceMetric
                }
            }
    )
    return $rows
}

function Select-OperisServerIPv4 {
    $candidates = @(Get-OperisIPv4Candidates)
    if ($candidates.Count -eq 0) {
        throw "Sunucuda yayına uygun aktif IPv4 adresi bulunamadı. Ağ bağdaştırıcısı ve statik IP yapılandırmasını kontrol edin."
    }

    $config = Read-OperisServerConfig
    $configuredIp = ""
    if ($config.ContainsKey("BIND_IP")) {
        $configuredIp = [string]$config["BIND_IP"]
    }

    if (-not [string]::IsNullOrWhiteSpace($configuredIp) -and
        $configuredIp.ToUpperInvariant() -notin @("ASK", "AUTO")) {
        $match = $candidates | Where-Object { $_.IPAddress -eq $configuredIp } | Select-Object -First 1
        if ($match) {
            $script:SelectedIPv4 = $match.IPAddress
            $script:SelectedInterfaceAlias = $match.InterfaceAlias
            Write-Log "Yayın IP adresi OPERIS_SERVER_CONFIG.ini dosyasından seçildi: $($script:SelectedIPv4) [$($script:SelectedInterfaceAlias)]"
            return
        }
        Write-Log "Config içindeki BIND_IP bu sunucudaki aktif IPv4 adreslerinden biri değil: $configuredIp" "WARN"
    }

    if ($candidates.Count -eq 1) {
        $script:SelectedIPv4 = $candidates[0].IPAddress
        $script:SelectedInterfaceAlias = $candidates[0].InterfaceAlias
        Write-Log "Tek aktif IPv4 bulundu; yayın adresi otomatik seçildi: $($script:SelectedIPv4) [$($script:SelectedInterfaceAlias)]"
        return
    }

    Write-Host ""
    Write-Host "Bu sunucuda birden fazla aktif IPv4 adresi bulundu." -ForegroundColor Yellow
    Write-Host "OPERİS yalnız seçeceğiniz IP adresinden TCP $Port portunda yayın yapacaktır." -ForegroundColor Yellow
    Write-Host ""
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        $row = $candidates[$i]
        Write-Host ("  [{0}] {1}/{2}  -  {3}" -f ($i + 1), $row.IPAddress, $row.PrefixLength, $row.InterfaceAlias) -ForegroundColor Cyan
    }

    while ($true) {
        $answer = Read-Host "Yayın yapılacak IP numarasını seçin (1-$($candidates.Count))"
        $number = 0
        if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $candidates.Count) {
            $selected = $candidates[$number - 1]
            $script:SelectedIPv4 = $selected.IPAddress
            $script:SelectedInterfaceAlias = $selected.InterfaceAlias
            Write-Log "Yayın IP adresi kullanıcı tarafından seçildi: $($script:SelectedIPv4) [$($script:SelectedInterfaceAlias)]"
            return
        }
        Write-Host "Geçersiz seçim. 1 ile $($candidates.Count) arasında bir sayı girin." -ForegroundColor Red
    }
}

function Save-OperisNetworkBinding {
    if ([string]::IsNullOrWhiteSpace($script:SelectedIPv4)) { throw "Yayın IP adresi seçilmedi." }
    $bindingFile = Join-Path $DataRoot "NetworkBinding.json"
    [ordered]@{
        selectedAt = (Get-Date).ToString("o")
        ipAddress = $script:SelectedIPv4
        interfaceAlias = $script:SelectedInterfaceAlias
        port = $Port
        publicUrl = "http://$($script:SelectedIPv4):$Port"
    } | ConvertTo-Json -Depth 4 | Set-Content $bindingFile -Encoding UTF8
    Write-Log "Ağ yayın yapılandırması kaydedildi: $bindingFile"
}

function Ensure-EnvironmentFile {
    if ([string]::IsNullOrWhiteSpace($script:SelectedIPv4)) {
        throw "Yayın IP adresi seçilmeden ortam dosyası hazırlanamaz."
    }

    $networkPublicUrl = "http://$($script:SelectedIPv4):$Port"
    $allowedOrigins = "http://$($script:SelectedIPv4):$Port"
    $targetEnv = Join-Path $InstallRoot "server\.env"

    if (Test-Path $targetEnv) {
        $text = Get-Content $targetEnv -Raw

        $pairs = [ordered]@{
            PORT = "$Port"
            BIND_HOST = "$($script:SelectedIPv4)"
            NODE_ENV = "production"
            COOKIE_SECURE = "false"
            PUBLIC_URL = "$networkPublicUrl"
            CLIENT_ORIGIN = "$allowedOrigins"
        }

        foreach ($entry in $pairs.GetEnumerator()) {
            $key = $entry.Key
            $value = $entry.Value
            if ($text -match "(?m)^$([regex]::Escape($key))=") {
                $text = [regex]::Replace($text, "(?m)^$([regex]::Escape($key))=.*$", "$key=$value")
            } else {
                $text += "`r`n$key=$value"
            }
        }

        [System.IO.File]::WriteAllText(
            $targetEnv,
            $text.Trim() + [Environment]::NewLine,
            [System.Text.UTF8Encoding]::new($false)
        )
        Save-OperisNetworkBinding
        return
    }

    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $jwtBytes = New-Object byte[] 48
        $rng.GetBytes($jwtBytes)
        $encBytes = New-Object byte[] 32
        $rng.GetBytes($encBytes)
        $jwt = [Convert]::ToBase64String($jwtBytes)
        $enc = [Convert]::ToBase64String($encBytes)
    } finally {
        $rng.Dispose()
    }

    $envContent = @"
DATABASE_URL="file:./yaklasan-isler.db"
JWT_SECRET="$jwt"
DATA_ENCRYPTION_KEY="$enc"
CLIENT_ORIGIN="$allowedOrigins"
PORT=$Port
BIND_HOST="$($script:SelectedIPv4)"
NODE_ENV=production
COOKIE_SECURE=false
PUBLIC_URL="$networkPublicUrl"
"@
    [System.IO.File]::WriteAllText(
        $targetEnv,
        $envContent.Trim() + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
    Save-OperisNetworkBinding
}
function Install-Runner {
    New-Item -ItemType Directory -Path (Join-Path $InstallRoot "windows") -Force | Out-Null
    $runner = @'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Continue"
$InstallRoot = Join-Path $env:ProgramData "Operis"
$LogsRoot = Join-Path $InstallRoot "Logs"
$NodePathFile = Join-Path $InstallRoot "node-path.txt"
$ServerFile = Join-Path $InstallRoot "server\dist\index.js"
$LogFile = Join-Path $LogsRoot "Server.log"
New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
if (-not (Test-Path $NodePathFile)) { Add-Content $LogFile "$(Get-Date -Format o) Node path file missing"; exit 2 }
$NodePath = (Get-Content $NodePathFile -Raw).Trim()
if (-not (Test-Path $NodePath)) { Add-Content $LogFile "$(Get-Date -Format o) node.exe missing: $NodePath"; exit 3 }
if (-not (Test-Path $ServerFile)) { Add-Content $LogFile "$(Get-Date -Format o) server file missing: $ServerFile"; exit 4 }
Set-Location $InstallRoot
Add-Content $LogFile "$(Get-Date -Format o) Operis server starting"
& $NodePath $ServerFile *>> $LogFile
$exitCode = $LASTEXITCODE
Add-Content $LogFile "$(Get-Date -Format o) Operis server exited: $exitCode"
exit $exitCode
'@
    Set-Content (Join-Path $InstallRoot "windows\server-runner.ps1") $runner -Encoding UTF8
    Set-Content (Join-Path $InstallRoot "node-path.txt") $script:NodePath -Encoding ASCII

    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallRoot\windows\server-runner.ps1`"" `
        -WorkingDirectory $InstallRoot

    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "$ProductName $Version sunucu çalışma görevi" -Force | Out-Null
}

function Install-DailyBackup {
    $script = @'
$ErrorActionPreference = "Stop"
$Root = Join-Path $env:ProgramData "Operis"
$Source = Join-Path $Root "server\prisma\yaklasan-isler.db"
$DestinationRoot = Join-Path $Root "Backups"
$Log = Join-Path $Root "Logs\Backup.log"
New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
if (-not (Test-Path $Source)) { Add-Content $Log "$(Get-Date -Format o) Database not found"; exit 0 }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$folder = Join-Path $DestinationRoot "Daily-$stamp"
New-Item -ItemType Directory -Path $folder -Force | Out-Null
Copy-Item $Source (Join-Path $folder "yaklasan-isler.db") -Force
$envFile = Join-Path $Root "server\.env"
if (Test-Path $envFile) { Copy-Item $envFile (Join-Path $folder "server.env") -Force }
$helpDeskAttachments = Join-Path $Root "Data\helpdesk-attachments"
if (Test-Path $helpDeskAttachments) {
    Copy-Item $helpDeskAttachments (Join-Path $folder "helpdesk-attachments") -Recurse -Force
}
$hash = (Get-FileHash (Join-Path $folder "yaklasan-isler.db") -Algorithm SHA256).Hash
Set-Content (Join-Path $folder "SHA256.txt") $hash -Encoding ASCII
Get-ChildItem $DestinationRoot -Directory | Where-Object Name -like "Daily-*" |
    Sort-Object CreationTime -Descending | Select-Object -Skip 30 | Remove-Item -Recurse -Force
Add-Content $Log "$(Get-Date -Format o) Backup completed: $folder"
'@
    Set-Content (Join-Path $InstallRoot "windows\daily-backup.ps1") $script -Encoding UTF8
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallRoot\windows\daily-backup.ps1`""
    $trigger = New-ScheduledTaskTrigger -Daily -At 22:00
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $BackupTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "$ProductName günlük yedekleme" -Force | Out-Null
}

function Install-FirewallRule {
    $ruleNames = @(
        "Operis Enterprise TCP $Port",
        "Operis Enterprise TCP $Port - DomainPrivate",
        "Operis Enterprise TCP $Port - PublicLocalSubnet"
    )
    foreach ($ruleName in $ruleNames) {
        Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    }

    New-NetFirewallRule `
        -DisplayName "Operis Enterprise TCP $Port - DomainPrivate" `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
        -LocalAddress $script:SelectedIPv4 `
        -Profile Domain,Private | Out-Null

    New-NetFirewallRule `
        -DisplayName "Operis Enterprise TCP $Port - PublicLocalSubnet" `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
        -LocalAddress $script:SelectedIPv4 `
        -Profile Public -RemoteAddress LocalSubnet | Out-Null
}

function Install-Shortcuts {
    try {
        $commonDesktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
        $commonStart = [Environment]::GetFolderPath("CommonPrograms")

        $shortcutContent = @"
[InternetShortcut]
URL=http://$($script:SelectedIPv4):$Port
IconFile=$InstallRoot\public\icons\operis.ico
IconIndex=0
"@

        foreach ($folder in @($commonDesktop, $commonStart)) {
            if ([string]::IsNullOrWhiteSpace($folder)) { continue }

            New-Item -ItemType Directory -Path $folder -Force | Out-Null
            $shortcutPath = Join-Path $folder "Operis Enterprise.url"

            [System.IO.File]::WriteAllText(
                $shortcutPath,
                $shortcutContent,
                [System.Text.Encoding]::ASCII
            )

            Write-Log "Kısayol oluşturuldu: $shortcutPath"
        }
    }
    catch {
        Write-Log "Kısayol oluşturulamadı; kurulum devam ediyor: $($_.Exception.Message)" "WARN"
    }
}

function Set-EnterprisePermissions {
    & icacls $InstallRoot /inheritance:r | Out-Null
    & icacls $InstallRoot /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "BUILTIN\Users:(OI)(CI)RX" | Out-Null
    & icacls $DataRoot /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
    & icacls $BackupsRoot /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
    & icacls $LogsRoot /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
}

function Verify-Installation {
    Start-ScheduledTask -TaskName $TaskName
    $lastError = ""
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://$($script:SelectedIPv4):$Port/api/health" -TimeoutSec 5
            if ($health.ok -and $health.version -eq $Version) {
                Write-Log "Sağlık kontrolü başarılı. Sürüm: $($health.version)"
                return
            }
            $lastError = "Beklenen sürüm $Version, gelen sürüm $($health.version)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    }
    throw "Kurulum doğrulanamadı: $lastError"
}

try {
    if (-not (Test-Administrator)) { throw "Kurulum yönetici yetkisi gerektirir." }
    Ensure-Directories
    Start-Transcript -Path $TranscriptLog -Append | Out-Null

    Write-Step "İşletim sistemi doğrulanıyor"
    $os = Get-OperatingSystemInfo
    Write-Log "$($os.Caption) | Build $($os.Build) | $($os.Architecture)"
    if (-not $os.Supported) {
        throw "Desteklenmeyen işletim sistemi. Desteklenenler: Windows 11, Windows Server 2019, 2022 ve 2025."
    }
    if ($os.Architecture -notmatch "64") { throw "Yalnızca 64-bit Windows desteklenir." }

    $script:InstallMode = Get-InstallMode

    $installConfig = Read-OperisServerConfig
    $forceCleanInstall = $false
    if ($installConfig.ContainsKey("FORCE_CLEAN_INSTALL")) {
        $forceCleanInstall = ([string]$installConfig["FORCE_CLEAN_INSTALL"]).Trim().ToUpperInvariant() -eq "YES"
    }

    Write-Step "Kurulum modu belirleniyor"
    Write-Log "Kurulum modu: $script:InstallMode | Önceki sürüm: $script:PreviousVersion | Hedef sürüm: $Version"

    if ($forceCleanInstall -and $script:InstallMode -ne "NEW") {
        Write-Log "Sıfır kurulum paketi aktif. Mevcut OPERİS kurulumu güvenli yedek sonrası temizlenecek." "WARN"

        Write-Step "Sıfır kurulum öncesi mevcut bağlantı ayarları korunuyor"
        Capture-PreservedSettings

        Write-Step "Sıfır kurulum öncesi mevcut OPERİS yedekleniyor"
        Write-Log "Start-Transcript tarafından kullanılan Logs klasörü yedek dışında bırakılır; aktif log dosyası kilit hatası oluşturmaz."
        $cleanBackupStamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $cleanBackupBase = Join-Path $env:ProgramData "Operis-Installer-Backups"
        $cleanBackupRoot = Join-Path $cleanBackupBase "BeforeCleanInstall-$cleanBackupStamp"
        New-Item -ItemType Directory -Path $cleanBackupRoot -Force | Out-Null

        if (Test-Path $InstallRoot) {
            $robocopyExcludeDirs = @(
                (Join-Path $InstallRoot "Logs"),
                (Join-Path $InstallRoot "node_modules"),
                (Join-Path $InstallRoot "server\node_modules"),
                (Join-Path $InstallRoot "dist"),
                (Join-Path $InstallRoot "server\dist"),
                (Join-Path $InstallRoot "server\public"),
                (Join-Path $InstallRoot "Backups")
            )

            & robocopy.exe $InstallRoot $cleanBackupRoot /E /COPY:DAT /DCOPY:T /R:1 /W:1 `
                /XD $robocopyExcludeDirs `
                /XF "Install.log" "Install-Transcript.log" "Server.log" "Backup.log" `
                | Out-Null

            if ($LASTEXITCODE -ge 8) {
                throw "Sıfır kurulum öncesi mevcut OPERİS yedeği alınamadı. Robocopy kodu: $LASTEXITCODE"
            }

            Write-Log "Sıfır kurulum yedeği tamamlandı. Çalışan loglar, node_modules ve yeniden üretilebilir build klasörleri yedeğe dahil edilmedi."
        }

        Stop-OperisRuntime

        if (Test-Path $InstallRoot) {
            # Start-Transcript bu işlem boyunca $LogsRoot\Install-Transcript.log dosyasını açık tutar.
            # Temiz kurulumda Logs/Backups/Data korunur; yalnız uygulama payload'ı silinir.
            # Böylece aktif transcript dosyası hiçbir zaman Remove-Item hedefi olmaz.
            Get-ChildItem $InstallRoot -Force |
                Where-Object { $_.Name -notin @("Logs", "Backups", "Data") } |
                Remove-Item -Recurse -Force -ErrorAction Stop
        }

        $script:InstallMode = "NEW"
        $script:PreviousVersion = ""
        $script:RollbackRoot = $null
        Write-Log "Sıfır kurulum modu etkinleştirildi. Yeni ve boş OPERİS kurulumu yapılacak."
    }

    if (-not $script:PreservedSettingsRoot -and (Test-Path $ExternalImportRoot)) {
        Write-Step "Harici IMPORT_CONFIG bağlantı ayarları hazırlanıyor"
        Capture-PreservedSettings
    }

    Write-Step "Sunucu yayın IP adresi seçiliyor"
    Select-OperisServerIPv4
    Write-Log "OPERİS yayın adresi: http://$($script:SelectedIPv4):$Port"

    Write-Step "Node.js kontrol ediliyor"
    $script:NodePath = Ensure-Node
    Write-Log "Node.js: $(& $script:NodePath --version)"

    Write-Step "Geri alma kopyası hazırlanıyor"
    Create-RollbackSnapshot

    Write-Step "Mevcut Operis durduruluyor"
    Stop-OperisRuntime

    Write-Step "Kurulum öncesi güvenli yedek alınıyor"
    $backupFolder = Backup-ExistingInstallation

    Write-Step "Uygulama dosyaları C:\ProgramData\Operis dizinine kuruluyor"
    Copy-ApplicationFiles $backupFolder
    Ensure-Directories

    Write-Step "Bağımlılıklar kuruluyor"
    if (Test-Path (Join-Path $InstallRoot "package-lock.json")) {
        Invoke-Npm $InstallRoot @("ci", "--no-audit", "--no-fund")
    } else {
        Invoke-Npm $InstallRoot @("install", "--no-audit", "--no-fund")
    }
    if (Test-Path (Join-Path $InstallRoot "server\package-lock.json")) {
        Invoke-Npm (Join-Path $InstallRoot "server") @("ci", "--no-audit", "--no-fund")
    } else {
        Invoke-Npm (Join-Path $InstallRoot "server") @("install", "--no-audit", "--no-fund")
    }

    Write-Step "Güvenli yapılandırma hazırlanıyor"
    Ensure-EnvironmentFile

    Write-Step "Veritabanı ve Prisma istemcisi hazırlanıyor"
    Invoke-Npm (Join-Path $InstallRoot "server") @("run", "prisma:generate")
    Invoke-Npm (Join-Path $InstallRoot "server") @("run", "prisma:push")

    Write-Step "Mevcut mail ve veritabanı bağlantıları aktarılıyor"
    Import-PreservedSettings

    Write-Step "Üretim derlemesi oluşturuluyor"
    Invoke-Npm $InstallRoot @("run", "build")

    Write-Step "Enterprise otomatik başlangıç görevi kuruluyor"
    Install-Runner

    Write-Step "Günlük korumalı yedekleme kuruluyor"
    Install-DailyBackup

    Write-Step "Windows Güvenlik Duvarı yapılandırılıyor"
    Install-FirewallRule

    Write-Step "Masaüstü ve Başlat menüsü kısayolları oluşturuluyor"
    try {
        Install-Shortcuts
    } catch {
        Write-Log "Kısayol adımı atlandı: $($_.Exception.Message)" "WARN"
    }

    Write-Step "Dosya izinleri sıkılaştırılıyor"
    Set-EnterprisePermissions

    Write-Step "Kurulum doğrulanıyor"
    Verify-Installation

    Write-Step "Tek seferlik bağlantı aktarım dosyaları temizleniyor"
    Clear-OneTimeImportConfig

    Set-Content (Join-Path $InstallRoot "VERSION.txt") $Version -Encoding ASCII
    Save-VersionHistory "SUCCESS" "Kurulum ve sağlık kontrolü tamamlandı."
    $script:UpgradeSucceeded = $true
    if ($script:RollbackRoot -and (Test-Path $script:RollbackRoot)) {
        Remove-Item $script:RollbackRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Log "$ProductName kurulumu başarıyla tamamlandı."
    Write-Host ""
    Write-Host "Kurulum başarıyla tamamlandı. Sürüm: $Version" -ForegroundColor Green
    Write-Host "Adres: http://$($script:SelectedIPv4):$Port" -ForegroundColor Green
    Write-Host "Loglar: $LogsRoot" -ForegroundColor Green
    Start-Process "http://$($script:SelectedIPv4):$Port"
}
catch {
    $failureMessage = $_.Exception.Message
    try { Write-Log $failureMessage "ERROR" } catch {}

    $rolledBack = $false
    if (-not $script:UpgradeSucceeded -and $script:RollbackRoot -and (Test-Path $script:RollbackRoot)) {
        $rolledBack = Restore-RollbackSnapshot
        try {
            $historyStatus = if ($rolledBack) { "ROLLED_BACK" } else { "FAILED" }
            Save-VersionHistory $historyStatus $failureMessage
        } catch {}
    }

    Write-Host ""
    Write-Host "KURULUM BAŞARISIZ: $failureMessage" -ForegroundColor Red
    if ($rolledBack) {
        Write-Host "Önceki çalışan sürüm otomatik olarak geri yüklendi." -ForegroundColor Yellow
    } else {
        Write-Host "Geri alma kopyası yoktu. Korunan veritabanı yedeği Backups klasöründedir." -ForegroundColor Yellow
    }
    Write-Host "Log: $InstallLog" -ForegroundColor Yellow
    exit 1
}
finally {
    try { Stop-Transcript | Out-Null } catch {}
}
