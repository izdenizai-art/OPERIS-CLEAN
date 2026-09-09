import { useMemo, useState } from 'react';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { AuditLog } from '@/lib/types';

interface Props {
  logs: AuditLog[];
  onRefresh: () => Promise<void>;
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Giriş Yapıldı', CREATE: 'Kayıt Eklendi', UPDATE: 'Kayıt Güncellendi',
  DELETE: 'Kayıt Silindi', RESTORE: 'Kayıt Geri Yüklendi', SEND_MAIL: 'E-posta Gönderildi',
  TEST_MAIL: 'E-posta Testi', ACKNOWLEDGE: 'Onaylandı', REVOKE: 'Oturum Sonlandırıldı',
  REVOKE_ALL: 'Tüm Oturumlar Sonlandırıldı', LOCK_ACQUIRE: 'Düzenleme Kilidi Alındı',
  LOCK_REFRESH: 'Düzenleme Kilidi Yenilendi', LOCK_RELEASE: 'Düzenleme Kilidi Bırakıldı',
  LOCK_FORCE_RELEASE: 'Düzenleme Kilidi Zorla Kaldırıldı', QUERY: 'Sorgu Yapıldı', QUERY_ERROR: 'Sorgu Hatası',
};

const MODULE_LABELS: Record<string, string> = {
  AUTH: 'Kimlik Doğrulama', TASKS: 'Yaklaşan İşler', TRACKING: 'Takip Kayıtları',
  CREDENTIALS: 'Şifreler / Erişim Bilgileri', RELEASE: 'Sürüm Bilgileri', LICENSE: 'Lisans',
  SESSION: 'Oturum Yönetimi', GRAPH_MAIL_SETTINGS: 'Microsoft Graph E-posta Ayarları',
  GRAPH_MAIL: 'Microsoft Graph E-posta', REPORTS: 'Raporlar', USERS: 'Kullanıcı Yönetimi',
  NOTES: 'Notlar', ANNOUNCEMENT: 'Duyurular', NETWORK: 'Network İzleme',
  NETWORK_MONITOR: 'Network İzleme', NETWORK_SERVICE: 'Network Servis İzleme', NETWORK_TOPOLOGY: 'Ağ Mimarisi / Topoloji',
  ASSETS: 'Demirbaş Yönetimi', ADMIN_TOOLS: 'Yönetim Araçları', DOMAIN_USER: 'Domain Kullanıcı Sorgusu', DOMAIN_DEVICE: 'Domain Cihaz Sorgusu',
};

export default function AuditLogPanel({ logs, onRefresh }: Props) {
  const [query, setQuery] = useState('');
  const [module, setModule] = useState('all');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return logs.filter(log => {
      const matchesModule = module === 'all' || log.module === module;
      const haystack = `${log.branchCode ?? ''} ${log.displayName} ${log.username} ${log.action} ${log.module} ${log.recordLabel} ${log.description} ${log.ipAddress}`.toLocaleLowerCase('tr-TR');
      return matchesModule && (!normalized || haystack.includes(normalized));
    });
  }, [logs, query, module]);

  const modules = Array.from(new Set(logs.map(log => log.module))).sort();

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-3 text-sm text-slate-300">
        Merkez Şube görünümünde tüm erişilebilir şubelerin işlem kayıtları tarih/saat sırasına göre tek karma listede gösterilir. Şube kodu her kaydın yanında belirtilir.
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Şube, kullanıcı, işlem, kayıt veya IP ara"
            className="form-control pl-9"
          />
        </div>
        <select value={module} onChange={event => setModule(event.target.value)} className="form-control md:w-52">
          <option value="all">Tüm Modüller</option>
          {modules.map(item => <option key={item} value={item}>{MODULE_LABELS[item] ?? item}</option>)}
        </select>
        <button type="button" onClick={() => void onRefresh()} className="action-button secondary-button">
          <RefreshCw className="h-4 w-4" /> Yenile
        </button>
      </div>

      <div className="max-h-[520px] overflow-auto rounded-xl ring-1 ring-slate-700">
        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-900 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Tarih / Saat</th>
              <th className="px-3 py-2 text-left">Şube</th>
              <th className="px-3 py-2 text-left">Kullanıcı</th>
              <th className="px-3 py-2 text-left">İşlem</th>
              <th className="px-3 py-2 text-left">Modül</th>
              <th className="px-3 py-2 text-left">Kayıt</th>
              <th className="px-3 py-2 text-left">Açıklama / Değişiklik</th><th className="px-3 py-2 text-left">IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(log => (
              <tr key={log.id} className="border-t border-slate-700/70 bg-slate-900/40">
                <td className="whitespace-nowrap px-3 py-2">{new Date(log.createdAt).toLocaleString('tr-TR')}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="record-branch-badge">{log.branchCode || '100'}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-white">{log.displayName || log.username || 'Sistem'}</div>
                  <div className="text-[10px] text-slate-500">{log.username}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-1 font-semibold ${
                    log.action === 'DELETE' ? 'bg-red-500/15 text-red-300' :
                    log.action === 'RESTORE' ? 'bg-emerald-500/15 text-emerald-300' :
                    'bg-sky-500/15 text-sky-300'
                  }`}>
                    {ACTION_LABELS[log.action] ?? log.action}
                  </span>
                </td>
                <td className="px-3 py-2">{MODULE_LABELS[log.module] ?? log.module}</td>
                <td className="max-w-[280px] truncate px-3 py-2" title={log.recordLabel}>{log.recordLabel || log.recordId}</td>
                <td className="max-w-[520px] px-3 py-2 leading-relaxed" title={log.description}>{log.description || '-'}</td>
                <td className="whitespace-nowrap px-3 py-2">{log.ipAddress || '-'}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500"><ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />Kayıt bulunamadı.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
