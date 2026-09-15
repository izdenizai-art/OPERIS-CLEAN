param(
    [Parameter(Mandatory = $true)][string]$PayloadRoot
)
$ErrorActionPreference = 'Stop'

# The setup EXE is launched from a PowerShell 7-hosted CI process, so Windows
# PowerShell 5.1 can inherit the PowerShell 7 module path. Remove only that
# incompatible path and ensure the native Windows module roots are present.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $paths = @($env:PSModulePath -split ';' | Where-Object {
        $_ -and $_ -notmatch '(?i)\\PowerShell\\7\\Modules\\?$'
    })
    foreach ($native in @(
        (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
        (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules')
    )) {
        if ($paths -notcontains $native) { $paths += $native }
    }
    $env:PSModulePath = ($paths | Select-Object -Unique) -join ';'
}

$hashCompat = Join-Path $PayloadRoot 'windows\sha256-compat.ps1'
if (-not (Test-Path $hashCompat)) { throw "SHA256 uyumluluk katmanı bulunamadı: $hashCompat" }
. $hashCompat

$configPath = Join-Path $PayloadRoot 'OPERIS_SERVER_CONFIG.ini'
if (-not (Test-Path $configPath)) { throw "OPERIS_SERVER_CONFIG.ini bulunamadı: $configPath" }
$config = Get-Content $configPath -Raw

$localIPv4 = @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object {
            $_.IPAddress -ne '127.0.0.1' -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.IPAddress -ne '0.0.0.0' -and
            $_.AddressState -eq 'Preferred'
        } |
        Sort-Object InterfaceMetric, SkipAsSource, InterfaceIndex, IPAddress
)
if ($localIPv4.Count -eq 0) { throw 'Otomatik kurulum için kullanılabilir IPv4 bulunamadı.' }

$selectedIp = $null
$explicitIp = ([string]$env:OPERIS_EXPLICIT_BIND_IP).Trim()
if (-not [string]::IsNullOrWhiteSpace($explicitIp)) {
    if (-not ($localIPv4 | Where-Object { $_.IPAddress -eq $explicitIp } | Select-Object -First 1)) {
        throw "Bu setup oturumunda seçilen IP aktif bir local IPv4 değil: $explicitIp"
    }
    $selectedIp = $explicitIp
}

# UPDATE/REPAIR priority: preserve the currently working binding unless this
# setup session explicitly requested another local address.
$existingBinding = $null
$existingBindingPath = Join-Path $env:ProgramData 'Operis\Data\NetworkBinding.json'
if (-not $selectedIp -and (Test-Path $existingBindingPath)) {
    try {
        $existingBinding = Get-Content $existingBindingPath -Raw | ConvertFrom-Json
        $existingIp = ([string]$existingBinding.ipAddress).Trim()
        if (-not [string]::IsNullOrWhiteSpace($existingIp) -and
            ($localIPv4 | Where-Object { $_.IPAddress -eq $existingIp } | Select-Object -First 1)) {
            $selectedIp = $existingIp
        }
    } catch {
        $existingBinding = $null
    }
}

if ($selectedIp) {
    $config = [regex]::Replace($config, '(?m)^BIND_IP=.*$', "BIND_IP=$selectedIp")
    Set-Content -Path $configPath -Value $config -Encoding UTF8
}
elseif ($config -match '(?m)^BIND_IP=ASK\s*$') {
    # Silent/setup automation fallback remains deterministic for clean installs.
    $ip = $localIPv4 | Select-Object -First 1 -ExpandProperty IPAddress
    $config = $config -replace '(?m)^BIND_IP=ASK\s*$', "BIND_IP=$ip"
    Set-Content -Path $configPath -Value $config -Encoding UTF8
}

$installer = Join-Path $PayloadRoot 'windows\install-enterprise.ps1'
if (-not (Test-Path $installer)) { throw "Ana installer bulunamadı: $installer" }
& $installer
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
