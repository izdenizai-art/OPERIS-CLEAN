import { useState } from 'react';
import { Lock, CheckCircle2, KeyRound, UserRound, Mail } from 'lucide-react';
import loginOceanBackground from '@/assets/operis-login-ocean.png';

interface Props {
  hasUsers: boolean;
  hasLegacyPassword: boolean;
  onLogin: (username: string, password: string) => Promise<boolean>;
  onInitialSetup: (username: string, displayName: string, email: string, password: string) => Promise<boolean>;
  onLegacyMigration: (username: string, displayName: string, email: string, password: string) => Promise<boolean>;
  onForgotPassword: (email: string) => Promise<void>;
  onResetPassword: (token: string, password: string) => Promise<void>;
  branding?: { companyName: string; companyLogoDataUrl: string; quickLinks: Array<{ id: string; label: string; url: string; active: boolean }> };
  version: string;
}

export default function LoginScreen({ hasUsers, hasLegacyPassword, onLogin, onInitialSetup, onLegacyMigration, onForgotPassword, onResetPassword, branding, version }: Props) {
  const firstSetup = !hasUsers && !hasLegacyPassword;
  const legacySetup = !hasUsers && hasLegacyPassword;
  const resetToken = new URLSearchParams(window.location.search).get('resetToken') ?? '';
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>(resetToken ? 'reset' : 'login');
  const [username, setUsername] = useState(firstSetup || legacySetup ? 'balamir' : '');
  const [displayName, setDisplayName] = useState(legacySetup ? 'Yönetici' : '');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setMessage(''); setBusy(true);
    try {
      if (mode === 'forgot') {
        if (!email.includes('@')) throw new Error('Geçerli bir e-posta adresi girin.');
        await onForgotPassword(email);
        setMessage('Adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi.');
        return;
      }
      if (mode === 'reset') {
        if (pw.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
        if (pw !== pw2) throw new Error('Şifreler eşleşmiyor.');
        await onResetPassword(resetToken, pw);
        history.replaceState({}, '', window.location.pathname);
        setMode('login'); setPw(''); setPw2('');
        setMessage('Şifreniz yenilendi. Yeni şifrenizle giriş yapabilirsiniz.');
        return;
      }
      if (!username.trim()) throw new Error('Kullanıcı adı zorunludur.');
      if (!pw) throw new Error('Şifre zorunludur.');
      // En az 8 karakter kuralı yalnız yeni şifre oluştururken uygulanır.
      // Mevcut/legacy kullanıcıların daha kısa eski şifrelerle giriş yapması engellenmez.
      if (!hasUsers && pw.length < 8) throw new Error('Yeni şifre en az 8 karakter olmalı.');
      if (!hasUsers && !email.includes('@')) throw new Error('Geçerli bir e-posta adresi girin.');
      if ((firstSetup || legacySetup) && pw !== pw2) throw new Error('Şifreler eşleşmiyor.');
      const ok = hasUsers
        ? await onLogin(username, pw)
        : legacySetup
          ? await onLegacyMigration(username, displayName, email, pw)
          : await onInitialSetup(username, displayName, email, pw);
      if (!ok) throw new Error(hasUsers || legacySetup ? 'Kullanıcı adı veya şifre hatalı.' : 'Kurulum tamamlanamadı.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem başarısız.');
    } finally { setBusy(false); }
  };

  return (
    <div
      style={{ backgroundImage: `linear-gradient(rgba(3,10,24,.28), rgba(3,10,24,.46)), url(${loginOceanBackground})` }}
      className="login-screen relative min-h-screen flex items-center justify-center p-6"
    >
      <aside className="login-quick-links login-glass fixed left-6 top-6 z-10 hidden w-72 rounded-2xl border border-white/15 p-4 shadow-2xl lg:block">
        <div className="space-y-2">
          {(branding?.quickLinks ?? []).filter(link => link.active).map(link => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="login-quick-link"
            >
              {link.label}
            </a>
          ))}
        </div>
      </aside>

      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-6 flex flex-col items-center text-center">
          {branding?.companyName && <p className="mb-3 text-lg font-bold tracking-wide text-cyan-200">{branding.companyName}</p>}
          {branding?.companyLogoDataUrl ? (
            <img src={branding.companyLogoDataUrl} alt={branding.companyName || 'Şirket logosu'}
              className="login-logo-glass mb-3 max-h-24 max-w-[260px] rounded-xl object-contain" />
          ) : (
            <div className="login-logo-glass mb-3 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-cyan-400/30">
              {mode === 'forgot' ? <Mail className="h-8 w-8 text-cyan-300" /> : hasUsers ? <Lock className="h-8 w-8 text-cyan-300" /> : <UserRound className="h-8 w-8 text-cyan-300" />}
            </div>
          )}
          <h1 className={`text-2xl font-bold ${hasUsers && mode === 'login' ? 'operis-rainbow-text' : 'text-white'}`}>
            {mode === 'forgot' ? 'Şifremi Unuttum' : mode === 'reset' ? 'Yeni Şifre' : hasUsers ? 'Operis' : 'İlk Kullanıcı Kurulumu'}
          </h1>
          {hasUsers && mode === 'login' && <p className="mt-1 text-xs text-slate-400">Operasyon ve İş Yönetim Sistemi</p>}
        </div>
        <form onSubmit={submit} className="login-form-glass rounded-2xl p-6 border border-white/70 ring-1 ring-white/20 space-y-4">
          {mode === 'forgot' ? (
            <div><label className="block text-sm text-slate-300 mb-2">E-posta</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoFocus className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none" placeholder="ornek@firma.com" /></div>
          ) : mode === 'reset' ? (
            <>
              <Password label="Yeni Şifre" value={pw} onChange={setPw} />
              <Password label="Yeni Şifre Tekrar" value={pw2} onChange={setPw2} />
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Kullanıcı Adı</label>
                <input
                  value={username}
                  onChange={e=>setUsername(e.target.value)}
                  readOnly={firstSetup || legacySetup}
                  autoFocus
                  className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none read-only:cursor-not-allowed read-only:opacity-70"
                  placeholder="balamir"
                />
                {(firstSetup || legacySetup) && <p className="mt-1 text-xs text-violet-300">İlk kurulum hesabı Süper Admin olarak balamir kullanıcı adıyla oluşturulur.</p>}
              </div>
              {!hasUsers && <div><label className="block text-sm text-slate-300 mb-2">Ad Soyad</label><input value={displayName} onChange={e=>setDisplayName(e.target.value)} className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none" /></div>}
              {!hasUsers && <div><label className="block text-sm text-slate-300 mb-2">E-posta</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none" placeholder="ornek@firma.com" /></div>}
              <Password label="Şifre" value={pw} onChange={setPw} />
              {!hasUsers && <Password label="Şifre Tekrar" value={pw2} onChange={setPw2} />}
            </>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {message && <p className="text-emerald-400 text-sm">{message}</p>}
          <button disabled={busy} className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-5 h-5" /> {busy ? 'İşleniyor…' : mode === 'forgot' ? 'Sıfırlama Bağlantısı Gönder' : mode === 'reset' ? 'Şifreyi Yenile' : hasUsers ? 'Giriş Yap' : 'Yönetici Kullanıcıyı Oluştur'}
          </button>
          {hasUsers && mode === 'login' && <button type="button" onClick={()=>setMode('forgot')} className="w-full text-sm text-sky-300 hover:text-sky-200">Şifremi unuttum</button>}
          {mode !== 'login' && <button type="button" onClick={()=>setMode('login')} className="w-full text-sm text-slate-300">Giriş ekranına dön</button>}
        </form>
        <div className="login-prepared-by mt-9 text-center text-xs text-slate-500"><span className="block text-slate-500">Hazırlayan</span><span className="login-prepared-name font-black text-white">BalamirK.</span><div className="mt-2 text-[11px] text-slate-500">v{version}</div></div>
      </div>
    </div>
  );
}
function Password({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}) {
  return <div><label className="block text-sm text-slate-300 mb-2">{label}</label><input type="password" value={value} onChange={e=>onChange(e.target.value)} className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none" placeholder="En az 8 karakter" /></div>;
}