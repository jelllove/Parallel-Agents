[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$SetupArgs
)

$ErrorActionPreference = 'Stop'
$exitCode = 1
Push-Location -LiteralPath (Join-Path $PSScriptRoot '..')
try {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    & $npm.Source run setup -- @SetupArgs
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}
exit $exitCode
