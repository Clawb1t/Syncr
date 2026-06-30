# Syncr Native Host Installer
# Installs to %LOCALAPPDATA%\Syncr (no admin required)
# Registers HKCU native messaging for Firefox

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$GITHUB_USER   = 'Clawb1t'
$GITHUB_REPO   = 'Syncr'
$GITHUB_BRANCH = 'main'
$RAW           = "https://raw.githubusercontent.com/$GITHUB_USER/$GITHUB_REPO/$GITHUB_BRANCH"
$API           = "https://api.github.com/repos/$GITHUB_USER/$GITHUB_REPO/releases/latest"

$InstallDir = Join-Path $env:LOCALAPPDATA 'Syncr'
$HostExe    = Join-Path $InstallDir 'syncr-host.exe'
$Manifest   = Join-Path $InstallDir 'syncr.json'
$ActsDir    = Join-Path $InstallDir 'activities'
$Activities = @('youtube', 'youtube-music')

Write-Host ''
Write-Host '  Syncr — Installing native host...' -ForegroundColor Cyan
Write-Host ''

# Directories
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
foreach ($act in $Activities) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ActsDir $act) | Out-Null
}

# Latest release — syncr-host.exe
Write-Host '  Fetching latest release...'
$release = Invoke-RestMethod -Uri $API -Headers @{ 'User-Agent' = 'Syncr-Installer/1.0' }
$hostAsset = $release.assets | Where-Object { $_.name -eq 'syncr-host.exe' } | Select-Object -First 1
if (-not $hostAsset) {
    Write-Host '  ERROR: syncr-host.exe not found in latest GitHub release.' -ForegroundColor Red
    Write-Host '  Upload syncr-host.exe to your GitHub release and try again.'
    Read-Host '  Press Enter to close'
    exit 1
}

Write-Host "  Downloading syncr-host.exe (v$($release.tag_name))..."
Invoke-WebRequest -Uri $hostAsset.browser_download_url -OutFile $HostExe -UseBasicParsing

# Activity presence files + version
foreach ($act in $Activities) {
    $url  = "$RAW/native-host/activities/$act/presence.js"
    $dest = Join-Path $ActsDir "$act/presence.js"
    Write-Host "  Downloading $act/presence.js..."
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

Write-Host '  Downloading version.json...'
Invoke-WebRequest -Uri "$RAW/native-host/version.json" -OutFile (Join-Path $InstallDir 'version.json') -UseBasicParsing

# Native messaging manifest
$manifestObj = @{
    name                 = 'syncr'
    description          = 'Syncr Native Messaging Host'
    path                 = $HostExe
    type                 = 'stdio'
    allowed_extensions   = @('syncr@clawb1t')
}
$manifestObj | ConvertTo-Json -Depth 3 | Set-Content -Path $Manifest -Encoding UTF8

# Register with Firefox (HKCU — no admin)
Write-Host '  Registering native messaging host...'
$regKey = 'HKCU:\Software\Mozilla\NativeMessagingHosts\syncr'
New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty -Path $regKey -Name '(Default)' -Value $Manifest

Write-Host ''
Write-Host '  Done! Syncr host installed to:' -ForegroundColor Green
Write-Host "  $InstallDir"
Write-Host ''
Write-Host '  Return to Firefox — the Syncr popup should show Connected.'
Write-Host ''
Read-Host '  Press Enter to close'
