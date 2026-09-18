import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, Download, Home, KeyRound, Laptop, LifeBuoy, ListTodo, LogOut, Mail, Network, PackageCheck, Plus, Search, Settings as SettingsIcon, Tablet, UserCircle, Wrench, X } from 'lucide-react';
import type { Announcement, AppMessage, AppState, AuditLog, BranchContext, Credential, NoteColor, SessionUser, Settings, Task, ThemeMode, TrackingRecord, UserNote, UserPermissions } from '@/lib/types';
import { remainingTime, isOverdue } from '@/lib/date';
import { sendNotification, playBeep, vibrate, shakeScreen } from '@/lib/notify';
import {
  downloadCredentialsImportTemplate,
  downloadImportTemplate,
  exportTasksExcel,
  exportTrackingExcel,
  importCredentialsExcelFile,
  importExcelFile,
} from '@/lib/excel';
import { ApiError, api, bootstrapToState, type LicenseStatus, type ReleaseInfo } from '@/lib/api';
import LoginScreen from '@/components/LoginScreen';
import SectionLoading from '@/components/SectionLoading';
import AppFooter from '@/components/AppFooter';
import PrintMailToolbar from '@/components/PrintMailToolbar';
import AnnouncementModal from '@/components/AnnouncementModal';
import ForcePasswordChange from '@/components/ForcePasswordChange';

const TaskForm = lazy(() => import('@/components/TaskForm'));
const TaskList = lazy(() => import('@/components/TaskList'));
const CalendarView = lazy(() => import('@/components/CalendarView'));
const CredentialsVault = lazy(() => import('@/components/CredentialsVault'));
const SettingsPanel = lazy(() => import('@/components/SettingsPanel'));
const TrackingPanel = lazy(() => import('@/components/TrackingPanel'));
const NetworkMonitorPanel = lazy(() => import('@/components/NetworkMonitorPanel'));
const HelpDeskPanel = lazy(() => import('@/components/HelpDeskPanel'));
const Dashboard = lazy(() => import('@/components/Dashboard'));
const MessagesPanel = lazy(() => import('@/components/MessagesPanel'));
const ProfileModal = lazy(() => import('@/components/ProfileModal'));
const UserManagementPanel = lazy(() => import('@/components/UserManagementPanel'));
const BranchManagementPanel = lazy(() => import('@/components/BranchManagementPanel'));
const AssetManagement = lazy(() => import('@/components/AssetManagement'));
const ReleaseNotesModal = lazy(() => import('@/components/ReleaseNotesModal'));
const LicenseBlockedScreen = lazy(() => import('@/components/LicenseBlockedScreen'));

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}


type Tab = 'dashboard' | 'messages' | 'tasks' | 'calendar' | 'tracking' | 'network' | 'helpdesk' | 'credentials' | 'settings';
type MainModule = 'operations' | 'assets';
type InterfaceMode = 'desktop' | 'tablet' | 'auto';

const CLIENT_VERSION = '6.3.63';

const NAV: { id: Tab; label: string; icon: typeof ListTodo }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'messages', label: 'Mesajlar', icon: Mail },
  { id: 'tasks', label: 'İşler', icon: ListTodo },
  { id: 'calendar', label: 'Takvim', icon: CalendarDays },
  { id: 'tracking', label: 'Takip', icon: Wrench },
  { id: 'network', label: 'Network İzleme', icon: Network },
  { id: 'helpdesk', label: 'Help Desk', icon: LifeBuoy },
  { id: 'credentials', label: 'Bilgiler', icon: KeyRound },
  { id: 'settings', label: 'Ayarlar', icon: SettingsIcon },
];

function branchAccessSignature(user: SessionUser, context: BranchContext) {
  return JSON.stringify({
    id: user.id,
    active: user.active,
    isAdmin: user.isAdmin,
    selectedBranchCode: context.selectedBranchCode,
    accessibleBranchCodes: context.accessibleBranchCodes,
    branches: context.branches.map(branch => ({
      code: branch.code,
      name: branch.name,
      active: branch.active,
      permissions: branch.permissions,
    })),
  });
}

function effectivePermissionsForBranchContext(
  user: SessionUser,
  context: BranchContext,
): UserPermissions {
  if (user.isAdmin) return user.permissions;

  if (context.selectedBranchCode !== 'ALL') {
    return context.branches.find(branch => branch.code === context.selectedBranchCode)?.permissions ?? user.permissions;
  }

  const branchPermissions = context.branches.map(branch => branch.permissions);
  const any = (selector: (permissions: UserPermissions) => boolean) => branchPermissions.some(selector);

  return {
    tasks: {
      canView: any(p => p.tasks.canView),
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExcel: any(p => p.tasks.canExcel),
    },
    credentials: {
      canView: any(p => p.credentials.canView),
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExcel: any(p => p.credentials.canExcel),
    },
    tracking: {
      canView: any(p => p.tracking.canView),
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExcel: any(p => p.tracking.canExcel),
    },
    network: {
      canView: any(p => p.network.canView),
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExcel: any(p => p.network.canExcel),
    },
    canAccessSettings: any(p => p.canAccessSettings),
    canManageUsers: any(p => p.canManageUsers),
    canManageBranches: any(p => p.canManageBranches),
    canAssignUserBranches: any(p => p.canAssignUserBranches),
    canSendBranchAnnouncements: any(p => p.canSendBranchAnnouncements),
    canAccessAssets: any(p => p.canAccessAssets),
    assets: {
      dashboardView: any(p => p.assets.dashboardView),
      cardsView: any(p => p.assets.cardsView),
      cardsCreate: false,
      cardsEdit: false,
      cardsDelete: false,
      assignmentsView: any(p => p.assets.assignmentsView),
      assignmentsCreate: false,
      assignmentsReturn: false,
      transfersView: any(p => p.assets.transfersView),
      transfersCreate: false,
      transfersApprove: false,
      countsView: any(p => p.assets.countsView),
      countsCreate: false,
      countsScan: false,
      countsReview: any(p => p.assets.countsReview),
      countsCorrect: false,
      countsComplete: false,
      countsApprove: false,
      locationsView: any(p => p.assets.locationsView),
      locationsManage: false,
      labelsView: any(p => p.assets.labelsView),
      labelsDesign: false,
      labelsPrint: false,
      documentsView: any(p => p.assets.documentsView),
      documentsPrint: false,
      reportsView: any(p => p.assets.reportsView),
      reportsExport: any(p => p.assets.reportsExport),
      integrationsView: any(p => p.assets.integrationsView),
      integrationsManage: false,
    },
  };
}

const EMPTY_STATE: AppState = {
  tasks: [],
  credentials: [],
  trackingRecords: [],
  settings: { notifyMinutesBefore: 15, shakeEnabled: true, soundEnabled: true, theme: 'dark', mail: {
    mailProvider: 'smtp',
    smtpEnabled: false,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPasswordSet: false,
    smtpFrom: '',
    graphEnabled: false, graphTenantId: '', graphClientId: '', graphClientSecretSet: false, graphSenderUser: '',
    reminderEmailEnabled: false, reminderLeadMinutes: 60,
  },
  branding: { companyName: '', companyLogoDataUrl: '', quickLinks: [] },
  backup: {
    networkBackupEnabled: false, networkBackupPath: '', backupScheduleEnabled: false,
    backupScheduleType: 'daily', backupScheduleTime: '22:00', backupScheduleDay: 1, backupRetentionDays: 30,
  } },
  passwordHash: null,
};

function sectionPermissionForTab(user: SessionUser | null, tab: Tab) {
  if (!user) return null;
  if (tab === 'tasks' || tab === 'calendar') return user.permissions.tasks;
  if (tab === 'credentials') return user.permissions.credentials;
  if (tab === 'tracking') return user.permissions.tracking;
  if (tab === 'network') return user.permissions.network;
  return null;
}

function canRemainInView(user: SessionUser, mainModule: MainModule, tab: Tab) {
  if (user.isAdmin) return true;
  if (mainModule === 'assets') return user.permissions.canAccessAssets;
  if (tab === 'dashboard' || tab === 'messages' || tab === 'helpdesk') return true;
  if (tab === 'settings') return user.permissions.canAccessSettings;
  return Boolean(sectionPermissionForTab(user, tab)?.canView);
}

export default function App() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [messageUsers, setMessageUsers] = useState<SessionUser[]>([]);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [sessionDismissedAnnouncements, setSessionDismissedAnnouncements] = useState<Set<string>>(() => new Set());
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [branchContext, setBranchContext] = useState<BranchContext>({ branches: [], assignedBranchCodes: [], accessibleBranchCodes: [], primaryBranchCode: '100', selectedBranchCode: '100', canSeeAllBranches: false });
  const liveAccessSignatureRef = useRef('');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [clientUpdated, setClientUpdated] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [licenseBlocked, setLicenseBlocked] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [hasUsers, setHasUsers] = useState(true);
  const [publicBranding, setPublicBranding] = useState({ companyName: '', companyLogoDataUrl: '', quickLinks: [] as Array<{ id: string; label: string; url: string; active: boolean }> });
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>(() => {
    const saved=sessionStorage.getItem('operis-current-tab') as Tab | null;
    return saved && ['dashboard','messages','tasks','calendar','tracking','network','helpdesk','credentials','settings'].includes(saved)
      ? saved
      : 'dashboard';
  });
  const [mainModule, setMainModule] = useState<MainModule>(() => {
    const saved=sessionStorage.getItem('operis-current-main-module');
    return saved==='assets' || saved==='operations' ? saved : 'operations';
  });
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>(() => {
    const saved = localStorage.getItem('operis-interface-mode');
    return saved === 'desktop' || saved === 'tablet' || saved === 'auto' ? saved : 'auto';
  });
  const [autoTablet, setAutoTablet] = useState(() =>
    window.matchMedia('(pointer: coarse)').matches
    && window.matchMedia('(max-width: 1180px)').matches
  );
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [popupNotif, setPopupNotif] = useState<{ title: string; body: string; id: number; overdue: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem('operis-interface-mode', interfaceMode);
  }, [interfaceMode]);

  useEffect(() => {
    sessionStorage.setItem('operis-current-tab', tab);
  }, [tab]);

  useEffect(() => {
    sessionStorage.setItem('operis-current-main-module', mainModule);
  }, [mainModule]);

  useEffect(() => {
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const tabletWidth = window.matchMedia('(max-width: 1180px)');
    const update = () => setAutoTablet(coarsePointer.matches && tabletWidth.matches);
    update();
    coarsePointer.addEventListener?.('change', update);
    tabletWidth.addEventListener?.('change', update);
    return () => {
      coarsePointer.removeEventListener?.('change', update);
      tabletWidth.removeEventListener?.('change', update);
    };
  }, []);

  const resolvedInterfaceMode: Exclude<InterfaceMode, 'auto'> =
    interfaceMode === 'auto'
      ? (autoTablet ? 'tablet' : 'desktop')
      : interfaceMode;

  const loadBootstrap = async () => {
    const payload = await api.bootstrap();
    setState(bootstrapToState(payload));
    const effectiveUser = {
      ...payload.user,
      permissions: effectivePermissionsForBranchContext(payload.user, payload.branchContext),
    };
    setCurrentUser(effectiveUser);
    liveAccessSignatureRef.current=branchAccessSignature(effectiveUser,payload.branchContext);
    setUsers(payload.users);
    setMessageUsers(payload.messageUsers);
    setMessages(payload.messages);
    setAnnouncements(payload.announcements ?? []);
    setSessionDismissedAnnouncements(new Set());
    setAuditLogs(payload.auditLogs ?? []);
    setNotes(payload.notes ?? []);
    setBranchContext(payload.branchContext);
    if (payload.branchContext?.selectedBranchCode) {
      localStorage.setItem('operis-selected-branch', payload.branchContext.selectedBranchCode);
    }
    setReleaseInfo(payload.releaseInfo);
    setLicenseStatus(payload.license);
    setLicenseBlocked(false);
    setShowReleaseNotes(Boolean(payload.releaseInfo?.shouldShow));
    if (sessionStorage.getItem('operis-client-updated') === CLIENT_VERSION) {
      setClientUpdated(true);
      sessionStorage.removeItem('operis-client-updated');
    }
    if (!effectiveUser.isAdmin && !effectiveUser.permissions.canAccessAssets) setMainModule('operations');
    const welcomeKey = `yi-welcome-${payload.user.id}`;
    if (!sessionStorage.getItem(welcomeKey)) {
      sessionStorage.setItem(welcomeKey, '1');
      setWelcomeVisible(true);
      window.setTimeout(() => setWelcomeVisible(false), 5000);
    }
    return { effectiveUser, branchContext: payload.branchContext };
  };

  useEffect(() => {
    let active = true;

    const refreshClientForNewVersion = async (serverVersion: string) => {
      if (serverVersion === CLIENT_VERSION) return false;

      const attemptKey = `operis-update-attempt-${serverVersion}`;
      if (sessionStorage.getItem(attemptKey)) return false;
      sessionStorage.setItem(attemptKey, '1');
      sessionStorage.setItem('operis-client-updated', serverVersion);

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith('operis-') || key.startsWith('yaklasan-isler')).map(key => caches.delete(key)));
      }

      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      }

      const url = new URL(window.location.href);
      url.searchParams.set('operisVersion', serverVersion);
      window.location.replace(url.toString());
      return true;
    };

    void (async () => {
      try {
        const version = await api.versionInfo();
        if (await refreshClientForNewVersion(version.version)) return;

        const status = await api.authStatus();
        if (!active) return;
        setHasUsers(status.hasUsers);
        setPublicBranding(status.branding);
        if (status.hasUsers) {
          try {
            const me = await api.currentUser();
            if (me.user.mustChangePassword) {
              setCurrentUser(me.user);
            } else {
              await loadBootstrap();
            }
          } catch (error) {
            setCurrentUser(null);
            if (error instanceof ApiError && error.code === 'LICENSE_EXPIRED') {
              setLicenseBlocked(true);
            }
          }
        }
      } finally {
        if (active) setBooting(false);
      }
    })();

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.classList.remove('theme-light', 'theme-spring', 'theme-dark', 'theme-gray', 'theme-turquoise', 'theme-black', 'theme-ocean-blue', 'theme-pastel-glass', 'theme-corporate-2d');
    root.classList.add(`theme-${state.settings.theme}`);
    root.style.colorScheme = ['light', 'spring', 'ocean-blue', 'pastel-glass', 'corporate-2d'].includes(state.settings.theme) ? 'light' : 'dark';
    localStorage.setItem('yi-theme', state.settings.theme);

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => root.classList.remove('theme-switching'));
    });

    return () => {
      window.cancelAnimationFrame(frame);
      root.classList.remove('theme-switching');
    };
  }, [state.settings.theme]);

  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(interval);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const check = () => {
      const now = Date.now();
      for (const task of state.tasks) {
        if (task.completed) continue;
        const [hours, minutes] = task.time.split(':').map(Number);
        const target = new Date(`${task.date}T00:00`);
        target.setHours(hours, minutes, 0, 0);
        const notifyAt = target.getTime() - state.settings.notifyMinutesBefore * 60_000;
        const key = `${task.id}_${notifyAt}`;
        const grace = 5 * 60_000;
        const validUntil = Math.max(target.getTime() + grace, notifyAt + grace);
        if (now >= notifyAt && now <= validUntil && !notifiedRef.current.has(key)) {
          notifiedRef.current.add(key);
          const overdue = isOverdue(task.date, task.time, false);
          const title = overdue ? 'İş zamanı geçti!' : 'İş yaklaşıyor';
          const body = `${task.title} — ${remainingTime(task.date, task.time)}`;
          sendNotification(title, body);
          setPopupNotif({ title, body, id: Date.now(), overdue });
          if (state.settings.soundEnabled) playBeep();
          if (state.settings.shakeEnabled) {
            vibrate([200, 100, 200, 100, 200]);
            shakeScreen();
          }
        }
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [currentUser, state.tasks, state.settings]);

  const refreshUsers = async () => {
    const list=await api.getUsers();
    setUsers(list);
    const self=list.find(user=>user.id===currentUser?.id);
    if(self)setCurrentUser(self);
  };

  useEffect(() => {
    if(!currentUser || currentUser.mustChangePassword)return;
    let cancelled=false;
    let refreshing=false;
    const refreshLiveAccess=async()=>{
      if(refreshing)return;
      refreshing=true;
      try{
        const [auth,context]=await Promise.all([api.currentUser(),api.getBranchContext()]);
        if(cancelled)return;
        const effectiveUser={
          ...auth.user,
          permissions:effectivePermissionsForBranchContext(auth.user,context),
        };
        const nextSignature=branchAccessSignature(effectiveUser,context);
        if(nextSignature!==liveAccessSignatureRef.current){
          await loadBootstrap();
          return;
        }
        setCurrentUser(effectiveUser);
        setBranchContext(context);
        if(context.selectedBranchCode)localStorage.setItem('operis-selected-branch',context.selectedBranchCode);
      }catch{
        // Geçici ağ hatasında mevcut oturum ve mevcut veri korunur; sonraki döngü tekrar dener.
      }finally{
        refreshing=false;
      }
    };
    const timer=window.setInterval(()=>void refreshLiveAccess(),15_000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[currentUser?.id,currentUser?.mustChangePassword]);

  const handleLogin = async (username: string, password: string): Promise<boolean> => {
    let authenticated = false;
    try {
      const loginResult = await api.login(username, password);
      authenticated = true;
      localStorage.setItem(`operis-last-activity-at:${loginResult.user.id}`, String(Date.now()));
      if (loginResult.user.mustChangePassword) {
        setCurrentUser(loginResult.user);
      } else {
        await loadBootstrap();
      }
      return true;
    } catch (error) {
      setCurrentUser(null);
      if (error instanceof ApiError && error.code === 'LICENSE_EXPIRED') {
        setLicenseBlocked(true);
      }

      // Giriş isteği başarılı olup bootstrap yüklemesi başarısızsa bunu
      // "kullanıcı adı veya şifre hatalı" diye maskeleme.
      if (authenticated) {
        const detail = error instanceof Error ? error.message : 'Uygulama verileri yüklenemedi.';
        throw new Error(`Giriş başarılı, ancak OPERİS arayüzü yüklenemedi: ${detail}`);
      }

      throw error;
    }
  };

  const handleInitialSetup = async (username: string, displayName: string, email: string, password: string): Promise<boolean> => {
    try {
      await api.setup(username, displayName, email, password);
      setHasUsers(true);
      await loadBootstrap();
      return true;
    } catch {
      return false;
    }
  };

  const requirePermission = (allowed: boolean, message: string) => {
    if (allowed) return true;
    alert(message);
    return false;
  };

  const addOrUpdateTask = async (task: Task) => {
    const exists = state.tasks.some((item) => item.id === task.id);
    const allowed = exists ? currentUser?.permissions.tasks.canEdit : currentUser?.permissions.tasks.canCreate;
    if (!requirePermission(Boolean(allowed), exists ? 'İş kaydı düzenleme yetkiniz yok.' : 'İş kaydı ekleme yetkiniz yok.')) return;
    try {
      if (exists) await api.acquireRecordLock('TASKS', task.id);
      const saved = exists ? await api.updateTask(task) : await api.createTask(task);
      setState((current) => ({
        ...current,
        tasks: exists ? current.tasks.map((item) => item.id === saved.id ? saved : item) : [...current.tasks, saved],
      }));
      setShowForm(false);
      setEditTask(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Kayıt kaydedilemedi.');
    }
  };

  const toggleTask = async (id: string) => {
    if (!requirePermission(Boolean(currentUser?.permissions.tasks.canEdit), 'İş kaydı düzenleme yetkiniz yok.')) return;
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    await addOrUpdateTask({ ...task, completed: !task.completed });
  };

  const deleteTask = async (id: string) => {
    if (!requirePermission(Boolean(currentUser?.permissions.tasks.canDelete), 'İş kaydı silme yetkiniz yok.')) return;
    const task = state.tasks.find(item => item.id === id);
    if (!confirm(`"${task?.title ?? 'Bu iş'}" kullanıcı ekranından silinsin mi?`)) return;
    try {
      await api.deleteTask(id);
      await loadBootstrap();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Kayıt silinemedi.');
    }
  };

  const restoreTask = async (id: string) => {
    if (!currentUser?.isAdmin) return;
    try {
      await api.restoreTask(id);
      await loadBootstrap();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Kayıt geri yüklenemedi.');
    }
  };

  const saveCredential = async (credential: Credential) => {
    const exists = state.credentials.some((item) => item.id === credential.id);
    const allowed = exists ? currentUser?.permissions.credentials.canEdit : currentUser?.permissions.credentials.canCreate;
    if (!requirePermission(Boolean(allowed), exists ? 'Bilgi kaydı düzenleme yetkiniz yok.' : 'Bilgi kaydı ekleme yetkiniz yok.')) return;
    try {
      const saved = exists ? await api.updateCredential(credential) : await api.createCredential(credential);
      setState((current) => ({
        ...current,
        credentials: exists
          ? current.credentials.map((item) => item.id === saved.id ? saved : item)
          : [...current.credentials, saved],
      }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Bilgi kaydı kaydedilemedi.');
    }
  };

  const deleteCredential = async (id: string) => {
    if (!requirePermission(Boolean(currentUser?.permissions.credentials.canDelete), 'Bilgi kaydı silme yetkiniz yok.')) return;
    const item = state.credentials.find(credential => credential.id === id);
    if (!confirm(`"${item?.groupName || item?.username || 'Bu kayıt'}" kullanıcı ekranından silinsin mi?`)) return;
    try {
      await api.deleteCredential(id);
      await loadBootstrap();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Bilgi kaydı silinemedi.');
    }
  };

  const restoreCredential = async (id: string) => {
    if (!currentUser?.isAdmin) return;
    try {
      await api.restoreCredential(id);
      await loadBootstrap();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Bilgi kaydı geri yüklenemedi.');
    }
  };

  const saveTrackingRecord = async (record: TrackingRecord) => {
    const exists = state.trackingRecords.some((item) => item.id === record.id);
    const allowed = exists ? currentUser?.permissions.tracking.canEdit : currentUser?.permissions.tracking.canCreate;
    if (!requirePermission(Boolean(allowed), exists ? 'Takip kaydı düzenleme yetkiniz yok.' : 'Takip kaydı ekleme yetkiniz yok.')) return;
    try {
      if (exists) await api.acquireRecordLock('TRACKING', record.id);
      const saved = exists ? await api.updateTracking(record) : await api.createTracking(record);
      setState((current) => ({
        ...current,
        trackingRecords: exists
          ? current.trackingRecords.map((item) => item.id === saved.id ? saved : item)
          : [...current.trackingRecords, saved],
      }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Takip kaydı kaydedilemedi.');
    }
  };

  const deleteTrackingRecord = async (id: string) => {
    if (!requirePermission(Boolean(currentUser?.permissions.tracking.canDelete), 'Takip kaydı silme yetkiniz yok.')) return;
    const item = state.trackingRecords.find(record => record.id === id);
    if (!confirm(`"${item?.serviceNumber || item?.groupName || 'Bu takip kaydı'}" kullanıcı ekranından silinsin mi?`)) return;
    try {
      await api.deleteTracking(id);
      await loadBootstrap();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Takip kaydı silinemedi.');
    }
  };

  const restoreTrackingRecord = async (id: string) => {
    if (!currentUser?.isAdmin) return;
    try {
      await api.restoreTracking(id);
      await loadBootstrap();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Takip kaydı geri yüklenemedi.');
    }
  };

  const updateSettings = async (settings: Settings) => {
    if (!requirePermission(Boolean(currentUser?.permissions.canAccessSettings), 'Ayarlara erişim yetkiniz yok.')) return;
    try {
      const saved = await api.updateSettings(settings);
      setState((current) => ({ ...current, settings: { ...current.settings, ...saved } }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ayarlar kaydedilemedi.');
    }
  };

  const triggerAlert = () => {
    const title = 'Test uyarısı';
    const body = 'Pop-up, turuncu uyarı, ses ve sarsıntı çalışıyor.';
    sendNotification(title, body);
    setPopupNotif({ title, body, id: Date.now(), overdue: false });
    if (state.settings.soundEnabled) playBeep();
    if (state.settings.shakeEnabled) {
      vibrate([250, 120, 250, 120, 350]);
      shakeScreen();
    }
  };

  const handleImportExcel = async (file: File) => {
    if (!requirePermission(Boolean(currentUser?.permissions.tasks.canExcel && currentUser?.permissions.credentials.canExcel), 'İşler ve Bilgiler için Excel yetkiniz yok.')) return;
    try {
      const result = await importExcelFile(file);
      await api.importRecords({ tasks: result.tasks, credentials: result.credentials });
      await loadBootstrap();
      const summary = `${result.tasks.length} iş ve ${result.credentials.length} bilgi kaydı yüklendi.`;
      alert(result.errors.length ? `${summary}\n\nAtlanan satırlar:\n${result.errors.join('\n')}` : summary);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Excel dosyası okunamadı.');
    }
  };

  const handleImportCredentialsExcel = async (file: File) => {
    if (!requirePermission(Boolean(currentUser?.permissions.credentials.canExcel), 'Bilgiler için Excel yetkiniz yok.')) return;
    try {
      const result = await importCredentialsExcelFile(file);
      await api.importRecords({ credentials: result.credentials });
      await loadBootstrap();
      const summary = `${result.credentials.length} bilgi kaydı yüklendi.`;
      alert(result.errors.length ? `${summary}\n\nAtlanan satırlar:\n${result.errors.join('\n')}` : summary);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Excel dosyası okunamadı.');
    }
  };

  const changePersonalTheme = async (theme: ThemeMode) => {
    if (!currentUser) return;
    const previousTheme = state.settings.theme;
    const root = document.documentElement;

    root.classList.remove('theme-light', 'theme-spring', 'theme-dark', 'theme-gray', 'theme-turquoise', 'theme-black', 'theme-ocean-blue', 'theme-pastel-glass', 'theme-corporate-2d');
    root.classList.add(`theme-${theme}`);
    root.style.colorScheme = ['light','spring','ocean-blue','pastel-glass','corporate-2d'].includes(theme) ? 'light' : 'dark';
    localStorage.setItem('yi-theme', theme);

    setState(current => ({ ...current, settings: { ...current.settings, theme } }));
    setCurrentUser(current => current ? { ...current, theme } : current);

    try {
      const updated = await api.updateTheme(theme);
      setCurrentUser(updated);
    } catch (error) {
      root.classList.remove('theme-light', 'theme-spring', 'theme-dark', 'theme-gray', 'theme-turquoise', 'theme-black', 'theme-ocean-blue', 'theme-pastel-glass', 'theme-corporate-2d');
      root.classList.add(`theme-${previousTheme}`);
      root.style.colorScheme = ['light','spring','ocean-blue','pastel-glass','corporate-2d'].includes(previousTheme) ? 'light' : 'dark';
      localStorage.setItem('yi-theme', previousTheme);
      setState(current => ({ ...current, settings: { ...current.settings, theme: previousTheme } }));
      setCurrentUser(current => current ? { ...current, theme: previousTheme } : current);
      alert(error instanceof Error ? error.message : 'Tema kaydedilemedi.');
    }
  };

  const refreshMessages = async () => {
    setMessages(await api.getMessages());
  };

  const unreadMessages = messages.filter(message => message.direction === 'inbox' && !message.readAt);
  const pendingAnnouncement = announcements.find(announcement =>
    !announcement.dontShowAgainAt
    && !sessionDismissedAnnouncements.has(announcement.id)
    && announcement.startsAt <= Date.now()
    && (!announcement.endsAt || announcement.endsAt >= Date.now())
  ) ?? null;

  // Güncelleme sonrasında öncelik her zaman sürüm notlarındadır.
  // Duyuru, sürüm penceresi kapatıldıktan sonra gösterilir ve ancak o anda okundu olarak işaretlenir.
  const activeAnnouncement = showReleaseNotes ? null : pendingAnnouncement;

  useEffect(() => {
    if (!activeAnnouncement || activeAnnouncement.seenAt) return;
    void api.markAnnouncementSeen(activeAnnouncement.id).then(result => {
      setAnnouncements(current => current.map(item => item.id === activeAnnouncement.id ? { ...item, seenAt: result.seenAt } : item));
    }).catch(() => undefined);
  }, [activeAnnouncement?.id]);

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const installed = () => {
      setInstallPrompt(null);
      setAppInstalled(true);
    };

    const displayModeChanged = () => {
      setAppInstalled(
        displayMode.matches
        || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
      );
    };

    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', installed);
    displayMode.addEventListener?.('change', displayModeChanged);

    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
      window.removeEventListener('appinstalled', installed);
      displayMode.removeEventListener?.('change', displayModeChanged);
    };
  }, []);





  const backupDatabase = async () => {
    const { blob, filename } = await api.downloadBackup();
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    if (picker) {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'Operis Tam Yedeği', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      alert('Tam yedek seçtiğiniz klasöre kaydedildi.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    alert('Tarayıcı yedeği indirdi. Dosyayı Belgeler klasörüne taşıyabilirsiniz.');
  };

  const restoreDatabase = async (file: File) => {
    const result = await api.restoreBackup(file);
    if (result.restartRequired) {
      alert('Yedek doğrulandı ve geri yüklendi. Sunucu yeniden başlıyor; 10 saniye sonra sayfa yenilenecek.');
      window.setTimeout(() => window.location.reload(), 10000);
    }
  };

  const createDesktopShortcut = async () => {
    if (appInstalled) {
      alert('Operis bu cihazda zaten uygulama olarak kuruludur.');
      return;
    }

    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === 'accepted') {
        setInstallPrompt(null);
        setAppInstalled(true);
        alert('Operis kendi logosuyla bu cihaza uygulama olarak kuruldu.');
      }
      return;
    }

    const userAgent = navigator.userAgent.toLowerCase();
    const isAppleMobile = /iphone|ipad|ipod/.test(userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isAppleMobile) {
      alert('iPhone veya iPad’de Safari paylaşım düğmesine dokunun ve “Ana Ekrana Ekle” seçeneğini kullanın. Operis kendi logosuyla ana ekrana eklenecektir.');
      return;
    }

    const isAndroid = userAgent.includes('android');
    if (isAndroid) {
      alert('Chrome menüsünü açın ve “Uygulamayı yükle” veya “Ana ekrana ekle” seçeneğine dokunun. Operis kendi logosuyla eklenecektir.');
      return;
    }

    const appUrl = `${window.location.protocol}//${window.location.host}`;
    const iconUrl = `${appUrl}/icons/operis.ico`;
    const script = [
      '@echo off',
      'setlocal',
      'title Operis Masaustu Kisayolu',
      'set "DESKTOP=%USERPROFILE%\\Desktop"',
      'if exist "%USERPROFILE%\\OneDrive\\Desktop" set "DESKTOP=%USERPROFILE%\\OneDrive\\Desktop"',
      'set "OPERISDIR=%LOCALAPPDATA%\\Operis"',
      'if not exist "%OPERISDIR%" mkdir "%OPERISDIR%"',
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '${iconUrl}' -OutFile '%OPERISDIR%\\Operis.ico' } catch { exit 1 }"`,
      'if errorlevel 1 (',
      '  echo Operis logosu indirilemedi.',
      '  pause',
      '  exit /b 1',
      ')',
      'set "SHORTCUT=%DESKTOP%\\Operis.url"',
      '> "%SHORTCUT%" echo [InternetShortcut]',
      `>> "%SHORTCUT%" echo URL=${appUrl}`,
      '>> "%SHORTCUT%" echo IconFile=%OPERISDIR%\\Operis.ico',
      '>> "%SHORTCUT%" echo IconIndex=0',
      '>> "%SHORTCUT%" echo HotKey=0',
      'echo.',
      'echo Operis kisayolu kendi logosuyla masaustune olusturuldu.',
      'echo Konum: %SHORTCUT%',
      'echo.',
      'pause',
    ].join('\r\n');

    const blob = new Blob([script], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Operis_MASAUSTU_KISAYOL_EKLE.cmd';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    alert('Kısayol oluşturucu indirildi. Dosyayı bir kez çalıştırdığınızda Operis kendi logosuyla masaüstüne eklenecektir.');
  };

  const createNote = async (input: { title: string; content: string; color: NoteColor }) => {
    const branchCode = branchContext.selectedBranchCode === 'ALL'
      ? branchContext.primaryBranchCode
      : branchContext.selectedBranchCode;
    const created = await api.createNote({ ...input, branchCode });
    setNotes(current => [created, ...current]);
  };

  const updateNote = async (id: string, input: { title: string; content: string; color: NoteColor }) => {
    const updated = await api.updateNote(id, input);
    setNotes(current => current.map(note => note.id === id ? updated : note));
  };

  const deleteNote = async (id: string) => {
    if (!confirm('Bu not silinsin mi?')) return;
    await api.deleteNote(id);
    setNotes(current => current.filter(note => note.id !== id));
  };

  const closeReleaseNotes = async () => {
    await api.acknowledgeRelease().catch(() => undefined);
    setShowReleaseNotes(false);
    setClientUpdated(false);
    if (releaseInfo) {
      setReleaseInfo({ ...releaseInfo, shouldShow: false });
    }
  };

  const changeBranchScope = async (branchCode: string) => {
    const previousBranchCode = localStorage.getItem('operis-selected-branch') || branchContext.selectedBranchCode;
    const previousMainModule = mainModule;
    const previousTab = tab;

    localStorage.setItem('operis-selected-branch', branchCode);
    setBooting(true);
    try {
      const loaded = await loadBootstrap();
      if (!canRemainInView(loaded.effectiveUser, previousMainModule, previousTab)) {
        setMainModule('operations');
        setTab('dashboard');
        sessionStorage.setItem('operis-current-main-module', 'operations');
        sessionStorage.setItem('operis-current-tab', 'dashboard');
      }
    } catch (error) {
      localStorage.setItem('operis-selected-branch', previousBranchCode);
      alert(error instanceof Error ? error.message : 'Şube görünümü değiştirilemedi.');
    } finally {
      setBooting(false);
    }
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    setCurrentUser(null);
    setUsers([]);
    setBranchContext({ branches: [], assignedBranchCodes: [], accessibleBranchCodes: [], primaryBranchCode: '100', selectedBranchCode: '100', canSeeAllBranches: false });
    setState(EMPTY_STATE);
    sessionStorage.removeItem('operis-current-tab');
    sessionStorage.removeItem('operis-current-main-module');
    sessionStorage.removeItem('operis-assets-page');
    setTab('dashboard');
    setMainModule('operations');
  };

  useEffect(() => {
    if (!currentUser) return;

    const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
    const activityKey = `operis-last-activity-at:${currentUser.id}`;
    let disposed = false;
    let idleTimer: number | null = null;
    let idleDetector: {
      start: (options: { threshold: number; signal?: AbortSignal }) => Promise<void>;
      addEventListener: (type: string, listener: () => void) => void;
      screenState?: string;
      userState?: string;
    } | null = null;
    const abortController = new AbortController();

    const secureLogout = async () => {
      if (disposed) return;
      disposed = true;
      sessionStorage.setItem('operis-lock-logout', '1');
      await api.logout().catch(() => undefined);
      setCurrentUser(null);
      setUsers([]);
      setMessageUsers([]);
      setMessages([]);
      setAnnouncements([]);
      setNotes([]);
      setState(EMPTY_STATE);
      sessionStorage.removeItem('operis-current-tab');
      sessionStorage.removeItem('operis-current-main-module');
      sessionStorage.removeItem('operis-assets-page');
      setTab('dashboard');
      setMainModule('operations');
    };

    const readLastActivity = () => {
      const raw = Number(localStorage.getItem(activityKey) || '0');
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    };

    const scheduleIdleLogout = (lastActivityAt = readLastActivity()) => {
      if (disposed) return;
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      const remaining = Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt));
      idleTimer = window.setTimeout(() => {
        void secureLogout();
      }, remaining);
    };

    const registerActivity = () => {
      if (disposed) return;
      const now = Date.now();
      localStorage.setItem(activityKey, String(now));
      scheduleIdleLogout(now);
    };

    const enforceIdleBeforeResume = () => {
      if (disposed) return true;
      const lastActivityAt = readLastActivity();
      if (lastActivityAt > 0 && Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) {
        void secureLogout();
        return true;
      }
      registerActivity();
      return false;
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'touchstart',
    ];
    activityEvents.forEach(eventName => window.addEventListener(eventName, registerActivity, { passive: true }));

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') enforceIdleBeforeResume();
    };
    const handleFocus = () => {
      enforceIdleBeforeResume();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    const startIdleLockDetection = async () => {
      const idleApi = window as Window & {
        IdleDetector?: {
          new(): {
            screenState?: string;
            userState?: string;
            start(options: { threshold: number; signal?: AbortSignal }): Promise<void>;
            addEventListener(type: string, listener: () => void): void;
          };
          requestPermission?(): Promise<'granted' | 'denied'>;
        };
      };

      if (!idleApi.IdleDetector) return;

      try {
        const permission = idleApi.IdleDetector.requestPermission
          ? await idleApi.IdleDetector.requestPermission()
          : 'granted';
        if (permission !== 'granted' || disposed) return;

        idleDetector = new idleApi.IdleDetector();
        idleDetector.addEventListener('change', () => {
          if (idleDetector?.screenState === 'locked') {
            void secureLogout();
            return;
          }
          if (idleDetector?.userState === 'idle') {
            void secureLogout();
          }
        });
        await idleDetector.start({ threshold: IDLE_TIMEOUT_MS, signal: abortController.signal });
      } catch {
        // IdleDetector desteklenmez/izin verilmezse 15 dakikalık etkinlik zamanlayıcısı çalışmaya devam eder.
      }
    };

    if (!readLastActivity()) registerActivity();
    else if (!enforceIdleBeforeResume()) scheduleIdleLogout();
    void startIdleLockDetection();

    return () => {
      disposed = true;
      abortController.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      activityEvents.forEach(eventName => window.removeEventListener(eventName, registerActivity));
      if (idleTimer !== null) window.clearTimeout(idleTimer);
    };
  }, [currentUser?.id]);

  if (booting) return <SectionLoading />;
  if (licenseBlocked) {
    return (
      <Suspense fallback={<SectionLoading />}>
        <LicenseBlockedScreen />
      </Suspense>
    );
  }
  if (!currentUser) {
    return (
      <LoginScreen
        hasUsers={hasUsers}
        hasLegacyPassword={false}
        onLogin={handleLogin}
        onInitialSetup={handleInitialSetup}
        onLegacyMigration={handleInitialSetup}
        onForgotPassword={async (email) => { await api.forgotPassword(email); }}
        onResetPassword={async (token, password) => { await api.resetPasswordWithToken(token, password); }}
        branding={publicBranding}
        version={CLIENT_VERSION}
      />
    );
  }

  if (currentUser.mustChangePassword) {
    return <ForcePasswordChange user={currentUser} onSave={async(input)=>{
      const result=await api.completeFirstLogin(input);
      setCurrentUser(result.user);
      await loadBootstrap();
    }} />;
  }

  const filteredTasks = query.trim()
    ? state.tasks.filter((task) =>
        task.title.toLowerCase().includes(query.toLowerCase()) ||
        task.description.toLowerCase().includes(query.toLowerCase()))
    : state.tasks;
  const overdueCount = state.tasks.filter((task) => isOverdue(task.date, task.time, task.completed)).length;

  return (
    <div
      className={`min-h-screen bg-slate-900 text-white flex flex-col app-shell interface-${resolvedInterfaceMode} ${mainModule === 'assets' ? 'asset-module-shell' : ''}`}
      data-interface-mode={resolvedInterfaceMode}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <header className="sticky top-0 z-20 bg-slate-900/90 backdrop-blur-md border-b border-slate-800" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="operis-topbar mx-auto flex w-full max-w-[1500px] items-center justify-between px-2 py-3 sm:px-3 lg:px-4">
          <div className="operis-brand-block flex min-w-0 items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 flex items-center justify-center ring-1 ring-sky-500/30">
              <ListTodo className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h1 className="operis-rainbow-text text-xl font-black leading-none sm:text-2xl">Operis</h1>
              <p className="operis-expanded-name mt-1 truncate text-[10px] font-semibold tracking-wide text-slate-500 sm:text-[11px]">Operasyon ve İş Yönetim Sistemi</p>
              {overdueCount > 0 && <p className="text-xs text-red-400 leading-tight">{overdueCount} iş zamanı geçti</p>}
            </div>
          </div>
          <div className="header-user-actions ml-auto flex items-center gap-1">
            <div className="operis-branch-switcher hidden items-center gap-2 rounded-xl bg-slate-800/80 px-2 py-1 ring-1 ring-slate-700 md:flex" title="Aktif şube görünümü">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Şube</span>
              {branchContext.branches.length > 1 ? (
                <select
                  value={branchContext.selectedBranchCode}
                  onChange={(event) => void changeBranchScope(event.target.value)}
                  className="max-w-56 rounded-lg bg-slate-900 px-2 py-1 text-xs font-bold text-slate-200 outline-none"
                >
                  <option value="ALL">Yetkili Şubeler — Tümü</option>
                  {branchContext.branches.map(branch => (
                    <option key={branch.code} value={branch.code}>{branch.code} — {branch.name}</option>
                  ))}
                </select>
              ) : (
                <span className="max-w-52 truncate text-xs font-bold text-cyan-200">
                  {branchContext.branches[0] ? `${branchContext.branches[0].code} — ${branchContext.branches[0].name}` : 'Şube yok'}
                </span>
              )}
            </div>
            <div className="interface-mode-switch hidden items-center rounded-xl bg-slate-800/80 p-1 ring-1 ring-slate-700 sm:flex" title="Arayüz modu">
              <button
                type="button"
                onClick={() => setInterfaceMode('desktop')}
                className={`interface-mode-option ${interfaceMode === 'desktop' ? 'active' : ''}`}
                aria-label="Masaüstü modu"
              >
                <Laptop className="h-4 w-4" />
                <span className="hidden xl:inline">Masaüstü</span>
              </button>
              <button
                type="button"
                onClick={() => setInterfaceMode('tablet')}
                className={`interface-mode-option ${interfaceMode === 'tablet' ? 'active' : ''}`}
                aria-label="Tablet modu"
              >
                <Tablet className="h-4 w-4" />
                <span className="hidden xl:inline">Tablet</span>
              </button>
              <button
                type="button"
                onClick={() => setInterfaceMode('auto')}
                className={`interface-mode-option ${interfaceMode === 'auto' ? 'active' : ''}`}
                aria-label="Otomatik arayüz modu"
              >
                <span className="text-[10px] font-black">A</span>
                <span className="hidden xl:inline">Otomatik</span>
              </button>
            </div>
            {mainModule === 'operations' && tab === 'tasks' && (
              <>
                <button onClick={() => setShowSearch((value) => !value)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-sky-400" aria-label="Ara">
                  <Search className="w-5 h-5" />
                </button>
                {currentUser.permissions.tasks.canExcel && (
                  <button onClick={() => exportTasksExcel(state.tasks)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400" aria-label="Excel'e aktar">
                    <Download className="w-5 h-5" />
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => setInterfaceMode(resolvedInterfaceMode === 'desktop' ? 'tablet' : 'desktop')}
              className="interface-mode-mobile-toggle rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-cyan-300 sm:hidden"
              aria-label={resolvedInterfaceMode === 'desktop' ? 'Tablet moduna geç' : 'Masaüstü moduna geç'}
              title={resolvedInterfaceMode === 'desktop' ? 'Tablet moduna geç' : 'Masaüstü moduna geç'}
            >
              {resolvedInterfaceMode === 'desktop' ? <Tablet className="h-5 w-5" /> : <Laptop className="h-5 w-5" />}
            </button>
            <button onClick={() => setShowProfile(true)} className="flex items-center gap-2 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-sky-400" aria-label="Profil bilgilerim">
              <UserCircle className="h-5 w-5 shrink-0" />
              <span className="hidden max-w-36 truncate text-xs font-semibold md:inline">{currentUser.displayName || currentUser.username}</span>
            </button>
            <button onClick={() => void logout()} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400" aria-label="Çıkış yap">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="mx-auto flex max-w-[1500px] gap-2 overflow-x-auto px-4 pb-3">
          <button
            type="button"
            onClick={() => setMainModule('operations')}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
              mainModule === 'operations'
                ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <ListTodo className="h-4 w-4" />
            Operasyon
          </button>


          {(currentUser.isAdmin || currentUser.permissions.canAccessAssets) && (
            <button
              type="button"
              onClick={() => setMainModule('assets')}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
                mainModule === 'assets'
                  ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <PackageCheck className="h-4 w-4" />
              Demirbaş Yönetimi
            </button>
          )}
        </div>
        {mainModule === 'operations' && tab === 'tasks' && showSearch && (
          <div className="max-w-2xl mx-auto px-4 pb-3">
            <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="İşlerde ara..."
              className="w-full bg-slate-800/60 text-white rounded-xl px-4 py-2.5 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none" />
          </div>
        )}
      </header>

      <main className={`flex flex-1 flex-col w-full mx-auto px-3 py-3 pb-24 ${
        mainModule === 'assets' || tab === 'dashboard' || tab === 'helpdesk' ? 'max-w-[1500px] md:px-6 lg:px-8' : 'max-w-4xl md:px-5'
      }`}>
        {mainModule === 'assets' ? (
          <Suspense fallback={<SectionLoading />}>
            <AssetManagement
              user={currentUser}
              companyName={state.settings.branding.companyName}
              logoDataUrl={state.settings.branding.companyLogoDataUrl}
            />
          </Suspense>
        ) : !['settings', 'dashboard', 'messages', 'helpdesk'].includes(tab) && !sectionPermissionForTab(currentUser, tab)?.canView
          ? <div className="panel-card text-center text-slate-400">Bu kullanıcı için görüntüleme yetkisi tanımlanmamış.</div>
          : (
            <>
{!['dashboard', 'messages', 'helpdesk'].includes(tab) && (
            <PrintMailToolbar
            title={NAV.find(item => item.id === tab)?.label ?? 'Rapor'}
            companyName={state.settings.branding.companyName}
            logoDataUrl={state.settings.branding.companyLogoDataUrl}
            rows={tab === 'tasks' || tab === 'calendar' ? state.tasks.filter(item => !item.deletedAt) as unknown as Record<string, unknown>[]
              : tab === 'tracking' ? state.trackingRecords.filter(item => !item.deletedAt) as unknown as Record<string, unknown>[]
              : tab === 'credentials' ? state.credentials.filter(item => !item.deletedAt).map(item => ({ ...item, password: '********' })) as unknown as Record<string, unknown>[]
              : tab === 'messages' ? messages as unknown as Record<string, unknown>[]
              : tab === 'dashboard' ? [
                { Alan: 'İşler', Toplam: state.tasks.length },
                { Alan: 'Takip', Toplam: state.trackingRecords.length },
                { Alan: 'Bilgiler', Toplam: state.credentials.length },
                { Alan: 'Mesajlar', Toplam: messages.length },
                { Alan: 'Kullanıcılar', Toplam: messageUsers.length },
              ] : []}
          />
          )}
          <Suspense fallback={<SectionLoading />}>
              {tab === 'dashboard' && (
                <Dashboard user={currentUser} tasks={state.tasks} trackingRecords={state.trackingRecords}
                  credentials={state.credentials} messages={messages} theme={state.settings.theme}
                  branchContext={branchContext}
                  branding={state.settings.branding}
                  onThemeChange={(theme) => void changePersonalTheme(theme)}
                  onNavigate={(next) => setTab(next)}
                  onNavigateHelpDesk={(filter) => {
                    sessionStorage.setItem('operis-helpdesk-dashboard-filter', filter);
                    setMainModule('operations'); setTab('helpdesk');
                  }}
                  notes={notes}
                  onCreateNote={createNote}
                  onUpdateNote={updateNote}
                  onDeleteNote={deleteNote}
                  onCreateShortcut={createDesktopShortcut}
                  shortcutVisible={!appInstalled} />
              )}
              {tab === 'messages' && (
                <MessagesPanel currentUser={currentUser} users={messageUsers} messages={messages}
                  branches={branchContext.branches}
                  onSend={async (recipientId, subject, body, branchCode) => {
                    const sent = await api.sendMessage(recipientId, subject, body, branchCode);
                    setMessages(current => [sent, ...current]);
                  }}
                  onRead={async (id) => { const result = await api.markMessageRead(id); setMessages(current => current.map(m => m.id === id ? { ...m, readAt: result.readAt } : m)); }}
                  onDelete={async (id) => { await api.deleteMessage(id); setMessages(current => current.filter(m => m.id !== id)); }}
                  onAnnouncementSend={async (input) => {
                    const result = await api.createAnnouncement(input);
                    setAnnouncements(await api.getAnnouncements());
                    return result;
                  }} />
              )}
              {tab === 'tasks' && (
                <TaskList key={tick} tasks={filteredTasks} onToggle={(id) => void toggleTask(id)}
                  onEdit={(task) => { setEditTask(task); setShowForm(true); }}
                  onDelete={(id) => void deleteTask(id)}
                  notifyMinutesBefore={state.settings.notifyMinutesBefore}
                  canEdit={currentUser.permissions.tasks.canEdit}
                  canDelete={currentUser.permissions.tasks.canDelete}
                  isAdmin={currentUser.isAdmin}
                  onRestore={(id) => void restoreTask(id)} />
              )}
              {tab === 'calendar' && <CalendarView tasks={state.tasks.filter(task => !task.deletedAt)} />}
              {tab === 'tracking' && (
                <TrackingPanel records={state.trackingRecords}
                  branches={branchContext.branches}
                  onSave={(record) => void saveTrackingRecord(record)}
                  onDelete={(id) => void deleteTrackingRecord(id)}
                  onRestore={(id) => void restoreTrackingRecord(id)}
                  isAdmin={currentUser.isAdmin}
                  onExport={(records) => exportTrackingExcel(records, 'Tümü')}
                  permissions={currentUser.permissions.tracking} />
              )}
              {tab === 'network' && (
                <NetworkMonitorPanel
                  permissions={currentUser.permissions.network}
                  isAdmin={currentUser.isAdmin}
                  branches={branchContext.branches}
                />
              )}
              {tab === 'helpdesk' && (
                <HelpDeskPanel user={currentUser} />
              )}
              {tab === 'credentials' && (
                <CredentialsVault credentials={state.credentials}
                  branches={branchContext.branches}
                  onSave={(credential) => void saveCredential(credential)}
                  onDelete={(id) => void deleteCredential(id)}
                  onRestore={(id) => void restoreCredential(id)}
                  isAdmin={currentUser.isAdmin}
                  onImportExcel={handleImportCredentialsExcel}
                  onDownloadTemplate={downloadCredentialsImportTemplate}
                  permissions={currentUser.permissions.credentials} />
              )}
              {tab === 'settings' && (
                <SettingsPanel settings={state.settings}
                  onChange={(settings) => void updateSettings(settings)}
                  onExportTasks={() => exportTasksExcel(state.tasks)}
                  onImportExcel={handleImportExcel}
                  onDownloadTemplate={downloadImportTemplate}
                  onTestAlert={triggerAlert}
                  onSaveMailSettings={async (mail) => {
                    const saved = await api.updateMailSettings(mail);
                    setState((current) => ({ ...current, settings: { ...current.settings, mail: saved } }));
                  }}
                  onVerifyMail={async () => api.verifyMail()}
                  onTestMail={async (email) => api.testMail(email)}
                  onSaveGraphMailSettings={async (input) => {
                    const saved = await api.updateGraphMailSettings(input);
                    setState(current => ({ ...current, settings: { ...current.settings, mail: { ...current.settings.mail, ...saved } } }));
                  }}
                  onTestGraphMail={async (email) => {
                    await api.testGraphMail(email);
                    alert('Microsoft Graph test e-postası gönderildi.');
                  }}
                  onBackupDatabase={backupDatabase}
                  onSaveBranding={async (branding) => {
                    const saved = await api.updateBranding(branding);
                    setState(current => ({ ...current, settings: { ...current.settings, branding: saved } }));
                    setPublicBranding(saved);
                  }}
                  onSaveBackupSettings={async (backup) => {
                    await api.updateBackupSettings(backup);
                    setState(current => ({ ...current, settings: { ...current.settings, backup } }));
                  }}
                  onTestNetworkBackup={async () => {
                    const result = await api.testNetworkBackup();
                    alert(result.message);
                  }}
                  onApplyBackupSchedule={async () => {
                    const result = await api.applyBackupSchedule();
                    alert(result.message);
                  }}
                  auditLogs={auditLogs}
                  isAdmin={currentUser.isAdmin}
                  onRefreshAuditLogs={async () => setAuditLogs(await api.getAuditLogs())}
                  onRestoreDatabase={restoreDatabase}
                  releaseInfo={releaseInfo}
                  onShowReleaseNotes={() => setShowReleaseNotes(true)}
                  currentUsername={currentUser.username}
                  currentUserId={currentUser.id}
                  licenseStatus={licenseStatus}
                  onUpdateLicense={async (expiresAt) => {
                    const updated = await api.updateLicenseExpiry(expiresAt);
                    setLicenseStatus(updated);
                    alert('Lisans süresi güncellendi. Diğer kullanıcıların erişimi yeniden değerlendirilecektir.');
                  }}
                  onChangePassword={async () => {
                    const password = prompt('Yeni şifrenizi girin (en az 8 karakter):');
                    if (!password) return;
                    try {
                      await api.resetPassword(currentUser.id, password);
                      alert('Şifre güncellendi.');
                    } catch (error) {
                      alert(error instanceof Error ? error.message : 'Şifre güncellenemedi.');
                    }
                  }}>
                  {currentUser.isAdmin && (
                    <UserManagementPanel users={users} branches={branchContext.branches} currentUser={currentUser}
                      onCreate={async (input) => { await api.createUser(input); await refreshUsers(); }}
                      onUpdate={async (id, changes) => {
                        await api.updateUser(id, changes);
                        await refreshUsers();
                      }}
                      onResetPassword={async (id, password) => { await api.resetPassword(id, password); }}
                      onDelete={(id) => { void api.deleteUser(id).then(refreshUsers).catch((error) => alert(error.message)); }} />
                  )}
                  {branchContext.canSeeAllBranches && currentUser.isAdmin && (
                    <BranchManagementPanel
                      users={users}
                      currentUser={currentUser}
                      canManageBranches={currentUser.isAdmin}
                      canAssignUserBranches={currentUser.isAdmin}
                      onBranchConfigurationChanged={async()=>{await loadBootstrap();}}
                    />
                  )}
                </SettingsPanel>
              )}
            </Suspense>
            </>
          )}
        <AppFooter />
      </main>

      {mainModule === 'operations' && tab === 'tasks' && currentUser.permissions.tasks.canCreate && (
        <button onClick={() => { setEditTask(null); setShowForm(true); }}
          className="fixed bottom-20 right-4 sm:right-1/2 sm:translate-x-[14rem] z-30 w-14 h-14 rounded-full bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/30 flex items-center justify-center"
          aria-label="Yeni iş ekle">
          <Plus className="w-7 h-7" />
        </button>
      )}

      {mainModule === 'operations' && (
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-800 bg-slate-900/95 backdrop-blur-md" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="operation-bottom-nav mx-auto flex max-w-4xl overflow-x-auto">
          {NAV.filter((item) => item.id !== 'settings' || currentUser.permissions.canAccessSettings).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex min-w-[72px] flex-1 shrink-0 flex-col items-center gap-1 px-2 py-2.5 ${tab === id ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>
              <Icon className="w-5 h-5" />
              <span className="relative text-xs font-medium">{label}{id === 'messages' && unreadMessages.length > 0 && <span className="absolute -right-3 -top-2 rounded-full bg-red-500 px-1 text-[9px] text-white">{unreadMessages.length}</span>}</span>
            </button>
          ))}
        </div>
      </nav>
      )}

      {activeAnnouncement && (
        <AnnouncementModal
          announcement={activeAnnouncement}
          onClose={async (dontShowAgain) => {
            const result = await api.dismissAnnouncement(activeAnnouncement.id, dontShowAgain);
            setAnnouncements(current => current.map(item => item.id === activeAnnouncement.id
              ? { ...item, dismissedAt: result.dismissedAt, dontShowAgainAt: result.dontShowAgainAt }
              : item));
            setSessionDismissedAnnouncements(current => {
              const next = new Set(current);
              next.add(activeAnnouncement.id);
              return next;
            });
          }}
        />
      )}

      {popupNotif && (
        <div className="fixed top-16 left-0 right-0 z-50 px-4">
          <div className={`max-w-2xl mx-auto text-white rounded-2xl shadow-lg p-4 flex items-start gap-3 ring-1 ${
            popupNotif.overdue ? 'bg-red-600 ring-red-400/50' : 'bg-orange-500 ring-orange-300/50'}`}>
            <Bell className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-sm">{popupNotif.title}</p>
              <p className="text-sm mt-0.5">{popupNotif.body}</p>
            </div>
            <button onClick={() => setPopupNotif(null)} className="p-1 rounded-lg hover:bg-white/20" aria-label="Kapat">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}


      {welcomeVisible && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-40 px-4">
          <div className="pointer-events-auto mx-auto flex min-h-32 max-w-4xl items-center justify-between rounded-3xl bg-sky-600/70 p-6 text-white shadow-2xl ring-1 ring-sky-300/30 backdrop-blur-xl sm:p-8">
            <div>
              <p className="text-2xl font-bold sm:text-3xl">Merhaba {currentUser.displayName || currentUser.username}</p>
              <p className="mt-2 text-base text-sky-50">{unreadMessages.length > 0 ? `${unreadMessages.length} okunmamış mesajınız var.` : 'Hoş geldiniz, başarılı bir gün geçirmenizi dileriz.'}</p>
            </div>
            <div className="flex gap-2">{unreadMessages.length > 0 && <button onClick={() => { setTab('messages'); setWelcomeVisible(false); }} className="rounded-xl bg-white/20 px-4 py-2 text-sm">Mesajları Aç</button>}<button onClick={() => setWelcomeVisible(false)} className="p-2"><X className="h-5 w-5" /></button></div>
          </div>
        </div>
      )}

      {showReleaseNotes && releaseInfo && (
        <Suspense fallback={null}>
          <ReleaseNotesModal release={releaseInfo} clientUpdated={clientUpdated} onClose={closeReleaseNotes} />
        </Suspense>
      )}

      {showProfile && (
        <ProfileModal user={currentUser} onClose={() => setShowProfile(false)}
          onSave={async changes => { const updated = await api.updateProfile(changes); const safeTheme = updated.theme === ('turquoise' as unknown as ThemeMode) ? 'light' : updated.theme; setCurrentUser({ ...updated, theme: safeTheme }); setState(current => ({ ...current, settings: { ...current.settings, theme: safeTheme } })); }}
          onPassword={async password => { await api.resetPassword(currentUser.id, password); }} />
      )}

      {showForm && (
        <TaskForm task={editTask} branches={branchContext.branches} onSave={(task) => void addOrUpdateTask(task)}
          onClose={() => { setShowForm(false); setEditTask(null); }} />
      )}
    </div>
  );
}
