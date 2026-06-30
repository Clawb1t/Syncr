@echo off
title Syncr Host Installer

echo.
echo   Syncr - Downloading and installing native host...
echo.

set "PS1=%TEMP%\syncr-install-host.ps1"
del "%PS1%" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Clawb1t/Syncr/main/scripts/install-host.ps1' -OutFile '%PS1%' -UseBasicParsing } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"

if not exist "%PS1%" (
  echo.
  echo   Failed to download installer script. Check your internet connection.
  echo   You can also run install-host.ps1 from the Syncr GitHub repo manually.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set ERR=%ERRORLEVEL%

if %ERR% neq 0 (
  echo.
  echo   Install failed.
  pause
  exit /b %ERR%
)

exit /b 0
