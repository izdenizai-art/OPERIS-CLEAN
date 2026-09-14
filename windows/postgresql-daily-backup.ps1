param(
    [string]$Root = (Join-Path $env:ProgramData 'Operis'),
    [int]$RetentionDays = 30,
    [string]$NetworkEnabled = 'False',
    [string]$NetworkPath = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installer-postgresql.ps1')
$url = Read-OperisDatabaseUrl (Join-Path $Root 'server\.env')
if ($url -notmatch '^postgres(ql)?://') { throw 'PostgreSQL backup requires an active PostgreSQL configuration.' }
$bin = (Get-Content (Join-Path $Root 'Data\postgresql-bin.txt') -Raw).Trim()
if (-not (Test-Path (Join-Path $bin 'pg_dump.exe'))) { throw 'Managed pg_dump missing.' }
$env:PATH = $bin + ';' + $env:PATH
$destination = Join-Path $Root ('Backups\PostgreSQL\Daily-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory $destination -Force | Out-Null
Protect-OperisPrivatePath $destination
$task = Get-ScheduledTask -TaskName OperisEnterpriseServer -ErrorAction SilentlyContinue
$resume = $task -and $task.State -eq 'Running'
try {
    if ($resume) { Stop-ScheduledTask -TaskName OperisEnterpriseServer }
    for ($i=0; $i -lt 30; $i++) {
        if (-not (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Seconds 1
    }
    if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { throw 'Runtime could not be quiesced; backup aborted.' }
    & (Join-Path $PSScriptRoot 'postgresql-backup.ps1') -DatabaseUrl $url -DestinationRoot $destination -RetentionDays $RetentionDays
    $data = Join-Path $Root 'Data'
    if (Test-Path $data) { Copy-Item $data (Join-Path $destination 'Data') -Recurse }
    Add-Type -AssemblyName System.Security
    $envBytes = [IO.File]::ReadAllBytes((Join-Path $Root 'server\.env'))
    try {
        $protected = [Security.Cryptography.ProtectedData]::Protect($envBytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
        [IO.File]::WriteAllBytes((Join-Path $destination 'server.env.dpapi'),$protected)
    } finally { [Array]::Clear($envBytes,0,$envBytes.Length) }
    $files = @(Get-ChildItem $destination -Recurse -File | ForEach-Object {
        @{ path=$_.FullName.Substring($destination.Length+1); bytes=$_.Length; sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash }
    })
    @{ product='OPERIS'; purpose='POSTGRESQL_FULL_BACKUP'; files=$files; configEncryption='DPAPI_LOCAL_MACHINE'; createdAt=(Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json -Depth 6 | Set-Content (Join-Path $destination 'backup-set.json')
    if ($NetworkEnabled -eq 'True') {
        if ($NetworkPath -notmatch '^\\\\[^\\]+\\[^\\]+' -or -not (Test-Path $NetworkPath)) { throw 'Network backup destination unavailable.' }
        Copy-Item $destination $NetworkPath -Recurse
    }
    Get-ChildItem (Split-Path $destination) -Directory -Filter 'Daily-*' |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-[Math]::Max(1,$RetentionDays)) -and (Test-Path (Join-Path $_.FullName 'backup-set.json')) } |
        Remove-Item -Recurse -Force
    Write-Output 'POSTGRESQL_SCHEDULED_FULL_BACKUP_PASS'
} finally {
    if ($resume) { Start-ScheduledTask -TaskName OperisEnterpriseServer }
}
