import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, KeyRound, LifeBuoy, Mail, MessageSquareReply, MonitorDown, Palette, Wrench, Star, TicketCheck } from 'lucide-react';
import CalendarView from './CalendarView';
import { api } from '@/lib/api';
import NotesPanel from './NotesPanel';
import { importantDatesForYear } from '@/lib/importantDates';
import type { AppMessage, BranchContext, BrandingSettings, Credential, HelpDeskManagerDashboard, HelpDeskMySummary, NoteColor, SessionUser, Task, ThemeMode, TrackingRecord, UserNote } from '@/lib/types';

interface Props {
  user: SessionUser;
  tasks: Task[];
  trackingRecords: TrackingRecord[];
  credentials: Credential[];
  messages: AppMessage[];
  theme: ThemeMode;
  branding: BrandingSettings;
  branchContext: BranchContext;
  onThemeChange: (theme: ThemeMode) => void;
  onNavigate: (tab: 'tasks' | 'calendar' | 'tracking' | 'credentials' | 'messages') => void;
  onNavigateHelpDesk: (filter: 'opened' | 'answered' | 'closed' | 'open' | 'all' | 'new' | 'inProgress' | 'unassigned') => void;
  notes: UserNote[];
  onCreateNote: (input: { title: string; content: string; color: NoteColor }) => Promise<void>;
  onUpdateNote: (id: string, input: { title: string; content: string; color: NoteColor }) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onCreateShortcut: () => Promise<void>;
  shortcutVisible: boolean;
}

const THEMES: { value: ThemeMode; label: string; dot: string }[] = [
  { value: 'dark', label: 'Koyu', dot: 'bg-slate-800' },
  { value: 'ocean-blue', label: 'Ocean Blue', dot: 'bg-sky-700' },
  { value: 'pastel-glass', label: 'Pastel Cam', dot: 'bg-fuchsia-200' },
  { value: 'corporate-2d', label: 'Kurumsal 2D', dot: 'bg-zinc-900' },
  { value: 'black', label: 'Siyah', dot: 'bg-black' },
  { value: 'gray', label: 'Gri', dot: 'bg-zinc-500' },
  { value: 'light', label: 'Kirli Beyaz', dot: 'bg-stone-200' },
  { value: 'spring', label: 'İlkbahar Yeşili', dot: 'bg-emerald-500' },
];

export default function Dashboard({
  user, tasks, trackingRecords, credentials, messages, theme, branding, branchContext, onThemeChange, onNavigate, onNavigateHelpDesk,
  notes, onCreateNote, onUpdateNote, onDeleteNote, onCreateShortcut, shortcutVisible,
}: Props) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [helpDeskSummary,setHelpDeskSummary]=useState<HelpDeskMySummary>({opened:0,answered:0,closed:0});
  const [managerDashboard,setManagerDashboard]=useState<HelpDeskManagerDashboard>({
    branches:[],totals:{total:0,open:0,closed:0,new:0,inProgress:0,unassigned:0},
  });
  useEffect(()=>{
    void api.getHelpDeskMySummary().then(setHelpDeskSummary).catch(()=>undefined);
    void api.getHelpDeskManagerDashboard().then(setManagerDashboard).catch(()=>undefined);
  },[]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const todayKey = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, '0')}-${String(clock.getDate()).padStart(2, '0')}`;
  const todayImportant = importantDatesForYear(clock.getFullYear()).find(item => item.date === todayKey);

  const upcomingTasks = useMemo(() => tasks
    .filter(task => !task.deletedAt && !task.completed)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    .slice(0, 6), [tasks]);

  const isWithinThirtyFiveDays = (date: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(`${date}T00:00:00`);
    const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    return days >= 0 && days <= 35;
  };

  const incomingMessages = useMemo(() => messages
    .filter(message => message.direction === 'inbox')
    .slice(0, 5), [messages]);

  const recentTracking = useMemo(() => trackingRecords.filter(record => !record.deletedAt)
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate))
    .slice(0, 6), [trackingRecords]);

  return (
    <div className="operation-dashboard-root block min-w-0 space-y-3 sm:space-y-4">
      <section className="corporate-dashboard-header">
        <div className="flex min-w-0 items-center gap-3">
          {branding.companyLogoDataUrl ? (
            <img
              src={branding.companyLogoDataUrl}
              alt={branding.companyName || 'Şirket logosu'}
              className="h-14 w-20 shrink-0 rounded-xl bg-white/90 object-contain p-1.5"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-cyan-400/15 ring-1 ring-cyan-300/30">
              <CalendarDays className="h-7 w-7 text-cyan-300" />
            </div>
          )}

          <div className="min-w-0">
            <div className="operis-rainbow-text mb-0.5 text-sm font-black tracking-tight">Operis</div>
            {branding.companyName && (
              <p className="truncate text-sm font-bold uppercase tracking-wide text-cyan-200">
                {branding.companyName}
              </p>
            )}
            <p className="truncate text-lg font-bold text-white">
              {user.department || 'Departman bilgisi tanımlanmamış'}
            </p>
            <p className="truncate text-sm text-slate-300">
              Hoş geldiniz, {user.displayName || user.username}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                {branchContext.branches.length > 1 ? 'Yetkili Şubeler' : 'Yetkili Şube'}
              </span>
              {branchContext.branches.map(branch => (
                <span key={branch.code} className="branch-access-badge">
                  {branch.code} — {branch.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {shortcutVisible && (
            <button
              type="button"
              onClick={() => void onCreateShortcut()}
              className="shortcut-install-button"
              title="Operis'i masaüstüne veya ana ekrana ekle"
            >
              <MonitorDown className="h-3.5 w-3.5" />
              <span>Masaüstüne Kısayol Ekle</span>
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setThemeOpen(value => !value)}
              className="theme-menu-button"
            >
              <Palette className="h-4 w-4" />
              Tema
              <ChevronDown className="h-4 w-4" />
            </button>

          {themeOpen && (
            <div className="theme-menu-popover">
              {THEMES.map(option => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => {
                    onThemeChange(option.value);
                    setThemeOpen(false);
                  }}
                  className={`theme-menu-option ${theme === option.value ? 'theme-menu-option-active' : ''}`}
                >
                  <span className={`h-4 w-4 rounded-full ring-1 ring-black/20 ${option.dot}`} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
      </section>

      <section className="corporate-panel">
        <PanelHeader icon={<LifeBuoy />} title="Help Desk Özeti" action="Help Desk'e Git" onClick={() => onNavigateHelpDesk('opened')} />
        <div className="grid grid-cols-3 gap-2 p-3">
          <button type="button" onClick={() => onNavigateHelpDesk('opened')} className="dashboard-stat text-left"><span className="text-xs text-slate-400">Açtığım</span><strong className="text-2xl text-white">{helpDeskSummary.opened}</strong></button>
          <button type="button" onClick={() => onNavigateHelpDesk('answered')} className="dashboard-stat text-left"><span className="flex items-center gap-1 text-xs text-slate-400"><MessageSquareReply className="h-3.5 w-3.5"/> Cevaplanan</span><strong className="text-2xl text-white">{helpDeskSummary.answered}</strong></button>
          <button type="button" onClick={() => onNavigateHelpDesk('closed')} className="dashboard-stat text-left"><span className="flex items-center gap-1 text-xs text-slate-400"><TicketCheck className="h-3.5 w-3.5"/> Kapanan</span><strong className="text-2xl text-white">{helpDeskSummary.closed}</strong></button>
        </div>
      </section>

      {managerDashboard.branches.length > 0 && (
        <section className="corporate-panel">
          <PanelHeader icon={<LifeBuoy />} title="Yetkili Olduğum Şubeler · Help Desk" action="Toplu Görünüm" onClick={() => onNavigateHelpDesk('opened')} />
          <div className="grid grid-cols-3 gap-2 border-b border-slate-700/60 p-3 sm:grid-cols-6">
            <div className="dashboard-stat"><span>Genel Toplam</span><strong>{managerDashboard.totals.total}</strong></div>
            <div className="dashboard-stat"><span>Yeni</span><strong>{managerDashboard.totals.new}</strong></div>
            <div className="dashboard-stat"><span>Açık</span><strong>{managerDashboard.totals.open}</strong></div>
            <div className="dashboard-stat"><span>İşlemde</span><strong>{managerDashboard.totals.inProgress}</strong></div>
            <div className="dashboard-stat"><span>Atanmamış</span><strong>{managerDashboard.totals.unassigned}</strong></div>
            <div className="dashboard-stat"><span>Kapalı</span><strong>{managerDashboard.totals.closed}</strong></div>
          </div>
          <div className="grid gap-3 p-3 lg:grid-cols-2">
            {managerDashboard.branches.map(branch=>(
              <div key={branch.branchCode} className="rounded-xl border border-slate-700/60 bg-slate-900/45 p-3">
                <button type="button" onClick={()=>{sessionStorage.setItem('operis-helpdesk-manager-branch',branch.branchCode);onNavigateHelpDesk('opened');}} className="mb-3 w-full text-left">
                  <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-sm text-white">{branch.branchCode} · {branch.branchName}</strong><span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-300">{branch.scope==='branch'?'Şube Geneli':'Bana Atanan'}</span></div>
                  <div className="grid grid-cols-6 gap-1 text-center text-[10px]" onClick={event=>event.stopPropagation()}>
                    {([
                      ['all','Toplam',branch.total],
                      ['new','Yeni',branch.new],
                      ['open','Açık',branch.open],
                      ['inProgress','İşlemde',branch.inProgress],
                      ['unassigned','Boşta',branch.unassigned],
                      ['closed','Kapalı',branch.closed],
                    ] as const).map(([filter,label,value])=>(
                      <button key={filter} type="button"
                        onClick={()=>{sessionStorage.setItem('operis-helpdesk-manager-branch',branch.branchCode);onNavigateHelpDesk(filter);}}
                        className="rounded-lg bg-slate-800/70 px-1 py-1.5 text-slate-300 hover:bg-slate-700/80">
                        {label}<br/><b>{value}</b>
                      </button>
                    ))}
                  </div>
                </button>
                <div className="space-y-1.5">{branch.responders.map(responder=>(
                  <div key={responder.userId} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg bg-slate-950/35 px-2 py-1.5 text-xs">
                    <span className="truncate text-slate-300">{responder.displayName}</span><span className="text-sky-300">Atanan {responder.assigned}</span><span className="text-amber-300">Açık {responder.open}</span><span className="text-emerald-300">Kapalı {responder.closed}</span>
                  </div>
                ))}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          Operasyon Özeti
        </h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {user.permissions.tracking.canView && (
            <section className="corporate-panel">
              <PanelHeader
                icon={<Wrench />}
                title="Takip Özeti"
                action="Takibe Git"
                onClick={() => onNavigate('tracking')}
              />
              <div className="divide-y divide-slate-700/60">
                {recentTracking.length ? recentTracking.map(record => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => onNavigate('tracking')}
                    className="dashboard-list-row"
                  >
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    <span className="min-w-0 flex-1 truncate">
                      {record.groupName || record.serviceNumber || 'Takip kaydı'}
                    </span>
                    <span className="record-branch-badge">{record.branchCode || '---'}</span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {record.serviceDate}
                    </span>
                  </button>
                )) : <EmptyText text="Takip kaydı bulunmuyor." />}
              </div>
            </section>
          )}

          {user.permissions.credentials.canView && (
            <section className="corporate-panel">
              <PanelHeader
                icon={<KeyRound />}
                title="Bilgiler Özeti"
                action="Bilgilere Git"
                onClick={() => onNavigate('credentials')}
              />
              <div className="grid grid-cols-2 gap-2 p-2">
                {credentials.filter(item => !item.deletedAt).slice(0, 6).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate('credentials')}
                    className="dashboard-info-tile"
                  >
                    <span className="truncate text-sm font-semibold text-white">
                      {item.groupName || 'Grupsuz'}
                    </span>
                    <span className="truncate text-xs text-slate-400">
                      {item.username || item.ip || 'Bilgi kaydı'}
                    </span>
                    <span className="record-branch-badge mt-1">{item.branchCode || '---'}</span>
                  </button>
                ))}
                {!credentials.length && (
                  <div className="col-span-full">
                    <EmptyText text="Bilgi kaydı bulunmuyor." />
                  </div>
                )}
              </div>
            </section>
          )}

          {user.permissions.tasks.canView && (
            <section className="corporate-panel">
              <PanelHeader
                icon={<CalendarDays />}
                title="Yaklaşan İşler"
                action="İşlere Git"
                onClick={() => onNavigate('tasks')}
              />
              <div className="divide-y divide-slate-700/60">
                {upcomingTasks.length ? upcomingTasks.map(task => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onNavigate('tasks')}
                    className={`dashboard-list-row ${isWithinThirtyFiveDays(task.date) ? 'dashboard-task-urgent' : ''}`}
                  >
                    <span className={`priority-dot priority-${task.priority}`} />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span className="record-branch-badge">{task.branchCode || '---'}</span>
                    <span className="shrink-0 text-xs">
                      {task.date} · {task.time}
                    </span>
                  </button>
                )) : <EmptyText text="Yaklaşan iş bulunmuyor." />}
              </div>
            </section>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          Takvim ve İletişim
        </h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(300px,.72fr)_minmax(260px,.62fr)_minmax(300px,.66fr)]">
          {user.permissions.tasks.canView && (
            <section className="corporate-panel">
              <PanelHeader
                icon={<CalendarDays />}
                title="Takvim"
                action="Takvime Git"
                onClick={() => onNavigate('calendar')}
              />
              <div className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-slate-700">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-4xl font-black tracking-tight text-white">{clock.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-300">{clock.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' })}</div>
                </div>
                <CalendarDays className="h-8 w-8 text-cyan-300" />
              </div>
              <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${todayImportant ? 'bg-lime-300/15 text-lime-200 ring-1 ring-lime-300/30' : 'bg-slate-800/70 text-slate-400'}`}>
                <div className="flex items-center gap-2 font-bold"><Star className="h-4 w-4" /> Bugün</div>
                <div className="mt-1">{todayImportant?.title ?? 'Önemli gün bulunmuyor.'}</div>
              </div>
            </div>
            <CalendarView tasks={tasks} compact />
            </section>
          )}

          <section className="corporate-panel">
            <PanelHeader
              icon={<Mail />}
              title="Son Mesajlar"
              action="Mesajlara Git"
              onClick={() => onNavigate('messages')}
            />
            <div className="divide-y divide-slate-700/60">
              {incomingMessages.length ? incomingMessages.map(message => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => onNavigate('messages')}
                  className="dashboard-message-row"
                >
                  <span className="dashboard-avatar">{initials(message.senderName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {message.senderName}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {message.subject || message.body}
                    </span>
                  </span>
                  <span className="record-branch-badge">{message.branchCode || '---'}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {new Date(message.createdAt).toLocaleString('tr-TR')}
                  </span>
                  {!message.readAt && <span className="h-2 w-2 rounded-full bg-cyan-400" />}
                </button>
              )) : <EmptyText text="Yeni mesaj bulunmuyor." />}
            </div>
          </section>

          <NotesPanel notes={notes} onCreate={onCreateNote} onUpdate={onUpdateNote} onDelete={onDeleteNote} />
        </div>
      </section>
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="corporate-panel-header">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
        <span className="text-cyan-300">{icon}</span>
        {title}
      </h3>
      <button
        type="button"
        onClick={onClick}
        className="dashboard-window-button ui-button ui-button-compact ui-button-neutral"
      >
        {action} →
      </button>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="p-4 text-center text-xs text-slate-500">{text}</p>;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR') || 'K';
}
