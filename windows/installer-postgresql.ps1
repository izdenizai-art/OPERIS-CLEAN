# Shared by the existing enterprise installer; no entry-point side effects.
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
        $url = Read-OperisDatabaseUrl (Join-Path $root 'server\.env')
        if ($url -match '^postgres(ql)?://') {
            $found += [pscustomobject]@{ Root=$root; Url=$url; SQLite=$null }
        } else {
            if ($url -and -not $url.StartsWith('file:')) { throw 'Desteklenmeyen veritabanı URL türü.' }
            $relative = if ($url) { $url.Substring(5) } else { './yaklasan-isler.db' }
            $file = if ([IO.Path]::IsPathRooted($relative)) { $relative } else { Join-Path (Join-Path $root 'server\prisma') $relative }
            if (Test-Path $file) { $found += [pscustomobject]@{ Root=$root; Url=$url; SQLite=[IO.Path]::GetFullPath($file) } }
        }
    }
    if ($found.Count -gt 1) { throw 'İki OPERIS veritabanı bulundu; otomatik hedef seçimi durduruldu.' }
    if ($found.Count -eq 1) { return $found[0] }
    return $null
}

function Save-OperisPreCutover {
    $script:PreCutoverRoot = Join-Path $BackupsRoot ('PreCutover-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory $script:PreCutoverRoot -Force | Out-Null
    Protect-OperisPrivatePath $script:PreCutoverRoot
    if (-not $script:DatabaseState) { return }
    $previousUrl = $env:DATABASE_URL
    $previousOutput = $env:OPERIS_SQLITE_BACKUP_DIR
    try {
        if ($script:DatabaseState.SQLite) {
            $env:DATABASE_URL = 'file:' + $script:DatabaseState.SQLite
            $env:OPERIS_SQLITE_BACKUP_DIR = $script:PreCutoverRoot
            $raw = & $script:NodePath (Join-Path $SourceRoot 'server\scripts\backup-sqlite-before-postgresql.mjs')
            if ($LASTEXITCODE -ne 0) { throw 'Tutarlı SQLite yedeği alınamadı.' }
            $manifest = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
            if ($manifest.integrityCheck -ne 'ok' -or (Get-FileHash $manifest.backupDb -Algorithm SHA256).Hash -ne $manifest.sha256) { throw 'SQLite yedek doğrulaması başarısız.' }
            $script:SQLiteMigrationSource = $manifest.backupDb
        }
        $envFile = Join-Path $script:DatabaseState.Root 'server\.env'
        if (Test-Path $envFile) { Copy-Item $envFile (Join-Path $script:PreCutoverRoot 'server.env') }
        $data = Join-Path $script:DatabaseState.Root 'Data'
        if (Test-Path $data) { Copy-Item $data (Join-Path $script:PreCutoverRoot 'Data') -Recurse }
    } finally { $env:DATABASE_URL=$previousUrl; $env:OPERIS_SQLITE_BACKUP_DIR=$previousOutput }
}

function Prepare-OperisPostgresql {
    $script:Postgres = Ensure-OperisPostgresql
    if ($script:DatabaseState -and -not $script:DatabaseState.SQLite -and $script:DatabaseState.Url -ne $script:Postgres.DatabaseUrl) {
        throw 'Mevcut PostgreSQL hedefi yönetilen veritabanıyla eşleşmiyor; yapılandırma değiştirilmedi.'
    }
    Protect-OperisPrivatePath (Join-Path $script:Postgres.Root 'credentials.dpapi')
    $env:PATH = $script:Postgres.Bin + ';' + $env:PATH
    if ($script:DatabaseState -and -not $script:DatabaseState.SQLite) {
        & (Join-Path $SourceRoot 'windows\postgresql-backup.ps1') -DatabaseUrl $script:Postgres.DatabaseUrl -DestinationRoot $script:PreCutoverRoot
        $script:PreUpgradePostgresDump = (Get-ChildItem $script:PreCutoverRoot -Filter '*.dump' | Select-Object -First 1).FullName
        if (-not $script:PreUpgradePostgresDump) { throw 'PostgreSQL upgrade yedeği bulunamadı.' }
    }
}

function Initialize-OperisPostgresql {
    $env:DATABASE_URL = $script:Postgres.DatabaseUrl
    if (-not $script:DatabaseState -or $script:DatabaseState.SQLite) {
        $uri = [Uri]$script:Postgres.DatabaseUrl
        $oldPassword = $env:PGPASSWORD
        try {
            $env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Split(':',2)[1])
            $count = & (Join-Path $script:Postgres.Bin 'psql.exe') -X -w -h $uri.Host -p $uri.Port -U operis -d operis -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
            if ($LASTEXITCODE -ne 0 -or [int]$count -ne 0) { throw 'Hedef PostgreSQL boş değil; schema ve veri değiştirilmedi.' }
        } finally { $env:PGPASSWORD=$oldPassword }
    }
    Copy-Item (Join-Path $InstallRoot 'server\prisma\schema.postgresql.prisma') (Join-Path $InstallRoot 'server\prisma\schema.prisma') -Force
    Invoke-Npm (Join-Path $InstallRoot 'server') @('run','prisma:generate')
    Invoke-Npm (Join-Path $InstallRoot 'server') @('run','prisma:push')
    $psql = Join-Path $script:Postgres.Bin 'psql.exe'
    $uri = [Uri]$script:Postgres.DatabaseUrl
    $oldPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Split(':',2)[1])
        & $psql -X -w -h $uri.Host -p $uri.Port -U operis -d operis -v ON_ERROR_STOP=1 -f (Join-Path $InstallRoot 'migration\postgresql-custom.sql') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL özel indeksleri hazırlanamadı.' }
    } finally { $env:PGPASSWORD = $oldPassword }
    if ($script:SQLiteMigrationSource) {
        $env:OPERIS_CONFIRM_SQLITE_MIGRATION='YES'
        $env:OPERIS_SQLITE_MIGRATION_SOURCE=$script:SQLiteMigrationSource
        $env:OPERIS_EXPECTED_TARGET_DATABASE=$uri.AbsolutePath.TrimStart('/')
        $env:OPERIS_MIGRATION_EVIDENCE=Join-Path $script:PreCutoverRoot 'migration-verification.json'
        & $script:NodePath (Join-Path $InstallRoot 'server\scripts\migrate-sqlite-windows.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'SQLite migration doğrulanamadı; provider değiştirilmedi.' }
    }
    # Switch only after migration and full-row verification. Keep the original env in PreCutover.
    $target = Join-Path $InstallRoot 'server\.env'
    $text = Get-Content $target -Raw
    $line = 'DATABASE_URL="' + $script:Postgres.DatabaseUrl + '"'
    $text = [regex]::Replace($text,'(?m)^DATABASE_URL\s*=.*$', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
    if ($text -notmatch '(?m)^DATABASE_URL=') { $text += "`r`n$line" }
    [IO.File]::WriteAllText($target,$text,[Text.UTF8Encoding]::new($false))
    Protect-OperisPrivatePath $target
    Set-Content (Join-Path $InstallRoot 'Data\postgresql-bin.txt') $script:Postgres.Bin
}
