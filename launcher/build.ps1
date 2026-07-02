$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'scripts\configure-win-codesign.ps1')
Configure-WinCodeSign -Root $root

Set-Location $PSScriptRoot
bun run build 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'build-log.txt')
