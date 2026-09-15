; progress-ui.ps1 -> operation-host.ps1 -> setup-launch.ps1/install-enterprise.ps1
; uninstall path: progress-ui.ps1 -> operation-host.ps1 -> uninstall-enterprise.ps1
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

[Code]
const
  OperisUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8A91CCDF-5230-4A91-A6AD-C3D9656F6363}_is1';
  TargetVersion = '6.3.63';

var
  MaintenancePage: TInputOptionWizardPage;
  InstalledVersion: String;
  MaintenanceAction: String;
  InstallerExitCode: Integer;

procedure ExitProcess(uExitCode: Cardinal);
  external 'ExitProcess@kernel32.dll stdcall';

function ReadInstalledVersion(var Version: String): Boolean;
begin
  Result := RegQueryStringValue(HKEY_LOCAL_MACHINE, OperisUninstallKey,
    'DisplayVersion', Version);
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := InstallerExitCode;
end;

function HasCommandLineSwitch(const SwitchName: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
  begin
    if CompareText(ParamStr(I), SwitchName) = 0 then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

procedure InitializeWizard;
begin
  InstallerExitCode := 0;
  MaintenanceAction := '';
  InstalledVersion := '';
  if ReadInstalledVersion(InstalledVersion) and
     (InstalledVersion = TargetVersion) and (not WizardSilent) then
  begin
    MaintenancePage := CreateInputOptionPage(wpWelcome,
      'OPERIS Bakım Modu',
      'Mevcut OPERIS Enterprise ' + InstalledVersion + ' kurulumu bulundu.',
      'Yapılacak işlemi seçin. Veritabanı ve mevcut yapılandırma korunacaktır.',
      True, False);
    MaintenancePage.Add('REPAIR - Uygulama dosyalarını ve runtime bileşenlerini onar');
    MaintenancePage.Add('REFRESH / REINSTALL - Aynı sürüm uygulama katmanını yeniden kur');
    MaintenancePage.Add('UNINSTALL - Uygulamayı kaldır, veritabanı ve yedekleri koru');
    MaintenancePage.SelectedValueIndex := 0;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ResultCode: Integer;
  Uninstaller: String;
begin
  Result := True;
  if Assigned(MaintenancePage) and (CurPageID = MaintenancePage.ID) then
  begin
    case MaintenancePage.SelectedValueIndex of
      0: MaintenanceAction := 'REPAIR';
      1: MaintenanceAction := 'REFRESH';
      2:
        begin
          if MsgBox('OPERIS uygulaması kaldırılacak. PostgreSQL verisi, yedekler ve korunan yapılandırma silinmeyecektir. Devam edilsin mi?',
            mbConfirmation, MB_YESNO) <> IDYES then
          begin
            Result := False;
            Exit;
          end;
          Uninstaller := ExpandConstant('{app}\unins000.exe');
          if not FileExists(Uninstaller) then
          begin
            MsgBox('Mevcut OPERIS uninstaller bulunamadı: ' + Uninstaller, mbError, MB_OK);
            Result := False;
            Exit;
          end;
          if (not Exec(Uninstaller, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OPERISPROGRESSUI',
            ExpandConstant('{app}'), SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode)) or
            (ResultCode <> 0) then
          begin
            MsgBox(Format('OPERIS uninstall başarısız oldu. ExitCode=%d', [ResultCode]), mbError, MB_OK);
            Result := False;
            Exit;
          end;
          ExitProcess(0);
        end;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShell: String;
  Params: String;
  ExecOk: Boolean;
  ShowMode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    Params := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{tmp}\OPERISPayload\windows\progress-ui.ps1') + '" -PayloadRoot "' +
      ExpandConstant('{tmp}\OPERISPayload') + '" -TargetVersion "' + TargetVersion + '"';

    if MaintenanceAction <> '' then
      Params := Params + ' -OperationType "' + MaintenanceAction + '"'
    else
      Params := Params + ' -OperationType "AUTO"';

    if WizardSilent then
    begin
      Params := Params + ' -Silent';
      ShowMode := SW_HIDE;
    end
    else
      ShowMode := SW_SHOWNORMAL;

    ResultCode := 0;
    ExecOk := Exec(PowerShell, Params, ExpandConstant('{tmp}\OPERISPayload'), ShowMode,
      ewWaitUntilTerminated, ResultCode);

    if not ExecOk then
    begin
      InstallerExitCode := 4;
      RaiseException('OPERIS progress UI / ana installer başlatılamadı.');
    end;

    if ResultCode <> 0 then
    begin
      InstallerExitCode := ResultCode;
      RaiseException(Format('OPERIS ana installer başarısız oldu. ExitCode=%d', [ResultCode]));
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  PowerShell: String;
  ProgressScript: String;
  PayloadRoot: String;
  Params: String;
  ExecOk: Boolean;
  InteractiveProgress: Boolean;
  ShowMode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    PayloadRoot := ExpandConstant('{commonappdata}\Operis');
    ProgressScript := PayloadRoot + '\windows\progress-ui.ps1';

    if not FileExists(ProgressScript) then
    begin
      if not UninstallSilent then
        MsgBox('OPERIS progress UI bulunamadı: ' + ProgressScript, mbError, MB_OK);
      ExitProcess(4);
    end;

    InteractiveProgress := (not UninstallSilent) or HasCommandLineSwitch('/OPERISPROGRESSUI');
    Params := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + ProgressScript +
      '" -PayloadRoot "' + PayloadRoot + '" -OperationType "UNINSTALL" -TargetVersion "' + TargetVersion + '"';

    if InteractiveProgress then
      ShowMode := SW_SHOWNORMAL
    else
    begin
      Params := Params + ' -Silent';
      ShowMode := SW_HIDE;
    end;

    ResultCode := 0;
    ExecOk := Exec(PowerShell, Params, PayloadRoot, ShowMode, ewWaitUntilTerminated, ResultCode);
    if not ExecOk then
      ExitProcess(4);
    if ResultCode <> 0 then
      ExitProcess(ResultCode);
  end;
end;
