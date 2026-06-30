@echo off
title Syncr Host Installer
cd /d "%~dp0"

echo.
echo   Syncr - Installing native host...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-host.ps1"
set ERR=%ERRORLEVEL%

if %ERR% neq 0 (
  echo.
  echo   Install failed. See errors above.
  pause
  exit /b %ERR%
)

exit /b 0
