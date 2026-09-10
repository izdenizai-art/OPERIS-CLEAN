param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [string]$Username = $env:OPERIS_STAGING_ADMIN_USERNAME,
  [string]$TestEmail = "",
  [string]$AssetConnectionId = "",
  [string]$NetworkMonitorId = "",
  [ValidateSet("true","false")][string]$TestDomain = "false",
  [ValidateSet("true","false")][string]$TestSmtp = "false",
  [ValidateSet("true","false")][string]$TestGraph = "false",
  [ValidateSet("true","false")][string]$TestMssql = "false",
  [ValidateSet("true","false")][string]$TestSnmp = "false"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')
$Password = $env:OPERIS_STAGING_ADMIN_PASSWORD

if (-not $Username) {
  throw "OPERIS staging admin username tanımlı değil."
}
if (-not $Password) {
  throw "OPERIS staging admin password tanımlı değil."
}

if ($BaseUrl -match '(?i)(localhost|127\.0\.0\.1|0\.0\.0\.0)') {
  throw "Self-hosted integration smoke için public/LAN staging URL bekleniyor."
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{
  username = $Username
  password = $Password
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri "$BaseUrl/api/auth/login" `
  -ContentType "application/json" `
  -Body $loginBody `
  -WebSession $session

if ($login.user.username -ne $Username) {
  throw "Login kullanıcı adı uyuşmuyor."
}

$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" -WebSession $session
if (-not $health.ok -or $health.database.connected -ne $true -or $health.database.provider -ne "postgresql") {
  throw "Staging health PostgreSQL/connected doğrulamasından geçmedi."
}

$results = [ordered]@{
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
  health = "PASS"
  login = "PASS"
  domain = "SKIP"
  smtp = "SKIP"
  graph = "SKIP"
  mssql = "SKIP"
  snmp = "SKIP"
}

if ($TestDomain -eq "true") {
  $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/domain-sync/test" -WebSession $session
  if (-not $r.ok) { throw "AD/DC test endpoint başarısız." }
  $results.domain = "PASS"
}

if ($TestSmtp -eq "true") {
  $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/mail-settings/verify" -WebSession $session
  if (-not $r.ok) { throw "SMTP verify endpoint başarısız." }

  if ($TestEmail) {
    $body = @{ email = $TestEmail } | ConvertTo-Json
    $t = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/mail-settings/test" -ContentType "application/json" -Body $body -WebSession $session
    if (-not $t.ok) { throw "SMTP test e-postası başarısız." }
  }
  $results.smtp = "PASS"
}

if ($TestGraph -eq "true") {
  if (-not $TestEmail) { throw "Graph test için TestEmail zorunludur." }
  $body = @{ email = $TestEmail } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/graph-mail-settings/test" -ContentType "application/json" -Body $body -WebSession $session
  if (-not $r.ok) { throw "Microsoft Graph mail test endpoint başarısız." }
  $results.graph = "PASS"
}

if ($TestMssql -eq "true") {
  if (-not $AssetConnectionId) { throw "MSSQL test için AssetConnectionId zorunludur." }
  $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/assets/external-connections/$AssetConnectionId/test" -WebSession $session
  if (-not $r.ok) { throw "Demirbaş MSSQL connection test endpoint başarısız." }
  $results.mssql = "PASS"
}

if ($TestSnmp -eq "true") {
  if (-not $NetworkMonitorId) { throw "SNMP test için NetworkMonitorId zorunludur." }
  $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/network-monitors/$NetworkMonitorId/snmp/test" -WebSession $session
  if (-not $r.ok) { throw "SNMP test endpoint başarısız." }
  $results.snmp = "PASS"
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path "operis-integration-smoke-summary.json" -Encoding UTF8
Write-Host "OPERIS_INTEGRATION_SMOKE_PASS"
$results | Format-List
