# Install VS 2022 Build Tools + C++ workload for node-pty compilation
# Run in PowerShell:  .\install-vs-buildtools.ps1
# If blocked by execution policy:  powershell -ExecutionPolicy Bypass -File .\install-vs-buildtools.ps1

$ErrorActionPreference = 'Stop'

Write-Host "=== Step 1/2: Install VS 2022 Build Tools shell via winget ===" -ForegroundColor Cyan
winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
    --accept-source-agreements --accept-package-agreements

Write-Host ""
Write-Host "=== Step 2/2: Add 'Desktop development with C++' workload ===" -ForegroundColor Cyan
Write-Host "This downloads ~3-5 GB and takes 10-20 minutes. A progress UI will appear." -ForegroundColor Yellow

$setup = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe"
if (-not (Test-Path $setup)) {
    Write-Host "ERROR: $setup not found. Step 1 may have failed." -ForegroundColor Red
    exit 1
}

# --passive must be launched elevated. Use -Verb RunAs to trigger UAC.
$proc = Start-Process -FilePath $setup -Verb RunAs -ArgumentList @(
    'modify',
    '--productId', 'Microsoft.VisualStudio.Product.BuildTools',
    '--channelId', 'VisualStudio.17.Release',
    '--add', 'Microsoft.VisualStudio.Workload.VCTools',
    '--includeRecommended',
    '--passive',
    '--norestart'
) -Wait -PassThru
Write-Host ("Installer exited with code {0}" -f $proc.ExitCode)
if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    Write-Host "Installer reported a non-zero exit code. Open Visual Studio Installer GUI to retry." -ForegroundColor Red
}

Write-Host ""
Write-Host "Done. Verifying with vswhere..." -ForegroundColor Cyan
$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    & $vswhere -products * -requires Microsoft.VisualCpp.Tools.HostX64.TargetX64 -property installationPath
}

Write-Host ""
Write-Host "All done. Now go back to your ParallelAgents folder and run: npm install" -ForegroundColor Green
