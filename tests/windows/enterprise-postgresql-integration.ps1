param([ValidateSet('clean','legacy')][string]$Scenario='clean')
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:OS -ne 'Windows_NT') { throw 'Disposable Windows runner required.' }
$repo=$env:GITHUB_WORKSPACE
$source=Join-Path $env:RUNNER_TEMP 'OperisInstallerSource'
$archive=Join-Path $env:RUNNER_TEMP 'operis-source.zip'
git archive --format=zip --output=$archive HEAD
Expand-Archive $archive $source
$root=Join-Path $env:ProgramData 'Operis'
if (Test-Path $root) { throw 'Test requires a clean OPERIS installation root.' }
$ip=Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } | Select-Object -First 1
if (-not $ip) { throw 'No test IPv4 address available.' }
Set-Content (Join-Path $source 'OPERIS_SERVER_CONFIG.ini') "BIND_IP=$($ip.IPAddress)`nFORCE_CLEAN_INSTALL=NO"
$evidence=Join-Path $env:RUNNER_TEMP 'operis-installer-evidence'
New-Item -ItemType Directory $evidence -Force | Out-Null
if ($Scenario -eq 'legacy') {
    New-Item -ItemType Directory (Join-Path $root 'server\prisma') -Force | Out-Null
    New-Item -ItemType Directory (Join-Path $root 'Data\helpdesk-attachments') -Force | Out-Null
    $env:DATABASE_URL='file:'+(Join-Path $root 'server\prisma\yaklasan-isler.db')
    Push-Location (Join-Path $repo 'server')
    try {
        npm.cmd ci --no-audit --no-fund
        npx.cmd prisma generate --schema prisma/schema.sqlite.prisma
        npx.cmd prisma db push --schema prisma/schema.sqlite.prisma --skip-generate
        node scripts/seed-migration-smoke.mjs
    } finally { Pop-Location }
    $jwt=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $key=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    Write-Output "::add-mask::$jwt"
    Write-Output "::add-mask::$key"
    Set-Content (Join-Path $root 'server\.env') "DATABASE_URL=file:./yaklasan-isler.db`nJWT_SECRET=$jwt`nDATA_ENCRYPTION_KEY=$key"
    Set-Content (Join-Path $root 'Data\helpdesk-attachments\sentinel.txt') 'preserve attachment'
    Remove-Item Env:DATABASE_URL
}
function Invoke-TestInstall {
    $process=Start-Process powershell.exe -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$source\windows\install-enterprise.ps1`"" -Environment @{ PSModulePath=$null } -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Main enterprise installer failed, exit=$($process.ExitCode)." }
}
Invoke-TestInstall
$health=Invoke-RestMethod "http://$($ip.IPAddress):3001/api/health"
if (-not $health.ok -or $health.database.provider -ne 'postgresql' -or -not $health.database.connected) { throw 'Installed PostgreSQL health failed.' }
if ($Scenario -eq 'clean' -and (Test-Path (Join-Path $root 'server\prisma\yaklasan-isler.db'))) { throw 'Clean install created a SQLite production database.' }
if ($Scenario -eq 'legacy') {
    $status=Invoke-RestMethod "http://$($ip.IPAddress):3001/api/auth/status"
    if (-not $status.hasUsers) { throw 'Migrated user missing.' }
    $login=Invoke-RestMethod "http://$($ip.IPAddress):3001/api/auth/login" -Method Post -ContentType application/json -Body '{"username":"balamir","password":"OperisCi123!"}'
    if ($login.user.username -ne 'balamir') { throw 'Migrated login failed.' }
    if ((Get-Content (Join-Path $root 'Data\helpdesk-attachments\sentinel.txt') -Raw).Trim() -ne 'preserve attachment') { throw 'Attachment missing.' }
}
$before=(Get-FileHash (Join-Path $env:ProgramData 'OperisPostgreSQL\credentials.dpapi')).Hash
Invoke-TestInstall
if ((Get-FileHash (Join-Path $env:ProgramData 'OperisPostgreSQL\credentials.dpapi')).Hash -ne $before) { throw 'Reinstall changed credentials.' }
$health=Invoke-RestMethod "http://$($ip.IPAddress):3001/api/health"
if (-not $health.ok -or $health.database.provider -ne 'postgresql') { throw 'Reinstall health failed.' }
& (Join-Path $root 'windows\postgresql-daily-backup.ps1')
$set=Get-ChildItem (Join-Path $root 'Backups\PostgreSQL') -Filter backup-set.json -Recurse | Select-Object -Last 1
if (-not $set) { throw 'Full backup set missing.' }
$manifest=Get-Content $set.FullName -Raw | ConvertFrom-Json
foreach ($file in $manifest.files) {
    if ((Get-FileHash (Join-Path $set.DirectoryName $file.path) -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Backup file hash mismatch.' }
}
$dump=Get-ChildItem $set.DirectoryName -Filter '*.dump' | Select-Object -First 1
Add-Type -AssemblyName System.Security
$plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $env:ProgramData 'OperisPostgreSQL\credentials.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
try { $state=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json } finally { [Array]::Clear($plain,0,$plain.Length) }
Write-Output "::add-mask::$($state.adminPassword)"
$adminUrl="postgresql://postgres:$($state.adminPassword)@127.0.0.1:5432/postgres"
Write-Output "::add-mask::$adminUrl"
$env:PATH=(Join-Path $env:ProgramData 'OperisPostgreSQL\server\bin')+';'+$env:PATH
& (Join-Path $root 'windows\postgresql-restore-test.ps1') -AdminDatabaseUrl $adminUrl -BackupFile $dump.FullName
@{sourceSha=$env:GITHUB_SHA; scenario=$Scenario; mainInstaller='PASS'; reinstall='PASS'; postgresqlHealth='PASS'; backupHashes='PASS'; isolatedRestore='PASS'; exeLifecycle='NOT_TESTED'} |
    ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
Write-Output "ENTERPRISE_POSTGRESQL_${Scenario}_INTEGRATION_PASS"
