@echo off
echo Installing Syncr...

set SRC=c:\Users\coal1\OneDrive\Documents\Coal\Syncr
set INSTALL=C:\Program Files\Syncr

:: Create directories
mkdir "%INSTALL%\activities\youtube-music" 2>nul
mkdir "%INSTALL%\activities\youtube" 2>nul

:: Copy files
copy /Y "%SRC%\installer\dist\syncr-host.exe" "%INSTALL%\"
copy /Y "%SRC%\native-host\activities\youtube-music\presence.js" "%INSTALL%\activities\youtube-music\"
copy /Y "%SRC%\native-host\activities\youtube\presence.js" "%INSTALL%\activities\youtube\"
copy /Y "%SRC%\native-host\version.json" "%INSTALL%\"
copy /Y "%SRC%\installer\dist\syncr.xpi" "%INSTALL%\"

:: Write native messaging manifest
(
echo {
echo   "name": "syncr",
echo   "description": "Syncr Native Messaging Host",
echo   "path": "C:\\Program Files\\Syncr\\syncr-host.exe",
echo   "type": "stdio",
echo   "allowed_extensions": ["syncr@clawb1t"]
echo }
) > "%INSTALL%\syncr.json"

:: Register native messaging host
reg add "HKLM\SOFTWARE\Mozilla\NativeMessagingHosts\syncr" /ve /t REG_SZ /d "%INSTALL%\syncr.json" /f

:: Write Firefox enterprise policy
mkdir "C:\Program Files\Mozilla Firefox\distribution" 2>nul
(
echo {
echo   "policies": {
echo     "Extensions": {
echo       "Install": ["file:///C:/Program%%20Files/Syncr/syncr.xpi"]
echo     }
echo   }
echo }
) > "C:\Program Files\Mozilla Firefox\distribution\policies.json"

echo.
echo Done! Restart Firefox to activate Syncr.
pause
