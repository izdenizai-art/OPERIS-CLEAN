import { useMemo, useState } from 'react';
import { KeyRound, UserRoundCheck } from 'lucide-react';
import type { SessionUser } from '@/lib/types';

type Input = {
  displayName: string;
  email: string;
  department: string;
  title: string;
  password?: string;
};

type Props = {
  user: SessionUser;
  onSave: (input: Input) => Promise<void>;
};

const strongPassword = (value: string) =>
  value.length >= 8 &&
  /[A-ZÇĞİÖŞÜ]/u.test(value) &&
  /[a-zçğıöşü]/u.test(value) &&
  /[0-9]/.test(value) &&
  /[^\p{L}\p{N}\s]/u.test(value);

const corporateEmail = (value: string) => /^[^\s@]+@[^\s@]+\.com\.tr$/i.test(value.trim());

export default function ForcePasswordChange({ user, onSave }: Props) {
  const isDomainUser=user.directorySource==='AD';
  const [displayName,setDisplayName]=useState(user.displayName ?? '');
  const [email,setEmail]=useState(user.email ?? '');
  const [department,setDepartment]=useState(user.department ?? '');
  const [title,setTitle]=useState(user.title ?? '');
  const [password,setPassword]=useState('');
  const [again,setAgain]=useState('');
  const [busy,setBusy]=useState(false);
  const [serverError,setServerError]=useState('');
  const [submitted,setSubmitted]=useState(false);

  const errors=useMemo(()=>({
    displayName:displayName.trim().length>=3?'':'Ad Soyad zorunludur.',
    email:corporateEmail(email)?'':'E-posta adresi @ içermeli ve .com.tr ile bitmelidir.',
    department:department.trim().length>=2?'':'Çalıştığınız birim zorunludur.',
    title:title.trim().length>=2?'':'Ünvan zorunludur.',
    password:isDomainUser||strongPassword(password)?'':'Şifre belirtilen güvenlik formatına uygun değildir.',
    again:isDomainUser||(password&&again===password)?'':'Şifre tekrar alanı aynı olmalıdır.',
  }),[displayName,email,department,title,password,again,isDomainUser]);

  const valid=Object.values(errors).every(value=>!value);
  const fieldClass=(error:string)=>`form-control ${submitted&&error?'!bg-red-950/70 !text-red-50 !ring-red-500':''}`;

  async function save(){
    setSubmitted(true);
    setServerError('');
    if(!valid)return;
    setBusy(true);
    try{
      await onSave({
        displayName:displayName.trim(),
        email:email.trim().toLocaleLowerCase('tr-TR'),
        department:department.trim(),
        title:title.trim(),
        ...(!isDomainUser?{password}:{}),
      });
    }catch(error){
      setServerError(error instanceof Error?error.message:'İlk giriş bilgileri kaydedilemedi.');
    }finally{
      setBusy(false);
    }
  }

  return <div className="min-h-screen bg-slate-950 px-4 py-8 text-white">
    <div className="mx-auto max-w-xl rounded-2xl bg-slate-900 p-6 ring-1 ring-slate-700">
      <div className="mb-5 flex items-start gap-3">
        <UserRoundCheck className="mt-0.5 h-7 w-7 shrink-0 text-cyan-300"/>
        <div>
          <h1 className="text-xl font-bold">{isDomainUser?'İlk Oturum Bilgi Doğrulaması':'İlk Oturum Bilgi ve Şifre Doğrulaması'}</h1>
          <p className="mt-1 text-sm text-slate-400">{isDomainUser?'Domain bilgileriniz getirildi. OPERİS\'e devam etmek için bilgileri kontrol edin; giriş parolanız Active Directory parolanız olarak kalır.':'OPERİS\'e devam etmek için bilgilerinizi kontrol edin ve kişisel şifrenizi oluşturun.'}</p>
          <p className="mt-2 text-xs font-semibold text-cyan-200">Domain kullanıcı adı: {user.username}{user.directoryUserPrincipalName ? ` · ${user.directoryUserPrincipalName}` : ''}</p>
          {user.directoryGroups?.length>0&&<p className="mt-1 text-xs text-slate-400">Domain grupları: {user.directoryGroups.join(', ')}</p>}
        </div>
      </div>

      {serverError&&<div className="mb-4 rounded-xl bg-red-950/80 p-3 text-sm font-semibold text-red-100 ring-1 ring-red-500">HATA: {serverError}</div>}

      <div className="space-y-3">
        <Field label="Ad Soyad" error={submitted?errors.displayName:''}>
          <input autoFocus value={displayName} onChange={e=>setDisplayName(e.target.value)} className={fieldClass(errors.displayName)} />
        </Field>
        <Field label="E-posta (.com.tr zorunlu)" error={submitted?errors.email:''}>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className={fieldClass(errors.email)} placeholder="kullanici@kurum.com.tr"/>
        </Field>
        <Field label="Çalıştığı Birim" error={submitted?errors.department:''}>
          <input value={department} onChange={e=>setDepartment(e.target.value)} className={fieldClass(errors.department)} />
        </Field>
        <Field label="Ünvan" error={submitted?errors.title:''}>
          <input value={title} onChange={e=>setTitle(e.target.value)} className={fieldClass(errors.title)} />
        </Field>

        {!isDomainUser && <>
        <div className="rounded-xl bg-slate-950/60 p-4 ring-1 ring-slate-700">
          <div className="mb-3 flex items-center gap-2"><KeyRound className="h-5 w-5 text-cyan-300"/><h2 className="font-semibold">Yeni Şifre</h2></div>
          <Field label="Yeni şifre" error={submitted?errors.password:''}>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className={fieldClass(errors.password)} />
          </Field>
          <div className="mt-3">
            <Field label="Yeni şifre tekrar" error={submitted?errors.again:''}>
              <input type="password" value={again} onChange={e=>setAgain(e.target.value)} className={fieldClass(errors.again)} />
            </Field>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-slate-300">
            <li>• En az 8 karakter</li>
            <li>• En az 1 büyük harf</li>
            <li>• En az 1 küçük harf</li>
            <li>• En az 1 rakam</li>
            <li>• En az 1 özel karakter</li>
          </ul>
        </div>
        </>}

        <button type="button" disabled={busy} onClick={()=>void save()} className="action-button primary-button w-full">
          {busy?'Kaydediliyor…':isDomainUser?'Bilgilerimi Doğrula ve Devam Et':'Bilgilerimi Doğrula, Şifremi Değiştir ve Devam Et'}
        </button>
      </div>
    </div>
  </div>;
}

function Field({label,error,children}:{label:string;error:string;children:React.ReactNode}){
  return <label className="block">
    <span className="mb-1 block text-xs font-bold text-slate-300">{label}</span>
    {children}
    {error&&<span className="mt-1 block rounded-md bg-red-950/80 px-2 py-1 text-xs font-bold text-red-100 ring-1 ring-red-500">HATA: {error}</span>}
  </label>;
}
