import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, BookOpen, CheckCircle2, Clock3, FileText, Inbox, LifeBuoy, Lock,
  MessageSquareReply, Paperclip, Plus, RefreshCw, Search, Send, Settings2,
  ShieldCheck, TicketCheck, Unlock, Users, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type {
  HelpDeskAdminAccess, HelpDeskBranchSetup, HelpDeskContext, HelpDeskReport,
  HelpDeskTicket, SessionUser,
} from '@/lib/types';

type View = 'home' | 'new' | 'mine' | 'pool' | 'assigned' | 'closed' | 'user' | 'knowledge' | 'reports' | 'admin';
type DashboardFilter = 'opened' | 'answered' | 'closed' | 'open' | 'all' | 'new' | 'inProgress' | 'unassigned';

const EMPTY_REPORT: HelpDeskReport = {
  total: 0,
  open: 0,
  closed: 0,
  slaResponseBreached: 0,
  slaResolutionBreached: 0,
  avgResolutionMinutes: 0,
  byCategory: [],
  byPriority: [],
  byStatus: [],
  byAssignee: [],
};

export default function HelpDeskPanel({ user }: { user: SessionUser }) {
  const [context, setContext] = useState<HelpDeskContext | null>(null);
  const [view, setView] = useState<View>('home');
  const [branchCode, setBranchCode] = useState('');
  const [setup, setSetup] = useState<HelpDeskBranchSetup | null>(null);
  const [recentScope, setRecentScope] = useState<'branch' | 'all'>('branch');
  const [mineScope, setMineScope] = useState<'branch' | 'all'>('branch');
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>('open');
  const [recent, setRecent] = useState<HelpDeskTicket[]>([]);
  const [tickets, setTickets] = useState<HelpDeskTicket[]>([]);
  const [selected, setSelected] = useState<HelpDeskTicket | null>(null);
  const [report, setReport] = useState<HelpDeskReport>(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [newTicket, setNewTicket] = useState({ categoryId: '', priorityId: '', subject: '', body: '', ccEmails: '' });
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [adminData, setAdminData] = useState<{
    users: Array<{ id: string; username: string; displayName: string; email: string | null; active: boolean }>;
    branches: Array<{ code: string; name: string; active: boolean }>;
    accesses: HelpDeskAdminAccess[];
  } | null>(null);
  const [adminUserId, setAdminUserId] = useState('');
  const [adminBranchCode, setAdminBranchCode] = useState('');
  const [adminAccess, setAdminAccess] = useState<HelpDeskAdminAccess | null>(null);
  const [branchSettings, setBranchSettings] = useState<HelpDeskBranchSetup['setting'] | null>(null);
  const [topicName, setTopicName] = useState('');
  const [topicAssigneeCategoryId, setTopicAssigneeCategoryId] = useState('');
  const [topicAssigneeUserIds, setTopicAssigneeUserIds] = useState<string[]>([]);
  const [globalHelpDeskSettings, setGlobalHelpDeskSettings] = useState<{ maxAttachments: number; maxAttachmentMb: number; allowedExtensions: string } | null>(null);
  const [knowledgeCategoryName, setKnowledgeCategoryName] = useState('');
  const [knowledgeDraft, setKnowledgeDraft] = useState({ categoryId: '', title: '', body: '' });
  const [cannedTitle, setCannedTitle] = useState('');
  const [cannedBody, setCannedBody] = useState('');
  const [priorityDraft, setPriorityDraft] = useState({ name: '', color: '#38bdf8', level: 3, firstResponseMinutes: 240, resolutionMinutes: 1440 });
  const [statusDraft, setStatusDraft] = useState({ code: '', name: '', color: '#64748b', closed: false, sortOrder: 60 });
  const [editingTopicId, setEditingTopicId] = useState('');
  const [editingPriorityId, setEditingPriorityId] = useState('');
  const [editingStatusId, setEditingStatusId] = useState('');
  const [editingCannedId, setEditingCannedId] = useState('');
  const [selectedRequesterId, setSelectedRequesterId] = useState('');
  const [selectedRequesterName, setSelectedRequesterName] = useState('');
  const [selectedRequesterState, setSelectedRequesterState] = useState<'all' | 'open' | 'closed'>('all');
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [draftReadyBranch, setDraftReadyBranch] = useState('');
  const refreshInFlight = useRef(false);

  const activeBranch = context?.branches.find(item => item.branchCode === branchCode) ?? null;
  const access = activeBranch?.access;
  const centralAll = Boolean(context?.canCentralManage && branchCode === 'ALL');
  const canOpen = Boolean(branchCode !== 'ALL' && (user.isAdmin || access?.canOpen));
  const canCoordinate = Boolean(user.isAdmin || centralAll || access?.canCoordinate);
  const canRespond = Boolean(user.isAdmin || access?.canRespond);
  const canViewPool = Boolean(user.isAdmin || centralAll || (access?.canCoordinate && access?.canViewAll));
  const canReport = Boolean(user.isAdmin || centralAll || access?.canReport);
  const canTopics = Boolean(branchCode !== 'ALL' && (user.isAdmin || access?.canTopics));
  const canCanned = Boolean(branchCode !== 'ALL' && (user.isAdmin || access?.canCannedReplies));
  const canKnowledge = Boolean(branchCode !== 'ALL' && (user.isAdmin || access?.canKnowledge));
  const canCentral = Boolean(context?.canCentralManage);

  function canKeepViewForBranch(nextContext: HelpDeskContext, nextBranchCode: string, nextView: View) {
    if (nextView === 'admin') return Boolean(nextContext.canCentralManage);
    if (nextBranchCode === 'ALL') {
      if (!nextContext.canCentralManage) return nextView === 'home' || nextView === 'mine';
      return nextView !== 'new' && nextView !== 'knowledge';
    }

    const branch = nextContext.branches.find(item => item.branchCode === nextBranchCode);
    if (!branch) return false;
    const branchAccess = branch.access;
    const canOpenBranch = Boolean(user.isAdmin || branchAccess?.canOpen);
    const canCoordinateBranch = Boolean(user.isAdmin || branchAccess?.canCoordinate);
    const canRespondBranch = Boolean(user.isAdmin || branchAccess?.canRespond);
    const canViewPoolBranch = Boolean(user.isAdmin || (branchAccess?.canCoordinate && branchAccess?.canViewAll));

    switch (nextView) {
      case 'home':
      case 'mine':
        return canOpenBranch || canCoordinateBranch || canRespondBranch;
      case 'new':
        return canOpenBranch;
      case 'pool':
        return canViewPoolBranch;
      case 'assigned':
        return canRespondBranch || canCoordinateBranch;
      case 'closed':
        return canViewPoolBranch || canOpenBranch;
      case 'user':
        return canViewPoolBranch || selectedRequesterId === user.id;
      case 'knowledge':
        return Boolean(user.isAdmin || branchAccess?.canKnowledge);
      case 'reports':
        return Boolean(user.isAdmin || branchAccess?.canReport);
      default:
        return false;
    }
  }


  function sameTicketList(current: HelpDeskTicket[], next: HelpDeskTicket[]) {
    if (current.length !== next.length) return false;
    return current.every((ticket, index) => {
      const candidate = next[index];
      return Boolean(candidate)
        && ticket.id === candidate.id
        && ticket.updatedAt === candidate.updatedAt
        && ticket.statusId === candidate.statusId
        && ticket.assignedUserId === candidate.assignedUserId
        && ticket.locked === candidate.locked
        && ticket.isUnprocessed === candidate.isUnprocessed;
    });
  }

  function updateTicketsSilently(next: HelpDeskTicket[]) {
    setTickets(current => sameTicketList(current, next) ? current : next);
  }

  function updateRecentSilently(next: HelpDeskTicket[]) {
    setRecent(current => sameTicketList(current, next) ? current : next);
  }

  async function silentRefresh() {
    if (!context || refreshInFlight.current || document.visibilityState !== 'visible') return;
    refreshInFlight.current = true;
    try {
      const recentCode = recentScope === 'all' || branchCode === 'ALL' ? '' : branchCode;
      if (branchCode) {
        const nextRecent = await api.getHelpDeskRecent(recentCode);
        updateRecentSilently(nextRecent);
      }

      if (view === 'home') {
        const code = mineScope === 'all' || branchCode === 'ALL' ? '' : branchCode;
        updateTicketsSilently(await api.getHelpDeskTickets(code, 'mine', 'open', 'all'));
      } else if (view === 'mine') {
        if (dashboardFilter === 'opened' || dashboardFilter === 'answered') {
          updateTicketsSilently(await api.getHelpDeskMyTickets(dashboardFilter));
        } else {
          const code = mineScope === 'all' || branchCode === 'ALL' ? '' : branchCode;
          updateTicketsSilently(await api.getHelpDeskTickets(code, 'mine', 'open', 'all'));
        }
      } else if (view === 'pool' || view === 'assigned') {
        const state = dashboardFilter === 'all' ? 'all' : 'open';
        const queue = (['new', 'inProgress', 'unassigned'].includes(dashboardFilter) ? dashboardFilter : 'all') as 'all' | 'new' | 'inProgress' | 'unassigned';
        const code = branchCode === 'ALL' ? '' : branchCode;
        updateTicketsSilently(await api.getHelpDeskTickets(code, view === 'pool' ? 'all' : 'assigned', state, queue));
      } else if (view === 'closed') {
        const code = (canViewPool ? branchCode === 'ALL' : mineScope === 'all' || branchCode === 'ALL') ? '' : branchCode;
        updateTicketsSilently(await api.getHelpDeskTickets(code, canViewPool ? 'all' : 'mine', 'closed', 'all'));
      } else if (view === 'user' && selectedRequesterId) {
        updateTicketsSilently(await api.getHelpDeskUserTickets(selectedRequesterId, branchCode || 'ALL', selectedRequesterState));
      } else if (view === 'reports' && canReport) {
        const nextReport = await api.getHelpDeskReport(branchCode || 'ALL');
        setReport(current => JSON.stringify(current) === JSON.stringify(nextReport) ? current : nextReport);
      }

      if (selected?.id) {
        const nextSelected = await api.getHelpDeskTicket(selected.id);
        setSelected(current => current && JSON.stringify(current) === JSON.stringify(nextSelected) ? current : nextSelected);
      }
    } catch {
      // Silent sync must never replace the current usable screen with an error/loading state.
    } finally {
      refreshInFlight.current = false;
    }
  }

  async function loadContext() {
    setLoading(true);
    try {
      const next = await api.getHelpDeskContext();
      setContext(next);
      const storedBranch = localStorage.getItem(`operis-helpdesk-branch:${user.id}`) || '';
      const storedView = localStorage.getItem(`operis-helpdesk-view:${user.id}`) as View | null;
      const storedBranchAllowed = storedBranch === 'ALL'
        ? Boolean(next.canCentralManage)
        : next.branches.some(item =>
            item.branchCode === storedBranch
            && (user.isAdmin || item.access?.canOpen || item.access?.canCoordinate || item.access?.canRespond),
          );
      const currentBranchAllowed = branchCode === 'ALL'
        ? Boolean(next.canCentralManage)
        : next.branches.some(item =>
            item.branchCode === branchCode
            && (user.isAdmin || item.access?.canOpen || item.access?.canCoordinate || item.access?.canRespond),
          );
      const initial = currentBranchAllowed
        ? branchCode
        : storedBranchAllowed
          ? storedBranch
          : next.branches.find(item => user.isAdmin || item.access?.canOpen || item.access?.canCoordinate || item.access?.canRespond)?.branchCode
            ?? next.branches[0]?.branchCode
            ?? '';
      setBranchCode(initial);

      const storedDashboardFilter = sessionStorage.getItem('operis-helpdesk-dashboard-filter');
      const allowedDashboardFilters: DashboardFilter[] = ['opened', 'answered', 'closed', 'open', 'all', 'new', 'inProgress', 'unassigned'];
      const requestedFilter: DashboardFilter = storedDashboardFilter && allowedDashboardFilters.includes(storedDashboardFilter as DashboardFilter)
        ? storedDashboardFilter as DashboardFilter
        : dashboardFilter;
      if (!requestedFilter && storedView && canKeepViewForBranch(next, initial, storedView)) {
        setView(storedView);
      }
      if(requestedFilter){
        sessionStorage.removeItem('operis-helpdesk-dashboard-filter');
        sessionStorage.removeItem('operis-helpdesk-manager-branch');

        if(requestedFilter==='closed'){
          setView('closed');
        }else if(requestedFilter==='opened'||requestedFilter==='answered'){
          setTickets(await api.getHelpDeskMyTickets(requestedFilter));
          setView('mine');
        }else{
          const selectedBranch=next.branches.find(item=>item.branchCode===initial);
          const poolAllowed=Boolean(user.isAdmin || next.canCentralManage || (selectedBranch?.access?.canCoordinate && selectedBranch?.access?.canViewAll));
          const scope=poolAllowed?'all':'assigned';
          const state=requestedFilter==='all'?'all':'open';
          const queueFilter=(['new','inProgress','unassigned'].includes(requestedFilter)?requestedFilter:'all') as 'all'|'new'|'inProgress'|'unassigned';
          setTickets(await api.getHelpDeskTickets(initial==='ALL'?'':initial,scope,state,queueFilter));
          setView(scope==='all'?'pool':'assigned');
        }
        setDashboardFilter(requestedFilter);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadSetup(code: string) {
    if (!code || code === 'ALL') {
      setSetup(null);
      setBranchSettings(null);
      return;
    }
    const next = await api.getHelpDeskBranchSetup(code);
    setSetup(next);
    setBranchSettings(next.setting);

    const newDraftKey = `operis-helpdesk-new-draft:${user.id}:${code}`;
    let storedDraft: Partial<typeof newTicket> = {};
    try {
      storedDraft = JSON.parse(localStorage.getItem(newDraftKey) || '{}') as Partial<typeof newTicket>;
    } catch {
      storedDraft = {};
    }

    setNewTicket({
      categoryId: next.categories.some(item => item.id === storedDraft.categoryId)
        ? String(storedDraft.categoryId)
        : next.categories[0]?.id ?? '',
      priorityId: next.priorities.some(item => item.id === storedDraft.priorityId)
        ? String(storedDraft.priorityId)
        : next.priorities.find(item => item.name === 'Normal')?.id ?? next.priorities[0]?.id ?? '',
      subject: String(storedDraft.subject ?? ''),
      body: String(storedDraft.body ?? ''),
      ccEmails: String(storedDraft.ccEmails ?? ''),
    });
    setDraftReadyBranch(code);
    setKnowledgeDraft(current => ({
      ...current,
      categoryId: next.knowledgeCategories.some(item => item.id === current.categoryId)
        ? current.categoryId
        : next.knowledgeCategories[0]?.id ?? '',
    }));
    const selectedCategoryId = next.categories.some(item => item.id === topicAssigneeCategoryId)
      ? topicAssigneeCategoryId
      : next.categories[0]?.id ?? '';
    setTopicAssigneeCategoryId(selectedCategoryId);
    setTopicAssigneeUserIds(next.categoryAssignees.filter(item => item.categoryId === selectedCategoryId).map(item => item.userId));
    setGlobalHelpDeskSettings(next.globalSetting);
  }

  async function loadRecent() {
    if (!branchCode) return;
    const code = recentScope === 'all' || branchCode === 'ALL' ? '' : branchCode;
    setRecent(await api.getHelpDeskRecent(code));
  }

  async function loadTickets(
    scope: 'mine' | 'assigned' | 'all',
    state: 'open' | 'closed' | 'all' = 'open',
    queueFilter: 'all' | 'new' | 'inProgress' | 'unassigned' = 'all',
  ) {
    const code = scope === 'mine'
      ? (mineScope === 'all' || branchCode === 'ALL' ? '' : branchCode)
      : (branchCode === 'ALL' ? '' : branchCode);
    setTickets(await api.getHelpDeskTickets(code, scope, state, queueFilter));
  }

  async function openRequesterTickets(requesterId: string, requesterName: string, state = selectedRequesterState) {
    setSelectedRequesterId(requesterId);
    setSelectedRequesterName(requesterName);
    setSelectedRequesterState(state);
    setTickets(await api.getHelpDeskUserTickets(requesterId, branchCode || 'ALL', state));
    setView('user');
  }

  async function loadRequesterTickets(state = selectedRequesterState) {
    if (!selectedRequesterId) return;
    setTickets(await api.getHelpDeskUserTickets(selectedRequesterId, branchCode || 'ALL', state));
  }

  function changeBranch(nextBranchCode: string) {
    if (!context || nextBranchCode === branchCode) return;
    setSelected(null);
    setBranchCode(nextBranchCode);
    if (!canKeepViewForBranch(context, nextBranchCode, view)) setView('home');
  }

  async function openTicket(ticket: HelpDeskTicket) {
    if (ticket.branchCode && ticket.branchCode !== branchCode) {
      setBranchCode(ticket.branchCode);
      await loadSetup(ticket.branchCode);
    }
    const detail = await api.getHelpDeskTicket(ticket.id);
    setSelected(detail);
    setInternalNote(false);
    setReply(localStorage.getItem(`operis-helpdesk-reply-draft:${user.id}:${detail.id}`) || '');
  }

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(() => {
    if (!branchCode) return;
    void loadSetup(branchCode);
  }, [branchCode]);

  useEffect(() => {
    if (!branchCode || branchCode === 'ALL' || draftReadyBranch !== branchCode) return;
    localStorage.setItem(
      `operis-helpdesk-new-draft:${user.id}:${branchCode}`,
      JSON.stringify(newTicket),
    );
  }, [newTicket, branchCode, draftReadyBranch, user.id]);

  useEffect(() => {
    if (!selected) return;
    const key = `operis-helpdesk-reply-draft:${user.id}:${selected.id}`;
    if (reply) localStorage.setItem(key, reply);
    else localStorage.removeItem(key);
  }, [reply, selected?.id, user.id]);


  useEffect(() => {
    void loadRecent();
  }, [branchCode, recentScope]);

  useEffect(() => {
    if (!context) return;
    if (view === 'home') void loadTickets('mine');
    if (view === 'mine') {
      if(dashboardFilter==='opened'||dashboardFilter==='answered') void api.getHelpDeskMyTickets(dashboardFilter).then(setTickets);
      else void loadTickets('mine');
    }
    if (view === 'pool') {
      const state=dashboardFilter==='all'?'all':'open';
      const queue=(['new','inProgress','unassigned'].includes(dashboardFilter)?dashboardFilter:'all') as 'all'|'new'|'inProgress'|'unassigned';
      void loadTickets('all',state,queue);
    }
    if (view === 'assigned') {
      const state=dashboardFilter==='all'?'all':'open';
      const queue=(['new','inProgress','unassigned'].includes(dashboardFilter)?dashboardFilter:'all') as 'all'|'new'|'inProgress'|'unassigned';
      void loadTickets('assigned',state,queue);
    }
    if (view === 'closed') void loadTickets(canViewPool ? 'all' : 'mine', 'closed');
    if (view === 'user') void loadRequesterTickets();
    if (view === 'reports' && canReport) void api.getHelpDeskReport(branchCode || 'ALL').then(setReport);
    if (view === 'admin' && canCentral) {
      void api.getHelpDeskAdminAccesses().then(data => {
        setAdminData(data);
        setAdminUserId(current => current || data.users[0]?.id || '');
        setAdminBranchCode(current => current || data.branches[0]?.code || '');
      });
    }
  }, [view, branchCode, mineScope, canReport, canCentral, context, selectedRequesterId, selectedRequesterState, dashboardFilter]);


  useEffect(() => {
    if (!context) return;

    const intervalId = window.setInterval(() => {
      void silentRefresh();
    }, 4000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void silentRefresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    context,
    view,
    branchCode,
    recentScope,
    mineScope,
    dashboardFilter,
    selectedRequesterId,
    selectedRequesterState,
    canViewPool,
    canReport,
    selected?.id,
  ]);

  useEffect(() => {
    if (!context || !branchCode) return;
    localStorage.setItem(`operis-helpdesk-branch:${user.id}`, branchCode);
    if (!canKeepViewForBranch(context, branchCode, view)) {
      setSelected(null);
      setView('home');
      localStorage.setItem(`operis-helpdesk-view:${user.id}`, 'home');
      return;
    }
    localStorage.setItem(`operis-helpdesk-view:${user.id}`, view);
  }, [context, branchCode, view, user.id]);

  useEffect(() => {
    if (!adminData || !adminUserId || !adminBranchCode) return;
    const found = adminData.accesses.find(item => item.userId === adminUserId && item.branchCode === adminBranchCode);
    setAdminAccess(found ?? {
      userId: adminUserId,
      branchCode: adminBranchCode,
      active: true,
      canOpen: false,
      canStaff: false,
      canCoordinate: false,
      canRespond: false,
      canChangeStatus: false,
      canReopen: false,
      canViewAll: false,
      canAssign: false,
      canClose: false,
      canReport: false,
      canTopics: false,
      canCannedReplies: false,
      canKnowledge: false,
      mutedEmail: false,
    });
  }, [adminData, adminUserId, adminBranchCode]);

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    if (!q) return tickets;
    return tickets.filter(ticket => (
      `${ticket.ticketNo} ${ticket.subject} ${ticket.requesterName} ${ticket.assignedUserName} ${ticket.branch?.name ?? ''} ${ticket.category?.name ?? ''} ${ticket.status?.name ?? ''}`
        .toLocaleLowerCase('tr-TR')
        .includes(q)
    ));
  }, [tickets, query]);

  function clearNewTicketDraft() {
    if (!branchCode || branchCode === 'ALL') return;
    localStorage.removeItem(`operis-helpdesk-new-draft:${user.id}:${branchCode}`);
    setNewTicket(current => ({ ...current, subject: '', body: '', ccEmails: '' }));
    setFiles([]);
  }

  function clearReplyDraft() {
    if (!selected) return;
    localStorage.removeItem(`operis-helpdesk-reply-draft:${user.id}:${selected.id}`);
    setReply('');
    setInternalNote(false);
  }

  function addSelectedFiles(selectedFiles: File[]) {
    const maxFiles = Math.max(1, Math.min(5, setup?.globalSetting.maxAttachments ?? 5));
    setFiles(current => {
      const combined = [...current];
      for (const file of selectedFiles) {
        const duplicate = combined.some(item =>
          item.name === file.name &&
          item.size === file.size &&
          item.lastModified === file.lastModified
        );
        if (!duplicate && combined.length < maxFiles) combined.push(file);
      }
      if (current.length + selectedFiles.length > maxFiles) {
        window.setTimeout(() => alert(`Bir ticket için en fazla ${maxFiles} dosya eklenebilir.`), 0);
      }
      return combined;
    });
  }

  function removeSelectedFile(index: number) {
    setFiles(current => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function deleteExistingAttachment(id: string) {
    if (!selected || selected.locked || !window.confirm('Bu ek dosya silinsin mi?')) return;
    await api.deleteHelpDeskAttachment(id);
    const updated = await api.getHelpDeskTicket(selected.id);
    setSelected(updated);
    setTickets(current => current.map(ticket => ticket.id === updated.id ? updated : ticket));
  }

  async function submitTicket() {
    if (!branchCode || branchCode === 'ALL' || !newTicket.categoryId || !newTicket.priorityId || !newTicket.subject.trim()) return;
    if (newTicket.body.trim().length < 50) { alert('Destek içeriği en az 50 karakter olmalıdır.'); return; }
    const maxFiles = Math.max(1, Math.min(5, setup?.globalSetting.maxAttachments ?? 5));
    if (files.length > maxFiles) { alert(`Bir ticket için en fazla ${maxFiles} dosya eklenebilir.`); return; }
    const created = await api.createHelpDeskTicket({
      branchCode,
      categoryId: newTicket.categoryId,
      priorityId: newTicket.priorityId,
      subject: newTicket.subject.trim(),
      body: newTicket.body.trim(),
      ccEmails: newTicket.ccEmails.trim(),
    });
    if (files.length) await api.uploadHelpDeskAttachments(created.id, files);
    localStorage.removeItem(`operis-helpdesk-new-draft:${user.id}:${branchCode}`);
    setFiles([]);
    setNewTicket(current => ({ ...current, subject: '', body: '', ccEmails: '' }));
    await loadRecent();
    await loadTickets('mine');
    await openTicket(created);
    setView('mine');
  }

  async function submitReply() {
    if (!selected || selected.locked || !reply.trim()) return;
    await api.replyHelpDeskTicket(selected.id, reply.trim(), internalNote);
    localStorage.removeItem(`operis-helpdesk-reply-draft:${user.id}:${selected.id}`);
    setReply('');
    setInternalNote(false);
    await openTicket(selected);
    await loadRecent();
  }

  async function updateStatus(statusId: string) {
    if (!selected || selected.locked) return;
    await api.setHelpDeskTicketStatus(selected.id, statusId);
    await openTicket(selected);
  }

  async function updateAssignee(userId: string) {
    if (!selected || selected.locked) return;
    await api.assignHelpDeskTicket(selected.id, userId || null);
    await openTicket(selected);
  }

  async function claimSelectedTicket() {
    if (!selected || selected.locked || selected.assignedUserId) return;
    await api.assignHelpDeskTicket(selected.id, user.id);
    await openTicket(selected);
    await loadTickets('assigned');
  }

  async function resendSelectedNotification() {
    if (!selected) return;
    const result = await api.resendHelpDeskTicketNotification(selected.id);
    alert(result.message);
    await openTicket(selected);
  }

  async function toggleLock() {
    if (!selected || !canCoordinate) return;
    const updated = await api.setHelpDeskTicketLock(selected.id, !selected.locked);
    await openTicket(updated);
  }

  async function saveAccess() {
    if (!adminAccess) return;
    const saved = await api.saveHelpDeskAccess(adminAccess);
    setAdminData(current => current ? {
      ...current,
      accesses: [...current.accesses.filter(item => !(item.userId === saved.userId && item.branchCode === saved.branchCode)), saved],
    } : current);
    await loadContext();
  }

  async function saveBranchSettings() {
    if (!canCentral || branchCode === 'ALL' || !branchSettings) return;
    await api.updateHelpDeskBranchSettings(branchCode, branchSettings);
    await loadSetup(branchCode);
    await loadContext();
  }

  async function createTopic() {
    if (!topicName.trim() || branchCode === 'ALL') return;
    await api.createHelpDeskCategory(branchCode, { name: topicName.trim(), description: '', active: true, sortOrder: (setup?.categories.length ?? 0) * 10 + 10 });
    setTopicName('');
    await loadSetup(branchCode);
  }

  async function editTopic(id: string) {
    const item=setup?.categories.find(row=>row.id===id); if(!item)return;
    setEditingTopicId(id); setTopicName(item.name);
  }

  async function saveTopic() {
    if(!editingTopicId||!topicName.trim()||branchCode==='ALL')return;
    const item=setup?.categories.find(row=>row.id===editingTopicId); if(!item)return;
    await api.updateHelpDeskCategory(branchCode,editingTopicId,{name:topicName.trim(),description:item.description,active:item.active,sortOrder:item.sortOrder});
    setEditingTopicId('');setTopicName('');await loadSetup(branchCode);
  }

  async function deleteTopic(id:string) {
    if(branchCode==='ALL'||!window.confirm('Destek konusu silinsin mi? Kullanılmışsa pasif yapılacaktır.'))return;
    await api.deleteHelpDeskCategory(branchCode,id);
    if(editingTopicId===id){setEditingTopicId('');setTopicName('');}
    await loadSetup(branchCode);
  }

  async function saveTopicAssignees() {
    if (!branchCode || branchCode === 'ALL' || !topicAssigneeCategoryId) return;
    await api.saveHelpDeskCategoryAssignees(branchCode, topicAssigneeCategoryId, topicAssigneeUserIds);
    await loadSetup(branchCode);
  }

  async function saveGlobalHelpDeskSettings() {
    if (!canCentral || !globalHelpDeskSettings) return;
    const saved = await api.updateHelpDeskGlobalSettings(globalHelpDeskSettings);
    setGlobalHelpDeskSettings(saved);
    if (branchCode && branchCode !== 'ALL') await loadSetup(branchCode);
  }

  async function createKnowledgeCategory() {
    if (!knowledgeCategoryName.trim() || branchCode === 'ALL') return;
    await api.createHelpDeskKnowledgeCategory(branchCode, { name: knowledgeCategoryName.trim(), description: '', active: true, sortOrder: 50 });
    setKnowledgeCategoryName('');
    await loadSetup(branchCode);
  }

  async function createArticle() {
    if (!knowledgeDraft.categoryId || !knowledgeDraft.title.trim() || !knowledgeDraft.body.trim() || branchCode === 'ALL') return;
    await api.createHelpDeskArticle(branchCode, { ...knowledgeDraft, active: true });
    setKnowledgeDraft(current => ({ ...current, title: '', body: '' }));
    await loadSetup(branchCode);
  }

  function editStatusDefinition(id:string) {
    const item=setup?.statuses.find(row=>row.id===id);if(!item)return;
    setEditingStatusId(id);setStatusDraft({code:item.code,name:item.name,color:item.color,closed:item.closed,sortOrder:item.sortOrder});
  }

  async function saveStatusDefinition() {
    if(!editingStatusId||!canCentral||branchCode==='ALL'||!statusDraft.name.trim()||!statusDraft.code.trim())return;
    await api.updateHelpDeskStatusDefinition(branchCode,editingStatusId,{...statusDraft,code:statusDraft.code.trim().toUpperCase(),name:statusDraft.name.trim(),active:true});
    setEditingStatusId('');setStatusDraft({code:'',name:'',color:'#64748b',closed:false,sortOrder:60});await loadSetup(branchCode);
  }

  async function createCanned() {
    if (!cannedTitle.trim() || !cannedBody.trim() || branchCode === 'ALL') return;
    await api.createHelpDeskCannedReply(branchCode, { title: cannedTitle.trim(), body: cannedBody.trim(), active: true });
    setCannedTitle('');
    setCannedBody('');
    await loadSetup(branchCode);
  }

  function editCanned(id:string) {
    const item=setup?.cannedReplies.find(row=>row.id===id);if(!item)return;
    setEditingCannedId(id);setCannedTitle(item.title);setCannedBody(item.body);
  }

  async function saveCanned() {
    if(!editingCannedId||!cannedTitle.trim()||!cannedBody.trim()||branchCode==='ALL')return;
    await api.updateHelpDeskCannedReply(branchCode,editingCannedId,{title:cannedTitle.trim(),body:cannedBody.trim(),active:true});
    setEditingCannedId('');setCannedTitle('');setCannedBody('');await loadSetup(branchCode);
  }

  async function deleteCanned(id:string) {
    if(branchCode==='ALL'||!window.confirm('Hazır yanıt kalıcı olarak silinsin mi?'))return;
    await api.deleteHelpDeskCannedReply(branchCode,id);
    if(editingCannedId===id){setEditingCannedId('');setCannedTitle('');setCannedBody('');}
    await loadSetup(branchCode);
  }

  async function createPriority() {
    if (!canCentral || branchCode === 'ALL' || !priorityDraft.name.trim()) return;
    await api.createHelpDeskPriority(branchCode, { ...priorityDraft, name: priorityDraft.name.trim(), active: true });
    setPriorityDraft({ name: '', color: '#38bdf8', level: 3, firstResponseMinutes: 240, resolutionMinutes: 1440 });
    await loadSetup(branchCode);
  }

  async function savePriority() {
    if(!editingPriorityId||!canCentral||branchCode==='ALL'||!priorityDraft.name.trim())return;
    await api.updateHelpDeskPriority(branchCode,editingPriorityId,{...priorityDraft,name:priorityDraft.name.trim(),active:true});
    setEditingPriorityId('');setPriorityDraft({name:'',color:'#38bdf8',level:3,firstResponseMinutes:240,resolutionMinutes:1440});
    await loadSetup(branchCode);
  }

  function editPriority(id:string) {
    const item=setup?.priorities.find(row=>row.id===id);if(!item)return;
    setEditingPriorityId(id);
    setPriorityDraft({name:item.name,color:item.color,level:item.level,firstResponseMinutes:item.firstResponseMinutes,resolutionMinutes:item.resolutionMinutes});
  }

  async function createStatus() {
    if (!canCentral || branchCode === 'ALL' || !statusDraft.name.trim() || !statusDraft.code.trim()) return;
    await api.createHelpDeskStatus(branchCode, {
      ...statusDraft,
      code: statusDraft.code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_'),
      name: statusDraft.name.trim(),
      active: true,
    });
    setStatusDraft({ code: '', name: '', color: '#64748b', closed: false, sortOrder: 60 });
    await loadSetup(branchCode);
  }

  const selectedAccess = selected
    ? context?.branches.find(item => item.branchCode === selected.branchCode)?.access ?? null
    : null;
  const selectedIsRequester = Boolean(selected && selected.requesterId === user.id);
  const canRespondInSelectedBranch = Boolean(selected && !user.isAdmin && selectedAccess?.active && selectedAccess.canRespond);
  const canRespondSelected = Boolean(selected && (user.isAdmin || (canRespondInSelectedBranch && selected.assignedUserId === user.id)));
  const canCoordinateSelected = Boolean(selected && (user.isAdmin || (selectedAccess?.active && selectedAccess.canCoordinate && selectedAccess.canViewAll)));
  const canClaimSelected = Boolean(selected && !selected.locked && !selected.assignedUserId && canRespondInSelectedBranch && !selected.status?.closed);
  const canWriteSelectedReply = Boolean(selected && (selectedIsRequester || canCoordinateSelected || canRespondSelected));
  const canModifySelectedAttachments = Boolean(selected && !selected.locked && (selectedIsRequester || canCoordinateSelected || canRespondSelected));
  const canChangeSelectedStatus = Boolean(selected && (user.isAdmin || (
    selectedAccess?.active && selectedAccess.canChangeStatus &&
    (selectedAccess.canCoordinate || (selectedAccess.canRespond && selected.assignedUserId === user.id))
  )));
  const canSeeInternalNotes = Boolean(user.isAdmin || canCoordinateSelected || canRespondSelected);
  const canResendSelectedNotification = Boolean(selected && (
    user.isAdmin || canCoordinateSelected || canRespondSelected ||
    (selectedAccess?.active && selectedAccess.canViewAll && selectedAccess.canReport)
  ));

  if (loading) return <div className="helpdesk-shell"><div className="helpdesk-empty">Help Desk hazırlanıyor…</div></div>;
  if (!context?.branches.length) return <div className="helpdesk-shell"><div className="helpdesk-empty">Aktif Help Desk şubesi bulunamadı.</div></div>;

  return (
    <section className="helpdesk-shell">
      <header className="helpdesk-hero">
        <div>
          <div className="helpdesk-brand"><LifeBuoy className="h-5 w-5" /> OPERİS HELP DESK</div>
          <h2>{branchCode === 'ALL' ? 'Merkez · Tüm Şubeler Help Desk' : activeBranch?.title || 'Help Desk'}</h2>
          <p>{branchCode === 'ALL' ? 'Tüm Help Desk şubelerini toplu veya şube bazlı yönetin.' : activeBranch?.welcomeText || 'Destek taleplerinizi oluşturun ve takip edin.'}</p>
        </div>
        <label className="helpdesk-branch-select">
          <span>Help Desk Şubesi</span>
          <select value={branchCode} onChange={event => changeBranch(event.target.value)}>
            {canCentral && view !== 'new' && <option value="ALL">TÜM ŞUBELER · Merkez Toplu Görünüm</option>}
            {context.branches.map(branch => <option key={branch.branchCode} value={branch.branchCode}>{branch.branchCode} · {branch.branchName}</option>)}
          </select>
        </label>
      </header>

      <nav className="helpdesk-nav">
        <Nav active={view === 'home'} onClick={() => setView('home')} icon={<Inbox />} label="Ana Sayfa" />
        {canOpen && <Nav active={view === 'new'} onClick={() => setView('new')} icon={<Plus />} label="Yeni Talep" />}
        <Nav active={view === 'mine'} onClick={() => setView('mine')} icon={<TicketCheck />} label="Açtığım Talepler" />
        {canViewPool && <Nav active={view === 'pool'} onClick={() => setView('pool')} icon={<Users />} label="Şube Ticket Takibi" />}
        {canRespond && <Nav active={view === 'assigned'} onClick={() => setView('assigned')} icon={<ShieldCheck />} label="Bana Atanan / Cevaplayacağım" />}
        <Nav active={view === 'closed'} onClick={() => setView('closed')} icon={<CheckCircle2 />} label="Kapalı Ticketlar" />
        {activeBranch?.knowledgeEnabled && <Nav active={view === 'knowledge'} onClick={() => setView('knowledge')} icon={<BookOpen />} label="Bilgi Bankası" />}
        {canReport && <Nav active={view === 'reports'} onClick={() => setView('reports')} icon={<BarChart3 />} label="Raporlar" />}
        {(canCentral || canTopics || canCanned || canKnowledge) && <Nav active={view === 'admin'} onClick={() => setView('admin')} icon={<Settings2 />} label="Yönetim" />}
      </nav>

      <div className="helpdesk-content">
        {(user.isAdmin || canCentral || canCoordinate || canRespond || canViewPool) && (
          <div className="helpdesk-card mb-3">
            <div className="helpdesk-grid-2">
              <Field label="Kullanıcı Talepleri">
                <select value={selectedRequesterId} onChange={event => {
                  const id=event.target.value;
                  if(!id){
                    setSelectedRequesterId('');
                    setSelectedRequesterName('');
                    return;
                  }
                  const selectedUser=context.users.find(item=>item.id===id);
                  void openRequesterTickets(id,selectedUser?.displayName || selectedUser?.username || 'Seçili Kullanıcı');
                }}>
                  <option value="">Kullanıcı seçin…</option>
                  {context.users.map(item => <option key={item.id} value={item.id}>{item.displayName} ({item.username})</option>)}
                </select>
              </Field>
              <Field label="Talep Durumu">
                <select value={selectedRequesterState} disabled={!selectedRequesterId} onChange={event => {
                  const next=event.target.value as 'all'|'open'|'closed';
                  setSelectedRequesterState(next);
                  if(selectedRequesterId)void loadRequesterTickets(next);
                }}>
                  <option value="all">Açık + Kapalı</option>
                  <option value="open">Sadece Açık</option>
                  <option value="closed">Sadece Kapalı</option>
                </select>
              </Field>
            </div>
          </div>
        )}
        {(view === 'home' || view === 'mine' || view === 'pool' || view === 'assigned' || view === 'closed' || view === 'user') && (
          <TicketTable
            title={
              view === 'user'
                ? `${selectedRequesterName || 'Seçili Kullanıcı'} · ${selectedRequesterState === 'open' ? 'Sadece Açık Talepler' : selectedRequesterState === 'closed' ? 'Sadece Kapalı Talepler' : 'Açık + Kapalı Talepler'}`
                : view === 'closed'
                  ? branchCode === 'ALL' ? 'Kapalı Ticket Arşivi · Yetkili Şubeler' : `${activeBranch?.branchName ?? 'Şube'} · Kapalı Ticketlar`
                  : view === 'pool'
                  ? branchCode === 'ALL' ? 'Tüm Şubeler Talep Havuzu' : `${activeBranch?.branchName} Talep Havuzu`
                  : view === 'assigned'
                  ? 'Bana Atanan Talepler'
                  : view === 'mine'
                    ? mineScope === 'all' ? 'Tüm Şubelerde Açtığım Talepler' : `${activeBranch?.branchName ?? 'Şube'} İçin Açtığım Talepler`
                    : mineScope === 'all' ? 'Tüm Şubelerde Son Taleplerim' : `${activeBranch?.branchName ?? 'Şube'} Son Taleplerim`
            }
            tickets={view === 'home' ? filteredTickets.slice(0, 10) : filteredTickets}
            query={query}
            onQuery={setQuery}
            onOpen={ticket => void openTicket(ticket)}
            onRequester={ticket => void openRequesterTickets(ticket.requesterId, ticket.requesterName)}
            scopeControl={view === 'home' || view === 'mine' ? (
              <ScopeToggle value={mineScope} onChange={setMineScope} disableBranch={branchCode === 'ALL'} />
            ) : undefined}
          />
        )}

        {view === 'new' && (
          <div className="helpdesk-card">
            <SectionTitle icon={<Plus />} title="Yeni Destek Talebi" text="Talebiniz seçtiğiniz şubenin bağımsız Help Desk havuzuna gönderilir." />
            <div className="helpdesk-grid-2">
              <Field label="Hedef Şube">
                <select value={branchCode} onChange={event => changeBranch(event.target.value)}>
                  {context.branches.filter(branch => user.isAdmin || branch.access?.canOpen).map(branch => (
                    <option key={branch.branchCode} value={branch.branchCode}>{branch.branchCode} · {branch.branchName}</option>
                  ))}
                </select>
              </Field>
              <Field label="Destek Konusu">
                <select value={newTicket.categoryId} onChange={event => setNewTicket(current => ({ ...current, categoryId: event.target.value }))}>
                  {setup?.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="Öncelik">
                <select value={newTicket.priorityId} onChange={event => setNewTicket(current => ({ ...current, priorityId: event.target.value }))}>
                  {setup?.priorities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="Konu">
                <input value={newTicket.subject} onChange={event => setNewTicket(current => ({ ...current, subject: event.target.value }))} />
              </Field>
            </div>
            <Field label="Bilgi E-posta Adresleri · birden fazla adresi ; ile ayırın">
              <input value={newTicket.ccEmails} onChange={event => setNewTicket(current => ({ ...current, ccEmails: event.target.value }))} placeholder="ornek1@firma.com;ornek2@firma.com" />
            </Field>
            <Field label={`Destek İçeriği · en az 50 karakter · ${newTicket.body.trim().length}/50`}>
              <textarea rows={8} minLength={50} value={newTicket.body} onChange={event => setNewTicket(current => ({ ...current, body: event.target.value }))} />
            </Field>
            {setup?.setting.allowAttachments && (
              <Field label={`Dosya Eki · en fazla ${setup.globalSetting.maxAttachments} dosya · ${setup.globalSetting.maxAttachmentMb} MB · ${setup.globalSetting.allowedExtensions}`}>
                <input
                  type="file"
                  multiple
                  accept={setup.globalSetting.allowedExtensions.split(',').map(ext => `.${ext.trim()}`).join(',')}
                  onChange={event => {
                    addSelectedFiles(Array.from(event.target.files ?? []));
                    event.currentTarget.value = '';
                  }}
                />
                {files.length > 0 && (
                  <div className="helpdesk-pending-files">
                    {files.map((file,index)=>(
                      <div key={`${file.name}-${file.size}-${file.lastModified}`} className="helpdesk-pending-file">
                        <span><FileText className="h-4 w-4" /> {file.name}</span>
                        <button type="button" onClick={()=>removeSelectedFile(index)}>Kaldır</button>
                      </div>
                    ))}
                    <small>{files.length}/{setup.globalSetting.maxAttachments} dosya seçildi.</small>
                  </div>
                )}
              </Field>
            )}
            <div className="helpdesk-reply-actions">
              <button className="helpdesk-primary" onClick={() => void submitTicket()}><Send className="h-4 w-4" /> Talebi Gönder</button>
              <button type="button" onClick={clearNewTicketDraft}>Taslağı Sil</button>
            </div>
          </div>
        )}

        {view === 'knowledge' && (
          <div className="space-y-4 helpdesk-knowledge-attention">
            <SectionTitle icon={<BookOpen />} title={`${activeBranch?.branchName ?? ''} Bilgi Bankası`} text="Bilgi bankası yalnız bu Help Desk şubesine aittir." />
            <div className="helpdesk-knowledge-grid">
              {setup?.articles.map(article => (
                <article key={article.id} className="helpdesk-knowledge-card">
                  <small>{setup.knowledgeCategories.find(item => item.id === article.categoryId)?.name ?? 'Bilgi Bankası'}</small>
                  <h4>{article.title}</h4>
                  <p>{article.body}</p>
                </article>
              ))}
            </div>
            {canKnowledge && (
              <div className="helpdesk-card">
                <h3>Bilgi Bankası Yönetimi</h3>
                <div className="helpdesk-grid-2">
                  <Field label="Yeni Kategori">
                    <div className="helpdesk-inline">
                      <input value={knowledgeCategoryName} onChange={event => setKnowledgeCategoryName(event.target.value)} />
                      <button onClick={() => void createKnowledgeCategory()}>Ekle</button>
                    </div>
                  </Field>
                  <Field label="Makale Kategorisi">
                    <select value={knowledgeDraft.categoryId} onChange={event => setKnowledgeDraft(current => ({ ...current, categoryId: event.target.value }))}>
                      {setup?.knowledgeCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Makale Başlığı"><input value={knowledgeDraft.title} onChange={event => setKnowledgeDraft(current => ({ ...current, title: event.target.value }))} /></Field>
                <Field label="Makale İçeriği"><textarea rows={7} value={knowledgeDraft.body} onChange={event => setKnowledgeDraft(current => ({ ...current, body: event.target.value }))} /></Field>
                <button className="helpdesk-primary" onClick={() => void createArticle()}>Makaleyi Kaydet</button>
              </div>
            )}
          </div>
        )}

        {view === 'reports' && canReport && (
          <div className="space-y-4">
            <SectionTitle icon={<BarChart3 />} title={branchCode === 'ALL' ? 'Merkez · Tüm Şubeler Help Desk Raporu' : `${activeBranch?.branchName} Help Desk Raporu`} text="Uptime mantığında değil, ticket süreçlerine göre Help Desk performans özeti." />
            <div className="helpdesk-stats">
              <Stat label="Toplam" value={report.total} />
              <Stat label="Açık" value={report.open} />
              <Stat label="Kapalı" value={report.closed} />
              <Stat label="Yanıt SLA Aşımı" value={report.slaResponseBreached} />
              <Stat label="Çözüm SLA Aşımı" value={report.slaResolutionBreached} />
              <Stat label="Ort. Çözüm" value={`${report.avgResolutionMinutes} dk`} />
            </div>
            <div className="helpdesk-report-grid">
              <ReportCard title="Destek Konuları" rows={report.byCategory} />
              <ReportCard title="Durumlar" rows={report.byStatus} />
              <ReportCard title="Öncelikler" rows={report.byPriority} />
              <ReportCard title="Görevliler" rows={report.byAssignee} />
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="space-y-4">
            <SectionTitle icon={<Settings2 />} title="Help Desk Yönetimi" text="Genel şube tanımları ve kullanıcı yetkileri Merkezden; Destek Konuları, Hazır Yanıtlar ve Bilgi Bankası şube yetkisiyle yönetilir." />

            {canCentral && adminData && (
              <div className="helpdesk-card">
                <h3>Merkez Kullanıcı Yetkilendirme</h3>
                <div className="helpdesk-grid-2">
                  <Field label="Kullanıcı">
                    <select value={adminUserId} onChange={event => setAdminUserId(event.target.value)}>
                      {adminData.users.map(item => <option key={item.id} value={item.id}>{item.displayName} ({item.username})</option>)}
                    </select>
                  </Field>
                  <Field label="Şube">
                    <select value={adminBranchCode} onChange={event => setAdminBranchCode(event.target.value)}>
                      {adminData.branches.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
                    </select>
                  </Field>
                </div>
                {adminAccess && (
                  <div className="helpdesk-permissions">
                    {[
                      ['active', 'Help Desk Erişimi Aktif'],
                      ['canOpen', 'Ticket Açabilir'],
                      ['canCoordinate', 'Ticket Açma / Takip Koordinatörü'],
                      ['canRespond', 'Atanmış Ticketa Cevap Yazabilir'],
                      ['canViewAll', 'Şubenin Tüm Ticketlarını Görebilir'],
                      ['canAssign', 'Atama Yapabilir / Değiştirebilir / Boşa Çıkarabilir'],
                      ['canChangeStatus', 'Ticket Durumunu Değiştirebilir'],
                      ['canClose', 'Ticket Kapatabilir'],
                      ['canReopen', 'Kapanmış Ticketı Yeniden Açabilir'],
                      ['canReport', 'Şube Dashboard / Raporlarını Görebilir'],
                      ['canTopics', 'Destek Konularını Yönetebilir'],
                      ['canCannedReplies', 'Hazır Yanıtları Yönetebilir'],
                      ['canKnowledge', 'Bilgi Bankasını Yönetebilir'],
                      ['mutedEmail', 'Görevli Mail Bildirimlerini Sustur'],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={Boolean(adminAccess[key as keyof HelpDeskAdminAccess])}
                          onChange={event => setAdminAccess(current => current ? ({ ...current, [key]: event.target.checked }) : current)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
                <div className="helpdesk-inline">
                  <button type="button" onClick={() => setAdminAccess(current => current ? ({
                    ...current,active:true,canOpen:true,canStaff:true,canCoordinate:true,canRespond:false,canViewAll:true,canAssign:true,
                    canChangeStatus:true,canClose:true,canReopen:true,canReport:true,
                  }) : current)}>Ticket Açma / Takip Yetkilisi Yap</button>
                  <button type="button" onClick={() => setAdminAccess(current => current ? ({
                    ...current,active:true,canStaff:true,canCoordinate:false,canRespond:true,canViewAll:false,canAssign:false,canChangeStatus:false,canClose:false,canReopen:false,
                  }) : current)}>Ticket Cevaplayan Yap</button>
                  <button className="helpdesk-primary" onClick={() => void saveAccess()}>Yetkileri Kaydet</button>
                </div>
              </div>
            )}

            {canCentral && globalHelpDeskSettings && (
              <div className="helpdesk-card">
                <h3>Merkezi Dosya Eki Politikası · Tüm Şubeler</h3>
                <div className="helpdesk-grid-2">
                  <Field label="En Fazla Dosya"><input type="number" min={1} max={5} value={globalHelpDeskSettings.maxAttachments}
                    onChange={event=>setGlobalHelpDeskSettings(c=>c?({...c,maxAttachments:Number(event.target.value)||5}):c)} /></Field>
                  <Field label="Dosya Başına En Fazla MB"><input type="number" min={1} max={25} value={globalHelpDeskSettings.maxAttachmentMb}
                    onChange={event=>setGlobalHelpDeskSettings(c=>c?({...c,maxAttachmentMb:Number(event.target.value)||10}):c)} /></Field>
                </div>
                <Field label="İzin Verilen Uzantılar · virgülle ayırın"><input value={globalHelpDeskSettings.allowedExtensions}
                  onChange={event=>setGlobalHelpDeskSettings(c=>c?({...c,allowedExtensions:event.target.value}):c)} /></Field>
                <button className="helpdesk-primary" onClick={() => void saveGlobalHelpDeskSettings()}>Merkezi Dosya Politikasını Kaydet</button>
              </div>
            )}

            {(canCentral || canTopics) && branchCode !== 'ALL' && setup && (
              <div className="helpdesk-card">
                <h3>Destek Konuları</h3>
                <div className="helpdesk-inline">
                  <input value={topicName} onChange={event => setTopicName(event.target.value)} placeholder={editingTopicId ? 'Destek konusunu düzenle' : 'Yeni destek konusu'} />
                  <button onClick={() => void (editingTopicId ? saveTopic() : createTopic())}>{editingTopicId ? 'Kaydet' : 'Konu Ekle'}</button>
                  {editingTopicId && <button onClick={()=>{setEditingTopicId('');setTopicName('')}}>Vazgeç</button>}
                </div>
                <div className="helpdesk-definition-list">{setup.categories.map(item => <div key={item.id} className="helpdesk-definition-row"><span>{item.name}{!item.active?' · Pasif':''}</span><div><button onClick={()=>void editTopic(item.id)}>Düzenle</button><button onClick={()=>void deleteTopic(item.id)}>Sil</button></div></div>)}</div>
                <div className="mt-4 rounded-xl border border-slate-700/60 p-3">
                  <h4 className="mb-2 font-semibold">Konuya Yetkili Cevaplayanlar</h4>
                  <Field label="Destek Konusu"><select value={topicAssigneeCategoryId} onChange={event => {
                    const categoryId=event.target.value;setTopicAssigneeCategoryId(categoryId);
                    setTopicAssigneeUserIds(setup.categoryAssignees.filter(item=>item.categoryId===categoryId).map(item=>item.userId));
                  }}>{setup.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                  <div className="helpdesk-permissions">{setup.staff.map(staff=><label key={staff.userId}><input type="checkbox" checked={topicAssigneeUserIds.includes(staff.userId)}
                    onChange={event=>setTopicAssigneeUserIds(current=>event.target.checked?[...new Set([...current,staff.userId])]:current.filter(id=>id!==staff.userId))}/>{staff.displayName} ({staff.username})</label>)}</div>
                  <button onClick={() => void saveTopicAssignees()}>Konu Görevlilerini Kaydet</button>
                </div>
              </div>
            )}

            {canCentral && branchCode !== 'ALL' && branchSettings && (
              <div className="helpdesk-card">
                <h3>Merkez · Şube Help Desk Ayarları</h3>
                <div className="helpdesk-grid-2">
                  <Field label="Başlık"><input value={branchSettings.title} onChange={event => setBranchSettings(current => current ? ({ ...current, title: event.target.value }) : current)} /></Field>
                  <Field label="Mail Konu Öneki"><input value={branchSettings.emailSubjectPrefix} onChange={event => setBranchSettings(current => current ? ({ ...current, emailSubjectPrefix: event.target.value }) : current)} /></Field>
                  <Field label="Karşılama Metni"><textarea rows={3} value={branchSettings.welcomeText} onChange={event => setBranchSettings(current => current ? ({ ...current, welcomeText: event.target.value }) : current)} /></Field>
                  <Field label="Maksimum Ek (MB)"><input type="number" min={1} max={25} value={branchSettings.maxAttachmentMb} onChange={event => setBranchSettings(current => current ? ({ ...current, maxAttachmentMb: Number(event.target.value) }) : current)} /></Field>
                </div>
                <div className="helpdesk-permissions">
                  {[
                    ['enabled', 'Help Desk Aktif'],
                    ['allowAttachments', 'Dosya Eklerine İzin Ver'],
                    ['knowledgeEnabled', 'Bilgi Bankası Aktif'],
                    ['showRecentTickets', 'Son 10 Talebi Göster'],
                  ].map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={Boolean(branchSettings[key as keyof HelpDeskBranchSetup['setting']])}
                        onChange={event => setBranchSettings(current => current ? ({ ...current, [key]: event.target.checked }) : current)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <button className="helpdesk-primary" onClick={() => void saveBranchSettings()}>Şube Ayarlarını Kaydet</button>
              </div>
            )}

            {canCentral && branchCode !== 'ALL' && setup && (
              <div className="helpdesk-card">
                <h3>Merkez · Öncelik / SLA / Durum Tanımları</h3>
                <div className="helpdesk-grid-2">
                  <Field label="Yeni Öncelik"><input value={priorityDraft.name} onChange={event => setPriorityDraft(current => ({ ...current, name: event.target.value }))} /></Field>
                  <Field label="Renk"><input type="color" value={priorityDraft.color} onChange={event => setPriorityDraft(current => ({ ...current, color: event.target.value }))} /></Field>
                  <Field label="İlk Yanıt SLA (dk)"><input type="number" min={0} value={priorityDraft.firstResponseMinutes} onChange={event => setPriorityDraft(current => ({ ...current, firstResponseMinutes: Number(event.target.value) }))} /></Field>
                  <Field label="Çözüm SLA (dk)"><input type="number" min={0} value={priorityDraft.resolutionMinutes} onChange={event => setPriorityDraft(current => ({ ...current, resolutionMinutes: Number(event.target.value) }))} /></Field>
                </div>
                <button className="helpdesk-secondary" onClick={() => void (editingPriorityId ? savePriority() : createPriority())}>{editingPriorityId ? 'Önceliği Kaydet' : 'Öncelik Ekle'}</button>
                {editingPriorityId && <button onClick={()=>{setEditingPriorityId('');setPriorityDraft({name:'',color:'#38bdf8',level:3,firstResponseMinutes:240,resolutionMinutes:1440})}}>Vazgeç</button>}
                <div className="helpdesk-definition-list">{setup.priorities.map(item => <div key={item.id} className="helpdesk-definition-row"><span>{item.name} · {item.firstResponseMinutes}/{item.resolutionMinutes} dk</span><button onClick={()=>editPriority(item.id)}>Düzenle</button></div>)}</div>
                <div className="helpdesk-grid-2">
                  <Field label="Durum Kodu"><input value={statusDraft.code} onChange={event => setStatusDraft(current => ({ ...current, code: event.target.value }))} /></Field>
                  <Field label="Durum Adı"><input value={statusDraft.name} onChange={event => setStatusDraft(current => ({ ...current, name: event.target.value }))} /></Field>
                  <Field label="Renk"><input type="color" value={statusDraft.color} onChange={event => setStatusDraft(current => ({ ...current, color: event.target.value }))} /></Field>
                  <label className="helpdesk-check"><input type="checkbox" checked={statusDraft.closed} onChange={event => setStatusDraft(current => ({ ...current, closed: event.target.checked }))} /> Kapalı / çözüldü saysın</label>
                </div>
                <button className="helpdesk-secondary" onClick={() => void (editingStatusId ? saveStatusDefinition() : createStatus())}>{editingStatusId ? 'Durumu Kaydet' : 'Durum Ekle'}</button>
                {editingStatusId && <button onClick={()=>{setEditingStatusId('');setStatusDraft({code:'',name:'',color:'#64748b',closed:false,sortOrder:60})}}>Vazgeç</button>}
                <div className="helpdesk-definition-list">{setup.statuses.map(item => <div key={item.id} className="helpdesk-definition-row"><span>{item.name}{item.closed?' · Kapalı':''}</span><button onClick={()=>editStatusDefinition(item.id)}>Düzenle</button></div>)}</div>
              </div>
            )}

            {canCanned && branchCode !== 'ALL' && (
              <div className="helpdesk-card">
                <h3>Hazır Yanıtlar</h3>
                <div className="helpdesk-grid-2">
                  <Field label="Başlık"><input value={cannedTitle} onChange={event => setCannedTitle(event.target.value)} /></Field>
                  <Field label="Yanıt"><textarea rows={3} value={cannedBody} onChange={event => setCannedBody(event.target.value)} /></Field>
                </div>
                <button className="helpdesk-secondary" onClick={() => void (editingCannedId ? saveCanned() : createCanned())}>{editingCannedId ? 'Hazır Yanıtı Kaydet' : 'Hazır Yanıt Ekle'}</button>
                {editingCannedId && <button onClick={()=>{setEditingCannedId('');setCannedTitle('');setCannedBody('')}}>Vazgeç</button>}
                <div className="helpdesk-definition-list">{setup?.cannedReplies.map(item=><div key={item.id} className="helpdesk-definition-row"><span>{item.title}{!item.active?' · Pasif':''}</span><div><button onClick={()=>editCanned(item.id)}>Düzenle</button><button onClick={()=>void deleteCanned(item.id)}>Sil</button></div></div>)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <div className="helpdesk-modal-backdrop">
          <div className="helpdesk-modal">
            <header>
              <div>
                <small>{selected.ticketNo} · {selected.branch?.name}</small>
                <h3>{selected.subject}</h3>
                {selected.locked && <div className="helpdesk-lock-banner"><Lock className="h-4 w-4" /> Ticket kilitli{selected.lockedByName ? ` · ${selected.lockedByName}` : ''}</div>}
              </div>
              <div className="helpdesk-modal-actions">
                {canResendSelectedNotification && (
                  <button className="helpdesk-primary" type="button" onClick={() => void resendSelectedNotification()}
                    title="Tüm dış yazışma geçmişini ve ekli dosyaları bildirim alıcılarına yeniden gönderir.">
                    <Send className="h-4 w-4" /> Mail Bildirimini Tekrar Gönder
                  </button>
                )}
                {canClaimSelected && (
                  <button className="helpdesk-primary" onClick={() => void claimSelectedTicket()}>
                    <ShieldCheck className="h-4 w-4" /> Üzerime Al
                  </button>
                )}
                {canCoordinateSelected && (
                  <button className={selected.locked ? 'helpdesk-unlock' : 'helpdesk-lock'} onClick={() => void toggleLock()}>
                    {selected.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    {selected.locked ? 'Kilidi Aç' : 'Kilitle'}
                  </button>
                )}
                <button onClick={() => setSelected(null)}><X className="h-5 w-5" /></button>
              </div>
            </header>

            <div className="helpdesk-meta">
              <div><small>Talep Sahibi</small><button type="button" className="block text-left underline decoration-dotted" onClick={() => { setSelected(null); void openRequesterTickets(selected.requesterId, selected.requesterName); }}>{selected.requesterName}</button></div>
              <Meta label="Kategori" value={selected.category?.name ?? '-'} />
              <Meta label="Öncelik" value={selected.priority?.name ?? '-'} />
              <Meta label="Durum" value={selected.status?.name ?? '-'} />
              <Meta label="Görevli" value={selected.assignedUserName || 'Havuz'} />
              <Meta label="Açılış" value={new Date(selected.createdAt).toLocaleString('tr-TR')} />
              <Meta label="Kaynak IP" value={selected.requesterIp || '-'} />
              <Meta label="Kaynak MAC" value={selected.requesterMac || 'Gözlemlenemedi'} />
              <Meta label="Ana Şube" value={selected.requesterPrimaryBranch?.name || '-'} />
              <Meta
                label="Atanmış Şubeler"
                value={selected.requesterBranches?.length
                  ? selected.requesterBranches.map(branch => `${branch.name}${branch.isPrimary ? ' (Ana)' : ''}`).join(', ')
                  : '-'}
              />
              <Meta
                label="DC Grupları"
                value={selected.requesterDirectoryGroups?.length ? selected.requesterDirectoryGroups.join(', ') : '-'}
              />
            </div>

            <div className="helpdesk-conversation">
              <article className="helpdesk-message"><b>{selected.requesterName}</b><p>{selected.body}</p></article>
              {selected.replies?.filter(item => canSeeInternalNotes || !item.internalNote).map(item => (
                <article key={item.id} className={`helpdesk-message ${item.internalNote ? 'internal' : item.isStaff ? 'staff' : ''}`}>
                  <b>{item.authorName}{item.internalNote ? ' · İç Not' : item.isStaff ? ' · Yetkili' : ''}</b>
                  <small>{new Date(item.createdAt).toLocaleString('tr-TR')}</small>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>

            {(canChangeSelectedStatus || canCoordinateSelected) && setup && (
              <div className="helpdesk-grid-2 helpdesk-modal-controls">
                {canChangeSelectedStatus && (
                  <Field label="Durum">
                    <select disabled={selected.locked} value={selected.statusId} onChange={event => void updateStatus(event.target.value)}>
                      {setup.statuses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </Field>
                )}
                {(user.isAdmin || (canCoordinateSelected && selectedAccess?.canAssign)) && (
                  <Field label="Görevli">
                    <select disabled={selected.locked} value={selected.assignedUserId ?? ''} onChange={event => void updateAssignee(event.target.value)}>
                      <option value="">Havuz / Atanmamış</option>
                      {setup.staff.map(item => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            )}

            <div className="helpdesk-reply">
              {(canCoordinateSelected || canRespondSelected) && setup?.cannedReplies.length ? (
                <select value="" disabled={selected.locked} onChange={event => {
                  const item = setup.cannedReplies.find(row => row.id === event.target.value);
                  if (item) setReply(item.body);
                }}>
                  <option value="">Hazır yanıt seç…</option>
                  {setup.cannedReplies.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              ) : null}
              <textarea disabled={selected.locked || !canWriteSelectedReply} rows={5} value={reply} onChange={event => setReply(event.target.value)}
                placeholder={selected.locked ? 'Ticket kilitli.' : canWriteSelectedReply ? 'Yanıtınızı yazın…' : 'Bu ticket için cevap yetkiniz yok.'} />
              <div className="helpdesk-reply-actions">
                {(canCoordinateSelected || canRespondSelected) && <label><input type="checkbox" checked={internalNote} disabled={selected.locked} onChange={event => setInternalNote(event.target.checked)} /> İç not</label>}
                <button className="helpdesk-primary" disabled={selected.locked || !canWriteSelectedReply} onClick={() => void submitReply()}><MessageSquareReply className="h-4 w-4" /> Yanıtla</button>
                {reply && <button type="button" onClick={clearReplyDraft}>Taslağı Sil</button>}
              </div>
            </div>

            {selected.attachments?.length ? (
              <div className="helpdesk-attachments">
                {selected.attachments.map(item => (
                  <div key={item.id} className="helpdesk-attachment-row">
                    <a href={api.getHelpDeskAttachmentUrl(item.id)} target="_blank" rel="noreferrer">
                      <FileText className="h-4 w-4" /> {item.originalName}
                    </a>
                    {canModifySelectedAttachments && (
                      <button type="button" onClick={()=>void deleteExistingAttachment(item.id)}>Sil</button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {(branchCode === 'ALL' || activeBranch?.showRecentTickets) && (
        <aside className="helpdesk-recent">
          <button type="button" className="helpdesk-recent-title w-full" onClick={() => setRecentExpanded(current => !current)}>
            <Clock3 className="h-4 w-4" />
            {recentScope === 'all' || branchCode === 'ALL' ? 'Tüm Şubelerde Son 10 Talebim' : `${activeBranch?.branchName ?? 'Şube'} · Son 10 Talebim`}
            <span>{recentExpanded ? 'Gizle' : 'Göster'}</span>
          </button>
          {recentExpanded && <>
            <ScopeToggle value={recentScope} onChange={setRecentScope} disableBranch={branchCode === 'ALL'} />
            {recent.slice(0, 10).map(ticket => (
              <button key={ticket.id} onClick={() => void openTicket(ticket)}>
                <small>{ticket.ticketNo}</small>
                <b>{ticket.subject}</b>
                <span>{ticket.branch?.name} · {ticket.status?.name}</span>
              </button>
            ))}
            <button className="helpdesk-all" onClick={() => { setMineScope(recentScope); setView('mine'); }}>Kendi Açtığım Tüm Taleplere Git</button>
          </>}
        </aside>
      )}
    </section>
  );
}

function Nav({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}{label}</button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="helpdesk-field"><span>{label}</span>{children}</label>;
}

function SectionTitle({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="helpdesk-section-title">{icon}<div><h3>{title}</h3><p>{text}</p></div></div>;
}

function ScopeToggle({ value, onChange, disableBranch }: { value: 'branch' | 'all'; onChange: (value: 'branch' | 'all') => void; disableBranch: boolean }) {
  return (
    <div className="helpdesk-scope">
      <button className={value === 'branch' ? 'active' : ''} disabled={disableBranch} onClick={() => onChange('branch')}>Bu Şube</button>
      <button className={value === 'all' ? 'active' : ''} onClick={() => onChange('all')}>Tüm Şubeler</button>
    </div>
  );
}

function TicketTable({ title, tickets, query, onQuery, onOpen, onRequester, scopeControl }: {
  title: string;
  tickets: HelpDeskTicket[];
  query: string;
  onQuery: (value: string) => void;
  onOpen: (ticket: HelpDeskTicket) => void;
  onRequester?: (ticket: HelpDeskTicket) => void;
  scopeControl?: React.ReactNode;
}) {
  return (
    <div className="helpdesk-card">
      <div className="helpdesk-table-header">
        <div><h3>{title}</h3><p>{tickets.length} kayıt</p></div>
        <div className="helpdesk-table-tools">
          {scopeControl}
          <div className="helpdesk-search"><Search className="h-4 w-4" /><input value={query} onChange={event => onQuery(event.target.value)} placeholder="Talep no, konu, kullanıcı, durum ara…" /></div>
        </div>
      </div>
      <div className="helpdesk-table-wrap">
        <table className="helpdesk-table">
          <thead><tr><th>Talep No</th><th>Şube</th><th>Konu</th><th>Destek Konusu</th><th>Öncelik</th><th>Durum</th><th>Görevli</th><th>Son İşlem</th></tr></thead>
          <tbody>
            {tickets.map(ticket => (
              <tr key={ticket.id} className={ticket.isUnprocessed && !ticket.status?.closed ? 'helpdesk-ticket-unprocessed' : ''} onClick={() => onOpen(ticket)}>
                <td className="font-mono">{ticket.ticketNo}</td>
                <td>{ticket.branch?.name ?? ticket.branchCode}</td>
                <td><b>{ticket.subject}</b><button type="button" className="block text-left text-xs underline decoration-dotted" onClick={event=>{event.stopPropagation();onRequester?.(ticket);}}>{ticket.requesterName}</button></td>
                <td>{ticket.category?.name ?? '-'}</td>
                <td>{ticket.priority?.name ?? '-'}</td>
                <td><span className="helpdesk-status" style={{ background: ticket.status?.color ?? '#475569' }}>{ticket.status?.name ?? '-'}</span>{ticket.locked ? <Lock className="ml-1 inline h-3 w-3 text-amber-300" /> : null}</td>
                <td>{ticket.assignedUserName || 'Havuz'}</td>
                <td>{new Date(ticket.lastActivityAt).toLocaleString('tr-TR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tickets.length && <div className="helpdesk-empty">Gösterilecek ticket bulunamadı.</div>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="helpdesk-stat"><span>{label}</span><b>{value}</b></div>;
}

function ReportCard({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
  return <div className="helpdesk-card"><h3>{title}</h3>{rows.map(row => <div className="helpdesk-report-row" key={row.name}><span>{row.name}</span><b>{row.count}</b></div>)}</div>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}
