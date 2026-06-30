@echo off
setlocal
title Syncr Host Installer

echo.
echo   Syncr - Installing native host...
echo.

set "PS1=%~dp0install-host.ps1"

REM Prefer install-host.ps1 sitting next to this bat (downloaded together)
if exist "%PS1%" goto :run

REM Fallback: download to temp (single-line — multiline breaks in .bat)
set "PS1=%TEMP%\syncr-install-host.ps1"
del "%PS1%" 2>nul

echo   Downloading installer from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/Clawb1t/Syncr/main/scripts/install-host.ps1','%PS1%')"

if not exist "%PS1%" (
  echo.
  echo   Failed to download installer script.
  echo   Check your internet connection, or download both files from:
  echo   https://github.com/Clawb1t/Syncr/tree/main/scripts
  pause
  exit /b 1
)

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set ERR=%ERRORLEVEL%

if %ERR% neq 0 (
  echo.
  echo   Install failed.
  pause
  exit /b %ERR%
)

exit /b 0
