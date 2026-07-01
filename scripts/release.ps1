# Legacy wrapper — use .\update.ps1 instead
param([switch]$BuildOnly)
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'update.ps1') @PSBoundParameters
