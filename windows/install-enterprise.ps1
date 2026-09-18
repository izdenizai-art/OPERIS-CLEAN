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
$script:SameVersionMaintenance = $false
$script:PreviousVersion = ""
$script:UpgradeSucceeded = $false
$script:SelectedIPv4 = $null
$script:SelectedInterfaceAlias = ""
$script:PreservedSettingsRoot = $null
$script:PreservedSettingsDb = $null
$script:PreservedSettingsEnv = $null
$ExternalImportRoot = Join-Path $SourceRoot "IMPORT_CONFIG"

$ServerConfigFile = Join-Path $SourceRoot "OPERIS_SERVER_CONFIG.ini"
. (Join-Path $PSScriptRoot "installer-postgresql.ps1")


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
        try {
            $installedVersion = [version]$script:PreviousVersion
            $targetVersion = [version]$Version
            if ($installedVersion -gt $targetVersion) { return "DOWNGRADE_BLOCKED" }
            if ($installedVersion -eq $targetVersion) {
                $script:SameVersionMaintenance = $true
                $maintenanceAction = ([string]$env:OPERIS_MAINTENANCE_ACTION).Trim().ToUpperInvariant()
                if ([string]::IsNullOrWhiteSpace($maintenanceAction)) { $maintenanceAction = "REPAIR" }
                if ($maintenanceAction -notin @("REPAIR", "REFRESH")) {
                    throw "SAME_VERSION maintenance action must be REPAIR or REFRESH."
                }
                return $maintenanceAction
            }
        } catch [System.Management.Automation.RuntimeException] {
            throw
        } catch {
            Write-Log "Kurulu sürüm karşılaştırılamadı; güvenli UPDATE akışı kullanılacak: $script:PreviousVersion" "WARN"
        }
        return "UPDATE"
    }
    if ((Test-Path $database) -or (Test-Path $legacyDatabase) -or (Test-Path $InstallRoot)) {
        return "REPAIR"
    }
    return "NEW"
}

function Create-RollbackSnapshot {
    $snapshotSource = if ($script:DatabaseState) { $script:DatabaseState.Root } else { $InstallRoot }
    if (-not $script:DatabaseState -and $script:InstallMode -eq "NEW") { return }
    if (-not (Test-Path $snapshotSource)) { return }

    $versionFile = Join-Path $snapshotSource "VERSION.txt"
    $serverFile = Join-Path $snapshotSource "server\dist\index.js"

    if (-not (Test-Path $versionFile) -or -not (Test-Path $serverFile)) {
        Write-Log "Kurulum eksik veya onarım durumunda. Uygulama dosyası geri alma kopyası atlandı; veritabanı ayrıca korunacak." "WARN"
        $script:RollbackRoot = $null
        return
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $script:RollbackRoot = Join-Path $env:TEMP "Operis-Rollback-$stamp"
    New-Item -ItemType Directory -Path $script:RollbackRoot -Force | Out-Null

    Protect-OperisPrivatePath $script:RollbackRoot
    Write-Log "Çalışan sürüm geri alma için kopyalanıyor: $script:RollbackRoot"
    & robocopy.exe $snapshotSource $script:RollbackRoot /E /COPY:DAT /DCOPY:T /R:2 /W:1 `
        /XD (Join-Path $snapshotSource "Backups") (Join-Path $snapshotSource "Logs") | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Geri alma kopyası oluşturulamadı. Robocopy kodu: $LASTEXITCODE"
    }

    [ordered]@{
        createdAt = (Get-Date).ToString("o")
        mode = $script:InstallMode
        previousVersion = $script:PreviousVersion
        targetVersion = $Version
        source = $snapshotSource
    } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $script:RollbackRoot "rollback-manifest.json") -Encoding UTF8
}

function Verify-RollbackHealth {
    $binding = Get-ExistingOperisNetworkBinding
    if (-not $binding) { throw "Rollback health için NetworkBinding.json bulunamadı." }
    $rollbackIp = [string]$binding.ipAddress
    $rollbackPort = [int]$binding.port
    if ([string]::IsNullOrWhiteSpace($rollbackIp) -or $rollbackPort -le 0) { throw "Rollback health binding geçersiz." }
    $lastError = ""
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://${rollbackIp}:$rollbackPort/api/health" -TimeoutSec 5
            $versionOk = [string]::IsNullOrWhiteSpace($script:PreviousVersion) -or ([string]$health.version -eq $script:PreviousVersion)
            $expectsPostgresql = $script:DatabaseState -and -not $script:DatabaseState.SQLite
            $databaseOk = if ($expectsPostgresql) { $health.database.provider -eq "postgresql" -and $health.database.connected } else { $true }
            if ($health.ok -and $versionOk -and $databaseOk) {
                Write-Log "Rollback health doğrulaması başarılı. Sürüm: $($health.version)" "WARN"
                return $true
            }
            $lastError = "Rollback health mismatch: ok=$($health.ok), version=$($health.version), provider=$($health.database.provider), connected=$($health.database.connected)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    }
    throw "Rollback health doğrulaması başarısız: $lastError"
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

        if ($script:PreUpgradePostgresDump) {
            & (Join-Path $SourceRoot 'windows\postgresql-restore.ps1') -DatabaseUrl $script:Postgres.DatabaseUrl -BackupFile $script:PreUpgradePostgresDump -ConfirmRestore YES
        }
        Install-Runner
        Start-ScheduledTask -TaskName $TaskName
        if (-not (Verify-RollbackHealth)) { throw "Rollback health verification returned false." }
        Write-Log "Önceki sürüm geri yüklendi ve health doğrulandı." "WARN"
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
    $maxAttempts = 12
    $delayMilliseconds = 250

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $tempFile = "$historyFile.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
        try {
            $history = @()
            if (Test-Path $historyFile) {
                $rawHistory = Get-Content $historyFile -Raw -ErrorAction Stop
                try {
                    $loaded = $rawHistory | ConvertFrom-Json -ErrorAction Stop
                    if ($loaded) { $history = @($loaded) }
                }
                catch {
                    Write-Log "Sürüm geçmişi JSON olarak okunamadı; yeni dosya oluşturulacak." "WARN"
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

            $json = $history | ConvertTo-Json -Depth 5
            [System.IO.File]::WriteAllText($tempFile, $json, [System.Text.UTF8Encoding]::new($true))
            Move-Item -LiteralPath $tempFile -Destination $historyFile -Force -ErrorAction Stop
            return
        }
        catch {
            if ($attempt -ge $maxAttempts) { throw }
            Write-Log "Sürüm geçmişi dosyasına erişilemedi; tekrar deneniyor ($attempt/$maxAttempts)." "WARN"
            Start-Sleep -Milliseconds $delayMilliseconds
        }
        finally {
            Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
        }
    }

    throw "Sürüm geçmişi dosyası güncellenemedi."
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

    $releaseBase = "https://nodejs.org/download/release/v24.21.0"
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
            Where-Object { $_ -match "node-v24\.21\.0-x64\.msi$" } |
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

        $nodeVersion = (& $node --version).Trim()
        if ($nodeVersion -ne 'v24.21.0') {
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
        Write-Host "https://nodejs.org/download/release/v24.21.0/" -ForegroundColor Cyan
        Write-Host ""
        throw
    }
}

function Ensure-Node {
    $node = Find-Node
    if ($node) {
        $nodeVersion = (& $node --version).Trim()
        if ($nodeVersion -eq 'v24.21.0') { return $node }
        Write-Log "Node.js sürümü desteklenen aralıkta değil: $(& $node --version)" "WARN"
    }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Step "Node.js LTS Winget üzerinden kuruluyor"
        & winget install --id OpenJS.NodeJS.LTS --version 24.21.0 --exact --silent --accept-package-agreements --accept-source-agreements
        $wingetExit = $LASTEXITCODE

        Refresh-Path
        Start-Sleep -Seconds 2
        $node = Find-Node

        if ($wingetExit -eq 0 -and $node) {
            $nodeVersion = (& $node --version).Trim()
            if ($nodeVersion -eq 'v24.21.0') {
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
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue
            $commandLine = [string]$process.CommandLine
            $legacyRoot = Join-Path $env:ProgramData 'YaklasanIsler'
            $owned = $process -and (
                $commandLine.IndexOf($InstallRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $commandLine.IndexOf($legacyRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0
            )
            if (-not $owned) { throw "TCP $Port başka bir uygulama tarafından kullanılıyor; süreç durdurulmadı." }
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop
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

function Get-ExistingOperisNetworkBinding {
    $bindingFile = Join-Path $DataRoot "NetworkBinding.json"
    if (-not (Test-Path $bindingFile)) { return $null }
    try {
        $binding = Get-Content $bindingFile -Raw | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace([string]$binding.ipAddress)) { return $null }
        return $binding
    } catch {
        Write-Log "Mevcut NetworkBinding.json okunamadı; diğer güvenli seçim kaynaklarına geçiliyor." "WARN"
        return $null
    }
}

function Select-OperisServerIPv4 {
    $candidates = @(Get-OperisIPv4Candidates)
    if ($candidates.Count -eq 0) {
        throw "Sunucuda yayına uygun aktif IPv4 adresi bulunamadı. Ağ bağdaştırıcısı ve statik IP yapılandırmasını kontrol edin."
    }

    $explicitIp = ([string]$env:OPERIS_EXPLICIT_BIND_IP).Trim()
    if (-not [string]::IsNullOrWhiteSpace($explicitIp)) {
        $explicit = $candidates | Where-Object { $_.IPAddress -eq $explicitIp } | Select-Object -First 1
        if (-not $explicit) { throw "Bu setup oturumunda seçilen IP aktif bir local IPv4 değil: $explicitIp" }
        $script:SelectedIPv4 = $explicit.IPAddress
        $script:SelectedInterfaceAlias = $explicit.InterfaceAlias
        Write-Log "Yayın IP adresi bu setup oturumundaki açık kullanıcı seçimiyle değiştirildi: $($script:SelectedIPv4) [$($script:SelectedInterfaceAlias)]"
        return
    }

    if ($script:InstallMode -ne "NEW") {
        $existingBinding = Get-ExistingOperisNetworkBinding
        if ($existingBinding) {
            $existing = $candidates | Where-Object { $_.IPAddress -eq ([string]$existingBinding.ipAddress) } | Select-Object -First 1
            if ($existing) {
                $script:SelectedIPv4 = $existing.IPAddress
                $script:SelectedInterfaceAlias = $existing.InterfaceAlias
                Write-Log "Mevcut NetworkBinding.json korunuyor: $($script:SelectedIPv4) [$($script:SelectedInterfaceAlias)]"
                return
            }
            Write-Log "Mevcut NetworkBinding IP artık aktif bir local NIC üzerinde değil: $($existingBinding.ipAddress)" "WARN"
        }
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
$env:DOTENV_CONFIG_PATH = Join-Path $InstallRoot "server\.env"
$env:OPERIS_DATA_DIR = Join-Path $InstallRoot "Data"
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
    $backupScript = Join-Path $InstallRoot 'windows\postgresql-daily-backup.ps1'
    if (-not (Test-Path $backupScript)) { throw 'PostgreSQL daily backup script missing.' }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$backupScript`""
    $trigger = New-ScheduledTaskTrigger -Daily -At 22:00
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $BackupTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "$ProductName PostgreSQL günlük yedekleme" -Force | Out-Null
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
            if ($health.ok -and $health.version -eq $Version -and $health.database.provider -eq "postgresql" -and $health.database.connected) {
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

    if ($script:InstallMode -eq "DOWNGRADE_BLOCKED") { throw "Kurulu OPERIS sürümü hedef sürümden daha yeni; downgrade varsayılan olarak engellendi." }

    if ($forceCleanInstall -and ((Find-OperisDatabaseState) -or (Test-Path (Join-Path $InstallRoot 'VERSION.txt')))) {
        throw "Mevcut kurulumda FORCE_CLEAN_INSTALL veri güvenliği için reddedildi; mevcut veriler korunuyor."
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

    $script:DatabaseState = Find-OperisDatabaseState
    Write-Step "Mevcut Operis durduruluyor"
    Stop-OperisRuntime
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Runtime durdurulamadı; veri yedekleme ve geçiş yapılmadı."
    }
    Write-Step "Tutarlı geçiş yedeği ve geri alma kopyası hazırlanıyor"
    Save-OperisPreCutover
    Create-RollbackSnapshot
    Write-Step "PostgreSQL otomatik kurulum ve hedef doğrulama"
    Prepare-OperisPostgresql

    Write-Step "Kurulum öncesi güvenli yedek alınıyor"
    $backupFolder = Backup-ExistingInstallation
    if ($script:SQLiteMigrationSource) { Copy-Item $script:SQLiteMigrationSource (Join-Path $backupFolder 'yaklasan-isler.db') -Force }
    if (Test-Path (Join-Path $script:PreCutoverRoot 'server.env')) {
        Copy-Item (Join-Path $script:PreCutoverRoot 'server.env') (Join-Path $backupFolder 'server.env') -Force
    }

    Write-Step "Uygulama dosyaları C:\ProgramData\Operis dizinine kuruluyor"
    Copy-ApplicationFiles $backupFolder
    if ($env:GITHUB_ACTIONS -eq 'true' -and $env:OPERIS_TEST_FORCE_UPDATE_FAILURE -eq 'AFTER_COPY') {
        throw 'OPERIS_TEST_FORCED_UPDATE_FAILURE'
    }
    Ensure-Directories
    if ($script:DatabaseState -and $script:DatabaseState.Root -ne $InstallRoot -and (Test-Path (Join-Path $script:PreCutoverRoot 'Data'))) {
        Copy-Item (Join-Path $script:PreCutoverRoot 'Data\*') $DataRoot -Recurse -Force
    }

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
    if ($script:SameVersionMaintenance -and $script:DatabaseState -and -not $script:DatabaseState.SQLite) {
        Copy-Item (Join-Path $InstallRoot 'server\prisma\schema.postgresql.prisma') (Join-Path $InstallRoot 'server\prisma\schema.prisma') -Force
        $env:DATABASE_URL = $script:Postgres.DatabaseUrl
        Invoke-Npm (Join-Path $InstallRoot 'server') @('run','prisma:generate')
        Write-Log "Same-version $script:InstallMode: PostgreSQL Prisma istemcisi yeniden üretildi; mevcut PostgreSQL şema/verisine db push uygulanmayacak."
    } else {
        Initialize-OperisPostgresql
    }

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
    Protect-OperisPrivatePath (Join-Path $InstallRoot "server\.env")
    Protect-OperisPrivatePath $BackupsRoot

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