import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { execFile } from 'node:child_process';
import { prisma } from './db.js';
import { decryptText, encryptText } from './crypto.js';
import { normalizePermissions } from './permissions.js';

export type DomainSyncSettingsInput = {
  enabled: boolean; controller: string; useLdaps: boolean; port: number; baseDn: string;
  username: string; password?: string; intervalMinutes: number;
};
type AdUser = {
  samAccountName:string; displayName:string; email:string; department:string; title:string; userPrincipalName:string; enabled:boolean; groups:string[]; objectGuid:string;
};
const EMPTY_PERMISSIONS=normalizePermissions({});

function powershellEncoded(script:string){return Buffer.from(script,'utf16le').toString('base64');}
function psQuote(value:string){return value.replaceAll("'","''");}

export class DomainConnectionError extends Error {
  constructor(public readonly code:string, message:string, public readonly detail:string=''){
    super(message);
    this.name='DomainConnectionError';
  }
}

function domainErrorCode(detail:string){
  const text=detail.toLocaleLowerCase('tr-TR');
  if(/timed out|timeout|zaman aş/.test(text))return 'DC_TIMEOUT';
  if(/server is not operational|sunucu kullanılamıyor|cannot contact|could not be contacted|unavailable/.test(text))return 'DC_UNREACHABLE';
  if(/logon failure|unknown user name|bad password|kullanıcı adı veya parola|invalid credentials|credentials supplied/.test(text))return 'DC_BIND_FAILED';
  if(/certificate|sertifika|trust relationship|ssl|tls/.test(text))return 'DC_TLS_ERROR';
  if(/invalid dn|distinguished name|base dn|naming violation|no such object/.test(text))return 'DC_BASE_DN_ERROR';
  if(/powershell.exe|enoent|not recognized/.test(text))return 'DC_POWERSHELL_ERROR';
  return 'DC_LDAP_ERROR';
}

async function runPowerShell(script:string,timeoutMs=120_000):Promise<string>{
  const utf8Script=[
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    script,
  ].join("\r\n");
  return new Promise((resolve,reject)=>{
    execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',powershellEncoded(utf8Script)],
      {windowsHide:true,timeout:timeoutMs,maxBuffer:32*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{
        if(error){
          const detail=String(stderr||error.message||'PowerShell sorgusu başarısız.').trim();
          reject(new DomainConnectionError(domainErrorCode(detail),'Domain Controller bağlantısı başarısız.',detail));
          return;
        }
        resolve(stdout.trim());
      });
  });
}

function meaningfulDepartment(groups:string[],department:string){
  const ignored=new Set(['domain users','authenticated users','everyone','users','etki alanı kullanıcıları','domain admins']);
  const meaningful=groups.map(v=>v.trim()).filter(Boolean).filter(v=>!ignored.has(v.toLocaleLowerCase('tr-TR')));
  return (meaningful.join(' / ')||department.trim()).slice(0,120);
}
async function settingsRow(){return prisma.appSettings.upsert({where:{id:1},update:{},create:{id:1}});}

export async function getDomainSyncSettings(){
  const row=await settingsRow();
  return {
    enabled:row.domainSyncEnabled,controller:row.domainController,useLdaps:row.domainUseLdaps,port:row.domainPort,
    baseDn:row.domainBaseDn,username:row.domainUsername,passwordSet:Boolean(row.domainPasswordEncrypted),
    intervalMinutes:row.domainSyncIntervalMinutes,lastSyncAt:row.domainLastSyncAt?.getTime()??null,lastSyncResult:row.domainLastSyncResult,
  };
}
export async function updateDomainSyncSettings(input:DomainSyncSettingsInput){
  const current=await settingsRow();
  const data:Record<string,unknown>={
    domainSyncEnabled:input.enabled,domainController:input.controller.trim(),domainUseLdaps:input.useLdaps,
    domainPort:Math.max(1,Math.min(65535,Math.round(input.port||(input.useLdaps?636:389)))),
    domainBaseDn:input.baseDn.trim(),domainUsername:input.username.trim(),
    domainSyncIntervalMinutes:Math.max(1,Math.min(1440,Math.round(Number(input.intervalMinutes)||60))),
  };
  if(typeof input.password==='string'&&input.password.length>0)data.domainPasswordEncrypted=encryptText(input.password);
  else if(!current.domainPasswordEncrypted)data.domainPasswordEncrypted='';
  await prisma.appSettings.update({where:{id:1},data});
  return getDomainSyncSettings();
}
async function connectionSecret(){
  const row=await settingsRow();
  if(!row.domainController.trim()||!row.domainBaseDn.trim()||!row.domainUsername.trim()||!row.domainPasswordEncrypted)
    throw new Error('Domain Controller, Base DN, yetkili kullanıcı ve parola eksiksiz girilmelidir.');
  return {controller:row.domainController.trim(),useLdaps:row.domainUseLdaps,port:row.domainPort,baseDn:row.domainBaseDn.trim(),
    username:row.domainUsername.trim(),password:decryptText(row.domainPasswordEncrypted)};
}

function ldapScript(secret:{controller:string;useLdaps:boolean;port:number;baseDn:string;username:string;password:string},listUsers:boolean){
  const common=[
    "$ErrorActionPreference='Stop'",
    "trap { $ex=$_.Exception; $parts=@(); $parts += ('MESSAGE=' + $ex.Message); if($null -ne $ex.HResult){$parts += ('HRESULT=0x' + $ex.HResult.ToString('X8'))}; if($ex.PSObject.Properties.Name -contains 'ExtendedError'){$parts += ('EXTENDED_ERROR=' + $ex.ExtendedError)}; if($ex.PSObject.Properties.Name -contains 'ExtendedErrorMessage' -and $ex.ExtendedErrorMessage){$parts += ('EXTENDED_MESSAGE=' + $ex.ExtendedErrorMessage)}; [Console]::Error.WriteLine(($parts -join ' | ')); exit 1 }","Add-Type -AssemblyName System.DirectoryServices",
    `$controller='${psQuote(secret.controller)}'`,`$port='${secret.port}'`,`$baseDn='${psQuote(secret.baseDn)}'`,
    `$username='${psQuote(secret.username)}'`,`$password='${psQuote(secret.password)}'`,`$provider='LDAP'`,`$protocol='${secret.useLdaps?'LDAPS':'LDAP'}'`,
    "$path=\"${provider}://${controller}:$port/$baseDn\"",
    "$authType=[System.DirectoryServices.AuthenticationTypes]::Secure -bor [System.DirectoryServices.AuthenticationTypes]::ServerBind",
    "if($protocol -eq 'LDAPS'){ $authType = $authType -bor [System.DirectoryServices.AuthenticationTypes]::SecureSocketsLayer }",
    "if($protocol -eq 'LDAP'){ $authType = $authType -bor [System.DirectoryServices.AuthenticationTypes]::Signing -bor [System.DirectoryServices.AuthenticationTypes]::Sealing }",
    "$root=New-Object System.DirectoryServices.DirectoryEntry($path,$username,$password,$authType)","$null=$root.NativeObject",
  ];
  if(!listUsers)return [...common,
    "$probe=New-Object System.DirectoryServices.DirectorySearcher($root)",
    "$probe.SearchScope=[System.DirectoryServices.SearchScope]::Base",
    "$probe.Filter='(objectClass=*)'",
    "$probe.SizeLimit=1",
    "[void]$probe.PropertiesToLoad.Add('distinguishedName')",
    "$baseProbe=$probe.FindOne()",
    "if(-not $baseProbe){throw 'Base DN üzerinde LDAP sorgusu sonuç döndürmedi.'}",
    "[pscustomobject]@{ok=$true;path=$path;baseDn=$baseDn;controller=$controller;port=[int]$port;protocol=$protocol} | ConvertTo-Json -Compress",
  ].join("\r\n");
  return [...common,
    "$searcher=New-Object System.DirectoryServices.DirectorySearcher($root)","$searcher.PageSize=1000",
    "$searcher.Filter='(&(objectCategory=person)(objectClass=user))'",
    "@('sAMAccountName','displayName','mail','department','title','userPrincipalName','userAccountControl','memberOf','objectGUID') | ForEach-Object { [void]$searcher.PropertiesToLoad.Add($_) }",
    "$items=@()","foreach($entry in $searcher.FindAll()){",
    "  $sam=if($entry.Properties['samaccountname'].Count){[string]$entry.Properties['samaccountname'][0]}else{''}",
    "  if(-not $sam){continue}","  $uac=if($entry.Properties['useraccountcontrol'].Count){[int]$entry.Properties['useraccountcontrol'][0]}else{0}",
    "  $disabled=($uac -band 2) -ne 0","  $groups=@()",
    "  if($entry.Properties['memberof']){ $groups=@($entry.Properties['memberof'] | ForEach-Object { $dn=[string]$_; if($dn -match '^CN=([^,]+)'){ $matches[1] -replace '\\\\,',',' } } | Where-Object { $_ }) }",
    "  $guid=''","  if($entry.Properties['objectguid'].Count){$guid=(New-Object Guid (,$entry.Properties['objectguid'][0])).ToString()}",
    "  $items += [pscustomobject]@{samAccountName=$sam;displayName=if($entry.Properties['displayname'].Count){[string]$entry.Properties['displayname'][0]}else{$sam};email=if($entry.Properties['mail'].Count){[string]$entry.Properties['mail'][0]}else{''};department=if($entry.Properties['department'].Count){[string]$entry.Properties['department'][0]}else{''};title=if($entry.Properties['title'].Count){[string]$entry.Properties['title'][0]}else{''};userPrincipalName=if($entry.Properties['userprincipalname'].Count){[string]$entry.Properties['userprincipalname'][0]}else{''};enabled=(-not $disabled);groups=@($groups);objectGuid=$guid}",
    "}","@($items) | ConvertTo-Json -Compress -Depth 4",
  ].join("\r\n");
}

function ldapSingleUserScript(
  secret:{controller:string;useLdaps:boolean;port:number;baseDn:string;username:string;password:string},
  targetUsername:string,
){
  const lines=[
    "$ErrorActionPreference='Stop'",
    "trap { $ex=$_.Exception; $parts=@(); $parts += ('MESSAGE=' + $ex.Message); if($null -ne $ex.HResult){$parts += ('HRESULT=0x' + $ex.HResult.ToString('X8'))}; if($ex.PSObject.Properties.Name -contains 'ExtendedError'){$parts += ('EXTENDED_ERROR=' + $ex.ExtendedError)}; if($ex.PSObject.Properties.Name -contains 'ExtendedErrorMessage' -and $ex.ExtendedErrorMessage){$parts += ('EXTENDED_MESSAGE=' + $ex.ExtendedErrorMessage)}; [Console]::Error.WriteLine(($parts -join ' | ')); exit 1 }",
    "Add-Type -AssemblyName System.DirectoryServices",
    `$controller='${psQuote(secret.controller)}'`,
    `$port='${secret.port}'`,
    `$baseDn='${psQuote(secret.baseDn)}'`,
    `$username='${psQuote(secret.username)}'`,
    `$password='${psQuote(secret.password)}'`,
    `$provider='LDAP'`,
    `$protocol='${secret.useLdaps?'LDAPS':'LDAP'}'`,
    `$targetSam='${psQuote(targetUsername)}'`,
    "$path=\"${provider}://${controller}:$port/$baseDn\"",
    "$authType=[System.DirectoryServices.AuthenticationTypes]::Secure -bor [System.DirectoryServices.AuthenticationTypes]::ServerBind",
    "if($protocol -eq 'LDAPS'){ $authType = $authType -bor [System.DirectoryServices.AuthenticationTypes]::SecureSocketsLayer }",
    "if($protocol -eq 'LDAP'){ $authType = $authType -bor [System.DirectoryServices.AuthenticationTypes]::Signing -bor [System.DirectoryServices.AuthenticationTypes]::Sealing }",
    "$root=New-Object System.DirectoryServices.DirectoryEntry($path,$username,$password,$authType)",
    "$null=$root.NativeObject",
    "$escapedSam=$targetSam.Replace('\\','\\5c').Replace('*','\\2a').Replace('(','\\28').Replace(')','\\29').Replace([char]0,'\\00')",
    "$searcher=New-Object System.DirectoryServices.DirectorySearcher($root)",
    "$searcher.PageSize=1",
    "$searcher.SizeLimit=1",
    "$searcher.Filter=\"(&(objectCategory=person)(objectClass=user)(sAMAccountName=$escapedSam))\"",
    "@('sAMAccountName','displayName','mail','department','title','userPrincipalName','userAccountControl','memberOf','objectGUID') | ForEach-Object { [void]$searcher.PropertiesToLoad.Add($_) }",
    "$entry=$searcher.FindOne()",
    "if(-not $entry){ [pscustomobject]@{found=$false} | ConvertTo-Json -Compress; exit 0 }",
    "$sam=if($entry.Properties['samaccountname'].Count){[string]$entry.Properties['samaccountname'][0]}else{''}",
    "$uac=if($entry.Properties['useraccountcontrol'].Count){[int]$entry.Properties['useraccountcontrol'][0]}else{0}",
    "$disabled=($uac -band 2) -ne 0",
    "$groups=@()",
    "if($entry.Properties['memberof']){ $groups=@($entry.Properties['memberof'] | ForEach-Object { $dn=[string]$_; if($dn -match '^CN=([^,]+)'){ $matches[1] -replace '\\\\,',',' } } | Where-Object { $_ }) }",
    "$guid=''",
    "if($entry.Properties['objectguid'].Count){$guid=(New-Object Guid (,$entry.Properties['objectguid'][0])).ToString()}",
    "$result=[pscustomobject]@{found=$true;samAccountName=$sam;displayName=if($entry.Properties['displayname'].Count){[string]$entry.Properties['displayname'][0]}else{$sam};email=if($entry.Properties['mail'].Count){[string]$entry.Properties['mail'][0]}else{''};department=if($entry.Properties['department'].Count){[string]$entry.Properties['department'][0]}else{''};title=if($entry.Properties['title'].Count){[string]$entry.Properties['title'][0]}else{''};userPrincipalName=if($entry.Properties['userprincipalname'].Count){[string]$entry.Properties['userprincipalname'][0]}else{''};enabled=(-not $disabled);groups=@($groups);objectGuid=$guid}",
    "$result | ConvertTo-Json -Compress -Depth 4",
  ];
  return lines.join("\r\n");
}

async function verifyDomainCredentials(usernameInput:string,passwordInput:string){
  const secret=await connectionSecret();
  const username=usernameInput.trim();
  const password=passwordInput;
  if(!username||!password)return false;
  const lines=[
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.DirectoryServices",
    `$controller='${psQuote(secret.controller)}'`,
    `$port='${secret.port}'`,
    `$baseDn='${psQuote(secret.baseDn)}'`,
    `$username='${psQuote(username)}'`,
    `$password='${psQuote(password)}'`,
    `$provider='LDAP'`,
    `$protocol='${secret.useLdaps?'LDAPS':'LDAP'}'`,
    "$path=\"${provider}://${controller}:$port/$baseDn\"",
    "$authType=[System.DirectoryServices.AuthenticationTypes]::Secure -bor [System.DirectoryServices.AuthenticationTypes]::ServerBind",
    "if($protocol -eq 'LDAPS'){ $authType = $authType -bor [System.DirectoryServices.AuthenticationTypes]::SecureSocketsLayer }",
    "if($protocol -eq 'LDAP'){ $authType = $authType -bor [System.DirectoryServices.AuthenticationTypes]::Signing -bor [System.DirectoryServices.AuthenticationTypes]::Sealing }",
    "$entry=New-Object System.DirectoryServices.DirectoryEntry($path,$username,$password,$authType)",
    "$null=$entry.NativeObject",
    "[pscustomobject]@{ok=$true} | ConvertTo-Json -Compress",
  ];
  try{
    const output=await runPowerShell(lines.join("\r\n"),30_000);
    return Boolean(output&&JSON.parse(output)?.ok);
  }catch(error){
    const detail=error instanceof DomainConnectionError?error.detail:(error instanceof Error?error.message:String(error));
    if(/logon failure|unknown user name|bad password|invalid credentials|user name or password is incorrect|52e/i.test(detail))return false;
    throw error;
  }
}

async function upsertDomainUserForLogin(ad:AdUser,helpDeskBranchCode:string){
  const username=String(ad.samAccountName).trim().toLocaleLowerCase('tr-TR');
  const groups=Array.isArray(ad.groups)?ad.groups.map(String):[];
  const displayName=String(ad.displayName||username).trim().slice(0,100);
  const department=meaningfulDepartment(groups,String(ad.department||'')).trim().slice(0,120);
  const title=String(ad.title||'').trim().slice(0,120);
  const directoryUserPrincipalName=String(ad.userPrincipalName||'').trim().slice(0,254);
  const candidateEmail=String(ad.email||'').trim().toLocaleLowerCase('tr-TR');

  const existing=await prisma.user.findUnique({where:{username}});
  const emailOwner=candidateEmail?await prisma.user.findFirst({where:{email:candidateEmail},select:{id:true,username:true}}):null;
  const safeEmail=emailOwner&&emailOwner.username!==username?null:(candidateEmail||null);

  if(!existing){
    if(!ad.enabled)return null;
    const user=await prisma.user.create({data:{
      username,displayName,email:safeEmail,department,title,directoryGroups:groups,directoryUserPrincipalName,
      theme:'dark',passwordHash:await bcrypt.hash(crypto.randomUUID()+crypto.randomUUID(),12),permissions:EMPTY_PERMISSIONS,active:true,isAdmin:false,
      mustChangePassword:true,directorySource:'AD',directoryEnabled:true,directoryObjectGuid:String(ad.objectGuid||''),directoryLastSyncAt:new Date(),
      branchMemberships:{create:{branchCode:helpDeskBranchCode,isPrimary:true,permissions:EMPTY_PERMISSIONS,assignedById:'DOMAIN_SYNC'}},
    }});
    await prisma.helpDeskAccess.upsert({
      where:{userId_branchCode:{userId:user.id,branchCode:helpDeskBranchCode}},
      update:{active:true,canOpen:true,canStaff:false,canCoordinate:false,canRespond:false,assignedById:'DOMAIN_SYNC'},
      create:{userId:user.id,branchCode:helpDeskBranchCode,active:true,canOpen:true,canStaff:false,canCoordinate:false,canRespond:false,
        canChangeStatus:false,canReopen:false,canViewAll:false,canAssign:false,canClose:false,canReport:false,canTopics:false,
        canCannedReplies:false,canKnowledge:false,mutedEmail:false,assignedById:'DOMAIN_SYNC'},
    });
    return user;
  }

  if(existing.isAdmin)return existing;
  if(existing.directorySource!=='AD')return null;

  const user=await prisma.user.update({where:{id:existing.id},data:{
    displayName,
    email:safeEmail,
    department,
    title,
    active:Boolean(ad.enabled),
    directorySource:'AD',
    directoryGroups:groups,
    directoryUserPrincipalName,
    directoryEnabled:Boolean(ad.enabled),
    directoryObjectGuid:String(ad.objectGuid||''),
    directoryLastSyncAt:new Date(),
  }});

  if(!ad.enabled){
    await prisma.userSession.updateMany({
      where:{userId:existing.id,revokedAt:null},
      data:{revokedAt:new Date(),revokeReason:'Active Directory hesabı pasif/devre dışı.'},
    });
  }
  return user;
}

export async function syncDomainUserForLogin(usernameInput:string,passwordInput?:string){
  const row=await settingsRow();
  if(!row.domainSyncEnabled)return {checked:false,found:false,enabled:false,user:null};

  const username=usernameInput.trim().toLocaleLowerCase('tr-TR');
  if(!username)return {checked:true,found:false,enabled:false,user:null};

  const secret=await connectionSecret();
  const output=await runPowerShell(ldapSingleUserScript(secret,username),30_000);
  const parsed=output?JSON.parse(output):{found:false};

  if(!parsed?.found){
    const existing=await prisma.user.findUnique({where:{username}});
    if(existing?.directorySource==='AD'&&!existing.isAdmin){
      await prisma.user.update({
        where:{id:existing.id},
        data:{active:false,directoryEnabled:false,directoryLastSyncAt:new Date()},
      });
      await prisma.userSession.updateMany({
        where:{userId:existing.id,revokedAt:null},
        data:{revokedAt:new Date(),revokeReason:'Active Directory hesabı bulunamadı veya kaldırıldı.'},
      });
    }
    return {checked:true,found:false,enabled:false,user:null};
  }

  const ad:AdUser={
    samAccountName:String(parsed.samAccountName||''),
    displayName:String(parsed.displayName||''),
    email:String(parsed.email||''),
    department:String(parsed.department||''),
    title:String(parsed.title||''),
    userPrincipalName:String(parsed.userPrincipalName||''),
    enabled:Boolean(parsed.enabled),
    groups:Array.isArray(parsed.groups)?parsed.groups.map(String):[],
    objectGuid:String(parsed.objectGuid||''),
  };

  if(!ad.enabled)return {checked:true,found:true,enabled:false,user:await upsertDomainUserForLogin(ad,await informationTechnologyBranchCode()),credentialsValid:false};
  const credentialsValid=passwordInput===undefined?undefined:await verifyDomainCredentials(
    String(ad.userPrincipalName||ad.samAccountName||username),
    passwordInput,
  );
  if(credentialsValid===false)return {checked:true,found:true,enabled:true,user:await prisma.user.findUnique({where:{username}}),credentialsValid:false};
  const helpDeskBranchCode=await informationTechnologyBranchCode();
  const user=await upsertDomainUserForLogin(ad,helpDeskBranchCode);
  if(user&&credentialsValid===true){
    await prisma.user.update({where:{id:user.id},data:{passwordHash:await bcrypt.hash(passwordInput!,12)}});
  }
  return {checked:true,found:true,enabled:Boolean(ad.enabled),user,credentialsValid};
}

export async function testDomainConnection(){
  const secret=await connectionSecret();
  const output=await runPowerShell(ldapScript(secret,false),30_000);
  const probe=output?JSON.parse(output):null;
  if(!probe?.ok)throw new DomainConnectionError('DC_LDAP_ERROR','Domain Controller bağlantı testi geçerli sonuç döndürmedi.',output);
  return {ok:true as const,message:`Domain bağlantısı başarılı: ${secret.useLdaps?'LDAPS':'LDAP'}://${secret.controller}:${secret.port} · Base DN: ${secret.baseDn}`};
}
async function informationTechnologyBranchCode(){
  const branches=await prisma.branch.findMany({where:{active:true},orderBy:{code:'asc'}});
  return branches.find(r=>/bilgi\s*i[şs]lem/i.test(r.name))?.code||branches.find(r=>r.code==='105')?.code||'100';
}
let domainSyncInFlight:Promise<DomainSyncResult>|null=null;

type DomainSyncResult={total:number;created:number;updated:number;disabled:number;helpDeskBranchCode:string};

async function performDomainUsersSync():Promise<DomainSyncResult>{
  const row=await settingsRow();if(!row.domainSyncEnabled)throw new Error('Domain otomatik kullanıcı senkronu aktif değil.');
  const secret=await connectionSecret();const output=await runPowerShell(ldapScript(secret,true),180_000);
  const parsed=output?JSON.parse(output):[];const users:AdUser[]=(Array.isArray(parsed)?parsed:[parsed]).filter(i=>String(i.samAccountName||'').trim());
  const existingAdCount=await prisma.user.count({where:{directorySource:'AD',isAdmin:false}});
  if(existingAdCount>0&&users.length===0){
    throw new DomainConnectionError(
      'DC_EMPTY_SYNC_RESULT',
      'Domain senkronu boş kullanıcı listesi döndürdü; mevcut OPERİS kullanıcıları güvenlik amacıyla pasifleştirilmedi.',
      `Mevcut AD kullanıcı sayısı: ${existingAdCount}. LDAP sonucu: 0.`,
    );
  }
  const helpDeskBranchCode=await informationTechnologyBranchCode();const seenUserIds=new Set<string>();let created=0,updated=0;
  for(const ad of users){
    const username=String(ad.samAccountName).trim().toLocaleLowerCase('tr-TR');const displayName=String(ad.displayName||username).trim().slice(0,100);
    const groups=Array.isArray(ad.groups)?ad.groups.map(String):[];
    const department=meaningfulDepartment(groups,String(ad.department||'')).trim().slice(0,120);
    const title=String(ad.title||'').trim().slice(0,120);
    const directoryUserPrincipalName=String(ad.userPrincipalName||'').trim().slice(0,254);
    const candidateEmail=String(ad.email||'').trim().toLocaleLowerCase('tr-TR');
    const existing=await prisma.user.findUnique({where:{username}});
    const emailOwner=candidateEmail?await prisma.user.findFirst({where:{email:candidateEmail},select:{id:true,username:true}}):null;
    const safeEmail=emailOwner&&emailOwner.username!==username?null:(candidateEmail||null);
    if(!existing){
      const passwordHash=await bcrypt.hash(crypto.randomUUID()+crypto.randomUUID(),12);
      const user=await prisma.user.create({data:{
        username,displayName,email:safeEmail,department,title,directoryGroups:groups,directoryUserPrincipalName,theme:'dark',passwordHash,permissions:EMPTY_PERMISSIONS,active:Boolean(ad.enabled),isAdmin:false,
        mustChangePassword:true,directorySource:'AD',directoryEnabled:Boolean(ad.enabled),directoryObjectGuid:String(ad.objectGuid||''),directoryLastSyncAt:new Date(),
        branchMemberships:{create:{branchCode:helpDeskBranchCode,isPrimary:true,permissions:EMPTY_PERMISSIONS,assignedById:'DOMAIN_SYNC'}},
      }});
      await prisma.helpDeskAccess.upsert({
        where:{userId_branchCode:{userId:user.id,branchCode:helpDeskBranchCode}},
        update:{active:true,canOpen:true,canStaff:false,canCoordinate:false,canRespond:false,assignedById:'DOMAIN_SYNC'},
        create:{userId:user.id,branchCode:helpDeskBranchCode,active:true,canOpen:true,canStaff:false,canCoordinate:false,canRespond:false,
          canChangeStatus:false,canReopen:false,canViewAll:false,canAssign:false,canClose:false,canReport:false,canTopics:false,
          canCannedReplies:false,canKnowledge:false,mutedEmail:false,assignedById:'DOMAIN_SYNC'},
      });
      seenUserIds.add(user.id);created++;continue;
    }
    // Aynı kullanıcı adına sahip OPERİS yerel hesabını AD hesabına dönüştürme.
    // LOCAL hesabın parolası, profil bilgileri, yetkileri ve şube atamaları OPERİS'e aittir.
    if(existing.directorySource!=='AD')continue;
    seenUserIds.add(existing.id);
    // permissions, UserBranch ve HelpDeskAccess kayıtlarına dokunmaz; yönetici yetkileri korunur.
    if(!existing.isAdmin){
      const dcChanges:Array<{field:string;label:string;oldValue:unknown;newValue:unknown}>=[];
      const track=(field:string,label:string,oldValue:unknown,newValue:unknown)=>{
        if(JSON.stringify(oldValue??null)!==JSON.stringify(newValue??null))dcChanges.push({field,label,oldValue:oldValue??null,newValue:newValue??null});
      };
      track('displayName','Ad Soyad',existing.displayName,displayName);
      track('email','E-posta',existing.email,safeEmail);
      track('department','Birim / Departman',existing.department,department);
      track('title','Ünvan',existing.title,title);
      track('directoryGroups','DC Grupları',existing.directoryGroups,groups);
      track('directoryUserPrincipalName','UPN',existing.directoryUserPrincipalName,directoryUserPrincipalName);
      track('directoryEnabled','DC Aktiflik',existing.directoryEnabled,Boolean(ad.enabled));
      track('directoryObjectGuid','DC Object GUID',existing.directoryObjectGuid,String(ad.objectGuid||''));
      await prisma.user.update({where:{id:existing.id},data:{
        displayName,email:safeEmail,department,title,
        active:Boolean(ad.enabled),directorySource:'AD',directoryGroups:groups,directoryUserPrincipalName,
        directoryEnabled:Boolean(ad.enabled),directoryObjectGuid:String(ad.objectGuid||''),directoryLastSyncAt:new Date()
      }});
      if(dcChanges.length){
        await prisma.auditLog.create({data:{
          branchCode:'100',userId:existing.id,username:existing.username,displayName:existing.displayName,
          action:'DOMAIN_SYNC_CHANGE',module:'USERS',recordId:existing.id,recordLabel:existing.username,
          description:`DC senkronunda ${dcChanges.length} kullanıcı alanı değişti.`,
          oldData:JSON.stringify(Object.fromEntries(dcChanges.map(c=>[c.field,c.oldValue]))),
          newData:JSON.stringify({changes:dcChanges}),
        }});
      }
      if(!ad.enabled)await prisma.userSession.updateMany({where:{userId:existing.id,revokedAt:null},data:{revokedAt:new Date()}});
      updated++;
    }
  }
  // LDAP liste sorgusunun eksik/yarım sonuç döndürmesi mevcut kullanıcıları yanlışlıkla pasifleştirmemeli.
  // Bir AD hesabı yalnız LDAP kaydı açıkça enabled=false dönerse (yukarıdaki döngü)
  // veya login-time tek kullanıcı kontrolünde artık bulunamazsa pasifleştirilir.
  const disabled=users.filter(ad=>!ad.enabled).length;
  const result=`AD kullanıcı senkronu tamamlandı. Toplam:${users.length} yeni:${created} güncel:${updated} DC-pasif:${disabled}`;
  await prisma.appSettings.update({where:{id:1},data:{domainLastSyncAt:new Date(),domainLastSyncResult:result}});
  return {total:users.length,created,updated,disabled,helpDeskBranchCode};
}

export async function syncDomainUsers():Promise<DomainSyncResult>{
  if(domainSyncInFlight)return domainSyncInFlight;
  domainSyncInFlight=performDomainUsersSync();
  try{return await domainSyncInFlight;}
  finally{domainSyncInFlight=null;}
}
let timer:NodeJS.Timeout|null=null;
export function startDomainSyncScheduler(){
  if(timer)return;
  const scheduleNext=async()=>{
    const row=await settingsRow();
    const minutes=Math.max(1,Math.min(1440,row.domainSyncIntervalMinutes||60));
    const delayMs=minutes*60_000;
    timer=setTimeout(async()=>{
      try{
        if((await settingsRow()).domainSyncEnabled)await syncDomainUsers();
      }catch(error){
        console.error('[DOMAIN SYNC]',error);
        try{
          await prisma.appSettings.update({
            where:{id:1},
            data:{
              domainLastSyncAt:new Date(),
              domainLastSyncResult:`HATA: ${error instanceof Error?error.message:String(error)}`.slice(0,1000),
            },
          });
        }catch{}
      }finally{
        timer=null;
        void scheduleNext();
      }
    },delayMs);
    timer.unref?.();
  };
  void scheduleNext();
}
