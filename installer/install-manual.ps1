$src     = "c:\Users\coal1\OneDrive\Documents\Coal\Syncr"
$install = "C:\Program Files\Syncr"

# Create directories
New-Item -ItemType Directory -Force -Path "$install\activities\youtube-music" | Out-Null
New-Item -ItemType Directory -Force -Path "$install\activities\youtube"        | Out-Null

# Copy files
Copy-Item "$src\installer\dist\syncr-host.exe"                          "$install\"                        -Force
Copy-Item "$src\native-host\activities\youtube-music\presence.js"       "$install\activities\youtube-music\" -Force
Copy-Item "$src\native-host\activities\youtube\presence.js"             "$install\activities\youtube\"       -Force
Copy-Item "$src\native-host\version.json"                               "$install\"                        -Force
Copy-Item "$src\installer\dist\syncr.xpi"                               "$install\"                        -Force

# Write native messaging manifest
$manifest = @"
{
  "name": "syncr",
  "description": "Syncr Native Messaging Host",
  "path": "C:\\Program Files\\Syncr\\syncr-host.exe",
  "type": "stdio",
  "allowed_extensions": ["syncr@clawb1t"]
}
"@
$manifest | Set-Content "$install\syncr.json" -Encoding UTF8

# Write Windows Registry key
New-Item -Path "HKLM:\SOFTWARE\Mozilla\NativeMessagingHosts\syncr" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\Mozilla\NativeMessagingHosts\syncr" -Name "(Default)" -Value "$install\syncr.json"

# Write Firefox enterprise policy
$distDir = "C:\Program Files\Mozilla Firefox\distribution"
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$policy = @"
{
  "policies": {
    "Extensions": {
      "Install": ["file:///C:/Program Files/Syncr/syncr.xpi"]
    }
  }
}
"@
$policy | Set-Content "$distDir\policies.json" -Encoding UTF8

Write-Host "Syncr installed successfully. Restart Firefox to activate." -ForegroundColor Green
