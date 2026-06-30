@echo off
title Syncr Host Installer

echo.
echo   Syncr - Downloading and installing native host...
echo.

set "PS1=%TEMP%\syncr-install-host.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Clawb1t/Syncr/main/scripts/install-host.ps1' -OutFile '%PS1%' -UseBasicParsing; if ($LASTEXITCODE -ne 0) { exit 1 }"

if errorlevel 1 (
  echo   Failed to download installer script. Check your internet connection.
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
