import { execFile } from 'node:child_process';
import os from 'node:os';

export type DomainUserResult = {
  samAccountName: string;
  userPrincipalName: string;
  displayName: string;
  email: string;
  department: string;
  title: string;
  telephoneNumber: string;
  manager: string;
  employeeId: string;
  enabled: boolean;
  groups: string[];
  querySource: string;
};

export type DomainDeviceResult = {
  computerName: string;
  dnsAddresses: string[];
  ipv4: string;
  macAddress: string;
  macSource: string;
  operatingSystem: string;
  operatingSystemVersion: string;
  enabled: boolean | null;
  description: string;
  lastLogonDate: string;
};

export type NetworkDiagnostics = {
  listening: boolean;
  localAddress: string;
  processId: number;
  firewallPresent: boolean;
  firewallEnabled: string;
  port: number;
  addresses: string[];
  urls: string[];
  hostName: string;
  platform: string;
  release: string;
};

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/_x000D__x000A_/gi, '\n')
    .replace(/_x000D_/gi, '\r')
    .replace(/_x000A_/gi, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readablePowerShellError(stderr: string, fallback: string): string {
  const raw = String(stderr || '').trim();
  if (!raw) return fallback;

  if (raw.startsWith('#< CLIXML') || raw.includes('<Objs Version=')) {
    const errors = [...raw.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
      .map(match => decodeXmlText(match[1]).trim())
      .filter(Boolean);

    const useful = errors
      .filter(line =>
        !/^At line:/i.test(line) &&
        !/^\+\s/.test(line) &&
        !/^~+$/.test(line) &&
        !/^\s*\+ CategoryInfo/i.test(line) &&
        !/^\s*\+ FullyQualifiedErrorId/i.test(line),
      )
      .join('\n')
      .replace(/\uFFFD/g, 'ı');

    if (useful) return useful;
  }

  return decodeXmlText(raw)
    .replace(/#< CLIXML[\s\S]*$/i, '')
    .replace(/\uFFFD/g, 'ı')
    .trim() || fallback;
}

function runPowerShell(script: string): Promise<string> {
  const wrapped = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    script,
  ].join('\r\n');

  const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encoded,
      ],
      {
        windowsHide: true,
        timeout: 25_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(readablePowerShellError(
            stderr,
            error.message || 'PowerShell sorgusu başarısız.',
          )));
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

function parseJson<T>(output: string): T {
  const value = output.trim();
  if (!value) throw new Error('Sorgu sonuç döndürmedi.');
  return JSON.parse(value) as T;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean);
  }
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLocaleLowerCase('tr-TR') === 'true';
  return fallback;
}

export async function queryDomainUser(query: string): Promise<DomainUserResult> {
  const normalizedInput = query.trim();
  if (!normalizedInput) throw new Error('Domain kullanıcı adı, e-posta veya ad soyad girin.');

  const accountCandidate = normalizedInput.includes('\\')
    ? normalizedInput.split('\\').filter(Boolean).at(-1) ?? normalizedInput
    : normalizedInput;

  const safeQuery = escapePowerShellSingleQuoted(normalizedInput);
  const safeAccount = escapePowerShellSingleQuoted(accountCandidate);

  const script = [
    "$ErrorActionPreference='Stop'",
    `$q='${safeQuery}'`,
    `$account='${safeAccount}'`,
    "$result=$null",
    "if (Get-Module -ListAvailable -Name ActiveDirectory) {",
    "  Import-Module ActiveDirectory -ErrorAction Stop",
    "  $user = Get-ADUser -Filter \"SamAccountName -eq '$account' -or UserPrincipalName -eq '$q' -or mail -eq '$q'\" -Properties DisplayName,mail,department,title,telephoneNumber,manager,employeeID,Enabled,MemberOf -ErrorAction SilentlyContinue | Select-Object -First 1",
    "  if (-not $user) { $user = Get-ADUser -Filter \"DisplayName -like '*$q*' -or Name -like '*$q*'\" -Properties DisplayName,mail,department,title,telephoneNumber,manager,employeeID,Enabled,MemberOf -ErrorAction SilentlyContinue | Select-Object -First 1 }",
    "  if ($user) {",
    "    $managerName=''",
    "    if ($user.Manager) { try { $managerName=(Get-ADUser $user.Manager -Properties DisplayName -ErrorAction Stop).DisplayName } catch {} }",
    "    $groups=@($user.MemberOf | ForEach-Object { ($_ -split ',')[0] -replace '^CN=','' })",
    "    $result=[pscustomobject]@{",
    "      samAccountName=[string]$user.SamAccountName",
    "      userPrincipalName=[string]$user.UserPrincipalName",
    "      displayName=[string]$user.DisplayName",
    "      email=[string]$user.mail",
    "      department=[string]$user.department",
    "      title=[string]$user.title",
    "      telephoneNumber=[string]$user.telephoneNumber",
    "      manager=[string]$managerName",
    "      employeeId=[string]$user.employeeID",
    "      enabled=[bool]$user.Enabled",
    "      groups=@($groups)",
    "      querySource='ActiveDirectory PowerShell'",
    "    }",
    "  }",
    "} else {",
    "  function Escape-LdapFilter([string]$value) {",
    "    if ($null -eq $value) { return '' }",
    "    $escaped=[string]$value",
    "    $escaped=$escaped -replace '\\\\','\\5c'",
    "    $escaped=$escaped -replace '\\*','\\2a'",
    "    $escaped=$escaped -replace '\\(','\\28'",
    "    $escaped=$escaped -replace '\\)','\\29'",
    "    $escaped=$escaped -replace ([string][char]0),'\\00'",
    "    return $escaped",
    "  }",
    "  function Prop([System.DirectoryServices.SearchResult]$entry,[string]$name) {",
    "    if ($entry.Properties[$name] -and $entry.Properties[$name].Count -gt 0) { return [string]$entry.Properties[$name][0] }",
    "    return ''",
    "  }",
    "  try {",
    "    $rootDse=[ADSI]'LDAP://RootDSE'",
    "    $baseDn=[string]$rootDse.defaultNamingContext",
    "    if (-not $baseDn) { throw 'Bu bilgisayar bir Active Directory domainine bağlı görünmüyor veya domain bilgisi okunamıyor.' }",
    "    $root=New-Object System.DirectoryServices.DirectoryEntry(\"LDAP://$baseDn\")",
    "    $searcher=New-Object System.DirectoryServices.DirectorySearcher($root)",
    "    $searcher.PageSize=100",
    "    $searcher.SizeLimit=20",
    "    $eqAccount=Escape-LdapFilter $account",
    "    $eqQuery=Escape-LdapFilter $q",
    "    $likeQuery=Escape-LdapFilter $q",
    "    $searcher.Filter=\"(&(objectCategory=person)(objectClass=user)(|(sAMAccountName=$eqAccount)(userPrincipalName=$eqQuery)(mail=$eqQuery)(displayName=*$likeQuery*)(name=*$likeQuery*)))\"",
    "    @('sAMAccountName','userPrincipalName','displayName','mail','department','title','telephoneNumber','manager','employeeID','userAccountControl','memberOf') | ForEach-Object { [void]$searcher.PropertiesToLoad.Add($_) }",
    "    $entry=$searcher.FindOne()",
    "    if ($entry) {",
    "      $managerName=''",
    "      $managerDn=Prop $entry 'manager'",
    "      if ($managerDn) {",
    "        try {",
    "          $managerEntry=New-Object System.DirectoryServices.DirectoryEntry(\"LDAP://$managerDn\")",
    "          $managerName=[string]$managerEntry.Properties['displayName'].Value",
    "        } catch {}",
    "      }",
    "      $groups=@()",
    "      if ($entry.Properties['memberof']) {",
    "        $groups=@($entry.Properties['memberof'] | ForEach-Object {",
    "          $dn=[string]$_",
    "          if ($dn -match '^CN=([^,]+)') { $matches[1] -replace '\\\\,',',' }",
    "        } | Where-Object { $_ })",
    "      }",
    "      $uac=0",
    "      if ($entry.Properties['useraccountcontrol'] -and $entry.Properties['useraccountcontrol'].Count -gt 0) { $uac=[int]$entry.Properties['useraccountcontrol'][0] }",
    "      $result=[pscustomobject]@{",
    "        samAccountName=Prop $entry 'samaccountname'",
    "        userPrincipalName=Prop $entry 'userprincipalname'",
    "        displayName=Prop $entry 'displayname'",
    "        email=Prop $entry 'mail'",
    "        department=Prop $entry 'department'",
    "        title=Prop $entry 'title'",
    "        telephoneNumber=Prop $entry 'telephonenumber'",
    "        manager=[string]$managerName",
    "        employeeId=Prop $entry 'employeeid'",
    "        enabled=(($uac -band 2) -eq 0)",
    "        groups=@($groups)",
    "        querySource='ADSI / LDAP'",
    "      }",
    "    }",
    "  } catch {",
    "    throw \"Domain LDAP sorgusu yapılamadı: $($_.Exception.Message)\"",
    "  }",
    "}",
    "if (-not $result) { throw \"Domain kullanıcısı bulunamadı: $q\" }",
    "$result | ConvertTo-Json -Depth 5 -Compress",
  ].join('\r\n');

  const raw = parseJson<Record<string, unknown>>(await runPowerShell(script));
  return {
    samAccountName: String(raw.samAccountName ?? ''),
    userPrincipalName: String(raw.userPrincipalName ?? ''),
    displayName: String(raw.displayName ?? ''),
    email: String(raw.email ?? ''),
    department: String(raw.department ?? ''),
    title: String(raw.title ?? ''),
    telephoneNumber: String(raw.telephoneNumber ?? ''),
    manager: String(raw.manager ?? ''),
    employeeId: String(raw.employeeId ?? ''),
    enabled: normalizeBoolean(raw.enabled),
    groups: normalizeStringArray(raw.groups),
    querySource: String(raw.querySource ?? 'Domain'),
  };
}

export async function queryDomainDevice(computerName: string): Promise<DomainDeviceResult> {
  const query = computerName.trim();
  if (!query) throw new Error('Bilgisayar adı veya IP adresi girin.');
  const safeName = escapePowerShellSingleQuoted(query);

  const script = [
    "$ErrorActionPreference='Stop'",
    `$name='${safeName}'`,
    '$isIPv4 = $name -match \'^\\d{1,3}(?:\\.\\d{1,3}){3}$\'',
    '$addresses=@()',
    'try { $addresses=@([System.Net.Dns]::GetHostAddresses($name) | ForEach-Object { $_.IPAddressToString }) } catch {}',
    'if ($isIPv4 -and $addresses.Count -eq 0) { $addresses=@($name) }',
    "$ipv4=@($addresses | Where-Object { $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' } | Select-Object -First 1)",
    'if ($ipv4.Count -gt 0) { ping.exe -n 1 -w 1000 $ipv4[0] | Out-Null }',
    "$mac=''",
    'if ($ipv4.Count -gt 0) {',
    '  $arp = arp.exe -a $ipv4[0] 2>$null',
    "  $line = @($arp | Where-Object { $_ -match [regex]::Escape($ipv4[0]) } | Select-Object -First 1)",
    "  $match = [regex]::Match(($line -join ' '), '([0-9a-fA-F]{2}[-:]){5}[0-9a-fA-F]{2}')",
    '  if ($match.Success) { $mac=$match.Value.ToUpper() }',
    '}',
    '$ad = $null',
    'if (Get-Module -ListAvailable -Name ActiveDirectory) {',
    '  try {',
    '    Import-Module ActiveDirectory',
    '    if ($isIPv4) {',
    '      $ip = if($ipv4.Count -gt 0){$ipv4[0]}else{$name}',
    "      $ad = Get-ADComputer -Filter \"IPv4Address -eq '$ip'\" -Properties OperatingSystem,OperatingSystemVersion,IPv4Address,DNSHostName,LastLogonDate,Enabled,Description -ErrorAction SilentlyContinue | Select-Object -First 1",
    '    } else {',
    '      $shortName = ($name -split \'\\.\')[0]',
    '      $ad = Get-ADComputer -Identity $shortName -Properties OperatingSystem,OperatingSystemVersion,IPv4Address,DNSHostName,LastLogonDate,Enabled,Description -ErrorAction SilentlyContinue',
    '      if (-not $ad) { $ad = Get-ADComputer -Filter "DNSHostName -eq \'$name\'" -Properties OperatingSystem,OperatingSystemVersion,IPv4Address,DNSHostName,LastLogonDate,Enabled,Description -ErrorAction SilentlyContinue | Select-Object -First 1 }',
    '    }',
    '  } catch {}',
    '}',
    '$resolvedName = if($ad -and $ad.Name){[string]$ad.Name}else{$name}',
    '[pscustomobject]@{',
    '  computerName=$resolvedName',
    '  dnsAddresses=@($addresses)',
    "  ipv4=if($ipv4.Count -gt 0){[string]$ipv4[0]}elseif($ad -and $ad.IPv4Address){[string]$ad.IPv4Address}else{''}",
    '  macAddress=[string]$mac',
    "  macSource=if($mac){'ARP'}else{'Bulunamadı'}",
    "  operatingSystem=if($ad){[string]$ad.OperatingSystem}else{''}",
    "  operatingSystemVersion=if($ad){[string]$ad.OperatingSystemVersion}else{''}",
    '  enabled=if($ad){[bool]$ad.Enabled}else{$null}',
    "  description=if($ad){[string]$ad.Description}else{''}",
    "  lastLogonDate=if($ad -and $ad.LastLogonDate){$ad.LastLogonDate.ToString('o')}else{''}",
    '} | ConvertTo-Json -Depth 5 -Compress',
  ].join('\r\n');

  const raw = parseJson<Record<string, unknown>>(await runPowerShell(script));
  const dnsAddresses = normalizeStringArray(raw.dnsAddresses);
  return {
    computerName: String(raw.computerName ?? query),
    dnsAddresses,
    ipv4: String(raw.ipv4 ?? dnsAddresses.find(value => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) ?? ''),
    macAddress: String(raw.macAddress ?? ''),
    macSource: String(raw.macSource ?? 'Bulunamadı'),
    operatingSystem: String(raw.operatingSystem ?? ''),
    operatingSystemVersion: String(raw.operatingSystemVersion ?? ''),
    enabled: raw.enabled == null ? null : normalizeBoolean(raw.enabled),
    description: String(raw.description ?? ''),
    lastLogonDate: String(raw.lastLogonDate ?? ''),
  };
}

export async function getNetworkDiagnostics(port = 3001): Promise<NetworkDiagnostics> {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$listener = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    `$firewall = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Operis Enterprise TCP ${port}*' -and $_.Enabled -eq 'True' } | Select-Object -First 1`,
    '[pscustomobject]@{',
    '  listening=[bool]$listener',
    "  localAddress=if($listener){$listener.LocalAddress}else{''}",
    '  processId=if($listener){$listener.OwningProcess}else{0}',
    '  firewallPresent=[bool]$firewall',
    "  firewallEnabled=if($firewall){[string]$firewall.Enabled}else{'False'}",
    '} | ConvertTo-Json -Compress',
  ].join('\r\n');

  const diagnostics = parseJson<Pick<
    NetworkDiagnostics,
    'listening' | 'localAddress' | 'processId' | 'firewallPresent' | 'firewallEnabled'
  >>(await runPowerShell(script));

  const addresses = Object.values(os.networkInterfaces())
    .flatMap(items => items ?? [])
    .filter(item => item.family === 'IPv4' && !item.internal)
    .map(item => item.address);

  return {
    ...diagnostics,
    port,
    addresses,
    urls: addresses.map(address => `http://${address}:${port}`),
    hostName: os.hostname(),
    platform: os.platform(),
    release: os.release(),
  };
}
