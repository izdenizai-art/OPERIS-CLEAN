import { execFile } from 'node:child_process';
import { prisma } from './db.js';

export function normalizeClientIp(value: string | null | undefined) {
  const raw = String(value ?? '').split(',')[0].trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

export async function observeMacAddress(ip: string) {
  if (!ip || process.platform !== 'win32' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return '';
  return new Promise<string>((resolve) => {
    execFile('arp.exe',['-a',ip],{windowsHide:true,timeout:2500,encoding:'utf8'},(_error,stdout)=>{
      const match=String(stdout||'').match(/(?:[0-9a-f]{2}[-:]){5}[0-9a-f]{2}/i);
      resolve(match?.[0]?.replaceAll('-',':').toUpperCase()??'');
    });
  });
}

export async function activeLoginBlock(ipAddress: string) {
  if (!ipAddress) return null;
  const row=await prisma.loginSecurityBlock.findUnique({where:{ipAddress}});
  if (!row?.active || !row.blockedUntil) return null;
  if (row.blockedUntil.getTime()<=Date.now()) {
    await prisma.loginSecurityBlock.update({
      where:{ipAddress},
      data:{active:false,clearedAt:new Date(),reason:`${row.reason} | Süre doldu`},
    });
    return null;
  }
  return row;
}

async function upsertBlock(ipAddress:string,macAddress:string,minutes:number,strikeLevel:number,reason:string){
  const now=new Date();
  const blockedUntil=new Date(now.getTime()+minutes*60_000);
  return prisma.loginSecurityBlock.upsert({
    where:{ipAddress},
    update:{macAddress,strikeLevel,lastStrikeAt:now,blockedUntil,reason,active:true,clearedAt:null,clearedById:'',clearedByName:''},
    create:{ipAddress,macAddress,strikeLevel,lastStrikeAt:now,blockedUntil,reason,active:true},
  });
}

export async function recordFailedLogin(usernameAttempt:string,ipAddress:string,macAddress:string){
  const now=new Date();
  await prisma.loginSecurityEvent.create({
    data:{usernameAttempt:usernameAttempt.slice(0,120),ipAddress,macAddress,success:false,reason:'Kullanıcı adı veya şifre hatalı'},
  });
  const fiveMinutesAgo=new Date(now.getTime()-5*60_000);
  const oneHourAgo=new Date(now.getTime()-60*60_000);
  const [recentFive,recentHour,state]=await Promise.all([
    prisma.loginSecurityEvent.findMany({
      where:{ipAddress,success:false,createdAt:{gte:fiveMinutesAgo}},
      select:{usernameAttempt:true,createdAt:true},orderBy:{createdAt:'desc'},take:200,
    }),
    prisma.loginSecurityEvent.count({where:{ipAddress,success:false,createdAt:{gte:oneHourAgo}}}),
    prisma.loginSecurityBlock.findUnique({where:{ipAddress}}),
  ]);
  const distinctUsers=new Set(recentFive.map(i=>i.usernameAttempt.toLocaleLowerCase('tr-TR')).filter(Boolean)).size;
  if (recentFive.length>=20 || distinctUsers>=8) {
    return upsertBlock(ipAddress,macAddress,60,Math.max(3,state?.strikeLevel??0),
      `Yoğun başarısız giriş denemesi (${recentFive.length} deneme / ${distinctUsers} farklı kullanıcı adı / 5 dk)`);
  }
  const lastStrikeAt=state?.lastStrikeAt?.getTime()??0;
  const withinHourOfStrike=lastStrikeAt>0 && now.getTime()-lastStrikeAt<=60*60_000;
  const failuresSinceStrike=withinHourOfStrike
    ? await prisma.loginSecurityEvent.count({where:{ipAddress,success:false,createdAt:{gt:state!.lastStrikeAt!}}})
    : recentHour;
  if (withinHourOfStrike && failuresSinceStrike>=4) {
    return upsertBlock(ipAddress,macAddress,15,Math.max(2,state?.strikeLevel??1),'Bir saat içinde ikinci 4 başarısız giriş serisi');
  }
  if (!withinHourOfStrike && recentHour>=4) {
    return upsertBlock(ipAddress,macAddress,5,1,'4 başarısız giriş denemesi');
  }
  return null;
}

export async function recordSuccessfulLogin(username:string,ipAddress:string,macAddress:string){
  await prisma.loginSecurityEvent.create({
    data:{usernameAttempt:username.slice(0,120),ipAddress,macAddress,success:true,reason:'Başarılı giriş'},
  });
}

export async function clearLoginBlock(ipAddress:string,admin:{id:string;displayName:string;username:string}){
  const row=await prisma.loginSecurityBlock.findUnique({where:{ipAddress}});
  if(!row) return null;
  return prisma.loginSecurityBlock.update({
    where:{ipAddress},
    data:{active:false,blockedUntil:null,clearedAt:new Date(),clearedById:admin.id,clearedByName:admin.displayName||admin.username,
      reason:`${row.reason} | Yönetici tarafından kaldırıldı`},
  });
}
