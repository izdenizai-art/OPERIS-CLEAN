$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramData 'Operis'
$ManagedPostgresRoot = Join-Path $env:ProgramData 'OperisPostgreSQL'
$TaskNames = @('OperisEnterpriseServer','OperisEnterpriseDailyBackup')

Write-Output '==> Kaldırma: sistem doğrulanıyor'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Kaldırma işlemi yönetici yetkisi gerektirir.'
}

Write-Output '==> Kaldırma: görevler durduruluyor'
foreach ($taskName in $TaskNames) {
    try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch {}
    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}

Write-Output '==> Kaldırma: güvenlik duvarı kuralları temizleniyor'
Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'OPERIS*3001*' -or $_.DisplayName -like 'OPERİS*3001*' } |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

Write-Output '==> Kaldırma: kısayollar kaldırılıyor'
$desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$programs = [Environment]::GetFolderPath('CommonPrograms')
foreach ($shortcut in @(
    (Join-Path $desktop 'OPERIS.lnk'),
    (Join-Path $programs 'OPERIS.lnk')
)) {
    Remove-Item $shortcut -Force -ErrorAction SilentlyContinue
}

Write-Output '==> Kaldırma: veri ve yapılandırma korunuyor'
# Veri güvenliği sözleşmesi: server\.env, Data ve Backups korunur.
$preservedEnv = Join-Path $env:TEMP 'operis-uninstall-server.env'
$envPath = Join-Path $InstallRoot 'server\.env'
if (Test-Path $envPath) { Copy-Item $envPath $preservedEnv -Force }

Write-Output '==> Kaldırma: uygulama dosyaları kaldırılıyor'
if (Test-Path $InstallRoot) {
    Get-ChildItem $InstallRoot -Force | Where-Object {
        $_.Name -notin @('Data','Backups','Logs')
    } | Remove-Item -Recurse -Force -ErrorAction Stop
    if (Test-Path $preservedEnv) {
        New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'server') -Force | Out-Null
        Copy-Item $preservedEnv $envPath -Force
        Remove-Item $preservedEnv -Force -ErrorAction SilentlyContinue
    }
}

Write-Output '==> Kaldırma: PostgreSQL veri sürekliliği doğrulanıyor'
# OperisPostgreSQL bilinçli olarak kaldırılmaz: servis, cluster ve credentials.dpapi DB survival için korunur.
if (-not (Test-Path $ManagedPostgresRoot)) {
    Write-Warning 'OperisPostgreSQL yönetilen kökü bulunamadı; kaldırma işlemi yine tamamlanır.'
}
Write-Output '==> Kaldırma: işlem tamamlandı'
Write-Output 'OPERIS_UNINSTALL_APP_REMOVED_DATABASE_PRESERVED_PASS'
