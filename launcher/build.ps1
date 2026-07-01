$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Set-Location $PSScriptRoot
npm run build 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'build-log.txt')
