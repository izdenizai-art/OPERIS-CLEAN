import { useEffect, useMemo, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Archive, Barcode, Boxes, Building2, ClipboardCheck, FileArchive, FileSpreadsheet,
  Gauge, History, MapPin, PackageCheck, Printer, QrCode, RefreshCw, Search,
  Settings2, ShieldCheck, Tags, Truck, UserCheck, CalendarDays, ChevronLeft,
  ChevronRight, X, Copy, Trash2, Save, Edit3, Plus, MousePointer2, Type,
  Eye, ListChecks, AlertCircle, CheckCircle2, Undo2, Upload, Download, FileUp,
} from 'lucide-react';
import type { SessionUser } from '@/lib/types';
import { importantDatesForYear } from '@/lib/importantDates';
import {
  api, type AssetAssignment, type AssetCard, type AssetCount, type AssetCountScan, type AssetExternalConnection,
  type ExternalColumnInfo, type ExternalConnectionTestResult, type ExternalTableInfo, type AssetLabelTemplate,
  type AssetParty, type AssetSummary, type AssetExternalSale,
} from '@/lib/api';

type AssetPage = 'dashboard' | 'assets' | 'sales' | 'labels' | 'assignments' | 'transfers' | 'counting' | 'locations' | 'documents' | 'disposals' | 'reports' | 'integrations';

interface Props {
  user: SessionUser;
  companyName: string;
  logoDataUrl: string;
}

const NAV: { id: AssetPage; label: string; icon: typeof Gauge; permission: keyof SessionUser['permissions']['assets'] }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge, permission: 'dashboardView' },
  { id: 'assets', label: 'Demirbaş Kartları', icon: Boxes, permission: 'cardsView' },
  { id: 'sales', label: 'Demirbaş Satış', icon: Archive, permission: 'cardsView' },
  { id: 'labels', label: 'Etiket Tasarımı', icon: Printer, permission: 'labelsView' },
  { id: 'assignments', label: 'Zimmet', icon: UserCheck, permission: 'assignmentsView' },
  { id: 'transfers', label: 'Transfer', icon: Truck, permission: 'transfersView' },
  { id: 'counting', label: 'Mobil Sayım', icon: ClipboardCheck, permission: 'countsView' },
  { id: 'locations', label: 'Kişi / Birim / Lokasyon', icon: MapPin, permission: 'locationsView' },
  { id: 'documents', label: 'Evrak QR', icon: FileArchive, permission: 'documentsView' },
  { id: 'disposals', label: 'Hurda', icon: Archive, permission: 'cardsView' },
  { id: 'reports', label: 'Raporlar', icon: FileSpreadsheet, permission: 'reportsView' },
  { id: 'integrations', label: 'Salt Okunur Veri Kaynakları', icon: Settings2, permission: 'integrationsView' },
];

const EMPTY_SUMMARY: AssetSummary = { total: 0, assigned: 0, warehouse: 0, openCounts: 0, activeTransfers: 0, sales: 0, scrap: 0, disposed: 0, labels: 0, documents: 0 };

export default function AssetManagement({ user, companyName, logoDataUrl }: Props) {
  const [page, setPage] = useState<AssetPage>(() => {
    const saved=sessionStorage.getItem('operis-assets-page') as AssetPage | null;
    return saved && NAV.some(item=>item.id===saved) ? saved : 'dashboard';
  });
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [assets, setAssets] = useState<AssetCard[]>([]);
  const [parties, setParties] = useState<AssetParty[]>([]);
  const [assignments, setAssignments] = useState<AssetAssignment[]>([]);
  const [counts, setCounts] = useState<AssetCount[]>([]);
  const [labels, setLabels] = useState<AssetLabelTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [externalSyncMessage, setExternalSyncMessage] = useState('');
  const permissions = user.permissions.assets;

  useEffect(()=>{ sessionStorage.setItem('operis-assets-page',page); },[page]);

  const loadLocalOperisData = async () => {
    const results = await Promise.allSettled([
      api.getAssetSummary(),
      api.getAssets(),
      api.getAssetParties(),
      api.getAssetAssignments(),
      api.getAssetCounts(),
      api.getAssetLabels(),
    ]);

    if (results[0].status === 'fulfilled') setSummary(results[0].value);
    if (results[1].status === 'fulfilled') setAssets(results[1].value);
    if (results[2].status === 'fulfilled') setParties(results[2].value);
    if (results[3].status === 'fulfilled') setAssignments(results[3].value);
    if (results[4].status === 'fulfilled') setCounts(results[4].value);
    if (results[5].status === 'fulfilled') setLabels(results[5].value);

    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length === results.length) {
      throw new Error('Operis yerel demirbaş kayıtları okunamadı.');
    }
  };

  const reload = async (syncExternal=true) => {
    setBusy(true);
    try {
      // Önce Operis'in kendi veritabanındaki son başarılı veriyi göster.
      // MSSQL erişimi olmasa bile kullanıcı mevcut kayıtlarla çalışmaya devam eder.
      await loadLocalOperisData();

      if (!syncExternal) return;

      try {
        const sync=await api.syncExternalAssetData();
        if(sync.connectionCount===0){
          setExternalSyncMessage('MSSQL bağlantısı bulunamadı. Son başarılı senkron verileriyle çalışılıyor.');
          return;
        }

        if(sync.hasErrors){
          const errors=sync.results.flatMap(item=>item.errors.map(error=>`${item.branchCode} ${item.connectionName}: ${error}`));
          setExternalSyncMessage(`MSSQL senkron yapılamadı. Son başarılı veriler korunarak kullanılıyor. ${errors.join(' | ')}`);
          return;
        }

        const demirmasChecked=sync.results.reduce((total,item)=>total+(item.demirmas?.scanned??0),0);
        const demirmasFetched=sync.results.reduce((total,item)=>total+(item.demirmas?.fetched??0),0);
        const demsatisChecked=sync.results.reduce((total,item)=>total+(item.demsatis?.scanned??0),0);
        const demsatisFetched=sync.results.reduce((total,item)=>total+(item.demsatis?.fetched??0),0);
        const autoMarkedSales=sync.results.reduce((total,item)=>total+(item.demsatis?.autoMarkedSales??0),0);
        const protectedOperis=sync.results.reduce((total,item)=>total+(item.demirmas?.protectedOperis??0),0);
        setExternalSyncMessage(
          `Artımsal SQL senkron tamamlandı · Demirbaş kontrol: ${demirmasChecked.toLocaleString('tr-TR')} / getirilen yeni-değişen: ${demirmasFetched.toLocaleString('tr-TR')} · ` +
          `Satış kontrol: ${demsatisChecked.toLocaleString('tr-TR')} / getirilen yeni-değişen: ${demsatisFetched.toLocaleString('tr-TR')} · ` +
          `Otomatik Satış işaretlenen kart: ${autoMarkedSales.toLocaleString('tr-TR')} · ` +
          `Korunan Operis kaydı: ${protectedOperis.toLocaleString('tr-TR')}`,
        );

        // Yalnız başarılı senkrondan sonra yerel Operis kayıtlarını yeniden oku.
        await loadLocalOperisData();
      } catch(error) {
        setExternalSyncMessage(
          `MSSQL erişilemiyor. Son başarılı senkron verileri ve Operis kayıtlarıyla devam ediliyor. ${
            error instanceof Error ? error.message : ''
          }`.trim(),
        );
        // TBLDEMSATIS son başarılı yerel satış kayıtları kart durumunu güncellemiş olabilir.
        // SQL hatasında bile güncel Operis durumlarını hemen ekrana yansıt.
        await loadLocalOperisData().catch(() => undefined);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Demirbaş verileri yüklenemedi.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const visibleNav = NAV.filter(item => user.isAdmin || permissions[item.permission]);
  const active = visibleNav.find(item => item.id === page) ?? visibleNav[0];

  return (
    <div className="asset-module-content space-y-4">
      <section className="asset-module-hero rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950 p-3 ring-1 ring-cyan-500/20 sm:p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {logoDataUrl ? <img src={logoDataUrl} alt={companyName || 'Şirket logosu'} className="h-14 w-20 rounded-xl bg-white/90 object-contain p-1.5" />
              : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-cyan-400/15 ring-1 ring-cyan-300/30"><PackageCheck className="h-7 w-7 text-cyan-300" /></div>}
            <div className="min-w-0">
              <div className="operis-rainbow-text text-xl font-black leading-none sm:text-2xl">Operis</div>
              <p className="operis-expanded-name mt-1 truncate text-[10px] font-semibold tracking-wide text-slate-500 sm:text-[11px]">Operasyon ve İş Yönetim Sistemi</p>
              <h1 className="mt-1 truncate text-lg font-bold text-white sm:text-xl">Demirbaş Yönetimi</h1>
              <p className="truncate text-xs text-slate-400 sm:text-sm">{user.department || 'Birim tanımlanmamış'} · {user.displayName}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge label="Bağımsız çalışma" value="Aktif" />
            <StatusBadge label="Harici kaynak" value="Salt okunur" />
            <button type="button" onClick={() => void reload()} className="asset-refresh-button action-button secondary-button"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Yenile</button>
          </div>
        </div>
      </section>

      <nav className="asset-module-nav flex gap-2 overflow-x-auto rounded-2xl bg-slate-900/70 p-2 ring-1 ring-slate-700">
        {visibleNav.map(item => {
          const Icon = item.icon;
          return <button key={item.id} type="button" onClick={() => setPage(item.id)}
            className={`asset-module-tab flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${page === item.id ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
            <Icon className="h-4 w-4" />{item.label}
          </button>;
        })}
      </nav>

      {externalSyncMessage && (
        <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">
          {externalSyncMessage}
        </div>
      )}

      {active?.id === 'dashboard' && <Dashboard summary={summary} onNavigate={setPage} />}
      {active?.id === 'assets' && <AssetsPage assets={assets} parties={parties} canCreate={user.isAdmin || permissions.cardsCreate} canEdit={user.isAdmin || permissions.cardsEdit} canDelete={user.isAdmin || permissions.cardsDelete} onReload={reload} />}
      {active?.id === 'sales' && <AssetSalesPage />}
      {active?.id === 'locations' && <PartiesPage parties={parties} canManage={user.isAdmin || permissions.locationsManage} onReload={reload} />}
      {(active?.id === 'assignments' || active?.id === 'transfers') && <AssignmentsPage assets={assets} parties={parties} assignments={assignments} transferMode={active.id === 'transfers'} canCreate={user.isAdmin || permissions.assignmentsCreate || permissions.transfersCreate} onReload={reload} />}
      {active?.id === 'counting' && <CountingPage
        counts={counts}
        parties={parties}
        canCreate={user.isAdmin || permissions.countsCreate}
        canScan={user.isAdmin || permissions.countsScan}
        canReview={user.isAdmin || permissions.countsReview}
        canCorrect={user.isAdmin || permissions.countsCorrect}
        onReload={reload}
      />}
      {active?.id === 'labels' && <LabelsPage labels={labels} assets={assets} canDesign={user.isAdmin || permissions.labelsDesign} onReload={reload} />}
      {active?.id === 'documents' && <DocumentScanner assignments={assignments} assets={assets} />}
      {active?.id === 'reports' && <ReportsPage assets={assets} assignments={assignments} parties={parties} />}
      {active?.id === 'disposals' && <DisposedPage assets={assets} />}
      {active?.id === 'integrations' && <IntegrationsPage canManage={user.isAdmin || permissions.integrationsManage} />}
    </div>
  );
}

function Dashboard({ summary, onNavigate }: { summary: AssetSummary; onNavigate: (page: AssetPage) => void }) {
  const [clock, setClock] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const todayKey = localDateKey(clock);
  const todayImportant = importantDatesForYear(clock.getFullYear()).find(item => item.date === todayKey);

  const cards = [
    ['Toplam Demirbaş', summary.total, Boxes, 'assets'],
    ['Zimmetli', summary.assigned, UserCheck, 'assignments'],
    ['Depoda', summary.warehouse, Building2, 'locations'],
    ['Açık Sayım', summary.openCounts, ClipboardCheck, 'counting'],
    ['Son Transferler', summary.activeTransfers, Truck, 'transfers'],
    ['Demirbaş Satış', summary.sales, Archive, 'sales'],
    ['Hurda', summary.scrap, AlertCircle, 'disposals'],
    ['Etiket Şablonu', summary.labels, Tags, 'labels'],
    ['Evrak', summary.documents, FileArchive, 'documents'],
  ] as const;

  return <div className="asset-dashboard space-y-3">
    <div className="grid gap-3 md:grid-cols-[1fr_1.3fr]">
      <button type="button" onClick={() => setCalendarOpen(true)} className="asset-dashboard-panel text-left transition hover:ring-cyan-400/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              {clock.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-300">
              {clock.toLocaleDateString('tr-TR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <CalendarDays className="h-8 w-8 text-cyan-300" />
        </div>
        <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${todayImportant ? 'bg-lime-300/15 text-lime-100 ring-1 ring-lime-300/30' : 'bg-slate-800/75 text-slate-400'}`}>
          <div className="font-bold">{todayImportant ? 'Bugün önemli gün' : 'Takvimi aç'}</div>
          <div className="mt-0.5">{todayImportant?.title ?? 'Aylık görünüm için tarih alanına dokunun.'}</div>
        </div>
      </button>

      <section className="asset-dashboard-panel">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Demirbaş Yönetimi Özeti</div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CompactSummary label="Kart" value={summary.total} />
          <CompactSummary label="Zimmet" value={summary.assigned} />
          <CompactSummary label="Sayım" value={summary.openCounts} />
          <CompactSummary label="Transfer" value={summary.activeTransfers} />
        </div>
        <div className="mt-3 rounded-xl bg-slate-800/65 px-3 py-2 text-xs text-slate-400">
          Kart, zimmet, transfer, sayım, etiket ve evrak işlemleri harici veritabanı olmadan çalışır.
        </div>
      </section>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map(([label, value, Icon, page]) => <button key={label} type="button" onClick={() => onNavigate(page)} className="asset-stat-card">
        <div className="flex items-center justify-between gap-2"><Icon className="h-5 w-5 text-cyan-300" /><span className="text-2xl font-black text-white">{value}</span></div>
        <p className="mt-2 text-xs font-semibold text-slate-300 sm:text-sm">{label}</p>
      </button>)}
    </div>

    {calendarOpen && <AssetMonthCalendar
      month={calendarMonth}
      onPrevious={() => setCalendarMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}
      onNext={() => setCalendarMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}
      onToday={() => setCalendarMonth(new Date(clock.getFullYear(), clock.getMonth(), 1))}
      onClose={() => setCalendarOpen(false)}
    />}
  </div>;
}

function CompactSummary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-slate-800/70 p-3 text-center">
    <div className="text-2xl font-black text-white">{value}</div>
    <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
  </div>;
}

function AssetMonthCalendar({ month, onPrevious, onNext, onToday, onClose }: {
  month: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onClose: () => void;
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const previousMonthDays = new Date(year, monthIndex, 0).getDate();
  const importantMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof importantDatesForYear>>();
    for (const item of importantDatesForYear(year)) {
      const current = map.get(item.date) ?? [];
      current.push(item);
      map.set(item.date, current);
    }
    return map;
  }, [year]);

  const cells = Array.from({ length: 42 }, (_, index) => {
    const rawDay = index - mondayOffset + 1;
    if (rawDay < 1) {
      return { date: new Date(year, monthIndex - 1, previousMonthDays + rawDay), current: false };
    }
    if (rawDay > dayCount) {
      return { date: new Date(year, monthIndex + 1, rawDay - dayCount), current: false };
    }
    return { date: new Date(year, monthIndex, rawDay), current: true };
  });

  return <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-3" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="w-full max-w-2xl rounded-3xl bg-slate-950 p-4 shadow-2xl ring-1 ring-cyan-500/35">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onPrevious} className="rounded-xl bg-slate-800 p-3 text-white hover:bg-slate-700" aria-label="Önceki ay">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={onToday} className="min-w-0 flex-1 rounded-xl bg-slate-900 px-3 py-2 text-center ring-1 ring-slate-700">
          <div className="text-lg font-black text-white">{month.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-cyan-300">Bugüne dön</div>
        </button>
        <button type="button" onClick={onNext} className="rounded-xl bg-slate-800 p-3 text-white hover:bg-slate-700" aria-label="Sonraki ay">
          <ChevronRight className="h-5 w-5" />
        </button>
        <button type="button" onClick={onClose} className="rounded-xl bg-red-500/15 p-3 text-red-200 hover:bg-red-500/25" aria-label="Takvimi kapat">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-black uppercase text-slate-500">
        {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(day => <div key={day} className="py-1">{day}</div>)}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map(({ date, current }, index) => {
          const key = localDateKey(date);
          const important = importantMap.get(key) ?? [];
          const isToday = key === localDateKey(new Date());
          const title = important.map(item => item.title).join('\n');
          return <div key={`${key}-${index}`} title={title || undefined}
            className={`relative min-h-14 rounded-xl p-1.5 text-left ring-1 sm:min-h-16 ${
              current ? 'bg-slate-900 text-slate-200 ring-slate-700' : 'bg-slate-900/35 text-slate-600 ring-slate-800/70'
            } ${isToday ? 'ring-2 ring-cyan-400' : ''} ${important.length ? 'bg-lime-300/15 shadow-[0_0_10px_rgba(190,242,100,0.18)]' : ''}`}>
            <div className="text-xs font-black">{date.getDate()}</div>
            {important.length > 0 && <div className="mt-1 line-clamp-2 text-[9px] font-bold leading-tight text-lime-200">
              {important[0].title}
            </div>}
          </div>;
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
        <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-cyan-200">Bugün</span>
        <span className="rounded-full bg-lime-300/15 px-2 py-1 text-lime-200">Resmî tatil / önemli gün</span>
      </div>
    </section>
  </div>;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function AssetSalesPage() {
  const PAGE_SIZE=250;
  const [rows,setRows]=useState<AssetExternalSale[]>([]);
  const [query,setQuery]=useState(()=>sessionStorage.getItem('operis-last-sale-asset-code') ?? '');
  const [page,setPage]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const [syncMessage,setSyncMessage]=useState('');
  const topScrollRef=useRef<HTMLDivElement>(null);
  const bodyScrollRef=useRef<HTMLDivElement>(null);

  const load=async(syncExternal=false)=>{
    setRefreshing(true);
    try{
      try {
        setRows(await api.getAssetExternalSales());
      } catch(error) {
        if(rows.length===0) {
          setSyncMessage(error instanceof Error ? error.message : 'Operis satış kayıtları okunamadı.');
        }
        return;
      }

      if(!syncExternal) return;

      try {
        const sync=await api.syncExternalAssetData();
        if(sync.hasErrors){
          const errors=sync.results.flatMap(item=>item.errors.map(error=>`${item.branchCode} ${item.connectionName}: ${error}`));
          setSyncMessage(`MSSQL senkron yapılamadı. Son başarılı satış verileriyle devam ediliyor. ${errors.join(' | ')}`);
          return;
        }

        setRows(await api.getAssetExternalSales());
        setSyncMessage('MSSQL satış senkronu tamamlandı.');
      } catch(error) {
        setSyncMessage(`MSSQL erişilemiyor. Son başarılı satış verileri korunarak gösteriliyor. ${error instanceof Error ? error.message : ''}`.trim());
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(()=>{void load(false); const id=window.setInterval(()=>void load(false),60_000); return()=>window.clearInterval(id)},[]);

  const recent=(r:AssetExternalSale)=>Boolean(r.sourceChangedAt && Date.now()-r.sourceChangedAt<=15*60*1000);
  const filtered=rows
    .filter(r=>[r.sirketKodu,r.demirKodu,r.tarih,r.belgeNo,r.alici,r.aciklama].join(' ').toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')))
    .sort((a,b)=>{
      if(recent(a)!==recent(b))return recent(a)?-1:1;
      if(recent(a)&&recent(b)&&(a.sourceChangedAt??0)!==(b.sourceChangedAt??0))return (b.sourceChangedAt??0)-(a.sourceChangedAt??0);
      return b.demirKodu.localeCompare(a.demirKodu,'tr',{numeric:true,sensitivity:'base'});
    });

  const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const safePage=Math.min(page,pageCount-1);
  const visibleRows=filtered.slice(safePage*PAGE_SIZE,(safePage+1)*PAGE_SIZE);

  useEffect(()=>{ if(page!==safePage)setPage(safePage); },[page,safePage]);

  const syncHorizontal=(source:'top'|'body')=>{
    const top=topScrollRef.current;
    const body=bodyScrollRef.current;
    if(!top||!body)return;
    if(source==='top'){
      if(Math.abs(body.scrollLeft-top.scrollLeft)>1)body.scrollLeft=top.scrollLeft;
    }else{
      if(Math.abs(top.scrollLeft-body.scrollLeft)>1)top.scrollLeft=body.scrollLeft;
    }
  };

  return <div className="space-y-4">
    <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-black text-white">Demirbaş Satış</h2>
          <p className="mt-1 text-sm text-slate-400">dbo.TBLDEMSATIS salt okunur satış kayıtları · her saat başı otomatik güncellenir.</p></div>
        <button disabled={refreshing} onClick={()=>void load(true)} className="ui-button ui-button-primary"><RefreshCw className={`h-4 w-4 ${refreshing?'animate-spin':''}`}/>SQL'den Yenile</button>
      </div>
      {syncMessage && <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">{syncMessage}</div>}
      <div className="mt-3 flex items-center gap-2"><Search className="h-4 w-4 text-slate-400"/>
        <input className="form-control" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}} placeholder="Demirbaş kodu, belge no, alıcı veya açıklama ara"/>
      </div>
    </section>

    <section className="rounded-2xl bg-slate-900/65 p-3 ring-1 ring-slate-700">
      <PaginationBar page={safePage} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage}/>

      <div ref={topScrollRef} onScroll={()=>syncHorizontal('top')} className="mt-2 overflow-x-auto overflow-y-hidden rounded-t-lg border border-slate-700 bg-slate-950/60">
        <div className="h-3 min-w-[1050px]" />
      </div>

      <div ref={bodyScrollRef} onScroll={()=>syncHorizontal('body')} className="max-h-[68vh] overflow-auto rounded-b-lg border-x border-b border-slate-700">
        <table className="w-full min-w-[1050px] table-fixed text-sm">
          <thead className="sticky top-0 z-20 bg-slate-900 shadow-sm">
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="w-[92px] p-2">Şirket</th>
              <th className="w-[120px] p-2">Demirbaş Kodu</th>
              <th className="w-[105px] p-2">Tarih</th>
              <th className="w-[120px] p-2">Belge No</th>
              <th className="w-[170px] p-2">Alıcı</th>
              <th className="w-[100px] p-2 text-right">Miktar</th>
              <th className="w-[250px] p-2">Açıklama</th>
              <th className="w-[120px] p-2">Kaynak</th>
            </tr>
          </thead>
          <tbody>{visibleRows.map(r=><tr key={r.id} className={`border-t border-slate-800 text-slate-200 ${recent(r)?'asset-source-recent-change font-black':''}`}>
            <td className="p-2 truncate" title={r.sirketKodu}>{r.sirketKodu||'—'}</td>
            <td className="p-2 font-bold text-cyan-200">{r.demirKodu}</td>
            <td className="p-2">{r.tarih||'—'}</td>
            <td className="p-2 truncate" title={r.belgeNo}>{r.belgeNo||'—'}</td>
            <td className="p-2 truncate" title={r.alici}>{r.alici||'—'}</td>
            <td className="p-2 text-right">{r.satisMiktari}</td>
            <td className="p-2 truncate" title={r.aciklama}>{r.aciklama||'—'}</td>
            <td className="p-2">
              {r.sourceType === 'OPERIS_STATUS'
                ? <span className="rounded-full bg-slate-700 px-2 py-1 text-[11px] font-bold text-slate-200">Operis · Satış</span>
                : <span className="rounded-full bg-cyan-500/10 px-2 py-1 text-[11px] font-bold text-cyan-200">SQL · Salt Okunur</span>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>

      <PaginationBar page={safePage} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage}/>
    </section>
  </div>
}

function PaginationBar({page,pageCount,total,pageSize,onPage}:{
  page:number;
  pageCount:number;
  total:number;
  pageSize:number;
  onPage:(page:number)=>void;
}) {
  const start=total===0?0:page*pageSize+1;
  const end=Math.min(total,(page+1)*pageSize);
  return <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-slate-400">
    <span>{total.toLocaleString('tr-TR')} kayıt · {start.toLocaleString('tr-TR')}–{end.toLocaleString('tr-TR')} gösteriliyor · Sayfa {page+1}/{pageCount}</span>
    <div className="flex items-center gap-1">
      <button type="button" disabled={page===0} onClick={()=>onPage(0)} className="ui-button ui-button-compact ui-button-neutral">İlk</button>
      <button type="button" disabled={page===0} onClick={()=>onPage(Math.max(0,page-1))} className="ui-button ui-button-compact ui-button-neutral"><ChevronLeft className="h-3.5 w-3.5"/>Önceki</button>
      <button type="button" disabled={page>=pageCount-1} onClick={()=>onPage(Math.min(pageCount-1,page+1))} className="ui-button ui-button-compact ui-button-neutral">Sonraki<ChevronRight className="h-3.5 w-3.5"/></button>
      <button type="button" disabled={page>=pageCount-1} onClick={()=>onPage(pageCount-1)} className="ui-button ui-button-compact ui-button-neutral">Son</button>
    </div>
  </div>;
}

function AssetsPage({
  assets,
  parties,
  canCreate,
  canEdit,
  canDelete,
  onReload,
}: {
  assets: AssetCard[];
  parties: AssetParty[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
}) {
  const emptyForm = {
    assetCode: '',
    name: '',
    category: '',
    brand: '',
    model: '',
    serialNumber: '',
    barcode: '',
    status: 'ACTIVE',
    quantity: 1,
    description: '',
    externalSource: 'MANUAL',
    externalId: '',
    unitId: '',
    locationId: '',
    purchaseDate: '',
    warrantyEndDate: '',
    sourceSirketKodu: '',
    sourceBitisYili: '',
    sourceAlisBelgeNo: '',
    sourceSatici: '',
    sourceResBelgeNo: '',
    sourceGrupKodu: '',
    sourceSatisTarihi: '',
  };

  const PAGE_SIZE = 250;
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const assetTopScrollRef = useRef<HTMLDivElement>(null);
  const assetBodyScrollRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Array<typeof emptyForm & { rowNumber: number }>>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const isRecentSourceChange = (item: AssetCard) =>
    Boolean(item.sourceChangedAt && Date.now() - item.sourceChangedAt <= 15 * 60 * 1000);

  const compareAssetCodeDesc = (left: string, right: string) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return rightNumber - leftNumber;
    }
    return right.localeCompare(left, 'tr', { numeric: true, sensitivity: 'base' });
  };

  const statusLabel = (status: string) => ({
    ACTIVE: 'Aktif',
    PASSIVE: 'Pasif',
    SALE: 'Satış',
    SCRAP: 'Hurda',
    WAREHOUSE: 'Depo',
  } as Record<string,string>)[status] ?? status;

  const passiveStatusClass = (status: string) =>
    status === 'ACTIVE'
      ? 'bg-emerald-500/15 text-emerald-300'
      : 'bg-slate-700 text-slate-300';

  const normalizeSearchText = (value: unknown) =>
    String(value ?? '')
      .toLocaleLowerCase('tr-TR')
      .replace(/\s+/g, ' ')
      .trim();

  const filtered = assets
    .filter(item => {
      const statusSearchText = statusLabel(item.status);
      const assignmentSearchText = item.currentTargetName || 'Boşta';
      const normalizedQuery = normalizeSearchText(query);

      if (!normalizedQuery) return true;

      const searchableText = normalizeSearchText([
        item.assetCode,
        item.name,
        item.serialNumber,
        item.barcode,
        item.brand,
        item.model,
        item.sourceSatici,
        item.sourceGrupKodu,
        item.sourceSirketKodu,
        statusSearchText,
        item.status,
        assignmentSearchText,
        `durum ${statusSearchText}`,
        `durum ${item.status}`,
        `zimmet ${assignmentSearchText}`,
        `zimet ${assignmentSearchText}`,
      ].join(' '));

      return searchableText.includes(normalizedQuery);
    })
    .sort((a, b) => {
      const aRecent = isRecentSourceChange(a);
      const bRecent = isRecentSourceChange(b);
      if (aRecent !== bRecent) return aRecent ? -1 : 1;
      if (aRecent && bRecent && a.sourceChangedAt !== b.sourceChangedAt) {
        return (b.sourceChangedAt ?? 0) - (a.sourceChangedAt ?? 0);
      }
      return compareAssetCodeDesc(a.assetCode, b.assetCode);
    });
  const assetPageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeAssetPage = Math.min(page, assetPageCount - 1);
  const visibleAssets = filtered.slice(safeAssetPage * PAGE_SIZE, (safeAssetPage + 1) * PAGE_SIZE);

  useEffect(() => {
    if (page !== safeAssetPage) setPage(safeAssetPage);
  }, [page, safeAssetPage]);

  const syncAssetHorizontal = (source: 'top' | 'body') => {
    const top = assetTopScrollRef.current;
    const body = assetBodyScrollRef.current;
    if (!top || !body) return;
    if (source === 'top') {
      if (Math.abs(body.scrollLeft - top.scrollLeft) > 1) body.scrollLeft = top.scrollLeft;
    } else {
      if (Math.abs(top.scrollLeft - body.scrollLeft) > 1) top.scrollLeft = body.scrollLeft;
    }
  };

  const locations = parties.filter(p => ['LOCATION', 'COMMON_AREA', 'WAREHOUSE'].includes(p.type));
  const units = parties.filter(p => p.type === 'UNIT');


  const normalizeExcelDate = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number') {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      excelEpoch.setUTCDate(excelEpoch.getUTCDate() + value);
      return excelEpoch.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  };

  const downloadExcelTemplate = async () => {
    const XLSX = await import('xlsx');
    const headers = [{
      'Demirbaş Kodu*': 'DMR-00001',
      'Demirbaş Adı*': 'Dizüstü Bilgisayar',
      'Şirket Kodu': '100',
      'Grup Kodu': 'BILGISAYAR',
      'Satıcı': 'Örnek Satıcı A.Ş.',
      'Kategori': 'Bilgisayar',
      'Marka': 'Dell',
      'Model': 'Latitude 5520',
      'Seri Numarası': 'SN-00001',
      'Barkod': '869000000001',
      'Durum': 'Aktif',
      'Adet': 1,
      'Açıklama': 'Bilgi İşlem demirbaşı',
      'Birim Kodu': '',
      'Lokasyon Kodu': '',
      'Satın Alma Tarihi': '04.08.2026',
      'Garanti Bitişi': '04.08.2029',
    }];
    const sheet = XLSX.utils.json_to_sheet(headers);
    sheet['!cols'] = [
      { wch: 18 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 24 },
      { wch: 18 }, { wch: 16 }, { wch: 20 },
      { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 32 },
      { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Demirbaşlar');
    XLSX.writeFile(workbook, 'Operis-Demirbas-Toplu-Yukleme-Sablonu.xlsx');
  };

  const parseExcelFile = async (file: File) => {
    setImportErrors([]);
    setImportRows([]);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('Excel dosyasında okunabilir sayfa bulunamadı.');

      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: true }) as Record<string, unknown>[];
      const errors: string[] = [];
      const seenCodes = new Set<string>();
      const seenSerials = new Set<string>();
      const seenBarcodes = new Set<string>();
      const mapped = rawRows.map((row, index) => {
        const rowNumber = index + 2;
        const assetCode = String(row['Demirbaş Kodu*'] ?? row['Demirbaş Kodu'] ?? row['Demirbas Kodu'] ?? '').trim();
        const name = String(row['Demirbaş Adı*'] ?? row['Demirbaş Adı'] ?? row['Demirbas Adi'] ?? '').trim();
        const sourceSirketKodu = String(row['Şirket Kodu'] ?? row['Sirket Kodu'] ?? '').trim();
        const sourceGrupKodu = String(row['Grup Kodu'] ?? '').trim();
        const sourceSatici = String(row['Satıcı'] ?? row['Satici'] ?? '').trim();
        const serialNumber = String(row['Seri Numarası'] ?? row['Seri Numarasi'] ?? '').trim();
        const barcode = String(row['Barkod'] ?? '').trim();
        const statusText = String(row['Durum'] ?? 'Aktif').trim().toLocaleLowerCase('tr-TR');
        const quantity = Math.max(1, Math.trunc(Number(row['Adet'] ?? 1) || 1));
        const unitCode = String(row['Birim Kodu'] ?? '').trim().toLocaleUpperCase('tr-TR');
        const locationCode = String(row['Lokasyon Kodu'] ?? '').trim().toLocaleUpperCase('tr-TR');
        const unit = units.find(item => item.code.toLocaleUpperCase('tr-TR') === unitCode);
        const location = locations.find(item => item.code.toLocaleUpperCase('tr-TR') === locationCode);

        if (!assetCode) errors.push(`Satır ${rowNumber}: Demirbaş Kodu zorunludur.`);
        if (!name) errors.push(`Satır ${rowNumber}: Demirbaş Adı zorunludur.`);
        const normalizedCode = assetCode.toLocaleUpperCase('tr-TR');
        if (assetCode && seenCodes.has(normalizedCode)) errors.push(`Satır ${rowNumber}: "${assetCode}" kodu dosyada yineleniyor.`);
        if (assetCode) seenCodes.add(normalizedCode);
        if (serialNumber && seenSerials.has(serialNumber)) errors.push(`Satır ${rowNumber}: "${serialNumber}" seri numarası dosyada yineleniyor.`);
        if (serialNumber) seenSerials.add(serialNumber);
        if (barcode && seenBarcodes.has(barcode)) errors.push(`Satır ${rowNumber}: "${barcode}" barkod numarası dosyada yineleniyor.`);
        if (barcode) seenBarcodes.add(barcode);
        if (unitCode && !unit) errors.push(`Satır ${rowNumber}: "${unitCode}" birim kodu sistemde bulunamadı.`);
        if (locationCode && !location) errors.push(`Satır ${rowNumber}: "${locationCode}" lokasyon kodu sistemde bulunamadı.`);

        return {
          rowNumber,
          assetCode,
          name,
          sourceSirketKodu,
          sourceGrupKodu,
          sourceSatici,
          sourceBitisYili: '',
          sourceAlisBelgeNo: '',
          sourceResBelgeNo: '',
          sourceSatisTarihi: '',
          category: String(row['Kategori'] ?? '').trim(),
          brand: String(row['Marka'] ?? '').trim(),
          model: String(row['Model'] ?? '').trim(),
          serialNumber,
          barcode,
          status: statusText === 'pasif' || statusText === 'passive' ? 'PASSIVE' : 'ACTIVE',
          quantity,
          description: String(row['Açıklama'] ?? row['Aciklama'] ?? '').trim(),
          externalSource: 'EXCEL',
          externalId: '',
          unitId: unit?.id ?? '',
          locationId: location?.id ?? '',
          purchaseDate: normalizeExcelDate(row['Satın Alma Tarihi'] ?? row['Satin Alma Tarihi']),
          warrantyEndDate: normalizeExcelDate(row['Garanti Bitişi'] ?? row['Garanti Bitisi']),
        };
      }).filter(row => row.assetCode || row.name);

      if (mapped.length === 0) errors.push('Excel dosyasında demirbaş satırı bulunamadı.');
      setImportRows(mapped);
      setImportErrors(errors);
      setImportOpen(true);
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : 'Excel dosyası okunamadı.']);
      setImportOpen(true);
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const confirmExcelImport = async () => {
    if (importRows.length === 0 || importErrors.length > 0) return;
    setImportBusy(true);
    try {
      const payload = importRows.map(({ rowNumber: _rowNumber, ...row }) => row);
      const result = await api.bulkCreateAssets(payload as never);
      alert(`${result.created} demirbaş kartı başarıyla kaydedildi.`);
      setImportOpen(false);
      setImportRows([]);
      await onReload();
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : 'Toplu demirbaş yüklemesi başarısız oldu.']);
    } finally {
      setImportBusy(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    if (!form.assetCode.trim() || !form.name.trim()) {
      alert('Demirbaş kodu ve demirbaş adı zorunludur.');
      return;
    }

    setBusyId(editingId ?? 'new');
    try {
      if (editingId) {
        await api.updateAsset(editingId, form);
      } else {
        await api.createAsset(form as never);
      }
      resetForm();
      await onReload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Demirbaş kartı kaydedilemedi.');
    } finally {
      setBusyId('');
    }
  };

  const edit = (asset: AssetCard) => {
    setEditingId(asset.id);
    setForm({
      assetCode: asset.assetCode,
      name: asset.name,
      category: asset.category,
      brand: asset.brand,
      model: asset.model,
      serialNumber: asset.serialNumber,
      barcode: asset.barcode,
      status: asset.status,
      quantity: asset.quantity,
      description: asset.description,
      externalSource: asset.externalSource,
      externalId: asset.externalId,
      unitId: asset.unitId,
      locationId: asset.locationId,
      purchaseDate: asset.purchaseDate,
      warrantyEndDate: asset.warrantyEndDate,
      sourceSirketKodu: asset.sourceSirketKodu,
      sourceBitisYili: asset.sourceBitisYili,
      sourceAlisBelgeNo: asset.sourceAlisBelgeNo,
      sourceSatici: asset.sourceSatici,
      sourceResBelgeNo: asset.sourceResBelgeNo,
      sourceGrupKodu: asset.sourceGrupKodu,
      sourceSatisTarihi: asset.sourceSatisTarihi,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setAssetStatus = async (asset: AssetCard, status: string) => {
    if (status === asset.status) return;
    setBusyId(asset.id);
    try {
      await api.updateAssetStatus(asset.id, status as 'ACTIVE' | 'PASSIVE' | 'SALE' | 'SCRAP' | 'WAREHOUSE');
      if (status === 'SALE') {
        sessionStorage.setItem('operis-last-sale-asset-code', asset.assetCode);
        alert(`${asset.assetCode} demirbaş kartı Satış olarak işaretlendi. Demirbaş Satış ekranında bu kodla otomatik listelenecektir.`);
      }
      await onReload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Demirbaş durumu değiştirilemedi.');
    } finally {
      setBusyId('');
    }
  };

  const remove = async (asset: AssetCard) => {
    const firstApproval = confirm(
      `${asset.assetCode} · ${asset.name} kaydını silmek istediğinize emin misiniz?`,
    );
    if (!firstApproval) return;

    const secondApproval = confirm(
      `SON UYARI\n\n${asset.assetCode} · ${asset.name} kalıcı olarak silinecek.\nBu işlem geri alınamaz.\n\nSilmeyi onaylıyor musunuz?`,
    );
    if (!secondApproval) return;

    setBusyId(asset.id);
    try {
      await api.deleteAsset(asset.id);
      if (editingId === asset.id) resetForm();
      await onReload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Demirbaş kaydı silinemedi.');
    } finally {
      setBusyId('');
    }
  };

  const editingAsset = editingId ? assets.find(asset => asset.id === editingId) ?? null : null;
  const sourceManaged = Boolean(
    editingAsset?.externalSource.startsWith('MSSQL:') &&
    editingAsset.externalSource.endsWith(':dbo.TBLDEMIRMAS'),
  );

  return <div className="space-y-4">
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div>
        <h2 className="font-black text-white">Demirbaş Kartları</h2>
        <p className="mt-1 text-xs text-slate-400">SQL kaynaklı kartlar Operis kayıt biçimine dönüştürülerek kaydedilir.</p>
      </div>
      <button disabled={Boolean(busyId)} onClick={()=>void onReload()} className="ui-button ui-button-primary">
        <RefreshCw className={`h-4 w-4 ${busyId?'animate-spin':''}`} /> SQL'den Yenile
      </button>
    </section>
    {canCreate && <section className="asset-import-toolbar rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Excel ile Toplu Demirbaş Yükleme</h2>
          <p className="mt-1 text-sm opacity-75">Şablonu indirin, demirbaşları doldurun ve dosyayı ön izleyerek toplu kaydedin.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void downloadExcelTemplate()} className="ui-button ui-button-info">
            <Download className="h-4 w-4" /> Excel Şablonunu İndir
          </button>
          <button type="button" onClick={() => excelInputRef.current?.click()} className="ui-button ui-button-primary">
            <FileUp className="h-4 w-4" /> Excel'den Yükle
          </button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void parseExcelFile(file);
            }}
          />
        </div>
      </div>
    </section>}

    {(canCreate || editingId) && <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-white">{editingId ? 'Demirbaş Kartını Düzenle' : 'Yeni Demirbaş Kartı'}</h2>
        {editingId && <button type="button" onClick={resetForm} className="action-button secondary-button py-2">
          <X className="h-4 w-4" /> İptal
        </button>}
      </div>
      {sourceManaged && <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">
        dbo.TBLDEMIRMAS kaynaklı alanlar salt okunurdur. Yalnız Operis'e ait boş/tamamlayıcı alanlar düzenlenebilir.
      </div>}
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <Input label="Demirbaş Kodu" value={form.assetCode} onChange={v => setForm({ ...form, assetCode: v })} readOnly={sourceManaged} />
        <Input label="Demirbaş Adı" value={form.name} onChange={v => setForm({ ...form, name: v })} readOnly={sourceManaged} />
        <Input label="Şirket Kodu" value={form.sourceSirketKodu} onChange={v => setForm({ ...form, sourceSirketKodu: v })} readOnly={sourceManaged} />
        <Input label="Satın Alma Tarihi" type="date" value={form.purchaseDate} onChange={v => setForm({ ...form, purchaseDate: v })} readOnly={sourceManaged} />
        <Input label="Bitiş Yılı" value={form.sourceBitisYili} onChange={v => setForm({ ...form, sourceBitisYili: v })} readOnly={sourceManaged} />
        <Input label="Alış Belge No" value={form.sourceAlisBelgeNo} onChange={v => setForm({ ...form, sourceAlisBelgeNo: v })} readOnly={sourceManaged} />
        <Input label="Satıcı" value={form.sourceSatici} onChange={v => setForm({ ...form, sourceSatici: v })} readOnly={sourceManaged} />
        <Input label="Adet" type="number" value={String(form.quantity)} onChange={v => setForm({ ...form, quantity: Math.max(1, Number(v) || 1) })} readOnly={sourceManaged} />
        <Input label="Resmî Belge No" value={form.sourceResBelgeNo} onChange={v => setForm({ ...form, sourceResBelgeNo: v })} readOnly={sourceManaged} />
        <Input label="Grup Kodu" value={form.sourceGrupKodu} onChange={v => setForm({ ...form, sourceGrupKodu: v })} readOnly={sourceManaged} />
        <Input label="Satış Tarihi" type="date" value={form.sourceSatisTarihi} onChange={v => setForm({ ...form, sourceSatisTarihi: v })} readOnly={sourceManaged} />

        <Input label="Seri Numarası" value={form.serialNumber} onChange={v => setForm({ ...form, serialNumber: v })} />
        <Input label="Barkod" value={form.barcode} onChange={v => setForm({ ...form, barcode: v })} />
        <Input label="Kategori" value={form.category} onChange={v => setForm({ ...form, category: v })} />
        <Input label="Marka" value={form.brand} onChange={v => setForm({ ...form, brand: v })} />
        <Input label="Model" value={form.model} onChange={v => setForm({ ...form, model: v })} />
        <Select
          label="Durum"
          value={form.status}
          onChange={v => setForm({ ...form, status: v })}
          options={[
            ['ACTIVE', 'Aktif'],
            ['PASSIVE', 'Pasif'],
            ['SALE', 'Satış'],
            ['SCRAP', 'Hurda'],
            ['WAREHOUSE', 'Depo'],
          ]}
        />
        <Select label="Birim" value={form.unitId} onChange={v => setForm({ ...form, unitId: v })} options={units.map(p => [p.id, p.name])} />
        <Select label="Lokasyon" value={form.locationId} onChange={v => setForm({ ...form, locationId: v })} options={locations.map(p => [p.id, p.name])} />
        <Input label="Garanti Bitişi" type="date" value={form.warrantyEndDate} onChange={v => setForm({ ...form, warrantyEndDate: v })} />
      </div>
      <button type="button" disabled={Boolean(busyId)} onClick={() => void save()} className="action-button primary-button mt-3">
        <Save className="h-4 w-4" /> {editingId ? 'Değişiklikleri Kaydet' : 'Kartı Kaydet'}
      </button>
    </section>}

    <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-slate-400" />
        <input className="form-control" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Örn: durum depo, zimmet testt, satış, seri no, barkod, şirket, grup, satıcı..." />
      </div>
      <PaginationBar page={safeAssetPage} pageCount={assetPageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage}/>

      <div
        ref={assetTopScrollRef}
        onScroll={() => syncAssetHorizontal('top')}
        className="mt-2 overflow-x-auto overflow-y-hidden rounded-t-lg border border-slate-700 bg-slate-950/60"
      >
        <div className="h-3 min-w-[1280px]" />
      </div>

      <div
        ref={assetBodyScrollRef}
        onScroll={() => syncAssetHorizontal('body')}
        className="max-h-[68vh] overflow-auto rounded-b-lg border-x border-b border-slate-700"
      >
        <table className="w-full min-w-[1280px] table-fixed text-[13px]">
          <thead className="sticky top-0 z-30 bg-slate-900 shadow-sm">
            <tr className="text-left text-[11px] uppercase text-slate-400">
              <th className="w-[100px] p-2">Kod</th>
              <th className="w-[180px] p-2">Ad</th>
              <th className="w-[72px] p-2">Şirket</th>
              <th className="w-[82px] p-2">Grup</th>
              <th className="w-[145px] p-2">Satıcı</th>
              <th className="w-[95px] p-2">Alış Tarihi</th>
              <th className="w-[55px] p-2 text-right">Adet</th>
              <th className="w-[105px] p-2">Seri No</th>
              <th className="w-[130px] p-2">Marka/Model</th>
              <th className="w-[110px] p-2">Zimmet</th>
              <th className="w-[72px] p-2">Durum</th>
              <th className="sticky right-0 z-40 w-[255px] bg-slate-900 p-2 text-right shadow-[-8px_0_12px_rgba(2,6,23,0.22)]">İşlemler</th>
            </tr>
          </thead>
          <tbody>{visibleAssets.map(asset => {
            const recentSourceChange = isRecentSourceChange(asset);
            return <tr key={asset.id} className={`border-t border-slate-800 text-slate-200 ${recentSourceChange ? 'asset-source-recent-change font-black' : ''}`}>
              <td className="p-2 font-bold text-cyan-200">{asset.assetCode}</td>
              <td className="p-2 truncate" title={asset.name}>{asset.name}</td>
              <td className="p-2 truncate" title={asset.sourceSirketKodu}>{asset.sourceSirketKodu || '—'}</td>
              <td className="p-2 truncate" title={asset.sourceGrupKodu}>{asset.sourceGrupKodu || '—'}</td>
              <td className="p-2 truncate" title={asset.sourceSatici}>{asset.sourceSatici || '—'}</td>
              <td className="p-2">{asset.purchaseDate || '—'}</td>
              <td className="p-2 text-right">{asset.quantity}</td>
              <td className="p-2 truncate" title={asset.serialNumber}>{asset.serialNumber || '—'}</td>
              <td className="p-2 truncate" title={[asset.brand, asset.model].filter(Boolean).join(' ')}>{[asset.brand, asset.model].filter(Boolean).join(' ') || '—'}</td>
              <td className="p-2 truncate" title={asset.currentTargetName}>{asset.currentTargetName || 'Boşta'}</td>
              <td className="p-2">
                <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${passiveStatusClass(asset.status)}`}>
                  {statusLabel(asset.status)}
                </span>
              </td>
              <td className={`sticky right-0 z-20 p-2 text-right shadow-[-8px_0_12px_rgba(2,6,23,0.18)] ${recentSourceChange ? 'bg-slate-900/95' : 'bg-slate-950/95'}`}>
                <div className="flex items-center justify-end gap-1">
                  {canEdit && <button type="button" disabled={busyId === asset.id} onClick={() => edit(asset)} className="ui-button ui-button-compact ui-button-neutral">
                    <Edit3 className="h-3.5 w-3.5" /> Düzenle
                  </button>}
                  {canEdit && <select
                    value={asset.status}
                    disabled={busyId === asset.id}
                    onChange={event => void setAssetStatus(asset, event.target.value)}
                    className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] font-bold text-slate-200 outline-none"
                    title="Durum değiştir"
                  >
                    <option value="ACTIVE">Aktif</option>
                    <option value="PASSIVE">Pasif</option>
                    <option value="SALE">Satış</option>
                    <option value="SCRAP">Hurda</option>
                    <option value="WAREHOUSE">Depo</option>
                  </select>}
                  {canDelete && <button type="button" disabled={busyId === asset.id} onClick={() => void remove(asset)} className="ui-button ui-button-compact ui-button-danger">
                    <Trash2 className="h-3.5 w-3.5" /> Sil
                  </button>}
                </div>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      <PaginationBar page={safeAssetPage} pageCount={assetPageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage}/>
    </section>

    {importOpen && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <section className="modal-surface max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl">
        <header className="flex items-center justify-between border-b p-4">
          <div>
            <h2 className="text-lg font-bold">Excel Toplu Yükleme Ön İzlemesi</h2>
            <p className="text-sm opacity-70">{importRows.length} satır okundu</p>
          </div>
          <button type="button" onClick={() => setImportOpen(false)} className="ui-button ui-button-icon ui-button-neutral" aria-label="Kapat">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[62vh] overflow-auto p-4">
          {importErrors.length > 0 && <div className="mb-4 rounded-xl border border-red-400/50 bg-red-500/10 p-3">
            <h3 className="font-bold text-red-600">Dosya düzeltilmeden yükleme yapılamaz</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {importErrors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
            </ul>
          </div>}

          {importRows.length > 0 && <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Satır</th>
                  <th className="p-2 text-left">Kod</th>
                  <th className="p-2 text-left">Ad</th>
                  <th className="p-2 text-left">Şirket</th>
                  <th className="p-2 text-left">Grup</th>
                  <th className="p-2 text-left">Satıcı</th>
                  <th className="p-2 text-left">Kategori</th>
                  <th className="p-2 text-left">Marka / Model</th>
                  <th className="p-2 text-left">Seri No</th>
                  <th className="p-2 text-left">Durum</th>
                  <th className="p-2 text-right">Adet</th>
                </tr>
              </thead>
              <tbody>
                {importRows.slice(0, 250).map(row => <tr key={`${row.rowNumber}-${row.assetCode}`} className="border-t">
                  <td className="p-2">{row.rowNumber}</td>
                  <td className="p-2 font-semibold">{row.assetCode || '—'}</td>
                  <td className="p-2">{row.name || '—'}</td>
                  <td className="p-2">{row.category || '—'}</td>
                  <td className="p-2">{[row.brand, row.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="p-2">{row.serialNumber || '—'}</td>
                  <td className="p-2">{row.status === 'ACTIVE' ? 'Aktif' : 'Pasif'}</td>
                  <td className="p-2 text-right">{row.quantity}</td>
                </tr>)}
              </tbody>
            </table>
            {importRows.length > 250 && <p className="p-3 text-sm opacity-70">İlk 250 satır gösteriliyor. Toplam: {importRows.length}</p>}
          </div>}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t p-4">
          <button type="button" onClick={() => setImportOpen(false)} className="ui-button ui-button-neutral">
            <X className="h-4 w-4" /> Vazgeç
          </button>
          <button
            type="button"
            disabled={importBusy || importRows.length === 0 || importErrors.length > 0}
            onClick={() => void confirmExcelImport()}
            className="ui-button ui-button-success"
          >
            <Upload className="h-4 w-4" /> {importBusy ? 'Kaydediliyor…' : `${importRows.length} Kartı Kaydet`}
          </button>
        </footer>
      </section>
    </div>}
  </div>;
}

function PartiesPage({ parties, canManage, onReload }: { parties: AssetParty[]; canManage: boolean; onReload: () => Promise<void> }) {
  const emptyForm = { type: 'LOCATION', code: '', name: '', parentId: '', externalSource: 'MANUAL', externalId: '', department: '', title: '', email: '', active: true };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      alert('Kod ve ad alanları zorunludur.');
      return;
    }

    setBusyId(editingId ?? 'new');
    try {
      if (editingId) {
        await api.updateAssetParty(editingId, form);
      } else {
        await api.createAssetParty(form as never);
      }
      reset();
      await onReload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Tanım kaydedilemedi.');
    } finally {
      setBusyId('');
    }
  };

  const edit = (party: AssetParty) => {
    setEditingId(party.id);
    setForm({
      type: party.type,
      code: party.code,
      name: party.name,
      parentId: party.parentId,
      externalSource: party.externalSource,
      externalId: party.externalId,
      department: party.department,
      title: party.title,
      email: party.email,
      active: party.active,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (party: AssetParty) => {
    if (!confirm(`${party.name} kaydı silinsin mi?\n\nKullanımda olan kayıtlar sistem tarafından silinmeyecektir.`)) return;
    setBusyId(party.id);
    try {
      await api.deleteAssetParty(party.id);
      if (editingId === party.id) reset();
      await onReload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Kayıt silinemedi.');
    } finally {
      setBusyId('');
    }
  };

  return <div className="space-y-4">
    {canManage && <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-white">{editingId ? 'Tanımı Düzenle' : 'Kişi, Birim veya Sayım Alanı Tanımla'}</h2>
        {editingId && <button type="button" onClick={reset} className="action-button secondary-button py-2"><X className="h-4 w-4" /> İptal</button>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <Select label="Tür" value={form.type} onChange={v => setForm({ ...form, type: v })} options={['PERSON','UNIT','LOCATION','COMMON_AREA','WAREHOUSE','VEHICLE','PROJECT','SERVICE'].map(v => [v, targetLabel(v)])} />
        <Input label="Kod" value={form.code} onChange={v => setForm({ ...form, code: v })} />
        <Input label="Ad" value={form.name} onChange={v => setForm({ ...form, name: v })} />
        <Select label="Üst Alan" value={form.parentId} onChange={v => setForm({ ...form, parentId: v })} options={parties.filter(p => p.id !== editingId).map(p => [p.id, p.name])} />
        <Input label="Departman" value={form.department} onChange={v => setForm({ ...form, department: v })} />
        <Input label="Ünvan / Açıklama" value={form.title} onChange={v => setForm({ ...form, title: v })} />
        <Input label="E-posta" type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} />
          Aktif kayıt
        </label>
      </div>
      <button type="button" disabled={Boolean(busyId)} onClick={() => void save()} className="action-button primary-button mt-3">
        <Save className="h-4 w-4" /> {editingId ? 'Değişiklikleri Kaydet' : 'Tanımı Kaydet'}
      </button>
    </section>}

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {parties.map(party => <article key={party.id} className="rounded-xl bg-slate-900/65 p-3 ring-1 ring-slate-700">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-cyan-300">{targetLabel(party.type)} · {party.code}</div>
            <div className="mt-1 truncate font-bold text-white">{party.name}</div>
            <div className="mt-2 text-xs text-slate-500">{party.externalSource === 'MANUAL' ? 'Manuel kayıt' : `${party.externalSource} · ${party.externalId}`}</div>
            <div className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${party.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>
              {party.active ? 'Aktif' : 'Pasif'}
            </div>
          </div>
          {canManage && <div className="flex shrink-0 gap-1">
            <button type="button" onClick={() => edit(party)} className="rounded-lg p-2 text-sky-300 hover:bg-sky-500/10" aria-label="Düzenle">
              <Edit3 className="h-4 w-4" />
            </button>
            <button type="button" disabled={busyId === party.id} onClick={() => void remove(party)} className="rounded-lg p-2 text-red-300 hover:bg-red-500/10" aria-label="Sil">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>}
        </div>
      </article>)}
    </div>
  </div>;
}

function AssignmentsPage({ assets, parties, assignments, transferMode, canCreate, onReload }: { assets: AssetCard[]; parties: AssetParty[]; assignments: AssetAssignment[]; transferMode: boolean; canCreate: boolean; onReload: () => Promise<void> }) {
  const [assetId, setAssetId] = useState('');
  const [targetId, setTargetId] = useState('');
  const target = parties.find(p => p.id === targetId);
  const create = async () => {
    if (!target) return;
    await api.createAssetAssignment({ assetId, targetType: target.type, targetId, unitId: target.type === 'UNIT' ? target.id : '', locationId: ['LOCATION','COMMON_AREA','WAREHOUSE'].includes(target.type) ? target.id : '' });
    await onReload();
  };
  return <div className="space-y-4">
    {canCreate && <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <h2 className="font-bold text-white">{transferMode ? 'Yeni Transfer' : 'Yeni Zimmet'}</h2>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Select label="Demirbaş" value={assetId} onChange={setAssetId} options={assets.map(a => [a.id, `${a.assetCode} · ${a.name} · ${a.serialNumber || 'Seri yok'}`])} />
        <Select label="Hedef" value={targetId} onChange={setTargetId} options={parties.filter(p => p.active).map(p => [p.id, `${targetLabel(p.type)} · ${p.name}`])} />
      </div>
      <button type="button" onClick={() => void create()} className="action-button primary-button mt-3">{transferMode ? 'Transfer Oluştur' : 'Zimmet Oluştur'}</button>
    </section>}
    <div className="space-y-2">{assignments.map(a => <article key={a.id} className="rounded-xl bg-slate-900/65 p-3 ring-1 ring-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-bold text-cyan-200">{a.documentNo}</span><span className="record-branch-badge ml-2">{a.branchCode}</span><span className="ml-3 text-slate-300">{a.targetName}</span></div><span className={a.status === 'ACTIVE' ? 'text-emerald-300' : 'text-slate-500'}>{a.status}</span></div>
      <div className="mt-1 text-xs text-slate-500">{new Date(a.startAt).toLocaleString('tr-TR')} · {targetLabel(a.targetType)}</div>
    </article>)}</div>
  </div>;
}

function CountingPage({
  counts,
  parties,
  canCreate,
  canScan,
  canReview,
  canCorrect,
  onReload,
}: {
  counts: AssetCount[];
  parties: AssetParty[];
  canCreate: boolean;
  canScan: boolean;
  canReview: boolean;
  canCorrect: boolean;
  onReload: () => Promise<void>;
}) {
  const [locationId, setLocationId] = useState('');
  const [name, setName] = useState('');
  const [activeCount, setActiveCount] = useState('');
  const [code, setCode] = useState('');
  const [lastResult, setLastResult] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scans, setScans] = useState<AssetCountScan[]>([]);
  const [scanQuery, setScanQuery] = useState('');
  const [selectedScan, setSelectedScan] = useState<AssetCountScan | null>(null);
  const [editResult, setEditResult] = useState<'MATCHED' | 'WRONG_LOCATION' | 'REVIEW_REQUIRED'>('MATCHED');
  const [editNote, setEditNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locations = parties.filter(p => ['LOCATION','COMMON_AREA','WAREHOUSE'].includes(p.type));
  const currentCount = counts.find(count => count.id === activeCount) ?? null;

  const loadScans = async (countId = activeCount) => {
    if (!countId || !canReview) {
      setScans([]);
      return;
    }
    try {
      setScans(await api.getAssetCountScans(countId));
    } catch (error) {
      setLastResult(error instanceof Error ? error.message : 'Sayım okutmaları yüklenemedi.');
    }
  };

  useEffect(() => {
    void loadScans(activeCount);
  }, [activeCount, canReview]);

  const scan = async (forcedCode?: string) => {
    const scannedCode = (forcedCode ?? code).trim();
    if (!activeCount) {
      setLastResult('Önce açık bir sayım seçin.');
      return;
    }
    if (!scannedCode) return;

    setBusy(true);
    try {
      const result = await api.scanAssetCount(activeCount, scannedCode);
      setLastResult(`✓ ${result.asset.assetCode} · ${result.asset.name}`);
      setCode('');
      if (canReview) await loadScans(activeCount);
      inputRef.current?.focus();
    } catch (error) {
      setLastResult(error instanceof Error ? error.message : 'Okutma başarısız.');
    } finally {
      setBusy(false);
    }
  };

  const openCorrection = (scanItem: AssetCountScan) => {
    setSelectedScan(scanItem);
    setEditResult(
      scanItem.result === 'WRONG_LOCATION' || scanItem.result === 'REVIEW_REQUIRED'
        ? scanItem.result
        : 'MATCHED',
    );
    setEditNote(scanItem.note ?? '');
  };

  const saveCorrection = async () => {
    if (!selectedScan || !activeCount || !canCorrect) return;
    setBusy(true);
    try {
      await api.updateAssetCountScan(activeCount, selectedScan.id, {
        result: editResult,
        note: editNote,
      });
      setSelectedScan(null);
      await loadScans(activeCount);
      setLastResult('Sayım kaydı düzeltildi.');
    } catch (error) {
      setLastResult(error instanceof Error ? error.message : 'Düzeltme kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const removeScan = async (scanItem: AssetCountScan) => {
    if (!activeCount || !canCorrect) return;
    const label = scanItem.asset ? `${scanItem.asset.assetCode} · ${scanItem.asset.name}` : scanItem.scannedCode;
    if (!confirm(`${label} okutması sayıma dahil edilmesin mi?\n\nİşlem denetim günlüğüne kaydedilecektir.`)) return;

    setBusy(true);
    try {
      await api.deleteAssetCountScan(activeCount, scanItem.id);
      if (selectedScan?.id === scanItem.id) setSelectedScan(null);
      await loadScans(activeCount);
      setLastResult('Yanlış okutma sayımdan kaldırıldı.');
    } catch (error) {
      setLastResult(error instanceof Error ? error.message : 'Okutma kaldırılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const filteredScans = scans.filter(scanItem => {
    const asset = scanItem.asset;
    const haystack = [
      asset?.assetCode,
      asset?.name,
      asset?.serialNumber,
      asset?.barcode,
      asset?.brand,
      asset?.model,
      scanItem.scannedByName,
      scanItem.note,
      scanItem.result,
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    return haystack.includes(scanQuery.trim().toLocaleLowerCase('tr-TR'));
  });

  const lastFive = scans.slice(0, 5);
  const matchedCount = scans.filter(item => item.result === 'MATCHED').length;
  const differenceCount = scans.filter(item => item.result !== 'MATCHED').length;

  return <div className="mobile-counting-page auto-count-mode space-y-3">
    {canCreate && <section className="rounded-2xl bg-slate-900/65 p-3 ring-1 ring-slate-700 sm:p-4">
      <h2 className="font-bold text-white">Lokasyon Bazlı Sayım Başlat</h2>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Input label="Sayım Adı" value={name} onChange={setName} />
        <Select label="Lokasyon / Oda / Ortak Alan" value={locationId} onChange={setLocationId} options={locations.map(p => [p.id, p.name])} />
      </div>
      <button
        type="button"
        disabled={!name.trim() || !locationId}
        onClick={() => void api.createAssetCount({ name, locationId }).then(async () => {
          setName('');
          setLocationId('');
          await onReload();
        })}
        className="action-button primary-button mt-3"
      >
        Sayımı Başlat
      </button>
    </section>}

    {canScan && <section className="count-scan-station rounded-2xl bg-slate-900/70 p-3 ring-1 ring-cyan-500/25 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-white">Mobil / El Terminali Sayımı</h2>
          <p className="mt-1 text-xs text-slate-400">Android, iPad, iPhone, kamera ve klavye tipi barkod okuyucular desteklenir.</p>
        </div>
        {currentCount && <div className="rounded-xl bg-cyan-500/10 px-3 py-2 text-right ring-1 ring-cyan-500/25">
          <div className="text-[10px] font-bold uppercase text-cyan-300">Sayım Alanı</div>
          <div className="max-w-52 truncate text-sm font-black text-white">{currentCount.locationName}</div>
        </div>}
      </div>

      <div className="count-scan-controls mt-3 grid gap-2 lg:grid-cols-[minmax(220px,.8fr)_minmax(280px,1.4fr)_auto]">
        <Select label="Açık Sayım" value={activeCount} onChange={value => {
          setActiveCount(value);
          setSelectedScan(null);
          setLastResult('');
        }} options={counts.filter(c => c.status === 'OPEN').map(c => [c.id, `${c.countNo} · ${c.locationName}`])} />
        <Input inputRef={inputRef} label="QR / Barkod" value={code} onChange={setCode} onEnter={() => void scan()} />
        <div className="count-primary-actions grid grid-cols-2 gap-2 self-end">
          <button type="button" disabled={busy || !activeCount} onClick={() => void scan()} className="mobile-count-action primary-button">
            <Barcode className="h-5 w-5" /> Okut
          </button>
          <button type="button" disabled={!activeCount} onClick={() => setCameraOpen(true)} className="mobile-count-action secondary-button">
            <QrCode className="h-5 w-5" /> Kamera
          </button>
        </div>
      </div>

      {cameraOpen && <CameraScanner
        onClose={() => setCameraOpen(false)}
        onDetected={(value) => {
          setCameraOpen(false);
          setCode('');
          void scan(value);
        }}
      />}

      {lastResult && <div className="mt-3 rounded-xl bg-cyan-500/10 p-3 text-sm font-semibold text-cyan-100 ring-1 ring-cyan-500/30">{lastResult}</div>}
    </section>}

    {canReview && activeCount && <div className="count-review-layout grid gap-3 xl:grid-cols-[minmax(0,.8fr)_minmax(0,1.3fr)]">
      <section className="rounded-2xl bg-slate-900/65 p-3 ring-1 ring-slate-700 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-black text-white"><ListChecks className="h-5 w-5 text-cyan-300" /> Son Sayılan 5 Ürün</h3>
          <span className="rounded-full bg-slate-800 px-2 py-1 text-xs font-bold text-slate-300">{scans.length} okutma</span>
        </div>
        <div className="mt-3 space-y-2">
          {lastFive.map((scanItem, index) => <CountScanRow
            key={scanItem.id}
            scan={scanItem}
            order={index + 1}
            compact
            canCorrect={canCorrect}
            onEdit={() => openCorrection(scanItem)}
            onRemove={() => void removeScan(scanItem)}
          />)}
          {!lastFive.length && <Empty text="Bu sayımda henüz ürün okutulmadı." />}
        </div>
      </section>

      <section className="rounded-2xl bg-slate-900/65 p-3 ring-1 ring-slate-700 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-black text-white"><Eye className="h-5 w-5 text-cyan-300" /> Sayım Anı Kontrol Listesi</h3>
            <p className="mt-1 text-xs text-slate-500">Sayılan tüm malzemeleri anlık olarak kontrol edin.</p>
          </div>
          <button type="button" onClick={() => void loadScans()} className="action-button secondary-button py-2"><RefreshCw className="h-4 w-4" /> Yenile</button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <CountMetric label="Toplam" value={scans.length} />
          <CountMetric label="Uyumlu" value={matchedCount} tone="success" />
          <CountMetric label="Kontrol" value={differenceCount} tone="warning" />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            value={scanQuery}
            onChange={event => setScanQuery(event.target.value)}
            className="form-control"
            placeholder="Kod, seri no, barkod, marka, model veya kullanıcı ara"
          />
        </div>

        <div className="mt-3 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
          {filteredScans.map((scanItem, index) => <CountScanRow
            key={scanItem.id}
            scan={scanItem}
            order={index + 1}
            canCorrect={canCorrect}
            onEdit={() => openCorrection(scanItem)}
            onRemove={() => void removeScan(scanItem)}
          />)}
          {!filteredScans.length && <Empty text={scans.length ? 'Arama ölçütüne uygun okutma bulunamadı.' : 'Henüz okutma yapılmadı.'} />}
        </div>
      </section>
    </div>}

    <div className="grid gap-3 md:grid-cols-2">
      {counts.map(count => <article key={count.id} className="rounded-xl bg-slate-900/65 p-3 ring-1 ring-slate-700">
        <div className="flex justify-between gap-2">
          <span className="font-bold text-cyan-200">{count.countNo}</span><span className="record-branch-badge ml-2">{count.branchCode}</span>
          <span className={count.status === 'OPEN' ? 'text-amber-300' : 'text-emerald-300'}>{count.status}</span>
        </div>
        <div className="mt-1 font-semibold text-white">{count.name}</div>
        <div className="text-sm text-slate-400">{count.locationName}</div>
      </article>)}
    </div>

    {selectedScan && canCorrect && <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/75 p-3">
      <section className="w-full max-w-lg rounded-3xl bg-slate-950 p-4 ring-1 ring-cyan-500/35">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-cyan-300">Sayım Kaydı Düzeltme</div>
            <h3 className="mt-1 text-lg font-black text-white">{selectedScan.asset?.assetCode ?? selectedScan.scannedCode}</h3>
            <p className="text-sm text-slate-400">{selectedScan.asset?.name ?? 'Demirbaş bilgisi bulunamadı'}</p>
          </div>
          <button type="button" onClick={() => setSelectedScan(null)} className="rounded-xl bg-slate-800 p-2 text-slate-300"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 space-y-3">
          <Select
            label="Kontrol Sonucu"
            value={editResult}
            onChange={value => setEditResult(value as typeof editResult)}
            options={[
              ['MATCHED', 'Uyumlu'],
              ['WRONG_LOCATION', 'Yanlış Lokasyon'],
              ['REVIEW_REQUIRED', 'İnceleme Gerekli'],
            ]}
          />
          <label className="block text-xs font-bold text-slate-400">
            Düzeltme Notu
            <textarea
              value={editNote}
              onChange={event => setEditNote(event.target.value)}
              rows={4}
              className="form-control mt-1 resize-y"
              placeholder="Düzeltmenin nedenini yazın"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => void saveCorrection()} className="action-button primary-button">
            <Save className="h-4 w-4" /> Kaydet
          </button>
          <button type="button" disabled={busy} onClick={() => void removeScan(selectedScan)} className="action-button bg-red-500/15 text-red-200 ring-1 ring-red-500/30">
            <Trash2 className="h-4 w-4" /> Okutmayı Kaldır
          </button>
        </div>
      </section>
    </div>}
  </div>;
}

function CountMetric({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'success' | 'warning' }) {
  const className = tone === 'success'
    ? 'text-emerald-300'
    : tone === 'warning'
      ? 'text-amber-300'
      : 'text-white';
  return <div className="rounded-xl bg-slate-800/70 p-2 text-center">
    <div className={`text-xl font-black ${className}`}>{value}</div>
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
  </div>;
}

function CountScanRow({
  scan,
  order,
  compact = false,
  canCorrect,
  onEdit,
  onRemove,
}: {
  scan: AssetCountScan;
  order: number;
  compact?: boolean;
  canCorrect: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const asset = scan.asset;
  const matched = scan.result === 'MATCHED';
  const review = scan.result === 'REVIEW_REQUIRED';

  return <article className={`rounded-xl p-3 ring-1 ${matched ? 'bg-emerald-500/5 ring-emerald-500/20' : review ? 'bg-violet-500/10 ring-violet-500/25' : 'bg-amber-500/10 ring-amber-500/25'}`}>
    <div className="flex items-start gap-3">
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${matched ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{order}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-black text-white">{asset?.assetCode ?? scan.scannedCode}</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black ${matched ? 'bg-emerald-500/15 text-emerald-300' : review ? 'bg-violet-500/15 text-violet-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {matched ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {matched ? 'UYUMLU' : review ? 'İNCELEME' : 'YANLIŞ LOKASYON'}
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold text-slate-200">{asset?.name ?? 'Demirbaş kaydı bulunamadı'}</div>
        {!compact && <div className="mt-1 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
          <span>Seri: {asset?.serialNumber || '—'}</span>
          <span>Barkod: {asset?.barcode || scan.scannedCode}</span>
          <span>Okutan: {scan.scannedByName || '—'}</span>
          <span>Zaman: {new Date(scan.scannedAt).toLocaleString('tr-TR')}</span>
        </div>}
        {scan.note && <div className="mt-2 rounded-lg bg-black/20 px-2 py-1 text-xs text-slate-300">{scan.note}</div>}
      </div>
      {canCorrect && <div className="flex shrink-0 gap-1">
        <button type="button" onClick={onEdit} className="rounded-lg p-2 text-sky-300 hover:bg-sky-500/10" aria-label="Düzelt">
          <Edit3 className="h-4 w-4" />
        </button>
        <button type="button" onClick={onRemove} className="rounded-lg p-2 text-red-300 hover:bg-red-500/10" aria-label="Okutmayı kaldır">
          <Undo2 className="h-4 w-4" />
        </button>
      </div>}
    </div>
  </article>;
}

type LabelElementKind = 'staticText' | 'assetCode' | 'assetName' | 'serialNumber' | 'brandModel' | 'barcode' | 'qr';

type LabelElement = {
  id: string;
  kind: LabelElementKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  textAlign: 'left' | 'center' | 'right';
};

type LabelLayout = {
  version: 1;
  elements: LabelElement[];
};

const DEFAULT_LABEL_ELEMENTS: LabelElement[] = [
  { id: 'operis-title', kind: 'staticText', label: 'OPERİS', x: 4, y: 5, width: 40, height: 14, fontSize: 11, fontWeight: 'bold', textAlign: 'left' },
  { id: 'asset-name', kind: 'assetName', label: 'Demirbaş Adı', x: 4, y: 22, width: 66, height: 18, fontSize: 14, fontWeight: 'bold', textAlign: 'left' },
  { id: 'asset-code', kind: 'assetCode', label: 'Demirbaş: ', x: 4, y: 48, width: 58, height: 13, fontSize: 9, fontWeight: 'normal', textAlign: 'left' },
  { id: 'serial-number', kind: 'serialNumber', label: 'Seri No: ', x: 4, y: 65, width: 58, height: 13, fontSize: 9, fontWeight: 'normal', textAlign: 'left' },
  { id: 'qr', kind: 'qr', label: 'QR', x: 74, y: 45, width: 22, height: 45, fontSize: 8, fontWeight: 'bold', textAlign: 'center' },
];

function createLabelElement(kind: LabelElementKind): LabelElement {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const names: Record<LabelElementKind, string> = {
    staticText: 'Yeni Metin',
    assetCode: 'Demirbaş: ',
    assetName: 'Demirbaş Adı',
    serialNumber: 'Seri No: ',
    brandModel: 'Marka / Model: ',
    barcode: 'Barkod',
    qr: 'QR',
  };
  return {
    id,
    kind,
    label: names[kind],
    x: 8,
    y: 8,
    width: kind === 'qr' ? 24 : 55,
    height: kind === 'qr' ? 40 : kind === 'barcode' ? 24 : 14,
    fontSize: kind === 'assetName' ? 14 : 10,
    fontWeight: kind === 'assetName' ? 'bold' : 'normal',
    textAlign: 'left',
  };
}

function parseLabelLayout(layoutJson: string): LabelLayout {
  try {
    const parsed = JSON.parse(layoutJson) as Partial<LabelLayout> & { fields?: string[] };
    if (Array.isArray(parsed.elements) && parsed.elements.length > 0) {
      return { version: 1, elements: parsed.elements.map(item => ({ ...item })) };
    }
  } catch {
    return { version: 1, elements: DEFAULT_LABEL_ELEMENTS.map(item => ({ ...item })) };
  }
  return { version: 1, elements: DEFAULT_LABEL_ELEMENTS.map(item => ({ ...item })) };
}

function LabelsPage({ labels, assets, canDesign, onReload }: { labels: AssetLabelTemplate[]; assets: AssetCard[]; canDesign: boolean; onReload: () => Promise<void> }) {
  const [sampleId, setSampleId] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState('50x25 Standart');
  const [width, setWidth] = useState(50);
  const [height, setHeight] = useState(25);
  const [printerLanguage, setPrinterLanguage] = useState('WINDOWS');
  const [isDefault, setIsDefault] = useState(false);
  const [elements, setElements] = useState<LabelElement[]>(() => DEFAULT_LABEL_ELEMENTS.map(item => ({ ...item })));
  const [selectedId, setSelectedId] = useState(DEFAULT_LABEL_ELEMENTS[0].id);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);

  const sample = assets.find(asset => asset.id === sampleId) ?? assets[0];
  const selected = elements.find(element => element.id === selectedId) ?? null;

  const updateElement = (id: string, changes: Partial<LabelElement>) => {
    setElements(current => current.map(element => element.id === id ? { ...element, ...changes } : element));
  };

  const resetDesigner = () => {
    setTemplateId(null);
    setName('50x25 Standart');
    setWidth(50);
    setHeight(25);
    setPrinterLanguage('WINDOWS');
    setIsDefault(false);
    const next = DEFAULT_LABEL_ELEMENTS.map(item => ({ ...item, id: `${item.id}-${Date.now()}` }));
    setElements(next);
    setSelectedId(next[0]?.id ?? '');
  };

  const loadTemplate = (template: AssetLabelTemplate) => {
    const layout = parseLabelLayout(template.layoutJson);
    setTemplateId(template.id);
    setName(template.name);
    setWidth(template.widthMm);
    setHeight(template.heightMm);
    setPrinterLanguage(template.printerLanguage);
    setIsDefault(template.isDefault);
    setElements(layout.elements);
    setSelectedId(layout.elements[0]?.id ?? '');
  };

  const saveTemplate = async () => {
    if (!name.trim()) {
      alert('Şablon adı zorunludur.');
      return;
    }
    if (elements.length === 0) {
      alert('Etikette en az bir alan bulunmalıdır.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        widthMm: width,
        heightMm: height,
        printerLanguage,
        layoutJson: JSON.stringify({ version: 1, elements } satisfies LabelLayout),
        isDefault,
      };
      if (templateId) {
        await api.updateAssetLabel(templateId, payload);
      } else {
        const created = await api.createAssetLabel(payload);
        setTemplateId(created.id);
      }
      await onReload();
      alert('Etiket şablonu kaydedildi.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Etiket şablonu kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const copyTemplate = () => {
    setTemplateId(null);
    setName(`${name} Kopya`);
    setIsDefault(false);
    setElements(current => current.map(element => ({ ...element, id: `${element.id}-${Date.now()}-${Math.random()}` })));
  };

  const deleteTemplate = async () => {
    if (!templateId || !confirm(`${name} şablonu silinsin mi?`)) return;
    setBusy(true);
    try {
      await api.deleteAssetLabel(templateId);
      resetDesigner();
      await onReload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Şablon silinemedi.');
    } finally {
      setBusy(false);
    }
  };

  const addElement = (kind: LabelElementKind) => {
    const element = createLabelElement(kind);
    setElements(current => [...current, element]);
    setSelectedId(element.id);
  };

  const removeElement = () => {
    if (!selected) return;
    setElements(current => current.filter(element => element.id !== selected.id));
    setSelectedId('');
  };

  const elementText = (element: LabelElement): string => {
    switch (element.kind) {
      case 'assetCode': return `${element.label}${sample?.assetCode ?? 'AST-000001'}`;
      case 'assetName': return sample?.name ?? element.label;
      case 'serialNumber': return `${element.label}${sample?.serialNumber || 'SN-ÖRNEK'}`;
      case 'brandModel': return `${element.label}${[sample?.brand, sample?.model].filter(Boolean).join(' ') || 'Marka Model'}`;
      case 'barcode': return sample?.barcode || sample?.assetCode || '869000000001';
      case 'qr': return 'OPERİS QR';
      default: return element.label;
    }
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>, element: LabelElement) => {
    if (!canDesign) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: element.id, startX: event.clientX, startY: event.clientY, x: element.x, y: element.y };
    setSelectedId(element.id);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / bounds.width) * 100;
    const dy = ((event.clientY - drag.startY) / bounds.height) * 100;
    const element = elements.find(item => item.id === drag.id);
    if (!element) return;
    updateElement(drag.id, {
      x: Math.max(0, Math.min(100 - element.width, drag.x + dx)),
      y: Math.max(0, Math.min(100 - element.height, drag.y + dy)),
    });
  };

  const pointerUp = () => {
    dragRef.current = null;
  };

  const previewWidth = Math.min(720, Math.max(320, width * 9));

  return <div className="space-y-4">
    <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-white">Etiket Şablonları</h2>
          <p className="mt-1 text-xs text-slate-400">Farklı ölçü ve tasarımları isim vererek saklayın.</p>
        </div>
        {canDesign && <button type="button" onClick={resetDesigner} className="action-button secondary-button py-2"><Plus className="h-4 w-4" /> Yeni Şablon</button>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {labels.map(template => <button type="button" key={template.id} onClick={() => loadTemplate(template)}
          className={`rounded-xl p-3 text-left ring-1 transition ${templateId === template.id ? 'bg-cyan-500/15 ring-cyan-400' : 'bg-slate-800/60 ring-slate-700 hover:ring-slate-500'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-bold text-white">{template.name}</span><span className="record-branch-badge">{template.branchCode}</span>
            {template.isDefault && <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[9px] font-bold text-emerald-300">Varsayılan</span>}
          </div>
          <div className="mt-2 text-xs text-slate-400">{template.widthMm} × {template.heightMm} mm · {template.printerLanguage}</div>
          <div className="mt-1 text-[10px] text-slate-500">{new Date(template.updatedAt).toLocaleString('tr-TR')}</div>
        </button>)}
        {labels.length === 0 && <div className="rounded-xl bg-slate-800/40 p-4 text-sm text-slate-500 ring-1 ring-slate-700">Henüz kayıtlı şablon yok.</div>}
      </div>
    </section>

    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_300px]">
      <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
        <h3 className="font-bold text-white">Şablon Ayarları</h3>
        <div className="mt-3 space-y-2">
          <Input label="Şablon Adı" value={name} onChange={setName} />
          <Select label="Örnek Demirbaş" value={sampleId} onChange={setSampleId} options={assets.map(asset => [asset.id, `${asset.assetCode} · ${asset.name}`])} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Genişlik (mm)" type="number" value={String(width)} onChange={value => setWidth(Math.max(10, Number(value) || 50))} />
            <Input label="Yükseklik (mm)" type="number" value={String(height)} onChange={value => setHeight(Math.max(10, Number(value) || 25))} />
          </div>
          <Select label="Yazıcı Dili" value={printerLanguage} onChange={setPrinterLanguage} options={['WINDOWS','ZPL','TSPL','TPCL','PDF'].map(value => [value, value])} />
          <label className="flex items-center gap-2 rounded-xl bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
            <input type="checkbox" checked={isDefault} onChange={event => setIsDefault(event.target.checked)} />
            Varsayılan şablon
          </label>
        </div>

        <div className="mt-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Alan Ekle</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([
              ['staticText', 'Metin'],
              ['assetName', 'Demirbaş Adı'],
              ['assetCode', 'Demirbaş Kodu'],
              ['serialNumber', 'Seri No'],
              ['brandModel', 'Marka / Model'],
              ['barcode', 'Barkod'],
              ['qr', 'QR Kod'],
            ] as Array<[LabelElementKind, string]>).map(([kind, label]) => <button type="button" key={kind} disabled={!canDesign} onClick={() => addElement(kind)}
              className="rounded-xl bg-slate-800 px-2 py-2 text-xs font-semibold text-slate-300 ring-1 ring-slate-700 hover:bg-slate-700">
              {label}
            </button>)}
          </div>
        </div>

        {canDesign && <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => void saveTemplate()} className="action-button primary-button"><Save className="h-4 w-4" /> {templateId ? 'Güncelle' : 'Kaydet'}</button>
          <button type="button" onClick={copyTemplate} className="action-button secondary-button"><Copy className="h-4 w-4" /> Kopyala</button>
          <button type="button" disabled={!templateId || busy} onClick={() => void deleteTemplate()} className="action-button col-span-2 bg-red-500/15 text-red-200 ring-1 ring-red-500/30"><Trash2 className="h-4 w-4" /> Şablonu Sil</button>
        </div>}
      </section>

      <section className="min-w-0 rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-white">Canlı Önizleme</h3>
            <p className="mt-1 text-xs text-slate-400"><MousePointer2 className="mr-1 inline h-3.5 w-3.5" />Alanı seçip sürükleyerek yerini değiştirin.</p>
          </div>
          <div className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-400">{width} × {height} mm</div>
        </div>
        <div className="mt-4 overflow-auto rounded-2xl bg-slate-950/70 p-4">
          <div ref={canvasRef} className="relative mx-auto overflow-hidden border-2 border-black bg-white text-black shadow-xl touch-none"
            style={{ width: `${previewWidth}px`, aspectRatio: `${width} / ${height}` }}>
            {elements.map(element => <div key={element.id}
              onPointerDown={event => pointerDown(event, element)}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onClick={() => setSelectedId(element.id)}
              className={`absolute overflow-hidden ${canDesign ? 'cursor-move select-none' : ''} ${selectedId === element.id ? 'outline outline-2 outline-cyan-500 outline-offset-1' : ''}`}
              style={{
                left: `${element.x}%`,
                top: `${element.y}%`,
                width: `${element.width}%`,
                height: `${element.height}%`,
                fontSize: `${element.fontSize}px`,
                fontWeight: element.fontWeight,
                textAlign: element.textAlign,
                lineHeight: 1.1,
              }}>
              {element.kind === 'barcode'
                ? <div className="flex h-full flex-col justify-end">
                    <div className="min-h-8 flex-1 bg-[repeating-linear-gradient(90deg,#000_0,#000_2px,#fff_2px,#fff_4px,#000_4px,#000_5px,#fff_5px,#fff_8px)]" />
                    <div className="truncate text-center text-[8px]">{elementText(element)}</div>
                  </div>
                : element.kind === 'qr'
                  ? <div className="grid h-full w-full place-items-center border border-black bg-[repeating-conic-gradient(#000_0_25%,#fff_0_50%)] bg-[length:8px_8px]"><span className="bg-white/90 px-1 text-[7px] font-black">QR</span></div>
                  : <div className="h-full w-full overflow-hidden break-words">{elementText(element)}</div>}
            </div>)}
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
        <h3 className="font-bold text-white">Seçili Alan</h3>
        {!selected ? <div className="mt-3 rounded-xl bg-slate-800/40 p-4 text-sm text-slate-500">Düzenlemek için önizlemeden bir alan seçin.</div> : <div className="mt-3 space-y-3">
          <div className="rounded-xl bg-cyan-500/10 p-3 text-sm font-bold text-cyan-200 ring-1 ring-cyan-500/25">{selected.label}</div>
          <Input label="Başlık / Metin" value={selected.label} onChange={value => updateElement(selected.id, { label: value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="X (%)" type="number" value={selected.x.toFixed(1)} onChange={value => updateElement(selected.id, { x: Math.max(0, Math.min(100 - selected.width, Number(value) || 0)) })} />
            <Input label="Y (%)" type="number" value={selected.y.toFixed(1)} onChange={value => updateElement(selected.id, { y: Math.max(0, Math.min(100 - selected.height, Number(value) || 0)) })} />
            <Input label="Genişlik (%)" type="number" value={selected.width.toFixed(1)} onChange={value => updateElement(selected.id, { width: Math.max(5, Math.min(100 - selected.x, Number(value) || 5)) })} />
            <Input label="Yükseklik (%)" type="number" value={selected.height.toFixed(1)} onChange={value => updateElement(selected.id, { height: Math.max(5, Math.min(100 - selected.y, Number(value) || 5)) })} />
          </div>
          <label className="block text-xs font-bold text-slate-400">
            Yazı Boyutu: <span className="text-cyan-300">{selected.fontSize}px</span>
            <input type="range" min="6" max="40" step="1" value={selected.fontSize} onChange={event => updateElement(selected.id, { fontSize: Number(event.target.value) })} className="mt-2 w-full" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Select label="Yazı Kalınlığı" value={selected.fontWeight} onChange={value => updateElement(selected.id, { fontWeight: value as LabelElement['fontWeight'] })} options={[['normal','Normal'],['bold','Kalın']]} />
            <Select label="Hizalama" value={selected.textAlign} onChange={value => updateElement(selected.id, { textAlign: value as LabelElement['textAlign'] })} options={[['left','Sol'],['center','Orta'],['right','Sağ']]} />
          </div>
          {canDesign && <button type="button" onClick={removeElement} className="action-button w-full bg-red-500/15 text-red-200 ring-1 ring-red-500/30"><Trash2 className="h-4 w-4" /> Alanı Sil</button>}
        </div>}
      </section>
    </div>
  </div>;
}

function CameraScanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const containerId = 'operis-asset-camera-reader';

  useEffect(() => {
    let scanner: { render: (success: (text: string) => void, failure?: () => void) => void; clear: () => Promise<void> } | null = null;
    let disposed = false;

    void import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
      if (disposed) return;
      scanner = new Html5QrcodeScanner(containerId, {
        fps: 10,
        qrbox: { width: 260, height: 260 },
        rememberLastUsedCamera: true,
        showTorchButtonIfSupported: true,
      }, false);
      scanner.render((decodedText) => {
        onDetected(decodedText);
        void scanner?.clear();
      });
    }).catch((error) => {
      alert(error instanceof Error ? error.message : 'Kamera başlatılamadı.');
      onClose();
    });

    return () => {
      disposed = true;
      void scanner?.clear().catch(() => undefined);
    };
  }, [onClose, onDetected]);

  return <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/85 p-4">
    <section className="w-full max-w-lg rounded-3xl bg-slate-950 p-4 ring-1 ring-cyan-500/30">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-white">Kamera ile QR / Barkod Oku</h3><button type="button" onClick={onClose} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">Kapat</button></div>
      <div id={containerId} className="overflow-hidden rounded-2xl bg-white" />
      <p className="mt-3 text-xs text-slate-400">Android Chrome, iPhone/iPad Safari ve desteklenen kurumsal el terminallerinde kamera izni gereklidir.</p>
    </section>
  </div>;
}

function DocumentScanner({ assignments, assets }: { assignments: AssetAssignment[]; assets: AssetCard[] }) {
  const [code,setCode]=useState('');
  const [result,setResult]=useState<unknown>(null);
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<AssetAssignment|null>(null);

  const assetById=useMemo(()=>new Map(assets.map(asset=>[asset.id,asset])),[assets]);
  const rows=assignments
    .filter(item=>{
      const asset=assetById.get(item.assetId);
      return [
        item.documentNo,
        item.targetName,
        item.targetType,
        item.status,
        item.note,
        asset?.assetCode,
        asset?.name,
        asset?.serialNumber,
      ].join(' ').toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'));
    })
    .sort((a,b)=>b.createdAt-a.createdAt);

  const resolveQr=async()=>{
    if(!code.trim())return;
    try{
      setResult(await api.resolveAssetQr(code.trim()));
    }catch(error){
      setResult({error:error instanceof Error?error.message:'Evrak çözümlenemedi.'});
    }
  };

  return <div className="space-y-4">
    <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <h2 className="font-black text-white">Evraklar</h2>
      <p className="mt-1 text-sm text-slate-400">Zimmet / transfer evrakları listeden manuel kontrol edilebilir. Barkod veya QR okutma ayrıca kullanılabilir.</p>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div>
          <label className="text-xs font-bold text-slate-400">Evraklarda Ara</label>
          <div className="mt-1 flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-400"/>
            <input className="form-control" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Evrak no, demirbaş, hedef, durum, seri no ara"/>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-400">QR / Barkod ile Aç</label>
          <div className="mt-1 flex gap-2">
            <input className="form-control" value={code} onChange={event=>setCode(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void resolveQr()}} placeholder="QR veya barkod okutun"/>
            <button onClick={()=>void resolveQr()} className="action-button primary-button"><QrCode className="h-4 w-4"/>Aç</button>
          </div>
        </div>
      </div>

      {result !== null && result !== undefined ? <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-slate-200">{JSON.stringify(result,null,2)}</pre> : null}
    </section>

    <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-white">Kayıtlı Evraklar</h3>
        <span className="text-xs font-semibold text-slate-400">{rows.length.toLocaleString('tr-TR')} evrak</span>
      </div>

      {rows.length ? <div className="overflow-auto">
        <table className="w-full min-w-[1150px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="p-2">Evrak No</th>
              <th className="p-2">Demirbaş</th>
              <th className="p-2">Hedef</th>
              <th className="p-2">İşlem</th>
              <th className="p-2">Başlangıç</th>
              <th className="p-2">Bitiş</th>
              <th className="p-2">Durum</th>
              <th className="p-2 text-right">Kontrol</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(item=>{
              const asset=assetById.get(item.assetId);
              return <tr key={item.id} className="border-t border-slate-800 text-slate-200">
                <td className="p-2 font-bold text-cyan-200">{item.documentNo}</td>
                <td className="p-2">{asset?`${asset.assetCode} · ${asset.name}`:'Demirbaş kaydı bulunamadı'}</td>
                <td className="p-2">{item.targetName}</td>
                <td className="p-2">{targetLabel(item.targetType)}</td>
                <td className="p-2">{new Date(item.startAt).toLocaleString('tr-TR')}</td>
                <td className="p-2">{item.endAt?new Date(item.endAt).toLocaleString('tr-TR'):'—'}</td>
                <td className="p-2">{item.status}</td>
                <td className="p-2 text-right"><button type="button" onClick={()=>setSelected(item)} className="ui-button ui-button-compact ui-button-neutral">Manuel Kontrol</button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <Empty text="Kayıtlı zimmet / transfer evrakı bulunmuyor." />}
    </section>

    {selected && <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-4" onClick={()=>setSelected(null)}>
      <section className="w-full max-w-2xl rounded-2xl bg-slate-950 p-5 ring-1 ring-cyan-500/30" onClick={event=>event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-black text-white">Evrak Manuel Kontrol</h3>
          <button type="button" onClick={()=>setSelected(null)} className="ui-button ui-button-compact ui-button-neutral">Kapat</button>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="text-xs font-bold text-slate-500">Evrak No</dt><dd className="mt-1 text-cyan-200">{selected.documentNo}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Şube</dt><dd className="mt-1 text-slate-200">{selected.branchCode}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Demirbaş</dt><dd className="mt-1 text-slate-200">{assetById.get(selected.assetId)?.assetCode || selected.assetId}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Hedef</dt><dd className="mt-1 text-slate-200">{selected.targetName}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Hedef Tipi</dt><dd className="mt-1 text-slate-200">{targetLabel(selected.targetType)}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Durum</dt><dd className="mt-1 text-slate-200">{selected.status}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Başlangıç</dt><dd className="mt-1 text-slate-200">{new Date(selected.startAt).toLocaleString('tr-TR')}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Bitiş</dt><dd className="mt-1 text-slate-200">{selected.endAt?new Date(selected.endAt).toLocaleString('tr-TR'):'—'}</dd></div>
        </dl>
        {selected.note && <div className="mt-4 rounded-xl bg-slate-900 p-3 text-sm text-slate-300"><b>Not:</b> {selected.note}</div>}
      </section>
    </div>}
  </div>;
}

function ReportsPage({ assets, assignments, parties }: { assets: AssetCard[]; assignments: AssetAssignment[]; parties: AssetParty[] }) {
  const active = assignments.filter(a => a.status === 'ACTIVE');
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    <Report title="Demirbaş Durumu" rows={[['Toplam', assets.length], ['Zimmetli', assets.filter(a => a.currentTargetId).length], ['Boşta', assets.filter(a => !a.currentTargetId).length]]} />
    <Report title="Zimmet Geçmişi" rows={[['Toplam hareket', assignments.length], ['Aktif', active.length], ['Kapanmış', assignments.length - active.length]]} />
    <Report title="Hedef Dağılımı" rows={Object.entries(active.reduce<Record<string, number>>((acc, item) => {
      const key = targetLabel(item.targetType);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})).map(([key, value]) => [key, value])} />
    <Report title="Tanımlar" rows={[['Kişi', parties.filter(p => p.type === 'PERSON').length], ['Birim', parties.filter(p => p.type === 'UNIT').length], ['Lokasyon', parties.filter(p => ['LOCATION','COMMON_AREA','WAREHOUSE'].includes(p.type)).length]]} />
  </div>;
}

function DisposedPage({ assets }: { assets: AssetCard[] }) {
  const [query,setQuery]=useState('');
  const rows=assets
    .filter(asset=>asset.status==='SCRAP')
    .filter(asset=>
      [asset.assetCode,asset.name,asset.serialNumber,asset.barcode,asset.sourceSatici,asset.currentTargetName]
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(query.toLocaleLowerCase('tr-TR'))
    )
    .sort((a,b)=>b.updatedAt-a.updatedAt);

  return <div className="space-y-4">
    <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <h2 className="font-black text-white">Hurda Demirbaşlar</h2>
      <p className="mt-1 text-sm text-slate-400">Yalnız durumu Hurda olarak işaretlenmiş demirbaş kartları listelenir. Satış kayıtları Demirbaş Satış penceresindedir.</p>
      <div className="mt-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-slate-400"/>
        <input className="form-control" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Kod, ad, seri no, barkod, satıcı veya zimmet ara"/>
      </div>
    </section>

    <section className="overflow-hidden rounded-2xl bg-slate-900/65 ring-1 ring-slate-700">
      {rows.length ? <div className="overflow-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="p-3">Demirbaş Kodu</th>
              <th className="p-3">Demirbaş Adı</th>
              <th className="p-3">Seri No</th>
              <th className="p-3">Satıcı</th>
              <th className="p-3">Zimmet</th>
              <th className="p-3">Durum</th>
              <th className="p-3">Son Güncelleme</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(asset=><tr key={asset.id} className="border-t border-slate-800 text-slate-200">
              <td className="p-3 font-bold text-cyan-200">{asset.assetCode}</td>
              <td className="p-3">{asset.name}</td>
              <td className="p-3">{asset.serialNumber||'—'}</td>
              <td className="p-3">{asset.sourceSatici||'—'}</td>
              <td className="p-3">{asset.currentTargetName||'Boşta'}</td>
              <td className="p-3"><span className="rounded-full bg-slate-700 px-2 py-1 text-xs font-black text-slate-200">Hurda</span></td>
              <td className="p-3 text-xs text-slate-400">{new Date(asset.updatedAt).toLocaleString('tr-TR')}</td>
            </tr>)}
          </tbody>
        </table>
      </div> : <Empty text="Hurda durumunda demirbaş bulunmuyor." />}
    </section>
  </div>;
}

function IntegrationsPage({ canManage }: { canManage: boolean }) {
  type LoadedTable = {
    info: ExternalTableInfo;
    columns: ExternalColumnInfo[];
    total: number;
    rows: Record<string, unknown>[];
    loading: boolean;
    error: string;
  };

  const empty = {
    name: '',
    type: 'MSSQL',
    host: '',
    port: 1433,
    database: '',
    username: '',
    password: '',
    queryText: '',
    purpose: '',
    enabled: false,
    branchVisibility: 'BRANCH' as 'BRANCH' | 'CENTER_ONLY',
  };

  const [items, setItems] = useState<AssetExternalConnection[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusByConnection, setStatusByConnection] = useState<Record<string, ExternalConnectionTestResult>>({});
  const [tablesByConnection, setTablesByConnection] = useState<Record<string, LoadedTable[]>>({});
  const [progressByConnection, setProgressByConnection] = useState<Record<string, string>>({});
  const [pageByTable, setPageByTable] = useState<Record<string, number>>({});
  const ROWS_PER_PAGE = 100;

  const load = async () => setItems(await api.getAssetExternalConnections());
  useEffect(() => { void load(); }, []);

  const reset = () => {
    setEditingId(null);
    setForm(empty);
  };

  const edit = (item: AssetExternalConnection) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      type: item.type,
      host: item.host,
      port: item.port,
      database: item.database,
      username: item.username,
      password: '',
      queryText: item.queryText,
      purpose: item.purpose,
      enabled: item.enabled,
      branchVisibility: item.branchVisibility,
    });
  };

  const testConnection = async (item: AssetExternalConnection) => {
    setProgressByConnection(current => ({ ...current, [item.id]: 'Bağlantı sınanıyor…' }));
    try {
      const result = await api.testAssetExternalConnection(item.id);
      setStatusByConnection(current => ({ ...current, [item.id]: result }));
      setProgressByConnection(current => ({
        ...current,
        [item.id]: result.ok ? 'Bağlantı başarılı.' : result.message,
      }));
      await load();
      return result;
    } catch (error) {
      const result: ExternalConnectionTestResult = {
        ok: false,
        database: '',
        server: '',
        login: '',
        serverTime: '',
        message: error instanceof Error ? error.message : 'Bağlantı sınanamadı.',
      };
      setStatusByConnection(current => ({ ...current, [item.id]: result }));
      setProgressByConnection(current => ({ ...current, [item.id]: result.message }));
      return result;
    }
  };

  const loadAllAuthorizedData = async (item: AssetExternalConnection) => {
    setBusy(true);
    try {
      const tested = await testConnection(item);
      if (!tested.ok) return;

      setProgressByConnection(current => ({ ...current, [item.id]: 'Yetkili tablolar ve view’lar okunuyor…' }));
      const tableResponse = await api.getAssetExternalTables(item.id);
      const initialTables: LoadedTable[] = tableResponse.tables.map(info => ({
        info,
        columns: [],
        total: 0,
        rows: [],
        loading: true,
        error: '',
      }));
      setTablesByConnection(current => ({ ...current, [item.id]: initialTables }));

      for (let tableIndex = 0; tableIndex < tableResponse.tables.length; tableIndex += 1) {
        const info = tableResponse.tables[tableIndex];
        const label = `${info.schemaName}.${info.tableName}`;
        setProgressByConnection(current => ({
          ...current,
          [item.id]: `${tableIndex + 1}/${tableResponse.tables.length} — ${label} tam veri getiriliyor…`,
        }));

        try {
          const allRows: Record<string, unknown>[] = [];
          let offset = 0;
          let total = 0;
          let columns: ExternalColumnInfo[] = [];
          let hasMore = true;

          while (hasMore) {
            const chunk = await api.getAssetExternalTableData(
              item.id,
              info.schemaName,
              info.tableName,
              offset,
              5000,
            );

            columns = chunk.columns;
            total = chunk.total;
            allRows.push(...chunk.rows);
            offset += chunk.rows.length;
            hasMore = chunk.hasMore && chunk.rows.length > 0;

            setProgressByConnection(current => ({
              ...current,
              [item.id]: `${tableIndex + 1}/${tableResponse.tables.length} — ${label}: ${allRows.length.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')} kayıt`,
            }));
          }

          setTablesByConnection(current => ({
            ...current,
            [item.id]: (current[item.id] ?? initialTables).map(table =>
              table.info.fullName === info.fullName
                ? { ...table, columns, total, rows: allRows, loading: false, error: '' }
                : table
            ),
          }));
        } catch (error) {
          setTablesByConnection(current => ({
            ...current,
            [item.id]: (current[item.id] ?? initialTables).map(table =>
              table.info.fullName === info.fullName
                ? {
                    ...table,
                    loading: false,
                    error: error instanceof Error ? error.message : 'Tablo verisi alınamadı.',
                  }
                : table
            ),
          }));
        }
      }

      setProgressByConnection(current => ({
        ...current,
        [item.id]: `${tableResponse.tables.length.toLocaleString('tr-TR')} yetkili tablo/view işlendi. Tüm erişilebilir veriler yüklendi.`,
      }));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.host.trim()) {
      alert('Bağlantı adı ve sunucu/host zorunludur.');
      return;
    }

    setBusy(true);
    try {
      const saved = editingId
        ? await api.updateAssetExternalConnection(editingId, form)
        : await api.createAssetExternalConnection(form);

      reset();
      await load();

      await loadAllAuthorizedData(saved);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Bağlantı kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const cellText = (value: unknown) => {
    if (value == null) return '';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
  };

  return <div className="space-y-4">
    <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <h2 className="font-bold text-white">Salt Okunur Harici Veri Kaynakları</h2>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        Bağlantı sınandıktan sonra SQL kullanıcısının SELECT yetkisi bulunan tüm tablo ve view’lar okunur.
        Her tablo ayrı başlık altında gerçek kolon adlarıyla gösterilir ve tablonun tüm satırları 5.000 kayıtlık güvenli parçalar halinde alınır.
        Operis bu ekranda INSERT, UPDATE, DELETE, DROP, ALTER veya CREATE çalıştırmaz.
      </p>
    </section>

    {canManage && <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-white">{editingId ? 'Harici Veri Kaynağını Düzenle' : 'Yeni Harici Veri Kaynağı'}</h3>
        {editingId && <button onClick={reset} className="action-button secondary-button"><X className="h-4 w-4" /> Vazgeç</button>}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Input label="Bağlantı Adı" value={form.name} onChange={value => setForm(v => ({ ...v, name: value }))} />
        <Select label="Tür" value={form.type} onChange={value => setForm(v => ({ ...v, type: value }))} options={[['MSSQL','MS SQL']]} />
        <Input label="Sunucu / Host" value={form.host} onChange={value => setForm(v => ({ ...v, host: value }))} />
        <Input label="Port" type="number" value={String(form.port)} onChange={value => setForm(v => ({ ...v, port: Number(value) || 1433 }))} />
        <Input label="Veritabanı" value={form.database} onChange={value => setForm(v => ({ ...v, database: value }))} />
        <Input label="Kullanıcı" value={form.username} onChange={value => setForm(v => ({ ...v, username: value }))} />
        <Input label="Şifre" type="password" value={form.password} onChange={value => setForm(v => ({ ...v, password: value }))} />
        <Select
          label="Şube Görünürlüğü"
          value={form.branchVisibility}
          onChange={value => setForm(v => ({ ...v, branchVisibility: value as 'BRANCH' | 'CENTER_ONLY' }))}
          options={[['BRANCH','Şubede göster'],['CENTER_ONLY','Sadece Merkez']]}
        />
      </div>

      <div className="mt-2">
        <Input label="Amaç / Açıklama" value={form.purpose} onChange={value => setForm(v => ({ ...v, purpose: value }))} />
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={form.enabled} onChange={event => setForm(v => ({ ...v, enabled: event.target.checked }))} />
        Bağlantı tanımı aktif
      </label>

      <button disabled={busy} onClick={() => void save()} className="action-button primary-button mt-3">
        <Save className="h-4 w-4" /> Kaydet, Bağlantıyı Sına ve Veriyi Getir
      </button>
    </section>}

    <section className="space-y-4">
      {items.map(item => {
        const status = statusByConnection[item.id];
        const tables = tablesByConnection[item.id] ?? [];
        const progress = progressByConnection[item.id] ?? '';
        return <article key={item.id} className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-white">{item.name}</h3>
                <span className="record-branch-badge">{item.branchCode}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{item.type} · {item.host}:{item.port} · {item.database}</p>
              <p className="mt-1 text-xs text-slate-500">{item.purpose || 'Açıklama yok'}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => void testConnection(item)} className="action-button secondary-button py-2">
                <CheckCircle2 className="h-4 w-4" /> Bağlantıyı Sına
              </button>
              <button disabled={busy} onClick={() => void loadAllAuthorizedData(item)} className="action-button primary-button py-2">
                <RefreshCw className="h-4 w-4" /> Tüm Yetkili Tabloları ve Verileri Getir
              </button>
              {canManage && <button disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const result = await api.syncTblDemirmas(item.id);
                  alert(`TBLDEMIRMAS artımsal senkron tamamlandı. Kontrol edilen: ${result.scanned}, SQL'den getirilen yeni/değişen: ${result.fetched}, Yeni: ${result.created}, Güncellenen: ${result.updated}, Değişmeyen: ${result.unchanged}, Korunan Operis: ${result.protectedOperis}`);
                  await load();
                } catch (error) {
                  alert(error instanceof Error ? error.message : 'TBLDEMIRMAS senkron başarısız.');
                } finally {
                  setBusy(false);
                }
              }} className="action-button secondary-button py-2">
                <RefreshCw className="h-4 w-4" /> TBLDEMIRMAS Şimdi Senkronla
              </button>}
              {canManage && <button disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const result=await api.syncTblDemSatis(item.id);
                  alert(`TBLDEMSATIS artımsal senkron tamamlandı. Kontrol edilen: ${result.scanned}, SQL'den getirilen yeni/değişen: ${result.fetched}, Yeni: ${result.created}, Güncellenen: ${result.updated}, Değişmeyen: ${result.unchanged}, Otomatik Satış işaretlenen kart: ${result.autoMarkedSales}`);
                } catch(error) {
                  alert(error instanceof Error ? error.message : 'TBLDEMSATIS senkron başarısız.');
                } finally { setBusy(false); }
              }} className="action-button secondary-button py-2">
                <RefreshCw className="h-4 w-4" /> TBLDEMSATIS Şimdi Senkronla
              </button>}
              {canManage && <button onClick={() => edit(item)} className="action-button secondary-button py-2">
                <Edit3 className="h-4 w-4" /> Düzenle
              </button>}
              {canManage && <button onClick={async () => {
                if (!confirm(`${item.name} bağlantı tanımı silinsin mi?`)) return;
                await api.deleteAssetExternalConnection(item.id);
                await load();
              }} className="action-button bg-red-500/15 py-2 text-red-200 ring-1 ring-red-500/30">
                <Trash2 className="h-4 w-4" /> Sil
              </button>}
            </div>
          </div>

          <div className={`mt-3 rounded-xl p-3 text-sm ring-1 ${
            status?.ok
              ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/30'
              : status
                ? 'bg-red-500/10 text-red-200 ring-red-500/30'
                : 'bg-slate-800/60 text-slate-300 ring-slate-700'
          }`}>
            {status?.ok
              ? `BAĞLANTI BAŞARILI · Sunucu: ${status.server} · Veritabanı: ${status.database} · Kullanıcı: ${status.login}`
              : status
                ? `BAĞLANTI BAŞARISIZ · ${status.message}`
                : item.lastTestResult
                  ? `Son sınama: ${item.lastTestResult}`
                  : 'Bağlantı henüz sınanmadı.'}
          </div>

          {progress && <div className="mt-2 rounded-lg bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 ring-1 ring-cyan-500/20">{progress}</div>}

          {tables.length > 0 && <div className="mt-4 space-y-4">
            {tables.map(table => {
              const key = `${item.id}:${table.info.fullName}`;
              const page = pageByTable[key] ?? 0;
              const pageCount = Math.max(1, Math.ceil(table.rows.length / ROWS_PER_PAGE));
              const safePage = Math.min(page, pageCount - 1);
              const visibleRows = table.rows.slice(safePage * ROWS_PER_PAGE, (safePage + 1) * ROWS_PER_PAGE);

              return <section key={table.info.fullName} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950/40">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
                  <div>
                    <h4 className="font-black text-cyan-200">{table.info.fullName}</h4>
                    <p className="text-[11px] text-slate-500">
                      {table.info.objectType} · Kolon: {table.columns.length} · Toplam: {table.total.toLocaleString('tr-TR')} · Yüklenen: {table.rows.length.toLocaleString('tr-TR')}
                    </p>
                  </div>
                  {table.loading && <span className="text-xs font-bold text-amber-300">Tam veri yükleniyor…</span>}
                  {table.error && <span className="text-xs font-bold text-red-300">{table.error}</span>}
                </div>

                {table.columns.length > 0 && <>
                  <div
                    className="overflow-x-auto overflow-y-hidden border-b border-slate-700"
                    onScroll={event => {
                      const target = event.currentTarget;
                      const body = target.nextElementSibling as HTMLDivElement | null;
                      if (body && Math.abs(body.scrollLeft - target.scrollLeft) > 1) body.scrollLeft = target.scrollLeft;
                    }}
                  >
                    <div style={{ width: 'max(100%, var(--operis-table-scroll-width, 100%))', height: 14 }} />
                  </div>
                  <div
                    className="overflow-auto"
                    ref={element => {
                      if (!element) return;
                      const headerScroller = element.previousElementSibling as HTMLDivElement | null;
                      const syncWidth = () => {
                        if (!headerScroller) return;
                        headerScroller.style.setProperty('--operis-table-scroll-width', `${element.scrollWidth}px`);
                        if (Math.abs(headerScroller.scrollLeft - element.scrollLeft) > 1) headerScroller.scrollLeft = element.scrollLeft;
                      };
                      syncWidth();
                      requestAnimationFrame(syncWidth);
                    }}
                    onScroll={event => {
                      const target = event.currentTarget;
                      const headerScroller = target.previousElementSibling as HTMLDivElement | null;
                      if (headerScroller && Math.abs(headerScroller.scrollLeft - target.scrollLeft) > 1) headerScroller.scrollLeft = target.scrollLeft;
                    }}
                  >
                  <table className="min-w-max w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-800">
                      <tr>
                        {table.columns.map(column => (
                          <th key={column.name} className="border-b border-r border-slate-700 px-3 py-2 text-left font-black text-slate-200">
                            <div>{column.name}</div>
                            <div className="mt-0.5 text-[9px] font-normal text-slate-500">{column.dataType}{column.nullable ? ' · NULL' : ''}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row, rowIndex) => (
                        <tr key={`${safePage}-${rowIndex}`} className="border-b border-slate-800 hover:bg-slate-800/45">
                          {table.columns.map(column => (
                            <td key={column.name} className="max-w-[360px] border-r border-slate-800 px-3 py-2 align-top text-slate-300">
                              <div className="max-h-24 overflow-auto whitespace-pre-wrap break-words">{cellText(row[column.name])}</div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </>}

                {table.rows.length > ROWS_PER_PAGE && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 px-3 py-2">
                  <span className="text-xs text-slate-400">
                    Sayfa {safePage + 1} / {pageCount} · Tüm {table.rows.length.toLocaleString('tr-TR')} kayıt yüklendi
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={safePage === 0}
                      onClick={() => setPageByTable(current => ({ ...current, [key]: Math.max(0, safePage - 1) }))}
                      className="action-button secondary-button py-1.5"
                    >
                      <ChevronLeft className="h-4 w-4" /> Önceki
                    </button>
                    <button
                      disabled={safePage >= pageCount - 1}
                      onClick={() => setPageByTable(current => ({ ...current, [key]: Math.min(pageCount - 1, safePage + 1) }))}
                      className="action-button secondary-button py-1.5"
                    >
                      Sonraki <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>}
              </section>;
            })}
          </div>}
        </article>;
      })}

      {!items.length && <Empty text="Bu şube görünümünde harici veri kaynağı tanımı yok." />}
    </section>
  </div>;
}

function Report({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return <section className="rounded-2xl bg-slate-900/65 p-4 ring-1 ring-slate-700"><h3 className="font-bold text-white">{title}</h3><div className="mt-3 space-y-2">{rows.map(([k,v]) => <div key={k} className="flex justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-sm"><span className="text-slate-300">{k}</span><b className="text-cyan-200">{v}</b></div>)}</div></section>;
}

function StatusBadge({ label, value }: { label: string; value: string }) {
  return <div className="asset-status-badge rounded-xl bg-slate-900/70 px-3 py-2 ring-1 ring-slate-700"><div className="asset-status-label text-[10px] font-bold uppercase text-slate-500">{label}</div><div className="asset-status-value text-xs font-bold text-emerald-300">{value}</div></div>;
}

function Input({ label, value, onChange, type='text', onEnter, inputRef, readOnly=false }: { label: string; value: string; onChange: (value: string) => void; type?: string; onEnter?: () => void; inputRef?: RefObject<HTMLInputElement>; readOnly?: boolean }) {
  return <label className="block text-xs font-bold text-slate-400">{label}<input ref={inputRef} type={type} value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }} className={`form-control mt-1 ${readOnly ? 'cursor-not-allowed opacity-70' : ''}`} /></label>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<readonly [string,string] | [string,string]> }) {
  return <label className="block text-xs font-bold text-slate-400">{label}<select value={value} onChange={e => onChange(e.target.value)} className="form-control mt-1"><option value="">Seçin</option>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl bg-slate-900/60 p-6 text-center text-sm text-slate-500 ring-1 ring-slate-700">{text}</div>; }

function targetLabel(type: string) {
  return ({ PERSON:'Kişi', UNIT:'Birim', LOCATION:'Lokasyon', COMMON_AREA:'Ortak Alan', WAREHOUSE:'Depo', VEHICLE:'Araç', PROJECT:'Proje/Saha', SERVICE:'Servis' } as Record<string,string>)[type] ?? type;
}
