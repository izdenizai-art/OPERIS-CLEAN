# Shared by the existing enterprise installer; no entry-point side effects.
. (Join-Path $PSScriptRoot 'sha256-compat.ps1')
. (Join-Path $PSScriptRoot 'postgresql-provision.ps1')

function Protect-OperisPrivatePath([string]$Path) {
    $item = Get-Item $Path
    $acl = if ($item.PSIsContainer) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
        $id = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = if ($item.PSIsContainer) {
            New-Object Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        } else { New-Object Security.AccessControl.FileSystemAccessRule($id,'FullControl','Allow') }
        $acl.AddAccessRule($rule)
    }
    Set-Acl $Path $acl
}

function Read-OperisDatabaseUrl([string]$EnvFile) {
    if (-not (Test-Path $EnvFile)) { return '' }
    $lines = @(Get-Content $EnvFile | Where-Object { $_ -match '^DATABASE_URL\s*=' })
    if ($lines.Count -gt 1) { throw 'Birden fazla DATABASE_URL bulundu.' }
    if ($lines.Count -eq 0) { return '' }
    return (($lines[0] -split '=',2)[1]).Trim().Trim('"').Trim("'")
}

function Find-OperisDatabaseState {
    $found = @()
    foreach ($root in @($InstallRoot,(Join-Path $env:ProgramData 'YaklasanIsler'))) {
        $envFile = Join-Path $root 'server\.env'
        if (-not (Test-Path $envFile)) { continue }
        $url = Read-OperisDatabaseUrl $envFile
        if ([string]::IsNullOrWhiteSpace($url)) { continue }
        if ($url -match '^postgres(ql)?://') {
            $found += [pscustomobject]@{ Root=$root; Url=$url }
            continue
        }
        Write-Log "PostgreSQL-only kurulum eski dosya tabanlı veritabanı URL'sini yok sayıyor: $root" "WARN"
    }
    if ($found.Count -gt 1) { throw 'İki OPERIS PostgreSQL yapılandırması bulundu; otomatik hedef seçimi durduruldu.' }
    if ($found.Count -eq 1) { return $found[0] }
    return $null
}

function Save-OperisPreCutover {
    $script:PreCutoverRoot = Join-Path $BackupsRoot ('PreCutover-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory $script:PreCutoverRoot -Force | Out-Null
    Protect-OperisPrivatePath $script:PreCutoverRoot
    if (-not $script:DatabaseState) { return }

    $envFile = Join-Path $script:DatabaseState.Root 'server\.env'
    if (Test-Path $envFile) { Copy-Item $envFile (Join-Path $script:PreCutoverRoot 'server.env') -Force }
    $data = Join-Path $script:DatabaseState.Root 'Data'
    if (Test-Path $data) { Copy-Item $data (Join-Path $script:PreCutoverRoot 'Data') -Recurse -Force }
}

function Prepare-OperisPostgresql {
    $bundledInstaller = Join-Path $SourceRoot 'vendor\postgresql\postgresql-16.14-2-windows-x64.exe'
    $script:Postgres = Ensure-OperisPostgresql -BundledInstallerPath $bundledInstaller

    if ($script:DatabaseState -and $script:DatabaseState.Url -ne $script:Postgres.DatabaseUrl) {
        throw 'Mevcut PostgreSQL hedefi yönetilen veritabanıyla eşleşmiyor; yapılandırma değiştirilmedi.'
    }

    Protect-OperisPrivatePath (Join-Path $script:Postgres.Root 'credentials.dpapi')
    $env:PATH = $script:Postgres.Bin + ';' + $env:PATH

    if ($script:DatabaseState) {
        & (Join-Path $SourceRoot 'windows\postgresql-backup.ps1') -DatabaseUrl $script:Postgres.DatabaseUrl -DestinationRoot $script:PreCutoverRoot
        $script:PreUpgradePostgresDump = (Get-ChildItem $script:PreCutoverRoot -Filter '*.dump' | Select-Object -First 1).FullName
        if (-not $script:PreUpgradePostgresDump) { throw 'PostgreSQL upgrade yedeği bulunamadı.' }
    }
}

function Initialize-OperisPostgresql {
    $env:DATABASE_URL = $script:Postgres.DatabaseUrl
    $uri = [Uri]$script:Postgres.DatabaseUrl

    if (-not $script:DatabaseState) {
        $oldPassword = $env:PGPASSWORD
        try {
            $env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Split(':',2)[1])
            $count = & (Join-Path $script:Postgres.Bin 'psql.exe') -X -w -h $uri.Host -p $uri.Port -U operis -d operis -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
            if ($LASTEXITCODE -ne 0 -or [int]$count -ne 0) {
                throw 'Hedef PostgreSQL boş değil; temiz kurulum mevcut veriyi değiştirmedi.'
            }
        } finally {
            $env:PGPASSWORD = $oldPassword
        }
    }

    Invoke-Npm (Join-Path $InstallRoot 'server') @('run','prisma:generate')
    Invoke-Npm (Join-Path $InstallRoot 'server') @('run','prisma:push')

    $psql = Join-Path $script:Postgres.Bin 'psql.exe'
    $oldPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Split(':',2)[1])
        & $psql -X -w -h $uri.Host -p $uri.Port -U operis -d operis -v ON_ERROR_STOP=1 -f (Join-Path $InstallRoot 'migration\postgresql-custom.sql') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL özel indeksleri hazırlanamadı.' }
    } finally {
        $env:PGPASSWORD = $oldPassword
    }

    $target = Join-Path $InstallRoot 'server\.env'
    $text = Get-Content $target -Raw
    $line = 'DATABASE_URL="' + $script:Postgres.DatabaseUrl + '"'
    if ($text -match '(?m)^DATABASE_URL\s*=') {
        $text = [regex]::Replace($text,'(?m)^DATABASE_URL\s*=.*$', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
    } else {
        $text += [Environment]::NewLine + $line
    }
    [IO.File]::WriteAllText($target,$text.Trim()+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    Protect-OperisPrivatePath $target
    Set-Content (Join-Path $InstallRoot 'Data\postgresql-bin.txt') $script:Postgres.Bin
}

