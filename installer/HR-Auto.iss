; HR Auto installer.
; Compile through installer\build-installer.ps1 so staging is populated first.
;
; Deliberately ASCII-only: Thai wording comes from Thai.isl via {cm:...} so the
; script does not depend on the compiler reading a BOM correctly.

#define MyAppName "HR Auto"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
AppId={{BE5597FB-AD90-440B-8310-1B6C9AE51E5D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=HR Auto
DefaultDirName={localappdata}\Programs\HR Auto
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Per-user install so recipients never see a UAC prompt.
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=HR-Auto-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\node.exe

[Languages]
Name: "thai"; MessagesFile: "compiler:Languages\Thai.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
; Checked by default: the install folder has no double-clickable app file of its
; own, so the shortcut is the primary way in.
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\node.exe"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\node.exe"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; \
  Flags: postinstall shellexec skipifsilent nowait

; Note: user data lives in %LOCALAPPDATA%\HR-Auto and is intentionally left in
; place on uninstall. It holds the Facebook browser profile and all evidence.
