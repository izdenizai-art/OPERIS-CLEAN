param(
    [string]$PayloadRoot = '',
    [ValidateSet('AUTO','INSTALL','UPDATE','REPAIR','REFRESH','UNINSTALL')][string]$OperationType = 'AUTO',
    [string]$CurrentVersion = '',
    [string]$TargetVersion = '6.3.63',
    [switch]$Silent,
    [switch]$ProbeOnly
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:ProgramData)) {
    $env:ProgramData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function New-ProgressControls {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'OPERIS Enterprise - Kurulum İşlemi'
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(760, 430)
    $form.MinimumSize = New-Object System.Drawing.Size(760, 430)
    $form.MaximizeBox = $false

    $title = New-Object System.Windows.Forms.Label
    $title.Location = New-Object System.Drawing.Point(20, 18)
    $title.Size = New-Object System.Drawing.Size(700, 26)
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
    $title.Text = 'OPERIS Enterprise işlemi hazırlanıyor'
    $form.Controls.Add($title)

    $meta = New-Object System.Windows.Forms.Label
    $meta.Location = New-Object System.Drawing.Point(20, 52)
    $meta.Size = New-Object System.Drawing.Size(700, 44)
    $meta.Text = 'İşlem: -    Mevcut sürüm: -    Hedef sürüm: -'
    $form.Controls.Add($meta)

    $step = New-Object System.Windows.Forms.Label
    $step.Location = New-Object System.Drawing.Point(20, 96)
    $step.Size = New-Object System.Drawing.Size(700, 24)
    $step.Text = 'Aktif adım: Başlatılıyor'
    $form.Controls.Add($step)

    $progress = New-Object System.Windows.Forms.ProgressBar
    $progress.Location = New-Object System.Drawing.Point(20, 126)
    $progress.Size = New-Object System.Drawing.Size(700, 24)
    $progress.Minimum = 0
    $progress.Maximum = 100
    $form.Controls.Add($progress)

    $status = New-Object System.Windows.Forms.Label
    $status.Location = New-Object System.Drawing.Point(20, 158)
    $status.Size = New-Object System.Drawing.Size(700, 42)
    $status.Text = 'Geçen süre: 00:00:00    Son başarılı adım: -'
    $form.Controls.Add($status)

    $details = New-Object System.Windows.Forms.TextBox
    $details.Location = New-Object System.Drawing.Point(20, 205)
    $details.Size = New-Object System.Drawing.Size(700, 125)
    $details.Multiline = $true
    $details.ReadOnly = $true
    $details.ScrollBars = 'Both'
    $details.WordWrap = $false
    $details.ShortcutsEnabled = $true
    $details.HideSelection = $false
    $form.Controls.Add($details)

    $copy = New-Object System.Windows.Forms.Button
    $copy.Location = New-Object System.Drawing.Point(20, 344)
    $copy.Size = New-Object System.Drawing.Size(110, 30)
    $copy.Text = 'Tümünü Kopyala'
    $form.Controls.Add($copy)

    $openLogs = New-Object System.Windows.Forms.Button
    $openLogs.Location = New-Object System.Drawing.Point(138, 344)
    $openLogs.Size = New-Object System.Drawing.Size(125, 30)
    $openLogs.Text = 'Log Klasörünü Aç'
    $form.Controls.Add($openLogs)

    $toggle = New-Object System.Windows.Forms.Button
    $toggle.Location = New-Object System.Drawing.Point(271, 344)
    $toggle.Size = New-Object System.Drawing.Size(130, 30)
    $toggle.Text = 'Detayları Gizle'
    $form.Controls.Add($toggle)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Location = New-Object System.Drawing.Point(409, 344)
    $cancel.Size = New-Object System.Drawing.Size(90, 30)
    $cancel.Text = 'Cancel'
    $form.Controls.Add($cancel)

    $openApp = New-Object System.Windows.Forms.Button
    $openApp.Location = New-Object System.Drawing.Point(507, 344)
    $openApp.Size = New-Object System.Drawing.Size(100, 30)
    $openApp.Text = 'Uygulamayı Aç'
    $openApp.Enabled = $false
    $form.Controls.Add($openApp)

    $finish = New-Object System.Windows.Forms.Button
    $finish.Location = New-Object System.Drawing.Point(615, 344)
    $finish.Size = New-Object System.Drawing.Size(105, 30)
    $finish.Text = 'Bitir'
    $finish.Enabled = $false
    $form.Controls.Add($finish)

    return [pscustomobject]@{
        Form = $form; Title = $title; Meta = $meta; Step = $step; ProgressBar = $progress;
        Status = $status; Details = $details; Copy = $copy; OpenLogs = $openLogs;
        Toggle = $toggle; Cancel = $cancel; OpenApp = $openApp; Finish = $finish
    }
}

function Set-RollbackFailureAppearance($Controls) {
    $Controls.Form.BackColor = [System.Drawing.Color]::MistyRose
    $Controls.Title.ForeColor = [System.Drawing.Color]::DarkRed
    $Controls.Title.Text = 'Rollback başarısız'
}

function Format-HealthSummary([string]$HealthStatus, [string]$Provider, [string]$Connectivity) {
    if ([string]::IsNullOrWhiteSpace($HealthStatus)) { $HealthStatus = 'UNKNOWN' }
    if ([string]::IsNullOrWhiteSpace($Provider)) { $Provider = 'unknown' }
    if ([string]::IsNullOrWhiteSpace($Connectivity)) { $Connectivity = 'unknown' }
    return ('Health: {0}    DB: {1} / {2}' -f $HealthStatus, $Provider, $Connectivity)
}

function Get-FinalHealthSummary {
    $bindingPath = Join-Path $env:ProgramData 'Operis\Data\NetworkBinding.json'
    if (-not (Test-Path $bindingPath)) {
        return (Format-HealthSummary 'UNKNOWN' 'unknown' 'binding-unavailable')
    }

    try {
        $binding = Get-Content $bindingPath -Raw | ConvertFrom-Json
        $healthUri = ''
        if (-not [string]::IsNullOrWhiteSpace([string]$binding.publicUrl)) {
            $healthUri = ([string]$binding.publicUrl).TrimEnd('/') + '/api/health'
        } elseif ($binding.ipAddress -and $binding.port) {
            $healthUri = 'http://{0}:{1}/api/health' -f $binding.ipAddress, $binding.port
        }
        if ([string]::IsNullOrWhiteSpace($healthUri)) {
            return (Format-HealthSummary 'UNKNOWN' 'unknown' 'endpoint-unavailable')
        }

        $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 5
        $healthStatus = if ([bool]$health.ok) { 'PASS' } else { 'FAIL' }
        $provider = if ($health.database -and $health.database.provider) { [string]$health.database.provider } else { 'unknown' }
        $connectivity = if ($health.database -and [bool]$health.database.connected) { 'connected' } else { 'disconnected' }
        return (Format-HealthSummary $healthStatus $provider $connectivity)
    } catch {
        return (Format-HealthSummary 'UNKNOWN' 'unavailable' 'unavailable')
    }
}

if ($ProbeOnly) {
    $controls = New-ProgressControls
    $controls.Details.Text = 'COPY_PROBE_TEXT'
    $copyWorks = $false
    try {
        $controls.Details.SelectAll()
        $controls.Details.Copy()
        $copyWorks = ([System.Windows.Forms.Clipboard]::GetText() -eq 'COPY_PROBE_TEXT')
    } catch {
        $copyWorks = $false
    }
    Set-RollbackFailureAppearance $controls
    $rollbackFailureRed = ($controls.Form.BackColor -eq [System.Drawing.Color]::MistyRose -and $controls.Title.ForeColor -eq [System.Drawing.Color]::DarkRed)
    $healthSurface = ((Format-HealthSummary 'PASS' 'postgresql' 'connected') -eq 'Health: PASS    DB: postgresql / connected')
    [ordered]@{
        logSelectable = ($controls.Details.ReadOnly -and $controls.Details.Multiline -and $controls.Details.ShortcutsEnabled)
        copyWorks = $copyWorks
        logFolderButton = ($controls.OpenLogs.Text -eq 'Log Klasörünü Aç')
        detailsToggle = ($controls.Toggle.Text -match 'Detayları')
        cancelButton = ($controls.Cancel.Text -eq 'Cancel')
        progressBar = ($controls.ProgressBar.Maximum -eq 100)
        rollbackFailureRed = $rollbackFailureRed
        finalHealthSurface = $healthSurface
        powershell51 = ($PSVersionTable.PSEdition -eq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5)
    } | ConvertTo-Json -Compress
    $controls.Form.Dispose()
    exit 0
}

if ([string]::IsNullOrWhiteSpace($PayloadRoot)) { throw 'PayloadRoot zorunludur.' }
$hostScript = Join-Path $PayloadRoot 'windows\operation-host.ps1'
if (-not (Test-Path $hostScript)) { throw "operation-host.ps1 bulunamadı: $hostScript" }

$sessionId = [guid]::NewGuid().ToString('N')
$installRoot = Join-Path $env:ProgramData 'Operis'
$script:InstallRootExistedAtStart = Test-Path $installRoot
$logsRoot = if ($script:InstallRootExistedAtStart) {
    Join-Path $installRoot 'Logs'
} else {
    Join-Path (Join-Path $env:ProgramData 'Operis-Setup') 'Logs'
}
New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
$eventFile = Join-Path $logsRoot ("Operation-{0}.events.jsonl" -f $sessionId)
$logFile = Join-Path $logsRoot ("Operation-{0}.log" -f $sessionId)
$cancelFile = Join-Path $logsRoot ("Operation-{0}.cancel" -f $sessionId)

$hostArgs = @(
    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $hostScript),
    '-PayloadRoot',('"{0}"' -f $PayloadRoot),
    '-OperationType',('"{0}"' -f $OperationType),
    '-CurrentVersion',('"{0}"' -f $CurrentVersion),
    '-TargetVersion',('"{0}"' -f $TargetVersion),
    '-SessionId',('"{0}"' -f $sessionId),
    '-EventFile',('"{0}"' -f $eventFile),
    '-LogFile',('"{0}"' -f $logFile),
    '-CancelRequestFile',('"{0}"' -f $cancelFile)
)

$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if ($Silent) {
    & $powershellExe @hostArgs
    $engineExitCode = $LASTEXITCODE
    exit $engineExitCode
}

$controls = New-ProgressControls
$startedAt = Get-Date
$engineExitCode = 1
$script:eventIndex = 0
$script:lastEvent = $null
$script:detailsVisible = $true
$script:engineExitCode = 1

$process = Start-Process -FilePath $powershellExe -ArgumentList $hostArgs -WindowStyle Hidden -PassThru

$controls.Copy.Add_Click({
    if (-not [string]::IsNullOrEmpty($controls.Details.Text)) {
        [System.Windows.Forms.Clipboard]::SetText($controls.Details.Text)
    }
})
$controls.OpenLogs.Add_Click({ Start-Process explorer.exe -ArgumentList ('"{0}"' -f $logsRoot) })
$controls.Toggle.Add_Click({
    $script:detailsVisible = -not $script:detailsVisible
    $controls.Details.Visible = $script:detailsVisible
    if ($script:detailsVisible) {
        $controls.Toggle.Text = 'Detayları Gizle'
        $controls.Form.Height = 430
    } else {
        $controls.Toggle.Text = 'Detayları Göster'
        $controls.Form.Height = 285
    }
})
$controls.Cancel.Add_Click({
    if ($controls.Cancel.Enabled -and -not $process.HasExited) {
        Set-Content $cancelFile 'cancel' -Encoding ASCII
        $controls.Cancel.Enabled = $false
        $controls.Title.Text = 'İptal isteği gönderildi'
    }
})
$controls.OpenApp.Add_Click({
    $bindingPath = Join-Path $env:ProgramData 'Operis\Data\NetworkBinding.json'
    if (Test-Path $bindingPath) {
        try {
            $binding = Get-Content $bindingPath -Raw | ConvertFrom-Json
            if (-not [string]::IsNullOrWhiteSpace([string]$binding.publicUrl)) { Start-Process ([string]$binding.publicUrl) }
        } catch {}
    }
})
$controls.Finish.Add_Click({ $controls.Form.Close() })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
    $elapsed = (Get-Date) - $startedAt
    $lastSuccessful = if ($script:lastEvent -and $script:lastEvent.lastSuccessfulStep) { [string]$script:lastEvent.lastSuccessfulStep } else { '-' }
    $rollbackSuffix = ''
    if ($script:lastEvent -and ($script:lastEvent.rollbackStatus -ne 'NOT_STARTED' -or $script:lastEvent.rollbackHealth -ne 'NOT_RUN')) {
        $rollbackSuffix = '    Rollback: {0} / {1}' -f $script:lastEvent.rollbackStatus, $script:lastEvent.rollbackHealth
    }
    $controls.Status.Text = ('Geçen süre: {0:hh\:mm\:ss}    Son başarılı adım: {1}{2}' -f $elapsed, $lastSuccessful, $rollbackSuffix)

    if (Test-Path $logFile) {
        try {
            $text = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
            if ($null -ne $text -and $controls.Details.Text -ne $text) {
                $controls.Details.Text = $text
                $controls.Details.SelectionStart = $controls.Details.TextLength
                $controls.Details.ScrollToCaret()
            }
        } catch {}
    }

    if (Test-Path $eventFile) {
        try {
            $lines = @(Get-Content $eventFile -ErrorAction SilentlyContinue | Where-Object { $_.Trim() })
            while ($script:eventIndex -lt $lines.Count) {
                $event = $lines[$script:eventIndex] | ConvertFrom-Json
                $script:eventIndex++
                $script:lastEvent = $event
                $controls.Title.Text = if ($event.status -eq 'SUCCESS') { 'Başarıyla tamamlandı' } elseif ($event.status -eq 'FAIL') { 'İşlem başarısız' } elseif ($event.status -eq 'ROLLBACK') { 'Rollback işlemi yürütülüyor' } else { 'OPERIS Enterprise işlemi devam ediyor' }
                $controls.Meta.Text = 'İşlem: {0}    Mevcut sürüm: {1}    Hedef sürüm: {2}' -f $event.operationType, $(if ($event.currentVersion) { $event.currentVersion } else { '-' }), $event.targetVersion
                $controls.Step.Text = 'Aktif adım: {0}' -f $event.step
                $p = [Math]::Max(0, [Math]::Min(100, [int]$event.progress))
                if ($p -ge $controls.ProgressBar.Value) { $controls.ProgressBar.Value = $p }
                $controls.Cancel.Enabled = ([bool]$event.cancelSafe -and -not $process.HasExited)

                if (($event.rollbackStatus -eq 'FAILED') -or ($event.rollbackHealth -eq 'FAIL')) {
                    Set-RollbackFailureAppearance $controls
                }

                if ($event.status -eq 'FAIL') {
                    $controls.Form.Height = 430
                    $controls.Details.Visible = $true
                    $controls.Toggle.Text = 'Detayları Gizle'
                    $eventText = "`r`nHata: $($event.message)`r`nExit code: $($event.exitCode)`r`nRollback: $($event.rollbackStatus) / $($event.rollbackHealth)"
                    if (-not $controls.Details.Text.Contains($eventText)) { $controls.Details.AppendText($eventText) }
                }
            }
        } catch {}
    }

    if ($process.HasExited) {
        $timer.Stop()
        $process.WaitForExit()
        $script:engineExitCode = [int]$process.ExitCode
        $controls.Cancel.Enabled = $false
        $controls.Finish.Enabled = $true
        $finalElapsed = (Get-Date) - $startedAt
        $finalLastSuccessful = if ($script:lastEvent -and $script:lastEvent.lastSuccessfulStep) { [string]$script:lastEvent.lastSuccessfulStep } else { '-' }
        $effectiveOperation = if ($script:lastEvent -and $script:lastEvent.operationType) { [string]$script:lastEvent.operationType } else { $OperationType }

        if ($script:engineExitCode -eq 0) {
            $controls.Title.Text = 'Başarıyla tamamlandı'
            $controls.ProgressBar.Value = 100
            $healthSummary = if ($effectiveOperation -eq 'UNINSTALL') {
                Format-HealthSummary 'N/A' 'preserved' 'not-applicable'
            } else {
                Get-FinalHealthSummary
            }
            $controls.Status.Text = ('Süre: {0:hh\:mm\:ss}    Son başarılı adım: {1}' -f $finalElapsed, $finalLastSuccessful) + [Environment]::NewLine + $healthSummary
            $controls.OpenApp.Enabled = ($effectiveOperation -ne 'UNINSTALL')
        } else {
            if ($script:lastEvent -and (($script:lastEvent.rollbackStatus -eq 'FAILED') -or ($script:lastEvent.rollbackHealth -eq 'FAIL'))) {
                Set-RollbackFailureAppearance $controls
            } else {
                $controls.Title.Text = 'İşlem başarısız'
                $controls.Title.ForeColor = [System.Drawing.Color]::DarkRed
                $controls.Form.BackColor = [System.Drawing.Color]::MistyRose
            }
            $controls.Status.Text = ('Süre: {0:hh\:mm\:ss}    Son başarılı adım: {1}' -f $finalElapsed, $finalLastSuccessful)
            $controls.Form.Height = 430
            $controls.Details.Visible = $true
            $controls.Toggle.Text = 'Detayları Gizle'
            $exitText = "`r`nExit code: $script:engineExitCode`r`nLog: $logFile"
            if (-not $controls.Details.Text.Contains($exitText)) { $controls.Details.AppendText($exitText) }
        }
    }
})

$controls.Form.Add_FormClosing({
    param($sender, $e)
    if (-not $process.HasExited) {
        $e.Cancel = $true
        if ($controls.Cancel.Enabled) {
            Set-Content $cancelFile 'cancel' -Encoding ASCII
            $controls.Cancel.Enabled = $false
            $controls.Title.Text = 'İptal isteği gönderildi; güvenli kapanış bekleniyor'
        } else {
            $controls.Title.Text = 'İşlem güvenli olmayan aşamada; pencere işlem bitene kadar kapatılamaz'
        }
    }
})

$timer.Start()
[void]$controls.Form.ShowDialog()
$timer.Stop()
if (-not $process.HasExited) { $process.WaitForExit() }
$engineExitCode = [int]$process.ExitCode
$controls.Form.Dispose()
exit $engineExitCode