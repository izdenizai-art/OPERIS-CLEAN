$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$helper=Join-Path $repo 'windows\sha256.ps1'
if (-not (Test-Path $helper)) { throw "Shared SHA256 helper missing: $helper" }
$probe=Join-Path $env:TEMP ('operis-sha256-' + [guid]::NewGuid().ToString('N') + '.txt')
try {
    [IO.File]::WriteAllText($probe,'OPERIS-PS51-SHA256',[Text.UTF8Encoding]::new($false))
    $expected=[BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($probe)))).Replace('-','')
    $command=". '$($helper.Replace("'","''"))'; `$actual=Get-OperisSha256 '$($probe.Replace("'","''"))'; if (`$actual -ne '$expected') { throw 'SHA256 mismatch' }; Write-Output 'OPERIS_PS51_SHA256_PASS'"
    $output=& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $command
    if ($LASTEXITCODE -ne 0 -or ($output -notcontains 'OPERIS_PS51_SHA256_PASS')) { throw "Windows PowerShell 5.1 SHA256 helper validation failed. exit=$LASTEXITCODE output=$($output -join ' ')" }
    Write-Output 'OPERIS_PS51_SHA256_CONTRACT_PASS'
} finally {
    Remove-Item $probe -Force -ErrorAction SilentlyContinue
}
