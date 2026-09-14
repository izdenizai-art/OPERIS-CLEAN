param()
$ErrorActionPreference='Stop'
$windows=Join-Path $PSScriptRoot '..\..\windows'
$compat=Join-Path $windows 'sha256-compat.ps1'
if (-not (Test-Path $compat)) { throw 'sha256-compat.ps1 missing.' }
$env:PSModulePath=''
. $compat
$temp=Join-Path $env:TEMP 'operis-ps51-sha256-test.txt'
[IO.File]::WriteAllText($temp,'OPERIS-PS51-SHA256',[Text.UTF8Encoding]::new($false))
try {
    $actual=(Get-FileHash $temp -Algorithm SHA256).Hash
    $expected='B959C4198995DA59749840C549BAA30D411DE31D5CD8E94FD42BFAC8377BB30E'
    if ($actual -ne $expected) { throw "SHA256 mismatch: $actual" }

    $uncovered=@()
    Get-ChildItem $windows -Filter '*.ps1' -File | ForEach-Object {
        $text=Get-Content $_.FullName -Raw
        if ($_.Name -ne 'sha256-compat.ps1' -and $text -match '\bGet-FileHash\b') {
            if ($text -notmatch 'sha256-compat\.ps1' -and $text -notmatch 'installer-postgresql\.ps1') {
                $uncovered += $_.Name
            }
        }
    }
    if ($uncovered.Count -gt 0) { throw ('Uncovered Windows runtime Get-FileHash path(s): ' + ($uncovered -join ', ')) }
    Write-Output 'PS51_SHA256_COMPAT_PASS'
    Write-Output 'WINDOWS_RUNTIME_HASH_COVERAGE_PASS'
} finally {
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
}
