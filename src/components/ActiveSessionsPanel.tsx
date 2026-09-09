import { useEffect, useMemo, useState } from 'react';
import { Laptop, LogOut, MonitorSmartphone, RefreshCw, Router, ShieldAlert, Smartphone, Tablet } from 'lucide-react';
import { api, type ActiveSession } from '@/lib/api';

const isSuperAdminUsername = (value: string) =>
  value.trim().normalize('NFKC').replace(/[Iİı]/g, 'i').toLowerCase() === 'balamir';

export default function ActiveSessionsPanel({ currentUserId }: { currentUserId: string }) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [deviceName, setDeviceName] = useState(() => localStorage.getItem('operis-device-name') ?? '');

  const load = async () => {
    setBusy(true);
    try {
      setSessions(await api.getActiveSessions());
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Oturumlar alınamadı.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const active = useMemo(
    () => sessions.filter(session => !session.revokedAt).sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeenAt - a.lastSeenAt),
    [sessions],
  );

  const saveDeviceName = () => {
    const clean = deviceName.trim().slice(0, 120);
    if (!clean) return alert('Cihaz adı boş olamaz.');
    localStorage.setItem('operis-device-name', clean);
    alert('Cihaz adı kaydedildi. Yeni oturum açıldığında bu ad kullanılacaktır.');
  };

  const revoke = async (session: ActiveSession) => {
    const own = session.userId === currentUserId;
    if (!confirm(`${session.displayName} kullanıcısının "${session.deviceName}" oturumu sonlandırılsın mı?${own ? '\n\nBu sizin oturumunuz olabilir ve uygulamadan çıkış yapabilirsiniz.' : ''}`)) return;
    await api.revokeSession(session.id);
    await load();
  };

  const revokeAll = async (session: ActiveSession) => {
    if (!confirm(`${session.displayName} kullanıcısının tüm aktif oturumları sonlandırılsın mı?`)) return;
    const result = await api.revokeUserSessions(session.userId);
    alert(`${result.count} oturum sonlandırıldı.`);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-900/55 p-3 ring-1 ring-slate-700">
        <label className="text-sm font-bold text-slate-200">Bu cihazın Operis adı</label>
        <div className="mt-2 flex gap-2">
          <input value={deviceName} onChange={event => setDeviceName(event.target.value)} maxLength={120}
            className="form-control" placeholder="Örn. Balamir iPad Mini 6" />
          <button type="button" onClick={saveDeviceName} className="action-button secondary-button shrink-0">Kaydet</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Cihaz adı yeni oturum açılışında kaydedilir. Tarayıcı güvenliği nedeniyle bilgisayar adı otomatik alınamaz.</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-bold text-white">Aktif oturumlar</p>
          <p className="text-xs text-slate-400">Son 5 dakika içinde etkin olanlar çevrimiçi kabul edilir.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} className="action-button secondary-button">
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      <div className="space-y-2">
        {active.length === 0 && <div className="rounded-xl bg-slate-900/50 p-5 text-center text-sm text-slate-500">Aktif oturum bulunmuyor.</div>}
        {active.map(session => (
          <article key={session.id} className="rounded-xl bg-slate-900/60 p-3 ring-1 ring-slate-700">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <div className={`mt-0.5 rounded-xl p-2 ${session.online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                  <DeviceIcon type={session.deviceType} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-white">{session.displayName}</p>
                    <span className="text-xs text-slate-400">@{session.username}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${session.online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
                      {session.online ? 'Çevrimiçi' : 'Çevrimdışı'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-cyan-200">{session.deviceName}</p>
                  <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                    <span>{session.deviceType} · {session.operatingSystem}</span>
                    <span>{session.browser}</span>
                    <span className="flex items-center gap-1"><Router className="h-3.5 w-3.5" /> IP: {session.ipAddress || '—'}</span>
                    <span>Son etkinlik: {new Date(session.lastSeenAt).toLocaleString('tr-TR')}</span>
                    <span>Oturum açılışı: {new Date(session.createdAt).toLocaleString('tr-TR')}</span>
                    <span>MAC: {session.macAvailable ? session.macAddress : 'İstemci Yardımcısı gerekli'}</span>
                  </div>
                </div>
              </div>

              {(!isSuperAdminUsername(session.username) || session.userId===currentUserId) ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void revoke(session)} className="action-button warning-button">
                    <LogOut className="h-4 w-4" /> Oturumu Sonlandır
                  </button>
                  <button type="button" onClick={() => void revokeAll(session)} className="action-button danger-button">
                    <ShieldAlert className="h-4 w-4" /> Tüm Oturumlar
                  </button>
                </div>
              ) : (
                <p className="text-xs font-semibold text-violet-300">Süper Admin oturumu korumalıdır.</p>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DeviceIcon({ type }: { type: string }) {
  if (type === 'Tablet') return <Tablet className="h-5 w-5" />;
  if (type === 'Telefon') return <Smartphone className="h-5 w-5" />;
  if (type === 'Bilgisayar') return <Laptop className="h-5 w-5" />;
  return <MonitorSmartphone className="h-5 w-5" />;
}
