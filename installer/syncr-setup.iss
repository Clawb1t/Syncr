; ─────────────────────────────────────────────────────────────────────────────
; Syncr — Inno Setup Installer Script
; ─────────────────────────────────────────────────────────────────────────────

#define AppName      "Syncr"
#define AppVersion   "1.0.0"
#define AppPublisher "Clawb1t"
#define AppURL       "https://github.com/Clawb1t/Syncr"
#define AppID        "syncr@clawb1t"
#define HostExe      "syncr-host.exe"

[Setup]
AppId={{F3A1B2C4-9D8E-4F7A-B6C5-2E1D0A3F4B8C}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
; ProgramData avoids 32-vs-64-bit Program Files virtualisation issues
DefaultDirName={commonappdata}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=SyncrSetup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
; 64-bit install mode ensures registry writes go to the native 64-bit hive
; (files still go to C:\ProgramData which is the same on 32 and 64-bit Windows)
ArchitecturesInstallIn64BitMode=x64os
; Admin rights needed to write to ProgramData and HKLM
PrivilegesRequired=admin
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#HostExe}

; ─── Files ──────────────────────────────────────────────────────────────────

[Files]
Source: "dist\{#HostExe}";            DestDir: "{app}";           Flags: ignoreversion
Source: "..\native-host\activities\*"; DestDir: "{app}\activities"; Flags: recursesubdirs ignoreversion createallsubdirs
Source: "..\native-host\version.json"; DestDir: "{app}";           Flags: ignoreversion
Source: "dist\syncr.xpi";             DestDir: "{app}";           Flags: ignoreversion skipifsourcedoesntexist

; ─── Registry ───────────────────────────────────────────────────────────────

[Registry]
; 64-bit Firefox reads the native 64-bit registry hive
Root: HKLM; Subkey: "SOFTWARE\Mozilla\NativeMessagingHosts\syncr"; \
  ValueType: string; ValueName: ""; ValueData: "{app}\syncr.json"; \
  Flags: uninsdeletekey
; 32-bit Firefox reads the WOW6432Node hive — write both to be safe
Root: HKLM; Subkey: "SOFTWARE\WOW6432Node\Mozilla\NativeMessagingHosts\syncr"; \
  ValueType: string; ValueName: ""; ValueData: "{app}\syncr.json"; \
  Flags: uninsdeletekey

; ─── Run after install ──────────────────────────────────────────────────────

[Run]
; Open the signed XPI in Firefox so the user gets the normal "Add to Firefox?" prompt
Filename: "{app}\syncr.xpi"; \
  Description: "Add Syncr extension to Firefox"; \
  Flags: postinstall shellexec skipifsilent nowait; \
  StatusMsg: "Opening Firefox extension installer..."

; ─── Icons ──────────────────────────────────────────────────────────────────

[Icons]
Name: "{group}\{#AppName} on GitHub"; Filename: "{#AppURL}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

; ─── Code ───────────────────────────────────────────────────────────────────

[Code]

// Write the native messaging manifest with the real install path
procedure WriteNativeManifest;
var
  ManifestPath: string;
  HostPath:     string;
  Json:         string;
begin
  ManifestPath := ExpandConstant('{app}\syncr.json');
  HostPath     := ExpandConstant('{app}\{#HostExe}');

  // Escape backslashes for JSON
  StringChangeEx(HostPath, '\', '\\', True);

  Json :=
    '{' + #13#10 +
    '  "name": "syncr",' + #13#10 +
    '  "description": "Syncr Native Messaging Host",' + #13#10 +
    '  "path": "' + HostPath + '",' + #13#10 +
    '  "type": "stdio",' + #13#10 +
    '  "allowed_extensions": ["{#AppID}"]' + #13#10 +
    '}';

  SaveStringToFile(ManifestPath, Json, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    WriteNativeManifest;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: string): string;
begin
  Result :=
    'What happens next:' + NewLine + NewLine +
    Space + '1. Files are installed to: ' + ExpandConstant('{app}') + NewLine +
    Space + '2. Native messaging host is registered for Firefox.' + NewLine +
    Space + '3. Firefox opens and asks you to Add Syncr.' + NewLine +
    Space + '4. Click Add — done! Open Discord and start browsing.';
end;
