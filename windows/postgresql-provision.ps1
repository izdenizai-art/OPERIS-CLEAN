# PostgreSQL provisioning module. Dot-source, then call Ensure-OperisPostgresql.
# Vendor command options: https://www.enterprisedb.com/docs/supported-open-source/postgresql/installing/command_line_parameters/
. (Join-Path $PSScriptRoot 'sha256-compat.ps1')
function Ensure-OperisPostgresql {
    param(
        [string]$Root = (Join-Path $env:ProgramData 'OperisPostgreSQL'),
        [string]$ServiceName = 'OperisPostgreSQL16',
        [int]$DatabasePort = 5432
    )
    $ErrorActionPreference = 'Stop'
    if ($env:OS -ne 'Windows_NT') { throw 'Windows required.' }
    if ($DatabasePort -lt 1024 -or $DatabasePort -gt 65535) { throw 'Invalid database port.' }
    if ($ServiceName -notmatch '^OperisPostgreSQL[A-Za-z0-9]+$') { throw 'Invalid service identity.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator required.' }

    $provisionMutex = New-Object System.Threading.Mutex($false, 'Global\OPERIS_POSTGRESQL_PROVISION')
    $hasProvisionLock = $false
    try {
        try {
            $hasProvisionLock = $provisionMutex.WaitOne(0, $false)
        } catch [System.Threading.AbandonedMutexException] {
            $hasProvisionLock = $true
        }
        if (-not $hasProvisionLock) {
            throw 'Another OPERIS PostgreSQL provisioning operation is already running.'
        }

        Add-Type -AssemblyName System.Security
        $stateFile = Join-Path $Root 'credentials.dpapi'
        $prefix = Join-Path $Root 'server'
        $data = Join-Path $Root 'data'
        $bin = Join-Path $prefix 'bin'
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        $existingState = Test-Path $stateFile
        if (-not $existingState) {
            if ($service -or (Test-Path $Root)) { throw 'Unowned or incomplete PostgreSQL installation; refusing overwrite.' }
            if (Get-NetTCPConnection -State Listen -LocalPort $DatabasePort -ErrorAction SilentlyContinue) { throw 'PostgreSQL port is already occupied; refusing to replace the existing service.' }
            New-Item -ItemType Directory -Path $Root | Out-Null
            $acl = New-Object Security.AccessControl.DirectorySecurity
            $acl.SetAccessRuleProtection($true, $false)
            foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
                $id = New-Object Security.Principal.SecurityIdentifier($sid)
                $rule = New-Object Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
                $acl.AddAccessRule($rule)
            }
            Set-Acl -Path $Root -AclObject $acl
            $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
            try {
                $bytes = New-Object byte[] 32
                $rng.GetBytes($bytes)
                $adminPassword = ([BitConverter]::ToString($bytes)).Replace('-','')
                $rng.GetBytes($bytes)
                $appPassword = ([BitConverter]::ToString($bytes)).Replace('-','')
            } finally { $rng.Dispose() }
            $state = @{ service = $ServiceName; port = $DatabasePort; root = $Root; adminPassword = $adminPassword; appPassword = $appPassword }
            $plain = [Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Compress))
            $protected = [Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
            [IO.File]::WriteAllBytes($stateFile,$protected)
            [Array]::Clear($plain,0,$plain.Length)
        } else {
            $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($stateFile),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
            try { $state = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json }
            finally { [Array]::Clear($plain,0,$plain.Length) }
            if ($state.port -ne $DatabasePort -or $state.root -ne $Root) { throw 'PostgreSQL identity changed; refusing reuse.' }
            if ($state.service -ne $ServiceName) {
                $storedService = Get-CimInstance Win32_Service -Filter ("Name='" + [string]$state.service + "'") -ErrorAction SilentlyContinue
                if ($storedService -and $storedService.PathName.Contains($prefix) -and $storedService.PathName.Contains($data)) {
                    $ServiceName = [string]$state.service
                    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
                } elseif ($storedService) { throw 'Stored PostgreSQL service points to an unexpected installation.' }
            }
        }
        if (-not $service -and (Test-Path (Join-Path $data 'PG_VERSION'))) {
            $ownedExistingServices = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName.Contains($prefix) -and $_.PathName.Contains($data) })
            if ($ownedExistingServices.Count -eq 1) {
                $service = Get-Service -Name $ownedExistingServices[0].Name -ErrorAction Stop
                $ServiceName = [string]$ownedExistingServices[0].Name
                $state.service = $ServiceName
                $plain = [Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Compress))
                try {
                    $protected = [Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
                    [IO.File]::WriteAllBytes($stateFile,$protected)
                } finally { [Array]::Clear($plain,0,$plain.Length) }
            } else { throw 'Existing cluster without service; automatic recreation refused.' }
        }
        if (-not $service) {
            $installer = Join-Path $Root 'postgresql-16.14-2-windows-x64.exe'
            $expectedHash = '6D3919BC23CFB45E79C6E391DE8B689C32101F2C1B73377AA26E4CE593C0EF28'
            if (-not (Test-Path $installer)) {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $download = Join-Path $Root ('postgresql-16.14-2-windows-x64.exe.download-' + [guid]::NewGuid().ToString('N'))
                try {
                    Invoke-WebRequest 'https://get.enterprisedb.com/postgresql/postgresql-16.14-2-windows-x64.exe' -OutFile $download -UseBasicParsing
                    if ((Get-FileHash $download -Algorithm SHA256).Hash -ne $expectedHash) { throw 'PostgreSQL installer SHA256 mismatch.' }
                    Move-Item $download $installer -Force
                } finally {
                    Remove-Item $download -Force -ErrorAction SilentlyContinue
                }
            }
            if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $expectedHash) { throw 'PostgreSQL installer SHA256 mismatch.' }
            $signature = Get-AuthenticodeSignature $installer
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'EnterpriseDB') { throw 'PostgreSQL publisher signature invalid.' }
            $optionFile = Join-Path $Root 'installer-options.txt'
            $options = @(
                'mode=unattended','unattendedmodeui=none','enable-components=server,commandlinetools',
                'disable-components=pgAdmin,stackbuilder',"prefix=$prefix","datadir=$data",
                "serverport=$DatabasePort","servicename=$ServiceName",'superaccount=postgres',
                "superpassword=$($state.adminPassword)",'serviceaccount=NT AUTHORITY\NetworkService',
                'locale=C','enable_acledit=1','install_runtimes=1','debuglevel=0'
            )
            try {
                [IO.File]::WriteAllLines($optionFile,$options,[Text.UTF8Encoding]::new($false))
                $process = Start-Process $installer -ArgumentList "--optionfile `"$optionFile`"" -Wait -PassThru
                if ($process.ExitCode -ne 0) { throw "PostgreSQL installer failed: exit=$($process.ExitCode)" }
            } finally {
                Remove-Item $optionFile -Force -ErrorAction SilentlyContinue
            }
        }
        foreach ($tool in @('psql.exe','pg_dump.exe','pg_restore.exe','pg_isready.exe')) {
            if (-not (Test-Path (Join-Path $bin $tool))) { throw "Missing PostgreSQL tool: $tool" }
        }
        $serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
        if (-not $serviceInfo) {
            $ownedServices = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName.Contains($prefix) -and $_.PathName.Contains($data) })
            if ($ownedServices.Count -ne 1) { throw 'PostgreSQL service points to an unexpected installation.' }
            $serviceInfo = $ownedServices[0]
            $ServiceName = [string]$serviceInfo.Name
            $state.service = $ServiceName
            $plain = [Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Compress))
            try {
                $protected = [Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
                [IO.File]::WriteAllBytes($stateFile,$protected)
            } finally { [Array]::Clear($plain,0,$plain.Length) }
        }
        if (-not $serviceInfo.PathName.Contains($prefix) -or -not $serviceInfo.PathName.Contains($data)) { throw 'PostgreSQL service points to an unexpected installation.' }
        Set-Service -Name $ServiceName -StartupType Automatic
        Start-Service -Name $ServiceName
        $oldPassword = $env:PGPASSWORD
        $env:PGPASSWORD = $state.adminPassword
        try {
            $psql = Join-Path $bin 'psql.exe'
            $pgArgs = @('-X','-w','-h','127.0.0.1','-p',"$DatabasePort",'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-t','-A')
            $version = & $psql @pgArgs -c 'SHOW server_version_num'
            if ($LASTEXITCODE -ne 0 -or [int]$version -lt 160000 -or [int]$version -ge 170000) { throw 'PostgreSQL 16 connection validation failed.' }
            $roleExists = & $psql @pgArgs -c "SELECT count(*) FROM pg_roles WHERE rolname='operis'"
            if ($LASTEXITCODE -ne 0) { throw 'Role lookup failed.' }
            if ([int]$roleExists -eq 0) {
                "CREATE ROLE operis LOGIN PASSWORD '$($state.appPassword)' NOSUPERUSER NOCREATEDB NOCREATEROLE;" | & $psql @pgArgs | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Application role creation failed.' }
            }
            $dbExists = & $psql @pgArgs -c "SELECT count(*) FROM pg_database WHERE datname='operis'"
            if ($LASTEXITCODE -ne 0) { throw 'Database lookup failed.' }
            if ([int]$dbExists -eq 0) {
                & $psql @pgArgs -c 'CREATE DATABASE operis OWNER operis' | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Application database creation failed.' }
            }
            $env:PGPASSWORD = $state.appPassword
            & $psql -X -w -h 127.0.0.1 -p $DatabasePort -U operis -d operis -v ON_ERROR_STOP=1 -c 'SELECT 1' | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Application database connection failed.' }
        } finally { $env:PGPASSWORD = $oldPassword }
        return [pscustomobject]@{
            Bin = $bin; Service = $ServiceName; Port = $DatabasePort; Root = $Root
            DatabaseUrl = "postgresql://operis:$($state.appPassword)@127.0.0.1:$DatabasePort/operis?schema=public"
        }
    } finally {
        if ($hasProvisionLock) {
            try { $provisionMutex.ReleaseMutex() } catch {}
        }
        $provisionMutex.Dispose()
    }
}
