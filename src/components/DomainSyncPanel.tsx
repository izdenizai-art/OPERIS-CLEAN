import { useEffect, useState } from 'react';
import { RefreshCw, Save, ServerCog, TestTube2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { DomainSyncSettings } from '@/lib/types';

const EMPTY:DomainSyncSettings={enabled:false,controller:'',useLdaps:true,port:636,baseDn:'',username:'',passwordSet:false,intervalMinutes:60,lastSyncAt:null,lastSyncResult:''};

export default function DomainSyncPanel(){
  const [settings,setSettings]=useState<DomainSyncSettings>(EMPTY);
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const load=async()=>setSettings(await api.getDomainSyncSettings());
  useEffect(()=>{void load();},[]);
  const payload=()=>({enabled:settings.enabled,controller:settings.controller,useLdaps:settings.useLdaps,port:settings.port,baseDn:settings.baseDn,
    username:settings.username,password:password||undefined,intervalMinutes:settings.intervalMinutes});
  return <section className="mt-4 space-y-3 rounded-xl bg-slate-950/35 p-4 ring-1 ring-slate-700/60">
    <div className="flex items-center gap-2"><ServerCog className="h-5 w-5 text-cyan-300"/><div>
      <h4 className="font-semibold text-white">Domain Controller Bağlantısı ve Kullanıcı Senkronu</h4>
      <p className="text-xs text-slate-400">Windows Server 2016+ AD DS · varsayılan LDAPS/636. DC bağlıyken 15 sn aralıkla değişiklikler izlenir; DC kesilirse daha önce aktarılmış aktif kullanıcılar OPERİS yerel kimlik bilgileriyle oturum açmaya devam eder.</p>
    </div></div>
    <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={settings.enabled} onChange={e=>setSettings(c=>({...c,enabled:e.target.checked}))}/> Otomatik domain kullanıcı senkronu aktif</label>
    <div className="grid gap-3 md:grid-cols-2">
      <input className="form-control" value={settings.controller} onChange={e=>setSettings(c=>({...c,controller:e.target.value}))} placeholder="Domain Controller"/>
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="flex items-center gap-2 rounded-xl bg-slate-900/70 px-3 text-sm text-slate-300 ring-1 ring-slate-700">
          <input type="checkbox" checked={settings.useLdaps} onChange={e=>setSettings(c=>({...c,useLdaps:e.target.checked,port:e.target.checked?636:389}))}/> LDAPS / TLS
        </label>
        <input type="number" min={1} max={65535} className="form-control" value={settings.port} onChange={e=>setSettings(c=>({...c,port:Number(e.target.value)||(c.useLdaps?636:389)}))}/>
      </div>
      <input className="form-control" value={settings.baseDn} onChange={e=>setSettings(c=>({...c,baseDn:e.target.value}))} placeholder="Base DN (DC=domain,DC=local)"/>
      <input className="form-control" value={settings.username} onChange={e=>setSettings(c=>({...c,username:e.target.value}))} placeholder="DOMAIN\\kullanici veya UPN"/>
      <input type="password" className="form-control" value={password} onChange={e=>setPassword(e.target.value)} placeholder={settings.passwordSet?'Parola kayıtlı — değiştirmek için yeni parola':'Yetkili kullanıcı parolası'}/>
      <label className="text-sm text-slate-300">Senkron aralığı (dk)<input type="number" min={1} step={1} max={1440} className="form-control mt-1" value={settings.intervalMinutes}
        onChange={e=>setSettings(c=>({...c,intervalMinutes:Number(e.target.value)||1}))}/></label>
    </div>
    <div className="grid gap-2 sm:grid-cols-3">
      <button disabled={busy} onClick={async()=>{setBusy(true);try{setSettings(await api.updateDomainSyncSettings(payload()));setPassword('');setMessage('Kaydedildi.');}catch(e){setMessage(e instanceof Error?e.message:'Kaydedilemedi.');}finally{setBusy(false);}}} className="action-button primary-button"><Save className="h-4 w-4"/> Kaydet</button>
      <button disabled={busy} onClick={async()=>{setBusy(true);try{await api.updateDomainSyncSettings(payload());const r=await api.testDomainSyncConnection();setMessage(r.message);setPassword('');await load();}catch(e){setMessage(e instanceof Error?e.message:'Bağlantı başarısız.');}finally{setBusy(false);}}} className="action-button secondary-button"><TestTube2 className="h-4 w-4"/> Bağlantıyı Test Et</button>
      <button disabled={busy||!settings.enabled} onClick={async()=>{setBusy(true);try{const r=await api.runDomainSync();setMessage(`Toplam ${r.total}, yeni ${r.created}, güncel ${r.updated}, pasif ${r.disabled}.`);await load();}catch(e){setMessage(e instanceof Error?e.message:'Senkron başarısız.');}finally{setBusy(false);}}} className="action-button secondary-button"><RefreshCw className="h-4 w-4"/> Şimdi Senkronla</button>
    </div>
    {message&&<p className="rounded-lg bg-slate-900/70 p-2 text-sm text-cyan-200">{message}</p>}
    <p className="text-xs text-slate-500">Yeni AD kullanıcıları normal OPERİS kullanıcısıdır; ilk kayıtta yalnız Bilgi İşlem Help Desk ticket açma/kendi ticketını takip etme hakkı alır. Sonraki OPERİS yetkilerini yönetici verir.</p>
  </section>;
}
