; setup-launch.ps1 delegates to the existing windows\install-enterprise.ps1 main installer.
[Setup]
AppId={{8A91CCDF-5230-4A91-A6AD-C3D9656F6363}
AppName=OPERIS Enterprise
AppVersion=6.3.63
AppPublisher=IZDENIZ
DefaultDirName={commonappdata}\Operis-Setup
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupMutex=Global\OPERIS_ENTERPRISE_SETUP
OutputDir=..\dist\installer
OutputBaseFilename=OPERIS_Setup_v6.3.63
Compression=lzma2/ultra64
SolidCompression=yes
Uninstallable=yes
CreateUninstallRegKey=yes
CloseApplications=no
RestartApplications=no
WizardStyle=modern

[Files]
Source: "..\*"; DestDir: "{tmp}\OPERISPayload"; Flags: ignoreversion recursesubdirs createallsubdirs deleteafterinstall; Excludes: ".git\*,node_modules\*,server\node_modules\*,dist\*,server\dist\*,server\public\*"

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{commonappdata}\Operis\windows\uninstall-enterprise.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "OPERISPreserveDatabase"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShell: String;
  Params: String;
begin
  if CurStep = ssPostInstall then
  begin
    PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    Params := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{tmp}\OPERISPayload\windows\setup-launch.ps1') + '" -PayloadRoot "' +
      ExpandConstant('{tmp}\OPERISPayload') + '"';
    if (not Exec(PowerShell, Params, ExpandConstant('{tmp}\OPERISPayload'), SW_HIDE,
      ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    begin
      RaiseException(Format('OPERIS ana installer başarısız oldu. ExitCode=%d', [ResultCode]));
    end;
  end;
end;
