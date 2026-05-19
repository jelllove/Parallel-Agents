# Add Spectre-mitigated MSVC libs to existing VS 2022 Build Tools
# Run elevated (or accept the UAC prompt the script triggers).
$ErrorActionPreference = 'Stop'

$setup = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe"
if (-not (Test-Path $setup)) {
    Write-Host "VS Installer not found at $setup" -ForegroundColor Red
    exit 1
}

Write-Host "Adding Spectre-mitigated x64/x86 libs to Build Tools 2022..." -ForegroundColor Cyan
Write-Host "This downloads ~500 MB. A progress UI will appear." -ForegroundColor Yellow

$proc = Start-Process -FilePath $setup -Verb RunAs -ArgumentList @(
    'modify',
    '--productId', 'Microsoft.VisualStudio.Product.BuildTools',
    '--channelId', 'VisualStudio.17.Release',
    '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64.Spectre',
    '--passive',
    '--norestart'
) -Wait -PassThru

Write-Host ("Installer exited with code {0}" -f $proc.ExitCode)
if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    Write-Host "Non-zero exit. Open VS Installer GUI and add Spectre libs manually:" -ForegroundColor Red
    Write-Host "  Individual components -> search 'Spectre' -> tick 'MSVC v143 ... x64/x86 Spectre-mitigated libs (Latest)'" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done. Now run: npx electron-rebuild -f -w node-pty" -ForegroundColor Green
