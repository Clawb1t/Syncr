; ─────────────────────────────────────────────────────────────────────────────
; Syncr — Inno Setup Installer Script
;
; Prerequisites before building:
;   1. npm install && npm run build  (inside native-host/) to produce syncr-host.exe
;   2. Obtain a Mozilla-signed syncr.xpi and place it in installer/dist/
;   3. Install Inno Setup 6+ from https://jrsoftware.org/isinfo.php
;   4. Open this file in Inno Setup Compiler and click Build → Compile
;
; Output: installer/dist/SyncrSetup.exe
; ─────────────────────────────────────────────────────────────────────────────

#define AppName      "Syncr"
#define AppVersion   "1.0.0"
#define AppPublisher "Clawb1t"
#define AppURL       "https://github.com/Clawb1t/Syncr"
#define AppID        "syncr@clawb1t"
#define HostExe      "syncr-host.exe"
#define HostManifest "syncr.json"

[Setup]
AppId={{F3A1B2C4-9D8E-4F7A-B6C5-2E1D0A3F4B8C}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=SyncrSetup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardResizable=no
DisableWelcomePage=no
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#HostExe}
MinVersion=6.1

; ─── Files ──────────────────────────────────────────────────────────────────

[Files]
; Native host executable (built from native-host/ with `npm run build`)
Source: "dist\{#HostExe}"; DestDir: "{app}"; Flags: ignoreversion

; Activity presence modules — stays on disk so the updater can replace them
Source: "..\native-host\activities\*"; DestDir: "{app}\activities"; \
  Flags: recursesubdirs ignoreversion createallsubdirs

; version.json — used by the updater to detect host upgrades
Source: "..\native-host\version.json"; DestDir: "{app}"; Flags: ignoreversion

; Signed Firefox extension XPI
; Place your Mozilla-signed syncr.xpi in installer/dist/ before compiling
Source: "dist\syncr.xpi"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; ─── Registry ───────────────────────────────────────────────────────────────

[Registry]
; Register native messaging host for all Firefox installations on this machine
Root: HKLM; Subkey: "SOFTWARE\Mozilla\NativeMessagingHosts\syncr"; \
  ValueType: string; ValueName: ""; ValueData: "{app}\{#HostManifest}"; \
  Flags: uninsdeletekey

; ─── Shortcuts ──────────────────────────────────────────────────────────────

[Icons]
Name: "{group}\{#AppName} on GitHub"; Filename: "{#AppURL}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

; ─── Code ───────────────────────────────────────────────────────────────────

[Code]

// ── Helpers ────────────────────────────────────────────────────────────────

function FindFirefoxDir: string;
var
  Paths: array[0..3] of string;
  I: Integer;
begin
  Paths[0] := ExpandConstant('{pf}\Mozilla Firefox');
  Paths[1] := ExpandConstant('{pf32}\Mozilla Firefox');
  Paths[2] := ExpandConstant('{localappdata}\Mozilla Firefox');
  Paths[3] := GetEnv('ProgramFiles') + '\Mozilla Firefox';

  for I := 0 to 3 do begin
    if DirExists(Paths[I]) then begin
      Result := Paths[I];
      Exit;
    end;
  end;
  Result := '';
end;

// ── Write the native messaging manifest ───────────────────────────────────

procedure WriteNativeManifest;
var
  ManifestPath: string;
  Json: string;
  HostPath: string;
begin
  HostPath     := ExpandConstant('{app}\{#HostExe}');
  ManifestPath := ExpandConstant('{app}\{#HostManifest}');

  // Escape backslashes for JSON
  StringChangeEx(HostPath, '\', '\\', True);

  Json :=
    '{' + #13#10 +
    '  "name": "syncr",' + #13#10 +
    '  "description": "Syncr Native Messaging Host",' + #13#10 +
    '  "path": "' + HostPath + '",' + #13#10 +
    '  "type": "stdio",' + #13#10 +
    '  "allowed_extensions": ["syncr@syncr.local"]' + #13#10 +
    '}';

  SaveStringToFile(ManifestPath, Json, False);
end;

// ── Write Firefox enterprise policy ───────────────────────────────────────

procedure WriteFirefoxPolicy;
var
  FirefoxDir: string;
  DistDir:    string;
  XpiPath:    string;
  PolicyJson: string;
begin
  FirefoxDir := FindFirefoxDir;
  if FirefoxDir = '' then Exit;

  DistDir := FirefoxDir + '\distribution';
  if not ForceDirectories(DistDir) then Exit;

  XpiPath := ExpandConstant('{app}\syncr.xpi');

  // Only add the policy if we have the XPI bundled
  if not FileExists(XpiPath) then begin
    // Policy pointing to GitHub releases page as fallback info
    PolicyJson :=
      '{' + #13#10 +
      '  "policies": {' + #13#10 +
      '    "3rdparty": {' + #13#10 +
      '      "Extensions": {}' + #13#10 +
      '    }' + #13#10 +
      '  }' + #13#10 +
      '}';
  end else begin
    StringChangeEx(XpiPath, '\', '\\', True);
    PolicyJson :=
      '{' + #13#10 +
      '  "policies": {' + #13#10 +
      '    "Extensions": {' + #13#10 +
      '      "Install": ["file:///' + XpiPath + '"]' + #13#10 +
      '    }' + #13#10 +
      '  }' + #13#10 +
      '}';
  end;

  SaveStringToFile(DistDir + '\policies.json', PolicyJson, False);
end;

// ── Remove enterprise policy on uninstall ────────────────────────────────

procedure RemoveFirefoxPolicy;
var
  FirefoxDir: string;
  PolicyPath: string;
begin
  FirefoxDir := FindFirefoxDir;
  if FirefoxDir = '' then Exit;
  PolicyPath := FirefoxDir + '\distribution\policies.json';
  DeleteFile(PolicyPath);
end;

// ── Hook into installer steps ────────────────────────────────────────────

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    WriteNativeManifest;
    WriteFirefoxPolicy;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then begin
    RemoveFirefoxPolicy;
  end;
end;

// ── Show helpful finish message ──────────────────────────────────────────

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: string): string;
begin
  Result :=
    'Syncr is almost ready!' + NewLine + NewLine +
    '  1. Restart Firefox to activate the extension.' + NewLine +
    '  2. Make sure Discord is running.' + NewLine +
    '  3. Browse YouTube or YouTube Music — your status will update automatically.' + NewLine + NewLine +
    'Activities and host updates are pulled automatically from GitHub.';
end;
