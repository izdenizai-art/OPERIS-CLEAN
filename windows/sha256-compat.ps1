# PowerShell 5.1-compatible SHA256 implementation used by OPERIS Windows runtime scripts.
# This intentionally keeps the Get-FileHash call contract used by the existing installer.
function global:Get-FileHash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true, Position=0)][string]$Path,
        [ValidateSet('SHA256')][string]$Algorithm = 'SHA256'
    )

    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $stream = [System.IO.File]::Open($resolved, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash($stream)
        $hash = ([System.BitConverter]::ToString($bytes)).Replace('-', '')
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }

    [pscustomobject]@{
        Algorithm = 'SHA256'
        Hash = $hash
        Path = $resolved
    }
}
