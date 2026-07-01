# Build unsigned Firefox extension zip for AMO signing (manual fallback).
# For automated signing, use: npm run release
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$manifest = Get-Content (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json
$version  = $manifest.version

Write-Host "Building Syncr extension v$version..." -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "Installing dependencies..."
    npm install
}

npm run build:xpi

$built = Get-ChildItem (Join-Path $root 'dist') -Filter 'syncr-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $built) {
    $built = Get-ChildItem (Join-Path $root 'dist') -Filter '*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if (-not $built) {
    Write-Host 'ERROR: No zip produced in dist/' -ForegroundColor Red
    exit 1
}

$outName = "syncr-$version-unsigned.zip"
$outPath = Join-Path $root "dist\$outName"
Copy-Item $built.FullName $outPath -Force

$hash = (Get-FileHash $outPath -Algorithm SHA256).Hash.ToLower()

Write-Host ''
Write-Host 'Done!' -ForegroundColor Green
Write-Host "  Output: dist\$outName"
Write-Host "  SHA-256: $hash"
Write-Host ''
Write-Host 'Tip: use npm run release for fully automated sign + publish.'
