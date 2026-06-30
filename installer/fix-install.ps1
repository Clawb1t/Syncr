$install = "C:\ProgramData\Syncr"

# 1 — Ensure directories exist
New-Item -ItemType Directory -Force -Path "$install\activities\youtube-music" | Out-Null
New-Item -ItemType Directory -Force -Path "$install\activities\youtube"        | Out-Null

# 2 — Copy files from wherever they ended up
$src = "C:\Program Files (x86)\Syncr"
if (Test-Path "$src\syncr-host.exe") {
    Copy-Item "$src\syncr-host.exe"                              "$install\" -Force
    Copy-Item "$src\activities\youtube-music\presence.js"        "$install\activities\youtube-music\" -Force
    Copy-Item "$src\activities\youtube\presence.js"              "$install\activities\youtube\" -Force
    Copy-Item "$src\version.json"                                "$install\" -Force
    Copy-Item "$src\syncr.xpi"                                   "$install\" -Force
    Write-Host "Copied files from Program Files (x86)\Syncr"
} else {
    $dev = "c:\Users\coal1\OneDrive\Documents\Coal\Syncr"
    Copy-Item "$dev\installer\dist\syncr-host.exe"                          "$install\" -Force
    Copy-Item "$dev\native-host\activities\youtube-music\presence.js"       "$install\activities\youtube-music\" -Force
    Copy-Item "$dev\native-host\activities\youtube\presence.js"             "$install\activities\youtube\" -Force
    Copy-Item "$dev\native-host\version.json"                               "$install\" -Force
    Copy-Item "$dev\installer\dist\syncr.xpi"                               "$install\" -Force
    Write-Host "Copied files from dev folder"
}

# 3 — Write correct syncr.json manifest
@"
{
  "name": "syncr",
  "description": "Syncr Native Messaging Host",
  "path": "C:\\ProgramData\\Syncr\\syncr-host.exe",
  "type": "stdio",
  "allowed_extensions": ["syncr@clawb1t"]
}
"@ | Set-Content "$install\syncr.json" -Encoding UTF8

# 4 — Fix BOTH registry hives to point to the correct path
$json = "$install\syncr.json"

# 64-bit hive (read by 64-bit Firefox)
New-Item -Path "HKLM:\SOFTWARE\Mozilla\NativeMessagingHosts\syncr" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\Mozilla\NativeMessagingHosts\syncr" -Name "(Default)" -Value $json

# 32-bit hive (read by 32-bit Firefox)
New-Item -Path "HKLM:\SOFTWARE\WOW6432Node\Mozilla\NativeMessagingHosts\syncr" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Mozilla\NativeMessagingHosts\syncr" -Name "(Default)" -Value $json

Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
Get-ChildItem "C:\ProgramData\Syncr" -Recurse | Select-Object -ExpandProperty FullName
Write-Host ""
Write-Host "64-bit registry: $((Get-ItemProperty 'HKLM:\SOFTWARE\Mozilla\NativeMessagingHosts\syncr').'(default)')"
Write-Host "32-bit registry: $((Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Mozilla\NativeMessagingHosts\syncr').'(default)')"
Write-Host ""
Write-Host "Done! Restart Firefox." -ForegroundColor Green
