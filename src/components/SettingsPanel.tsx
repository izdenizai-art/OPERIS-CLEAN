import { useEffect, useRef, useState } from 'react';
import {
  Bell, ChevronDown, ChevronUp, Database, Download, FileImage, FileSpreadsheet,
  Info, Mail, Network, Save, Settings2, ShieldCheck, Upload, Users, Vibrate, Volume2,
} from 'lucide-react';
import type { AuditLog, BackupSettings, BrandingSettings, Settings } from '@/lib/types';
import type { LicenseStatus, MailTestResult, ReleaseInfo, SystemPerformanceMetrics } from '@/lib/api';
import { api } from '@/lib/api';
import AuditLogPanel from './AuditLogPanel';
import ActiveSessionsPanel from './ActiveSessionsPanel';
import DomainNetworkPanel from './DomainNetworkPanel';
import DomainSyncPanel from './DomainSyncPanel';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onExportTasks: () => void;
  onImportExcel: (file: File) => Promise<void>;
  onDownloadTemplate: () => void;
  onChangePassword: () => void;
  onTestAlert: () => void;
  onSaveMailSettings: (mail: Settings['mail'] & { smtpPassword?: string }) => Promise<void>;
  onVerifyMail: () => Promise<MailTestResult>;
  onTestMail: (email: string) => Promise<MailTestResult>;
  onSaveGraphMailSettings: (input: {
    mailProvider: 'smtp' | 'graph';
    graphEnabled: boolean;
    graphTenantId: string;
    graphClientId: string;
    graphClientSecret?: string;
    graphSenderUser: string;
  }) => Promise<void>;
  onTestGraphMail: (email: string) => Promise<void>;
  onBackupDatabase: () => Promise<void>;
  onRestoreDatabase: (file: File) => Promise<void>;
  onSaveBranding: (branding: BrandingSettings) => Promise<void>;
  onSaveBackupSettings: (backup: BackupSettings) => Promise<void>;
  onTestNetworkBackup: () => Promise<void>;
  onApplyBackupSchedule: () => Promise<void>;
  auditLogs: AuditLog[];
  onRefreshAuditLogs: () => Promise<void>;
  isAdmin: boolean;
  releaseInfo: ReleaseInfo | null;
  onShowReleaseNotes: () => void;
  currentUsername: string;
  currentUserId: string;
  licenseStatus: LicenseStatus | null;
  onUpdateLicense: (expiresAt: string | null) => Promise<void>;
  children?: React.ReactNode;
}

type SectionKey = 'branding' | 'notifications' | 'mail' | 'data' | 'backup' | 'access' | 'audit' | 'sessions' | 'performance' | 'domain' | 'users' | 'license' | 'about';

export default function SettingsPanel(props: Props) {
  const [open, setOpen] = useState<SectionKey>('branding');
  const [mail, setMail] = useState(props.settings.mail);
  const [backup, setBackup] = useState(props.settings.backup);
  const [branding, setBranding] = useState(props.settings.branding);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [graphSecret, setGraphSecret] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [mailTestResult, setMailTestResult] = useState<MailTestResult | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [licenseDate, setLicenseDate] = useState('');
  const [remoteAccess, setRemoteAccess] = useState<{
    mode: 'SERVER_ONLY' | 'LOCAL_NETWORK' | 'ALL_ALLOWED';
    bindHost: string;
    port: number;
    serverAddresses: string[];
    localhostAvailable: boolean;
    firewall?: { applied: boolean; reason: string };
  } | null>(null);
  const [remoteAccessBusy, setRemoteAccessBusy] = useState(false);
  const [performance, setPerformance] = useState<SystemPerformanceMetrics | null>(null);
  const [performanceError, setPerformanceError] = useState('');

  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMail(props.settings.mail), [props.settings.mail]);
  useEffect(() => setBackup(props.settings.backup), [props.settings.backup]);
  useEffect(() => setBranding(props.settings.branding), [props.settings.branding]);
  useEffect(() => {
    if (!props.isAdmin) return;
    void api.getRemoteAccessSettings().then(setRemoteAccess).catch(() => setRemoteAccess(null));
  }, [props.isAdmin]);

  useEffect(() => {
    if (!props.isAdmin || open !== 'performance') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await api.getSystemPerformance();
        if (!cancelled) {
          setPerformance(next);
          setPerformanceError('');
        }
      } catch (error) {
        if (!cancelled) setPerformanceError(error instanceof Error ? error.message : 'Performans bilgisi alınamadı.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, props.isAdmin]);

  useEffect(() => {
    if (props.licenseStatus?.expiresAt) {
      const date = new Date(props.licenseStatus.expiresAt);
      setLicenseDate(new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    } else {
      setLicenseDate('');
    }
  }, [props.licenseStatus]);

  const selectLogo = (file?: File) => {
    if (!file) return;
    if (file.type !== 'image/jpeg') {
      alert('Yalnızca JPEG/JPG logo yüklenebilir.');
      return;
    }
    if (file.size > 1_500_000) {
      alert('Logo en fazla 1,5 MB olabilir.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBranding(current => ({ ...current, companyLogoDataUrl: String(reader.result ?? '') }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <Accordion title="Şirket ve Logo" icon={<FileImage className="h-5 w-5" />} active={open === 'branding'} onToggle={() => setOpen(open === 'branding' ? 'about' : 'branding')}>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <div className="space-y-3">
            <input value={branding.companyName} onChange={e => setBranding({ ...branding, companyName: e.target.value })}
              placeholder="Şirket adı" className="form-control" />
            <label className="action-button secondary-button cursor-pointer">
              <Upload className="h-4 w-4" /> JPEG Logo Seç
              <input type="file" accept=".jpg,.jpeg,image/jpeg" className="hidden" onChange={e => selectLogo(e.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => setBranding({ ...branding, companyLogoDataUrl: '' })} className="action-button secondary-button">
              Logoyu Kaldır
            </button>

            <div className="space-y-2 rounded-xl border border-slate-700/70 bg-slate-900/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-200">Giriş Ekranı Hızlı Bağlantıları</div>
                  <div className="text-xs text-slate-400">En fazla 12 bağlantı. Yalnızca http:// veya https:// adresleri kabul edilir.</div>
                </div>
                <button
                  type="button"
                  disabled={branding.quickLinks.length >= 12}
                  onClick={() => setBranding(current => ({
                    ...current,
                    quickLinks: [
                      ...current.quickLinks,
                      { id: crypto.randomUUID(), label: 'Yeni Bağlantı', url: 'https://', active: true },
                    ],
                  }))}
                  className="action-button secondary-button disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Bağlantı Ekle
                </button>
              </div>

              {branding.quickLinks.map((link, index) => (
                <div key={link.id} className="grid gap-2 rounded-lg border border-slate-700/60 p-2 sm:grid-cols-[1fr_1.6fr_auto_auto]">
                  <input
                    value={link.label}
                    onChange={event => setBranding(current => ({
                      ...current,
                      quickLinks: current.quickLinks.map(item => item.id === link.id ? { ...item, label: event.target.value } : item),
                    }))}
                    placeholder={`Bağlantı ${index + 1} adı`}
                    className="form-control"
                  />
                  <input
                    value={link.url}
                    onChange={event => setBranding(current => ({
                      ...current,
                      quickLinks: current.quickLinks.map(item => item.id === link.id ? { ...item, url: event.target.value } : item),
                    }))}
                    placeholder="https://..."
                    className="form-control"
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={link.active}
                      onChange={event => setBranding(current => ({
                        ...current,
                        quickLinks: current.quickLinks.map(item => item.id === link.id ? { ...item, active: event.target.checked } : item),
                      }))}
                    />
                    Aktif
                  </label>
                  <button
                    type="button"
                    onClick={() => setBranding(current => ({
                      ...current,
                      quickLinks: current.quickLinks.filter(item => item.id !== link.id),
                    }))}
                    className="action-button secondary-button"
                  >
                    Kaldır
                  </button>
                </div>
              ))}
            </div>

            <button type="button" onClick={async () => { await props.onSaveBranding(branding); alert('Şirket bilgileri kaydedildi.'); }} className="action-button primary-button">
              <Save className="h-4 w-4" /> Şirket Bilgilerini Kaydet
            </button>
          </div>
          <div className="flex min-h-32 items-center justify-center rounded-xl bg-slate-900/50 p-3 ring-1 ring-slate-700">
            {branding.companyLogoDataUrl ? <img src={branding.companyLogoDataUrl} alt="Şirket logosu" className="max-h-28 max-w-full object-contain" /> : <span className="text-xs text-slate-500">Logo önizlemesi</span>}
          </div>
        </div>
      </Accordion>

      <Accordion title="Bildirim ve Uyarılar" icon={<Bell className="h-5 w-5" />} active={open === 'notifications'} onToggle={() => setOpen(open === 'notifications' ? 'about' : 'notifications')}>
        <label className="block text-sm text-slate-300">Uyarı süresi: {props.settings.notifyMinutesBefore} dakika</label>
        <input type="range" min={1} max={120} value={props.settings.notifyMinutesBefore}
          onChange={e => props.onChange({ ...props.settings, notifyMinutesBefore: Number(e.target.value) })} className="w-full accent-sky-500" />
        <Toggle icon={<Vibrate className="h-4 w-4" />} label="Titreşim ve sarsıntı" checked={props.settings.shakeEnabled}
          onChange={value => props.onChange({ ...props.settings, shakeEnabled: value })} />
        <Toggle icon={<Volume2 className="h-4 w-4" />} label="Sesli uyarı" checked={props.settings.soundEnabled}
          onChange={value => props.onChange({ ...props.settings, soundEnabled: value })} />
        <button type="button" onClick={props.onTestAlert} className="action-button warning-button w-full">Uyarıyı Test Et</button>
      </Accordion>

      <Accordion title="E-posta, Exchange ve Microsoft Graph" icon={<Mail className="h-5 w-5" />} active={open === 'mail'} onToggle={() => setOpen(open === 'mail' ? 'about' : 'mail')}>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMail({ ...mail, mailProvider: 'smtp' })}
            className={`action-button ${mail.mailProvider === 'smtp' ? 'primary-button' : 'secondary-button'}`}>
            SMTP
          </button>
          <button type="button" onClick={() => setMail({ ...mail, mailProvider: 'graph' })}
            className={`action-button ${mail.mailProvider === 'graph' ? 'primary-button' : 'secondary-button'}`}>
            Microsoft Graph OAuth2
          </button>
        </div>

        {mail.mailProvider === 'smtp' ? (
          <>
            <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-white">Gmail Hazır Ayarları</p>
                  <p className="text-xs text-slate-400">Gmail için normal hesap şifresi değil, 2 Adımlı Doğrulama sonrası oluşturulan 16 haneli Uygulama Şifresi kullanılmalıdır.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setMail({
                    ...mail,
                    mailProvider: 'smtp',
                    smtpEnabled: true,
                    smtpHost: 'smtp.gmail.com',
                    smtpPort: 587,
                    smtpSecure: false,
                    smtpFrom: mail.smtpFrom || mail.smtpUser,
                  })} className="action-button secondary-button">
                    Gmail 587 · STARTTLS
                  </button>
                  <button type="button" onClick={() => setMail({
                    ...mail,
                    mailProvider: 'smtp',
                    smtpEnabled: true,
                    smtpHost: 'smtp.gmail.com',
                    smtpPort: 465,
                    smtpSecure: true,
                    smtpFrom: mail.smtpFrom || mail.smtpUser,
                  })} className="action-button secondary-button">
                    Gmail 465 · SSL
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <input value={mail.smtpHost} onChange={e => { setMail({ ...mail, smtpHost: e.target.value }); setMailTestResult(null); }} placeholder="SMTP sunucusu" className="form-control" />
              <input type="number" value={mail.smtpPort} onChange={e => { setMail({ ...mail, smtpPort: Number(e.target.value) }); setMailTestResult(null); }} placeholder="Port" className="form-control" />
              <input value={mail.smtpUser} onChange={e => {
                const value=e.target.value;
                setMail({ ...mail, smtpUser: value, smtpFrom: mail.smtpFrom || value });
                setMailTestResult(null);
              }} placeholder="Gmail adresi / SMTP kullanıcı adı" className="form-control" />
              <input type="password" value={smtpPassword} onChange={e => { setSmtpPassword(e.target.value); setMailTestResult(null); }}
                placeholder={mail.smtpPasswordSet ? 'Uygulama şifresi kayıtlı · değiştirmek için yazın' : 'Gmail 16 haneli uygulama şifresi'} className="form-control" />
              <input value={mail.smtpFrom} onChange={e => { setMail({ ...mail, smtpFrom: e.target.value }); setMailTestResult(null); }}
                placeholder="Gönderen e-posta" className="form-control" />
              <select value={mail.smtpSecure ? 'ssl' : 'starttls'} onChange={e => setMail({
                ...mail,
                smtpSecure: e.target.value === 'ssl',
                smtpPort: e.target.value === 'ssl' ? 465 : 587,
              })} className="form-control">
                <option value="starttls">STARTTLS · Port 587</option>
                <option value="ssl">SSL/TLS · Port 465</option>
              </select>
            </div>

            <Toggle icon={<Mail className="h-4 w-4" />} label="SMTP etkin" checked={mail.smtpEnabled}
              onChange={value => { setMail({ ...mail, smtpEnabled: value }); setMailTestResult(null); }} />

            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" disabled={mailBusy} onClick={async () => {
                setMailBusy(true);
                setMailTestResult(null);
                try {
                  await props.onSaveMailSettings({ ...mail, mailProvider: 'smtp', ...(smtpPassword ? { smtpPassword } : {}) });
                  setSmtpPassword('');
                  setMailTestResult({
                    ok: true,
                    stage: 'configuration',
                    message: 'SMTP ayarları Operis veritabanına kaydedildi. Bağlantıyı Sına ile Gmail erişimini doğrulayın.',
                    host: mail.smtpHost,
                    port: mail.smtpPort,
                    secure: mail.smtpSecure,
                    user: mail.smtpUser,
                    from: mail.smtpFrom,
                    accepted: [],
                    rejected: [],
                    response: '',
                    code: '',
                  });
                } catch (error) {
                  setMailTestResult({
                    ok: false,
                    stage: 'configuration',
                    message: error instanceof Error ? error.message : 'SMTP ayarları kaydedilemedi.',
                    host: mail.smtpHost,
                    port: mail.smtpPort,
                    secure: mail.smtpSecure,
                    user: mail.smtpUser,
                    from: mail.smtpFrom,
                    accepted: [],
                    rejected: [],
                    response: '',
                    code: '',
                  });
                } finally {
                  setMailBusy(false);
                }
              }} className="action-button primary-button">
                <Save className="h-4 w-4" /> {mailBusy ? 'İşleniyor…' : 'Ayarları Kaydet'}
              </button>

              <button type="button" disabled={mailBusy} onClick={async () => {
                setMailBusy(true);
                setMailTestResult(null);
                try {
                  setMailTestResult(await props.onVerifyMail());
                } catch (error) {
                  setMailTestResult({
                    ok: false,
                    stage: 'connection',
                    message: error instanceof Error ? error.message : 'SMTP bağlantısı sınanamadı.',
                    host: mail.smtpHost,
                    port: mail.smtpPort,
                    secure: mail.smtpSecure,
                    user: mail.smtpUser,
                    from: mail.smtpFrom,
                    accepted: [],
                    rejected: [],
                    response: '',
                    code: '',
                  });
                } finally {
                  setMailBusy(false);
                }
              }} className="action-button secondary-button">
                <Network className="h-4 w-4" /> Bağlantıyı Sına
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="Test e-postasının gönderileceği adres" className="form-control" />
              <button type="button" disabled={mailBusy || !testEmail.trim()} onClick={async () => {
                setMailBusy(true);
                setMailTestResult(null);
                try {
                  setMailTestResult(await props.onTestMail(testEmail.trim()));
                } catch (error) {
                  setMailTestResult({
                    ok: false,
                    stage: 'send',
                    message: error instanceof Error ? error.message : 'Test e-postası gönderilemedi.',
                    host: mail.smtpHost,
                    port: mail.smtpPort,
                    secure: mail.smtpSecure,
                    user: mail.smtpUser,
                    from: mail.smtpFrom,
                    accepted: [],
                    rejected: [],
                    response: '',
                    code: '',
                  });
                } finally {
                  setMailBusy(false);
                }
              }} className="action-button secondary-button">
                <Mail className="h-4 w-4" /> Test E-postası Gönder
              </button>
            </div>

            <div className={`rounded-xl border p-3 ${
              mailTestResult
                ? mailTestResult.ok
                  ? 'border-emerald-500/35 bg-emerald-500/10'
                  : 'border-red-500/35 bg-red-500/10'
                : 'border-slate-700 bg-slate-900/40'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className={mailTestResult?.ok ? 'text-emerald-300' : mailTestResult ? 'text-red-300' : 'text-slate-300'}>
                  {mailTestResult
                    ? mailTestResult.ok
                      ? '● ÇALIŞIYOR'
                      : '● HATA'
                    : '● HENÜZ SINANMADI'}
                </strong>
                {mailTestResult && <span className="text-[11px] uppercase tracking-wide text-slate-400">
                  Aşama: {mailTestResult.stage}
                </span>}
              </div>
              <p className="mt-2 text-sm text-slate-200">
                {mailTestResult?.message ?? 'Ayarları kaydedin, ardından Bağlantıyı Sına veya Test E-postası Gönder seçeneğini kullanın.'}
              </p>
              {mailTestResult && (
                <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                  <span>Sunucu: {mailTestResult.host || '—'}:{mailTestResult.port || '—'}</span>
                  <span>Güvenlik: {mailTestResult.secure ? 'SSL/TLS' : 'STARTTLS'}</span>
                  <span>Kullanıcı: {mailTestResult.user || '—'}</span>
                  <span>Gönderen: {mailTestResult.from || '—'}</span>
                  {mailTestResult.code && <span>Hata kodu: {mailTestResult.code}</span>}
                  {mailTestResult.response && <span className="sm:col-span-2">SMTP yanıtı: {mailTestResult.response}</span>}
                  {mailTestResult.accepted.length > 0 && <span className="sm:col-span-2">Kabul edilen: {mailTestResult.accepted.join(', ')}</span>}
                  {mailTestResult.rejected.length > 0 && <span className="sm:col-span-2 text-red-300">Reddedilen: {mailTestResult.rejected.join(', ')}</span>}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-cyan-500/10 p-3 text-xs leading-5 text-slate-300 ring-1 ring-cyan-500/25">
              Entra ID uygulamasına Microsoft Graph <strong>Application permission: Mail.Send</strong> eklenmeli ve yönetici onayı verilmelidir.
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={mail.graphTenantId} onChange={e => setMail({ ...mail, graphTenantId: e.target.value })} placeholder="Tenant ID (Directory ID)" className="form-control" />
              <input value={mail.graphClientId} onChange={e => setMail({ ...mail, graphClientId: e.target.value })} placeholder="Client ID (Application ID)" className="form-control" />
              <input type="password" value={graphSecret} onChange={e => setGraphSecret(e.target.value)}
                placeholder={mail.graphClientSecretSet ? 'Client Secret kayıtlı' : 'Client Secret Value'} className="form-control" />
              <input type="email" value={mail.graphSenderUser} onChange={e => setMail({ ...mail, graphSenderUser: e.target.value })}
                placeholder="Gönderen posta kutusu" className="form-control" />
            </div>
            <Toggle icon={<Mail className="h-4 w-4" />} label="Microsoft Graph etkin" checked={mail.graphEnabled}
              onChange={value => setMail({ ...mail, graphEnabled: value })} />
            <button type="button" onClick={async () => {
              await props.onSaveGraphMailSettings({
                mailProvider: 'graph',
                graphEnabled: mail.graphEnabled,
                graphTenantId: mail.graphTenantId,
                graphClientId: mail.graphClientId,
                graphSenderUser: mail.graphSenderUser,
                ...(graphSecret ? { graphClientSecret: graphSecret } : {}),
              });
              setGraphSecret('');
              alert('Microsoft Graph OAuth2 ayarları kaydedildi.');
            }} className="action-button primary-button w-full">
              <Save className="h-4 w-4" /> Graph OAuth2 Ayarlarını Kaydet
            </button>
            <div className="flex gap-2">
              <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="Test adresi" className="form-control" />
              <button type="button" onClick={() => void props.onTestGraphMail(testEmail)} className="action-button secondary-button">Graph Test</button>
            </div>
          </>
        )}

        <Toggle icon={<Bell className="h-4 w-4" />} label="Hatırlatma e-postası etkin" checked={mail.reminderEmailEnabled}
          onChange={value => setMail({ ...mail, reminderEmailEnabled: value })} />
      </Accordion>

      <Accordion title="Excel ve Veri Aktarımı" icon={<FileSpreadsheet className="h-5 w-5" />} active={open === 'data'} onToggle={() => setOpen(open === 'data' ? 'about' : 'data')}>
        <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && void props.onImportExcel(e.target.files[0])} />
        <button type="button" onClick={() => importRef.current?.click()} className="action-button primary-button w-full"><Upload className="h-4 w-4" /> Excel’den Yükle</button>
        <button type="button" onClick={props.onDownloadTemplate} className="action-button secondary-button w-full"><Download className="h-4 w-4" /> Şablon İndir</button>
        <button type="button" onClick={props.onExportTasks} className="action-button success-solid-button w-full"><Download className="h-4 w-4" /> Excel’e Aktar</button>
      </Accordion>

      {props.isAdmin && (
        <Accordion title="Sunucu Dışı Erişim" icon={<ShieldCheck className="h-5 w-5" />} active={open === 'access'} onToggle={() => setOpen(open === 'access' ? 'about' : 'access')}>
          {!remoteAccess ? (
            <p className="text-sm text-slate-400">Erişim durumu yükleniyor veya okunamadı.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-950/35 p-3 ring-1 ring-slate-700/60">
                <p className="font-semibold text-white">OPERİS yayın adresi: http://{remoteAccess.bindHost}:{remoteAccess.port}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Sunucunun kendi IP adreslerinden erişim her zaman açık kalır. DNS adı sunucunun kendi IP'sine çözülüyorsa sunucu üzerinden erişim devam eder.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Sunucu IP'leri: {remoteAccess.serverAddresses.length ? remoteAccess.serverAddresses.join(', ') : remoteAccess.bindHost}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  ['SERVER_ONLY', 'Sadece Sunucu', 'Başka bilgisayarlardan IP/DNS erişimini kapatır.'],
                  ['LOCAL_NETWORK', 'Yerel Ağ', 'Sunucu ve aynı yerel subnet erişebilir.'],
                  ['ALL_ALLOWED', 'Tüm İzinli Ağlar', 'Firewall/network tarafından ulaşabilen istemcilere izin verir.'],
                ] as const).map(([mode, label, description]) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={remoteAccessBusy}
                    onClick={async () => {
                      if (mode === 'SERVER_ONLY' && !confirm('Sunucu dışındaki mevcut oturumlar erişimi kaybedecek. Sunucu konsolundan seçili sunucu IP adresiyle erişim açık kalacaktır. Devam edilsin mi?')) return;
                      setRemoteAccessBusy(true);
                      try {
                        const result = await api.updateRemoteAccessSettings(mode);
                        setRemoteAccess(result);
                        alert(`Sunucu dışı erişim modu: ${label}\n${result.firewall?.reason ?? 'Backend erişim filtresi güncellendi.'}`);
                      } catch (error) {
                        alert(error instanceof Error ? error.message : 'Erişim modu güncellenemedi.');
                      } finally {
                        setRemoteAccessBusy(false);
                      }
                    }}
                    className={`rounded-xl border p-3 text-left transition ${
                      remoteAccess.mode === mode
                        ? 'border-sky-400 bg-sky-500/15 ring-1 ring-sky-400/40'
                        : 'border-slate-700 bg-slate-900/50 hover:border-sky-500/50'
                    }`}
                  >
                    <span className="block font-bold text-white">{label}</span>
                    <span className="mt-1 block text-xs text-slate-400">{description}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-lg bg-slate-950/35 p-3 text-xs text-slate-400 ring-1 ring-slate-700/60">
                Aktif mod: <strong className="text-cyan-300">{remoteAccess.mode}</strong>.
                {remoteAccess.firewall && <> Windows Firewall: {remoteAccess.firewall.applied ? 'uygulandı' : 'uygulanamadı'} — {remoteAccess.firewall.reason}</>}
              </div>
            </div>
          )}
        </Accordion>
      )}

      <Accordion title="Yedekleme, Network ve Zamanlama" icon={<Database className="h-5 w-5" />} active={open === 'backup'} onToggle={() => setOpen(open === 'backup' ? 'about' : 'backup')}>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await props.onBackupDatabase(); } finally { setBusy(false); } }} className="action-button success-solid-button">
            <Download className="h-4 w-4" /> Tam Yedek Al
          </button>
          <button type="button" onClick={() => restoreRef.current?.click()} className="action-button warning-button">
            <Upload className="h-4 w-4" /> Yedeği Geri Yükle
          </button>
          <input ref={restoreRef} type="file" accept=".zip" className="hidden" onChange={e => e.target.files?.[0] && void props.onRestoreDatabase(e.target.files[0])} />
        </div>

        <Toggle icon={<Network className="h-4 w-4" />} label="Network yedekleme" checked={backup.networkBackupEnabled}
          onChange={value => setBackup({ ...backup, networkBackupEnabled: value })} />
        <input value={backup.networkBackupPath} onChange={e => setBackup({ ...backup, networkBackupPath: e.target.value })}
          placeholder="\\SUNUCU\PAYLASIM\YaklasanIsler" className="form-control" />

        <Toggle icon={<Settings2 className="h-4 w-4" />} label="Zamanlanmış görev etkin" checked={backup.backupScheduleEnabled}
          onChange={value => setBackup({ ...backup, backupScheduleEnabled: value })} />
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={backup.backupScheduleType} onChange={e => setBackup({ ...backup, backupScheduleType: e.target.value as BackupSettings['backupScheduleType'] })} className="form-control">
            <option value="daily">Her gün</option><option value="weekly">Haftalık</option><option value="hourly">Saatlik</option>
          </select>
          <input type="time" value={backup.backupScheduleTime} onChange={e => setBackup({ ...backup, backupScheduleTime: e.target.value })} className="form-control" />
          <input type="number" min={1} max={3650} value={backup.backupRetentionDays} onChange={e => setBackup({ ...backup, backupRetentionDays: Number(e.target.value) })} className="form-control" />
        </div>
        <button type="button" onClick={async () => { await props.onSaveBackupSettings(backup); alert('Yedek ayarları kaydedildi.'); }} className="action-button primary-button w-full"><Save className="h-4 w-4" /> Yedek Ayarlarını Kaydet</button>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={props.onTestNetworkBackup} className="action-button secondary-button">Network Yolunu Test Et</button>
          <button type="button" onClick={props.onApplyBackupSchedule} className="action-button secondary-button">Zamanlanmış Görevi Uygula</button>
        </div>
        <p className="text-xs text-slate-500">Bu bölüm yalnızca yetkili yönetici tarafından kullanılabilir. Network paylaşım izinleri Windows hesabına göre uygulanır.</p>
      </Accordion>


      {props.isAdmin && (
        <Accordion title="Sistem Performansı" icon={<Settings2 className="h-5 w-5" />} active={open === 'performance'} onToggle={() => setOpen(open === 'performance' ? 'about' : 'performance')}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-white">Canlı Sunucu ve OPERIS Yükü</p>
                <p className="text-xs text-slate-400">3 saniyede bir yenilenir. Kapasite değerlendirmesi için anlık görünüm sağlar.</p>
              </div>
              {performance && <span className={performanceStatus(performance).className}>{performanceStatus(performance).label}</span>}
            </div>

            {performanceError && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">{performanceError}</div>}

            {performance ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PerformanceCard title="CPU">
                    <div>Sistem: <strong>{performance.system.systemCpuPercent.toFixed(1)}%</strong></div>
                    <div>OPERIS: <strong>{performance.operis.processCpuPercent.toFixed(1)}%</strong></div>
                    <div>{performance.system.logicalProcessors} vCPU · {performance.system.cpuModel || 'CPU'}</div>
                  </PerformanceCard>
                  <PerformanceCard title="RAM">
                    <div>Kullanım: <strong>{performance.system.memoryUsedPercent.toFixed(1)}%</strong></div>
                    <div>{formatBytes(performance.system.usedMemoryBytes)} / {formatBytes(performance.system.totalMemoryBytes)}</div>
                    <div>OPERIS: {formatBytes(performance.operis.processMemoryBytes)} · Boş: {formatBytes(performance.system.freeMemoryBytes)}</div>
                  </PerformanceCard>
                  <PerformanceCard title="Aktif Oturum ve API Yükü">
                    <div>Aktif Oturum: <strong>{performance.users.activeSessions}</strong></div>
                    <div>RPS: <strong>{performance.traffic.requestsPerSecond.toFixed(2)}</strong> · Son 60 sn: {performance.traffic.requestCount60s}</div>
                    <div>API p95: {performance.traffic.p95LatencyMs.toFixed(0)} ms · HTTP hata: %{performance.traffic.httpErrorRatePercent.toFixed(2)}</div>
                  </PerformanceCard>
                  <PerformanceCard title="PostgreSQL">
                    <div>Bağlantı: <strong>{performance.database.connectionCount}</strong> / {performance.database.maxConnections}</div>
                    <div>Aktif sorgu: {performance.database.activeConnections}</div>
                    <div>Veritabanı: {formatBytes(performance.database.databaseSizeBytes)}</div>
                  </PerformanceCard>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{performance.system.hostName} · {performance.system.platform} {performance.system.release} · {performance.system.architecture}</span>
                  <span>Son ölçüm: {new Date(performance.sampledAt).toLocaleTimeString('tr-TR')}</span>
                </div>
              </>
            ) : (
              <div className="rounded-xl bg-slate-800/50 p-4 text-sm text-slate-400 ring-1 ring-slate-700">Performans bilgisi yükleniyor…</div>
            )}
          </div>
        </Accordion>
      )}
      {props.isAdmin && (
        <Accordion title="Ayrıntılı İşlem Geçmişi" icon={<Settings2 className="h-5 w-5" />} active={open === 'audit'} onToggle={() => setOpen(open === 'audit' ? 'about' : 'audit')}>
          <AuditLogPanel logs={props.auditLogs} onRefresh={props.onRefreshAuditLogs} />
        </Accordion>
      )}

      {props.children && <Accordion title="Kullanıcı Yönetimi" icon={<Settings2 className="h-5 w-5" />} active={open === 'users'} onToggle={() => setOpen(open === 'users' ? 'about' : 'users')}>{props.children}</Accordion>}




      {props.isAdmin && (
        <Accordion title="Domain, Cihaz ve Ağ Bilgi Sorgulama" icon={<Network className="h-5 w-5" />} active={open === 'domain'} onToggle={() => setOpen(open === 'domain' ? 'about' : 'domain')}>
          <DomainSyncPanel />
          <DomainNetworkPanel />
        </Accordion>
      )}

      {props.isAdmin && (
        <Accordion title="Çevrimiçi Kullanıcılar ve Oturumlar" icon={<Users className="h-5 w-5" />} active={open === 'sessions'} onToggle={() => setOpen(open === 'sessions' ? 'about' : 'sessions')}>
          <ActiveSessionsPanel currentUserId={props.currentUserId} />
        </Accordion>
      )}

      {props.currentUsername.toLocaleLowerCase('tr-TR') === 'balamir' && (
        <Accordion title="Lisans Süresi" icon={<Settings2 className="h-5 w-5" />} active={open === 'license'} onToggle={() => setOpen(open === 'license' ? 'about' : 'license')}>
          <div className="space-y-3">
            <div className={`rounded-xl p-3 text-sm ring-1 ${
              props.licenseStatus?.expired
                ? 'bg-red-500/10 text-red-200 ring-red-500/30'
                : 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/30'
            }`}>
              <p className="font-bold">{props.licenseStatus?.expired ? 'Lisans süresi dolmuş veya saat geri alma tespit edilmiş.' : 'Lisans erişimi aktif.'}</p>
              <p className="mt-1 text-xs opacity-80">
                Zaman kaynağı: {props.licenseStatus?.timeSource ?? '—'}
                {props.licenseStatus?.clockRollbackDetected ? ' · Saat geri alma tespit edildi' : ''}
              </p>
            </div>
            <label className="block text-sm font-semibold text-slate-300">Lisans bitiş tarihi ve saati</label>
            <input type="datetime-local" value={licenseDate} onChange={e => setLicenseDate(e.target.value)} className="form-control" />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={async () => {
                if (!licenseDate) return alert('Lisans bitiş tarihini girin.');
                await props.onUpdateLicense(new Date(licenseDate).toISOString());
              }} className="action-button primary-button">
                <Save className="h-4 w-4" /> Lisans Süresini Kaydet
              </button>
              <button type="button" onClick={async () => {
                if (!confirm('Lisans süresiz yapılsın mı?')) return;
                await props.onUpdateLicense(null);
              }} className="action-button secondary-button">
                Süresiz Yap
              </button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Bu alanı yalnızca balamir kullanıcısı görebilir. Lisans süresi dolduğunda diğer kullanıcıların giriş ve API erişimi engellenir.
            </p>
          </div>
        </Accordion>
      )}

      <Accordion title="Hakkında" icon={<Info className="h-5 w-5" />} active={open === 'about'} onToggle={() => setOpen(open === 'about' ? 'branding' : 'about')}>
        <div className="rounded-xl bg-slate-800/60 p-4 ring-1 ring-slate-700">
          <div className="operis-rainbow-text text-xl font-black">Operis Enterprise</div>
          <p className="mt-2 text-sm font-bold text-white">
            Sürüm {props.releaseInfo?.version ?? '6.3.62'} {props.releaseInfo?.name ? `· ${props.releaseInfo.name}` : ''}
          </p>
          <p className="mt-1 text-sm text-slate-400">Kurumsal operasyon, demirbaş başlangıç modülü, güvenli güncelleme ve kullanıcı istemcisi yenileme altyapısı.</p>
          <button type="button" onClick={props.onShowReleaseNotes} className="action-button secondary-button mt-4">
            <Info className="h-4 w-4" /> Yenilikleri Gör
          </button>
        </div>
      </Accordion>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return value.toFixed(unit >= 3 ? 1 : 0) + ' ' + units[unit];
}

function performanceStatus(metrics: SystemPerformanceMetrics): { label: string; className: string } {
  const peak = Math.max(metrics.system.systemCpuPercent, metrics.system.memoryUsedPercent);
  if (peak >= 90 || metrics.traffic.serverErrorRatePercent >= 1) {
    return { label: 'Kritik', className: 'rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold text-red-300 ring-1 ring-red-500/30' };
  }
  if (peak >= 75 || metrics.traffic.p95LatencyMs >= 1500) {
    return { label: 'Yüksek', className: 'rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300 ring-1 ring-amber-500/30' };
  }
  return { label: 'Normal', className: 'rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/30' };
}

function PerformanceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-800/55 p-3 text-sm text-slate-300 ring-1 ring-slate-700">
      <div className="mb-2 font-bold text-white">{title}</div>
      <div className="space-y-1 text-xs leading-5">{children}</div>
    </div>
  );
}
function Accordion({ title, icon, active, onToggle, children }: { title: string; icon: React.ReactNode; active: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-2xl bg-slate-900/60 ring-1 ring-slate-700">
    <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
      <span className="flex items-center gap-2 font-semibold text-white">{icon}{title}</span>
      {active ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
    </button>
    {active && <div className="space-y-3 border-t border-slate-700 p-4">{children}</div>}
  </section>;
}

function Toggle({ icon, label, checked, onChange }: { icon: React.ReactNode; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between py-2">
    <span className="flex items-center gap-2 text-sm text-slate-300">{icon}{label}</span>
    <span className={`relative h-6 w-11 rounded-full ${checked ? 'bg-sky-500' : 'bg-slate-600'}`}>
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </span>
  </button>;
}
