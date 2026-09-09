import { useState } from 'react';
import { Computer, Copy, Network, RefreshCw, Search, UserRoundSearch, XCircle } from 'lucide-react';
import { api, type DomainDeviceResult, type DomainUserResult, type NetworkDiagnostics } from '@/lib/api';

export default function DomainNetworkPanel() {
  const [userQuery, setUserQuery] = useState('');
  const [deviceQuery, setDeviceQuery] = useState('');
  const [user, setUser] = useState<DomainUserResult | null>(null);
  const [device, setDevice] = useState<DomainDeviceResult | null>(null);
  const [network, setNetwork] = useState<NetworkDiagnostics | null>(null);
  const [busy, setBusy] = useState('');
  const [errorText, setErrorText] = useState('');

  const asTextArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(item => String(item ?? '').trim()).filter(Boolean);
    if (value == null || value === '') return [];
    return [String(value).trim()].filter(Boolean);
  };

  const copyError = async () => {
    if (!errorText) return;
    try {
      await navigator.clipboard.writeText(errorText);
    } catch {
      const area = document.createElement('textarea');
      area.value = errorText;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setErrorText('');
    try {
      await action();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'İşlem başarısız.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100 ring-1 ring-amber-500/25">
        Bu bölüm yalnızca salt okunur bilgi sorgular. Domain hesabıyla Operis oturumu açmaz, parola almaz ve Operis yetkilerini değiştirmez.
      </div>

      {errorText && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-black"><XCircle className="h-4 w-4" /> Sorgu Hatası</div>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5">{errorText}</pre>
            </div>
            <button type="button" onClick={() => void copyError()} className="action-button secondary-button shrink-0">
              <Copy className="h-4 w-4" /> Hatayı Kopyala
            </button>
          </div>
        </div>
      )}

      <section className="rounded-xl bg-slate-900/55 p-4 ring-1 ring-slate-700">
        <h3 className="flex items-center gap-2 font-bold text-white"><UserRoundSearch className="h-5 w-5 text-cyan-300" /> Domain Kullanıcı Bilgisi</h3>
        <div className="mt-3 flex gap-2">
          <input value={userQuery} onChange={e => setUserQuery(e.target.value)} className="form-control"
            placeholder="Domain kullanıcı adı, e-posta veya ad soyad" />
          <button type="button" className="action-button primary-button" disabled={busy === 'user'}
            onClick={() => void run('user', async () => setUser(await api.queryDomainUser(userQuery)))}>
            <Search className="h-4 w-4" /> Sorgula
          </button>
        </div>
        {user && <ResultGrid rows={[
          ['Domain kullanıcı adı', user.samAccountName], ['UPN', user.userPrincipalName],
          ['Ad Soyad', user.displayName], ['E-posta', user.email], ['Departman', user.department],
          ['Ünvan', user.title], ['Telefon', user.telephoneNumber], ['Yönetici', user.manager],
          ['Sicil No', user.employeeId], ['Hesap', user.enabled ? 'Aktif' : 'Pasif'],
          ['Sorgu yöntemi', user.querySource || 'Domain'],
          ['Gruplar', asTextArray(user.groups).join(', ')],
        ]} />}
      </section>

      <section className="rounded-xl bg-slate-900/55 p-4 ring-1 ring-slate-700">
        <h3 className="flex items-center gap-2 font-bold text-white"><Computer className="h-5 w-5 text-cyan-300" /> Bilgisayar, IP ve MAC Sorgusu</h3>
        <div className="mt-3 flex gap-2">
          <input value={deviceQuery} onChange={e => setDeviceQuery(e.target.value)} className="form-control" placeholder="Bilgisayar adı veya IP adresi" />
          <button type="button" className="action-button primary-button" disabled={busy === 'device'}
            onClick={() => void run('device', async () => setDevice(await api.queryDomainDevice(deviceQuery)))}>
            <Search className="h-4 w-4" /> Sorgula
          </button>
        </div>
        {device && <ResultGrid rows={[
          ['Bilgisayar adı', device.computerName], ['IPv4', device.ipv4], ['DNS adresleri', asTextArray(device.dnsAddresses).join(', ')],
          ['MAC adresi', device.macAddress || 'ARP tablosunda bulunamadı'], ['MAC kaynağı', device.macSource],
          ['İşletim sistemi', device.operatingSystem], ['Sürüm', device.operatingSystemVersion],
          ['Domain hesabı', device.enabled === null ? 'Bilgi yok' : device.enabled ? 'Aktif' : 'Pasif'],
          ['Açıklama', device.description], ['Son domain oturumu', device.lastLogonDate ? new Date(device.lastLogonDate).toLocaleString('tr-TR') : '—'],
        ]} />}
      </section>

      <section className="rounded-xl bg-slate-900/55 p-4 ring-1 ring-slate-700">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-bold text-white"><Network className="h-5 w-5 text-cyan-300" /> Ağ ve Tablet Erişim Tanılama</h3>
          <button type="button" className="action-button secondary-button" disabled={busy === 'network'}
            onClick={() => void run('network', async () => setNetwork(await api.getNetworkDiagnostics()))}>
            <RefreshCw className={`h-4 w-4 ${busy === 'network' ? 'animate-spin' : ''}`} /> Kontrol Et
          </button>
        </div>
        {network && <ResultGrid rows={[
          ['Sunucu adı', network.hostName], ['Port', String(network.port)],
          ['Port dinleniyor', network.listening ? 'Evet' : 'Hayır'], ['Dinleme adresi', network.localAddress || '—'],
          ['PID', String(network.processId || '—')], ['Firewall kuralı', network.firewallPresent ? `Var / ${network.firewallEnabled}` : 'Yok'],
          ['Yerel IP adresleri', asTextArray(network.addresses).join(', ')], ['Tablet erişim adresleri', asTextArray(network.urls).join(', ')],
        ]} />}
      </section>

      <p className="text-xs leading-5 text-slate-500">
        MAC adresi yalnızca cihaz aynı yerel ağda görünürse ve sunucunun ARP tablosuna düşerse bulunabilir. Farklı VLAN, yönlendirici veya güvenlik politikalarında MAC adresi alınamaz.
      </p>
    </div>
  );
}

function ResultGrid({ rows }: { rows: Array<[string, string]> }) {
  return <div className="mt-4 grid gap-2 sm:grid-cols-2">{rows.map(([label, value]) =>
    <div key={label} className="rounded-lg bg-slate-800/70 px-3 py-2 text-xs">
      <div className="font-bold text-slate-400">{label}</div><div className="mt-1 break-words text-slate-100">{value || '—'}</div>
    </div>
  )}</div>;
}
