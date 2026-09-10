$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This test requires an isolated GitHub Windows runner.' }
$file = Join-Path $PSScriptRoot '..\..\windows\install-enterprise.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Installer parse failed' }
# Execute the actual bootstrap functions without invoking application installation.
foreach ($name in @('Refresh-Path', 'Find-Node', 'Install-NodeFromOfficialMsi')) {
    $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $function) { throw "Missing installer function: $name" }
    . ([scriptblock]::Create($function.Extent.Text))
}
function Write-Log([string]$Message, [string]$Level = 'INFO') { Write-Host "$Level $Message" }
function Write-Step([string]$Message) { Write-Host $Message }
$node = Install-NodeFromOfficialMsi
$version = (& $node --version).Trim()
if ($version -ne 'v24.21.0') { throw "Unexpected bootstrap runtime: $version" }
Write-Host "NODE_MSI_BOOTSTRAP_PASS=$version"
