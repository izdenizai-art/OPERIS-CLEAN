import type { BranchContext, BranchAdminItem, UserBranchAssignment, NetworkMonitor, NetworkMonitorEvent, NetworkService, NetworkTopologyWorkspace, NetworkTopologyWorkspaceSummary, NetworkTopologyLayout, Announcement, AnnouncementMailboxItem, AppMessage, AppState, AuditLog, Credential, SessionUser, Settings, Task, RecordLock, TrackingRecord, UserNote, UserPermissions, HelpDeskContext, HelpDeskTicket, HelpDeskBranchSetup, HelpDeskReport, HelpDeskAdminAccess, DomainSyncSettings, DomainSyncResult, HelpDeskMySummary, HelpDeskManagerDashboard } from './types';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type DomainUserResult = {
  samAccountName: string;
  userPrincipalName: string;
  displayName: string;
  email: string;
  department: string;
  title: string;
  telephoneNumber: string;
  manager: string;
  employeeId: string;
  enabled: boolean;
  groups: string[];
  querySource: string;
};

export type DomainDeviceResult = {
  computerName: string;
  dnsAddresses: string[];
  ipv4: string;
  macAddress: string;
  macSource: string;
  operatingSystem: string;
  operatingSystemVersion: string;
  enabled: boolean | null;
  description: string;
  lastLogonDate: string;
};

export type NetworkMonitorWriteInput = Omit<
  NetworkMonitor,
  'id' | 'status' | 'consecutiveFailures' | 'lastLatencyMs' | 'lastCheckedAt' | 'lastSuccessAt' |
  'lastFailureAt' | 'lastNotifiedStatus' | 'createdById' | 'createdByName' | 'createdAt' | 'updatedAt' |
  'snmpCommunitySet' | 'snmpAuthKeySet' | 'snmpPrivKeySet' | 'services'
> & {
  snmpCommunity?: string;
  snmpAuthKey?: string;
  snmpPrivKey?: string;
};

export type NetworkDiagnostics = {
  listening: boolean;
  localAddress: string;
  processId: number;
  firewallPresent: boolean;
  firewallEnabled: string;
  port: number;
  addresses: string[];
  urls: string[];
  hostName: string;
  platform: string;
  release: string;
};


export type AssetCard = {
  branchCode: string;
  id: string; assetCode: string; externalSource: string; externalId: string; name: string;
  category: string; brand: string; model: string; serialNumber: string; barcode: string;
  status: string; quantity: number; description: string; currentTargetType: string;
  currentTargetId: string; currentTargetName: string; unitId: string; locationId: string;
  purchaseDate: string; warrantyEndDate: string;
  sourceSirketKodu: string; sourceBitisYili: string; sourceAlisBelgeNo: string; sourceSatici: string;
  sourceResBelgeNo: string; sourceGrupKodu: string; sourceSatisTarihi: string;
  sourceFingerprint: string; sourceSyncedAt: number | null; sourceChangedAt: number | null;
  createdAt: number; updatedAt: number;
};
export type MailTestResult = {
  ok: boolean;
  stage: 'configuration' | 'connection' | 'authentication' | 'send';
  message: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  accepted: string[];
  rejected: string[];
  response: string;
  code: string;
};

export type AssetExternalSale = {
  id:string; branchCode:string; connectionId:string; sirketKodu:string; demirKodu:string;
  tarih:string; belgeNo:string; alici:string; satisMiktari:number; aciklama:string;
  sourceType?:'SQL'|'OPERIS_STATUS';
  sourceChangedAt:number|null; sourceSyncedAt:number|null; createdAt:number; updatedAt:number;
};

export type AssetParty = {
  branchCode: string;
  id: string; type: string; code: string; name: string; parentId: string;
  externalSource: string; externalId: string; department: string; title: string;
  email: string; active: boolean; createdAt: number; updatedAt: number;
};
export type AssetAssignment = {
  branchCode: string;
  id: string; documentNo: string; assetId: string; targetType: string; targetId: string;
  targetName: string; unitId: string; locationId: string; startAt: number; endAt: number | null;
  status: string; note: string; createdAt: number; updatedAt: number;
};

export type AssetCountScan = {
  branchCode: string;
  id: string;
  countId: string;
  assetId: string;
  scannedCode: string;
  locationId: string;
  result: 'MATCHED' | 'WRONG_LOCATION' | 'REVIEW_REQUIRED' | string;
  note: string;
  scannedById: string;
  scannedByName: string;
  scannedAt: number;
  asset: AssetCard | null;
};

export type AssetCount = {
  branchCode: string;
  id: string; countNo: string; name: string; locationId: string; locationName: string;
  status: string; startedAt: number; completedAt: number | null; createdAt: number; updatedAt: number;
};


export type AssetSummary = {
  total: number; assigned: number; warehouse: number; openCounts: number;
  activeTransfers: number; sales: number; scrap: number; disposed: number;
  labels: number; documents: number;
};
export type AssetExternalConnection = {
  id: string;
  branchCode: string;
  branchVisibility: 'BRANCH' | 'CENTER_ONLY';
  name: string;
  type: string;
  host: string;
  port: number;
  database: string;
  username: string;
  passwordSet: boolean;
  queryText: string;
  purpose: string;
  enabled: boolean;
  lastTestAt: number | null;
  lastTestResult: string;
  createdAt: number;
  updatedAt: number;
};


export type ExternalConnectionTestResult = {
  ok: boolean;
  database: string;
  server: string;
  login: string;
  serverTime: string;
  message: string;
};

export type ExternalTableInfo = {
  schemaName: string;
  tableName: string;
  objectType: 'TABLE' | 'VIEW';
  fullName: string;
};

export type ExternalColumnInfo = {
  ordinal: number;
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength: number | null;
};

export type ExternalTableDataChunk = {
  schemaName: string;
  tableName: string;
  columns: ExternalColumnInfo[];
  total: number;
  offset: number;
  limit: number;
  rows: Record<string, unknown>[];
  hasMore: boolean;
};

export type AssetLabelTemplate = {
  branchCode: string;
  id: string; name: string; widthMm: number; heightMm: number;
  printerLanguage: string; layoutJson: string; isDefault: boolean;
  createdAt: number; updatedAt: number;
};

export type ActiveSession = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  department: string;
  deviceName: string;
  deviceType: string;
  browser: string;
  operatingSystem: string;
  ipAddress: string;
  macAddress: string | null;
  macAvailable: boolean;
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
  online: boolean;
};

export type LicenseStatus = {
  ownerUsername: string;
  expiresAt: number | null;
  effectiveNow: number;
  expired: boolean;
  clockRollbackDetected: boolean;
  timeSource: 'https' | 'system' | 'stored';
  canManage: boolean;
};

export type ReleaseInfo = {
  version: string;
  name: string;
  headlines: string[];
  shouldShow?: boolean;
};

type BootstrapPayload = {
  user: SessionUser;
  tasks: Task[];
  credentials: Credential[];
  trackingRecords: TrackingRecord[];
  settings: Settings;
  users: SessionUser[];
  messageUsers: SessionUser[];
  messages: AppMessage[];
  announcements: Announcement[];
  auditLogs: AuditLog[];
  notes: UserNote[];
  releaseInfo: ReleaseInfo;
  license: LicenseStatus;
  branchContext: BranchContext;
};

function getDeviceName(): string {
  const existing = localStorage.getItem('operis-device-name')?.trim();
  if (existing) return existing.slice(0, 120);
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || 'Cihaz';
  const generated = `${platform} · Operis`;
  localStorage.setItem('operis-device-name', generated);
  return generated;
}

function branchRequestHeaders(branchCode?: string): Record<string, string> {
  return branchCode ? { 'X-Operis-Branch-Code': branchCode } : {};
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Operis-Device-Name': getDeviceName(),
        'X-Operis-Branch-Code': localStorage.getItem('operis-selected-branch') || '',
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      `OPERİS sunucusuna bağlanılamadı. Adres: ${window.location.origin}. Ağ/Firewall/CORS bağlantısını kontrol edin. ${detail}`,
      0,
      'NETWORK_ERROR',
    );
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; code?: string; detail?: string };
    throw new ApiError([payload.error, payload.code ? `Hata kodu: ${payload.code}` : '', payload.detail ? `Detay: ${payload.detail}` : ''].filter(Boolean).join(' — ') || `İstek başarısız (${response.status})`, response.status, payload.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  authStatus: () => request<{ hasUsers: boolean; license: { expired: boolean; expiresAt: number | null }; branding: { companyName: string; companyLogoDataUrl: string; quickLinks: Array<{ id: string; label: string; url: string; active: boolean }> } }>('/api/auth/status'),
  currentUser: () => request<{ user: SessionUser }>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  setup: (username: string, displayName: string, email: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, displayName, email, password }) }),
  changeOwnPassword: (password: string) => request<{ user: SessionUser }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ password }) }),
  completeFirstLogin: (input: { displayName: string; email: string; department: string; title: string; password?: string }) =>
    request<{ user: SessionUser }>('/api/auth/complete-first-login', { method: 'POST', body: JSON.stringify(input) }),
  forgotPassword: (email: string) =>
    request<{ ok: true }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPasswordWithToken: (token: string, password: string) =>
    request<void>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  bootstrap: () => request<BootstrapPayload>('/api/bootstrap'),
  versionInfo: () => request<ReleaseInfo>('/api/version-info', { cache: 'no-store' }),
  acknowledgeRelease: () => request<void>('/api/release/acknowledge', { method: 'POST' }),
  getLicenseStatus: () => request<LicenseStatus>('/api/license/status'),
  updateLicenseExpiry: (expiresAt: string | null) =>
    request<LicenseStatus>('/api/license/expiry', { method: 'PUT', body: JSON.stringify({ expiresAt }) }),



  getAnnouncements: () => request<Announcement[]>('/api/announcements'),
  getAnnouncementInbox: () => request<AnnouncementMailboxItem[]>('/api/announcements/inbox'),
  getAnnouncementSent: () => request<AnnouncementMailboxItem[]>('/api/announcements/sent'),
  createAnnouncement: (input: {
    branchCode: string;
    title: string;
    body: string;
    priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
    audienceType: 'TEAM' | 'ALL' | 'DEPARTMENT' | 'USERS';
    audienceValue: string;
    startsAt?: string;
    endsAt?: string | null;
  }) => request<{ id: string; recipientCount: number }>('/api/announcements', {
    method: 'POST',
    headers: branchRequestHeaders(input.branchCode),
    body: JSON.stringify(input),
  }),
  markAnnouncementSeen: (id: string) =>
    request<{ seenAt: number | null }>(`/api/announcements/${encodeURIComponent(id)}/seen`, { method: 'POST' }),
  dismissAnnouncement: (id: string, dontShowAgain: boolean) =>
    request<{ dismissedAt: number | null; dontShowAgainAt: number | null }>(`/api/announcements/${encodeURIComponent(id)}/dismiss`, { method: 'POST', body: JSON.stringify({ dontShowAgain }) }),
  deleteAnnouncement: (id: string) =>
    request<void>(`/api/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' }),


  getBranchContext: () => request<BranchContext>('/api/branches/context'),
  getBranches: () => request<BranchAdminItem[]>('/api/branches'),
  createBranch: (input: { code: string; name: string; active: boolean }) =>
    request<BranchAdminItem>('/api/branches', { method: 'POST', body: JSON.stringify(input) }),
  updateBranch: (code: string, input: { name: string; active: boolean }) =>
    request<BranchAdminItem>(`/api/branches/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteBranch: (code: string) =>
    request<void>(`/api/branches/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  getUserBranches: (userId: string) =>
    request<UserBranchAssignment[]>(`/api/branches/users/${encodeURIComponent(userId)}`),
  updateUserBranches: (userId: string, input: {
    assignments: Array<{
      branchCode: string;
      isPrimary: boolean;
      role: UserBranchAssignment['role'];
      permissions: UserPermissions;
      helpDesk: UserBranchAssignment['helpDesk'];
    }>;
  }) =>
    request<UserBranchAssignment[]>(`/api/branches/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(input) }),

  getNetworkTopologyWorkspaces: () =>
    request<NetworkTopologyWorkspaceSummary[]>('/api/network-monitors/topology-workspaces/list'),
  getNetworkTopologyWorkspace: (id: string) =>
    request<NetworkTopologyWorkspace>(`/api/network-monitors/topology-workspaces/${encodeURIComponent(id)}`),
  createNetworkTopologyWorkspace: (input: { branchCode: string; name: string; description: string; layout: NetworkTopologyLayout }) =>
    request<NetworkTopologyWorkspace>('/api/network-monitors/topology-workspaces', {
      method: 'POST',
      headers: branchRequestHeaders(input.branchCode),
      body: JSON.stringify({ name: input.name, description: input.description, layout: input.layout }),
    }),
  updateNetworkTopologyWorkspace: (id: string, input: { name: string; description: string; layout: NetworkTopologyLayout }) =>
    request<NetworkTopologyWorkspace>(`/api/network-monitors/topology-workspaces/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteNetworkTopologyWorkspace: (id: string) =>
    request<void>(`/api/network-monitors/topology-workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getNetworkMonitors: () => request<NetworkMonitor[]>('/api/network-monitors'),
  createNetworkMonitor: (input: NetworkMonitorWriteInput) =>
    request<NetworkMonitor>('/api/network-monitors', { method: 'POST', headers: branchRequestHeaders(input.branchCode), body: JSON.stringify(input) }),
  updateNetworkMonitor: (id: string, input: Omit<NetworkMonitorWriteInput, 'branchCode'>) =>
    request<NetworkMonitor>(`/api/network-monitors/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteNetworkMonitor: (id: string) =>
    request<void>(`/api/network-monitors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testNetworkMonitor: (id: string) =>
    request<NetworkMonitor>(`/api/network-monitors/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  getNetworkMonitorEvents: (id: string) =>
    request<NetworkMonitorEvent[]>(`/api/network-monitors/${encodeURIComponent(id)}/events`),
  getNetworkSummary: () =>
    request<{
      total: number; online: number; offline: number; unknown: number; active: number;
      servicesTotal: number; servicesOnline: number; servicesOffline: number;
      averageLatencyMs: number; alarms24h: number;
      recentAlarms: Array<{ id: string; monitorId: string; status: string; message: string; createdAt: number }>;
    }>('/api/network-monitors/summary'),
  discoverNetwork: (input: { cidr: string; timeoutMs: number; branchCode: string }) =>
    request<{
      cidr: string; scanned: number; found: number;
      results: Array<{ ip: string; hostname: string; latencyMs: number | null; deviceType: string; alreadyMonitored: boolean }>;
    }>('/api/network-monitors/discover', {
      method: 'POST',
      headers: branchRequestHeaders(input.branchCode),
      body: JSON.stringify({ cidr: input.cidr, timeoutMs: input.timeoutMs }),
    }),
  getNetworkMetrics: (id: string, hours = 24) =>
    request<{
      hours: number; totalSamples: number; uptimePercent: number; packetLossPercent: number;
      downtimeMinutes: number; avgLatencyMs: number; maxLatencyMs: number;
      samples: Array<{ at: number; success: boolean; latencyMs: number | null }>;
    }>(`/api/network-monitors/${encodeURIComponent(id)}/metrics?hours=${hours}`),
  getNetworkServices: (id: string) =>
    request<NetworkService[]>(`/api/network-monitors/${encodeURIComponent(id)}/services`),
  createNetworkService: (monitorId: string, input: {
    name: string; protocol: NetworkService['protocol']; port: number; path: string;
    expectedStatus: number | null; timeoutMs: number; active: boolean;
  }) => request<NetworkService>(`/api/network-monitors/${encodeURIComponent(monitorId)}/services`, {
    method: 'POST', body: JSON.stringify(input),
  }),
  updateNetworkService: (serviceId: string, input: {
    name: string; protocol: NetworkService['protocol']; port: number; path: string;
    expectedStatus: number | null; timeoutMs: number; active: boolean;
  }) => request<NetworkService>(`/api/network-monitors/services/${encodeURIComponent(serviceId)}`, {
    method: 'PUT', body: JSON.stringify(input),
  }),
  deleteNetworkService: (serviceId: string) =>
    request<void>(`/api/network-monitors/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE' }),
  testNetworkService: (serviceId: string) =>
    request<{ success: boolean; latencyMs: number | null; message: string; responseCode: number | null }>(
      `/api/network-monitors/services/${encodeURIComponent(serviceId)}/test`,
      { method: 'POST' },
    ),
  testNetworkSnmp: (id: string) =>
    request<{
      ok: boolean; sysName: string; sysDescr: string; sysLocation: string; sysContact: string;
      sysUptimeTicks: string | null; cpuPercent: number | null; memoryPercent: number | null;
      diskPercent: number | null; createdAt: number;
      interfaces: Array<{
        interfaceIndex: number; interfaceName: string; adminStatus: number | null; operStatus: number | null;
        speedBps: string | null; inBps: number | null; outBps: number | null;
      }>;
    }>(`/api/network-monitors/${encodeURIComponent(id)}/snmp/test`, { method: 'POST' }),
  getNetworkSnmp: (id: string, hours = 24) =>
    request<{
      enabled: boolean; version: string;
      latest: null | {
        id: string; sysName: string; sysDescr: string; sysLocation: string; sysContact: string;
        sysUptimeTicks: string | null; cpuPercent: number | null; memoryPercent: number | null;
        diskPercent: number | null; createdAt: number;
      };
      samples: Array<{ cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null; createdAt: number }>;
      interfaces: Array<{
        interfaceIndex: number; interfaceName: string; adminStatus: number | null; operStatus: number | null;
        speedBps: string | null; inBps: number | null; outBps: number | null; createdAt: number;
      }>;
    }>(`/api/network-monitors/${encodeURIComponent(id)}/snmp?hours=${hours}`),
  getNetworkRdpUrl: (id: string) =>
    `${API_BASE}/api/network-monitors/${encodeURIComponent(id)}/remote/rdp`,

  syncExternalAssetData: () =>
    request<{
      connectionCount:number;
      results:Array<{
        connectionId:string;
        connectionName:string;
        branchCode:string;
        demirmas?:{scanned:number;fetched:number;created:number;updated:number;unchanged:number;protectedOperis:number};
        demsatis?:{scanned:number;fetched:number;created:number;updated:number;unchanged:number;autoMarkedSales:number};
        errors:string[];
      }>;
      hasErrors:boolean;
    }>('/api/assets/sync-external-asset-data',{method:'POST'}),

  getAssetExternalSales: () => request<AssetExternalSale[]>('/api/assets/sales-external'),
  syncTblDemSatis: (id: string) =>
    request<{ scanned:number; fetched:number; created:number; updated:number; unchanged:number; autoMarkedSales:number }>(
      `/api/assets/external-connections/${encodeURIComponent(id)}/sync-tbldemsatis`, { method:'POST' }
    ),

  syncTblDemirmas: (id: string) =>
    request<{ scanned: number; fetched: number; created: number; updated: number; unchanged: number; protectedOperis: number }>(
      `/api/assets/external-connections/${encodeURIComponent(id)}/sync-tbldemirmas`,
      { method: 'POST' },
    ),

  testAssetExternalConnection: (id: string) =>
    request<ExternalConnectionTestResult>(`/api/assets/external-connections/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  getAssetExternalTables: (id: string) =>
    request<{ tables: ExternalTableInfo[] }>(`/api/assets/external-connections/${encodeURIComponent(id)}/tables`),
  getAssetExternalTableColumns: (id: string, schemaName: string, tableName: string) =>
    request<{ schemaName: string; tableName: string; columns: ExternalColumnInfo[] }>(
      `/api/assets/external-connections/${encodeURIComponent(id)}/table-columns?schema=${encodeURIComponent(schemaName)}&table=${encodeURIComponent(tableName)}`
    ),
  getAssetExternalTableData: (id: string, schemaName: string, tableName: string, offset = 0, limit = 5000) =>
    request<ExternalTableDataChunk>(
      `/api/assets/external-connections/${encodeURIComponent(id)}/table-data?schema=${encodeURIComponent(schemaName)}&table=${encodeURIComponent(tableName)}&offset=${offset}&limit=${limit}`
    ),

  getAssetExternalConnections: () => request<AssetExternalConnection[]>('/api/assets/external-connections'),
  createAssetExternalConnection: (input: {
    name: string; type: string; host: string; port: number; database: string; username: string; password?: string;
    queryText: string; purpose: string; enabled: boolean; branchVisibility: 'BRANCH' | 'CENTER_ONLY';
  }) => request<AssetExternalConnection>('/api/assets/external-connections', { method: 'POST', body: JSON.stringify(input) }),
  updateAssetExternalConnection: (id: string, input: {
    name: string; type: string; host: string; port: number; database: string; username: string; password?: string;
    queryText: string; purpose: string; enabled: boolean; branchVisibility: 'BRANCH' | 'CENTER_ONLY';
  }) => request<AssetExternalConnection>(`/api/assets/external-connections/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteAssetExternalConnection: (id: string) =>
    request<void>(`/api/assets/external-connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getAssetSummary: () => request<AssetSummary>('/api/assets/summary'),
  getAssets: () => request<AssetCard[]>('/api/assets/cards'),
  createAsset: (input: Omit<AssetCard, 'id' | 'branchCode' | 'createdAt' | 'updatedAt' | 'currentTargetType' | 'currentTargetId' | 'currentTargetName'>) =>
    request<AssetCard>('/api/assets/cards', { method: 'POST', body: JSON.stringify(input) }),
  bulkCreateAssets: (items: Array<Omit<AssetCard, 'id' | 'branchCode' | 'createdAt' | 'updatedAt' | 'currentTargetType' | 'currentTargetId' | 'currentTargetName'>>) =>
    request<{ created: number; items: AssetCard[] }>('/api/assets/cards/bulk', { method: 'POST', body: JSON.stringify({ items }) }),
  updateAssetStatus: (id: string, status: 'ACTIVE' | 'PASSIVE' | 'SALE' | 'SCRAP' | 'WAREHOUSE') =>
    request<AssetCard>(`/api/assets/cards/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  updateAsset: (id: string, input: Partial<AssetCard>) =>
    request<AssetCard>(`/api/assets/cards/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteAsset: (id: string) => request<void>(`/api/assets/cards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getAssetParties: () => request<AssetParty[]>('/api/assets/parties'),
  createAssetParty: (input: Omit<AssetParty, 'id' | 'createdAt' | 'updatedAt'>) =>
    request<AssetParty>('/api/assets/parties', { method: 'POST', body: JSON.stringify(input) }),
  updateAssetParty: (id: string, input: Partial<AssetParty>) =>
    request<AssetParty>(`/api/assets/parties/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteAssetParty: (id: string) =>
    request<void>(`/api/assets/parties/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getAssetAssignments: () => request<AssetAssignment[]>('/api/assets/assignments'),
  createAssetAssignment: (input: { assetId: string; targetType: string; targetId: string; unitId?: string; locationId?: string; note?: string }) =>
    request<AssetAssignment>('/api/assets/assignments', { method: 'POST', body: JSON.stringify(input) }),
  returnAssetAssignment: (id: string) => request<void>(`/api/assets/assignments/${encodeURIComponent(id)}/return`, { method: 'POST' }),
  getAssetCounts: () => request<AssetCount[]>('/api/assets/counts'),
  createAssetCount: (input: { name: string; locationId: string }) =>
    request<AssetCount>('/api/assets/counts', { method: 'POST', body: JSON.stringify(input) }),
  scanAssetCount: (id: string, code: string) =>
    request<{ scan: AssetCountScan; asset: AssetCard }>(`/api/assets/counts/${encodeURIComponent(id)}/scan`, { method: 'POST', body: JSON.stringify({ code }) }),
  getAssetCountScans: (id: string) =>
    request<AssetCountScan[]>(`/api/assets/counts/${encodeURIComponent(id)}/scans`),
  updateAssetCountScan: (countId: string, scanId: string, input: { result?: 'MATCHED' | 'WRONG_LOCATION' | 'REVIEW_REQUIRED'; note?: string }) =>
    request<AssetCountScan>(`/api/assets/counts/${encodeURIComponent(countId)}/scans/${encodeURIComponent(scanId)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteAssetCountScan: (countId: string, scanId: string) =>
    request<void>(`/api/assets/counts/${encodeURIComponent(countId)}/scans/${encodeURIComponent(scanId)}`, { method: 'DELETE' }),
  completeAssetCount: (id: string) =>
    request<AssetCount>(`/api/assets/counts/${encodeURIComponent(id)}/complete`, { method: 'POST' }),
  getAssetCountDifferences: (id: string) =>
    request<{ totals: Record<string, number>; missing: AssetCard[]; wrongLocation: unknown[] }>(`/api/assets/counts/${encodeURIComponent(id)}/differences`),
  createAssetQr: (entityType: 'ASSET' | 'LOCATION' | 'DOCUMENT', entityId: string) =>
    request<{ payload: string }>(`/api/assets/qr/${entityType}/${encodeURIComponent(entityId)}`, { method: 'POST' }),
  resolveAssetQr: (payload: string) =>
    request<{ entityType: string; entity: unknown }>('/api/assets/qr/resolve', { method: 'POST', body: JSON.stringify({ payload }) }),
  getAssetLabels: () => request<AssetLabelTemplate[]>('/api/assets/labels'),
  createAssetLabel: (input: Omit<AssetLabelTemplate, 'branchCode' | 'id' | 'createdAt' | 'updatedAt'>) =>
    request<AssetLabelTemplate>('/api/assets/labels', { method: 'POST', body: JSON.stringify(input) }),
  updateAssetLabel: (id: string, input: Omit<AssetLabelTemplate, 'branchCode' | 'id' | 'createdAt' | 'updatedAt'>) =>
    request<AssetLabelTemplate>(`/api/assets/labels/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteAssetLabel: (id: string) =>
    request<void>(`/api/assets/labels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getAuditLogs: () => request<AuditLog[]>('/api/admin/audit-logs'),
  getActiveSessions: () => request<ActiveSession[]>('/api/admin/sessions'),
  getRemoteAccessSettings: () =>
    request<{
      mode: 'SERVER_ONLY' | 'LOCAL_NETWORK' | 'ALL_ALLOWED';
      bindHost: string;
      port: number;
      serverAddresses: string[];
      localhostAvailable: boolean;
      firewall?: { applied: boolean; reason: string };
    }>('/api/admin/remote-access'),
  updateRemoteAccessSettings: (mode: 'SERVER_ONLY' | 'LOCAL_NETWORK' | 'ALL_ALLOWED') =>
    request<{
      mode: 'SERVER_ONLY' | 'LOCAL_NETWORK' | 'ALL_ALLOWED';
      bindHost: string;
      port: number;
      serverAddresses: string[];
      localhostAvailable: boolean;
      firewall?: { applied: boolean; reason: string };
    }>('/api/admin/remote-access', { method: 'PUT', body: JSON.stringify({ mode }) }),

  getDomainSyncSettings: () => request<DomainSyncSettings>('/api/admin/domain-sync/settings'),
  updateDomainSyncSettings: (input: { enabled: boolean; controller: string; useLdaps: boolean; port: number; baseDn: string; username: string; password?: string; intervalMinutes: number }) =>
    request<DomainSyncSettings>('/api/admin/domain-sync/settings', { method: 'PUT', body: JSON.stringify(input) }),
  testDomainSyncConnection: () => request<{ ok: true; message: string }>('/api/admin/domain-sync/test', { method: 'POST' }),
  runDomainSync: () => request<DomainSyncResult>('/api/admin/domain-sync/run', { method: 'POST' }),
  queryDomainUser: (query: string) => request<DomainUserResult>('/api/admin/domain/user-query', { method: 'POST', body: JSON.stringify({ query }) }),
  queryDomainDevice: (computerName: string) => request<DomainDeviceResult>('/api/admin/domain/device-query', { method: 'POST', body: JSON.stringify({ computerName }) }),
  getNetworkDiagnostics: () => request<NetworkDiagnostics>('/api/admin/network-diagnostics'),
  revokeSession: (id: string) => request<void>(`/api/admin/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  revokeUserSessions: (userId: string) => request<{ count: number }>(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { method: 'POST' }),

  sendReportMail: async (input: { to: string; subject: string; body: string; file: File }) => {
    const form = new FormData();
    form.append('to', input.to);
    form.append('subject', input.subject);
    form.append('body', input.body);
    form.append('attachment', input.file);

    const response = await fetch(`${API_BASE}/api/mail/send-report`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error || `E-posta gönderilemedi (${response.status})`);
    return { ok: Boolean(payload.ok) };
  },

  updateBranding: (input: { companyName: string; companyLogoDataUrl: string; quickLinks: Array<{ id: string; label: string; url: string; active: boolean }> }) =>
    request<{ companyName: string; companyLogoDataUrl: string; quickLinks: Array<{ id: string; label: string; url: string; active: boolean }> }>('/api/admin/branding', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  updateBackupSettings: (input: {
    networkBackupEnabled: boolean;
    networkBackupPath: string;
    backupScheduleEnabled: boolean;
    backupScheduleType: 'daily' | 'weekly' | 'hourly';
    backupScheduleTime: string;
    backupScheduleDay: number;
    backupRetentionDays: number;
  }) =>
    request('/api/admin/backup/settings', { method: 'PUT', body: JSON.stringify(input) }),

  testNetworkBackup: () =>
    request<{ ok: boolean; message: string }>('/api/admin/backup/test-network', { method: 'POST' }),

  applyBackupSchedule: () =>
    request<{ ok: boolean; message: string }>('/api/admin/backup/apply-schedule', { method: 'POST' }),

  uploadOutlookAttachment: async (file: File, subject: string): Promise<{ protocolUrl: string }> => {
    const form = new FormData();
    form.append('attachment', file);
    form.append('subject', subject);
    const response = await fetch(`${API_BASE}/api/outlook/attachment`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const payload = await response.json().catch(() => ({})) as { protocolUrl?: string; error?: string };
    if (!response.ok || !payload.protocolUrl) throw new Error(payload.error || 'Outlook eki hazırlanamadı.');
    return { protocolUrl: payload.protocolUrl };
  },

  acquireRecordLock: (module: RecordLock['module'], recordId: string) =>
    request<RecordLock>('/api/record-locks/acquire', { method: 'POST', body: JSON.stringify({ module, recordId }) }),
  heartbeatRecordLock: (id: string) =>
    request<RecordLock>(`/api/record-locks/${encodeURIComponent(id)}/heartbeat`, { method: 'POST' }),
  releaseRecordLock: (id: string) =>
    request<void>(`/api/record-locks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  forceReleaseRecordLock: (id: string) =>
    request<void>(`/api/admin/record-locks/${encodeURIComponent(id)}/force`, { method: 'DELETE' }),

  createTask: (task: Task) => request<Task>('/api/tasks', { method: 'POST', headers: branchRequestHeaders(task.branchCode), body: JSON.stringify(task) }),
  updateTask: (task: Task) => request<Task>(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify(task) }),
  deleteTask: (id: string) => request<Task>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreTask: (id: string) => request<Task>(`/api/tasks/${encodeURIComponent(id)}/restore`, { method: 'POST' }),

  createCredential: (item: Credential) => request<Credential>('/api/credentials', { method: 'POST', headers: branchRequestHeaders(item.branchCode), body: JSON.stringify(item) }),
  updateCredential: (item: Credential) => request<Credential>(`/api/credentials/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify(item) }),
  deleteCredential: (id: string) => request<Partial<Credential>>(`/api/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreCredential: (id: string) => request<Partial<Credential>>(`/api/credentials/${encodeURIComponent(id)}/restore`, { method: 'POST' }),

  createTracking: (item: TrackingRecord) => request<TrackingRecord>('/api/tracking', { method: 'POST', headers: branchRequestHeaders(item.branchCode), body: JSON.stringify(item) }),
  updateTracking: (item: TrackingRecord) => request<TrackingRecord>(`/api/tracking/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify(item) }),
  deleteTracking: (id: string) => request<TrackingRecord>(`/api/tracking/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreTracking: (id: string) => request<TrackingRecord>(`/api/tracking/${encodeURIComponent(id)}/restore`, { method: 'POST' }),

  updateSettings: (settings: Settings) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  updateTheme: (theme: SessionUser['theme']) =>
    request<SessionUser>('/api/profile/theme', { method: 'PUT', body: JSON.stringify({ theme }) }),

  updateProfile: (changes: { displayName: string; email: string; department: string; title: string; theme: SessionUser['theme'] }) =>
    request<SessionUser>('/api/profile', { method: 'PUT', body: JSON.stringify(changes) }),

  getNotes: () => request<UserNote[]>('/api/notes'),
  createNote: (input: { title: string; content: string; color: UserNote['color']; branchCode: string }) =>
    request<UserNote>('/api/notes', { method: 'POST', headers: branchRequestHeaders(input.branchCode), body: JSON.stringify(input) }),
  updateNote: (id: string, input: { title: string; content: string; color: UserNote['color'] }) =>
    request<UserNote>(`/api/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteNote: (id: string) => request<void>(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getMessages: () => request<AppMessage[]>('/api/messages'),
  sendMessage: (recipientId: string, subject: string, body: string, branchCode: string) =>
    request<AppMessage>('/api/messages', { method: 'POST', headers: branchRequestHeaders(branchCode), body: JSON.stringify({ recipientId, subject, body }) }),
  markMessageRead: (id: string) =>
    request<{ readAt: number | null }>(`/api/messages/${encodeURIComponent(id)}/read`, { method: 'PUT' }),
  deleteMessage: (id: string) =>
    request<void>(`/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  downloadBackup: async (): Promise<{ blob: Blob; filename: string }> => {
    const response = await fetch(`${API_BASE}/api/admin/backup`, { credentials: 'include' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || `Yedek alınamadı (${response.status})`);
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    return { blob: await response.blob(), filename: match?.[1] ?? `yaklasan-isler-yedek-${Date.now()}.zip` };
  },

  restoreBackup: async (file: File): Promise<{ ok: boolean; restartRequired: boolean }> => {
    const form = new FormData();
    form.append('backup', file);
    const response = await fetch(`${API_BASE}/api/admin/restore`, { method: 'POST', credentials: 'include', body: form });
    const payload = await response.json().catch(() => ({})) as { error?: string; ok?: boolean; restartRequired?: boolean };
    if (!response.ok) throw new Error(payload.error || `Yedek yüklenemedi (${response.status})`);
    return { ok: Boolean(payload.ok), restartRequired: Boolean(payload.restartRequired) };
  },

  getUsers: () => request<SessionUser[]>('/api/users'),
  acknowledgeDomainUserChange: (id: string) => request<{ ok: true }>(`/api/users/${encodeURIComponent(id)}/domain-sync-ack`, { method: 'POST' }),
  createUser: (input: {
    username: string; displayName: string; email: string; department: string; password: string; isAdmin: boolean;
    permissions: UserPermissions;
    assignments: Array<{
      branchCode: string;
      isPrimary: boolean;
      role: UserBranchAssignment['role'];
      permissions: UserPermissions;
      helpDesk: UserBranchAssignment['helpDesk'];
    }>;
  }) =>
    request<SessionUser>('/api/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (id: string, changes: { displayName: string; email: string; department: string; active: boolean; isAdmin: boolean; permissions: UserPermissions }) =>
    request<SessionUser>(`/api/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(changes) }),
  resetPassword: (id: string, password: string) =>
    request<void>(`/api/users/${encodeURIComponent(id)}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  deleteUser: (id: string) => request<void>(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  updateGraphMailSettings: (input: {
    mailProvider: 'smtp' | 'graph';
    graphEnabled: boolean;
    graphTenantId: string;
    graphClientId: string;
    graphClientSecret?: string;
    graphSenderUser: string;
  }) =>
    request<{
      mailProvider: 'smtp' | 'graph';
      graphEnabled: boolean;
      graphTenantId: string;
      graphClientId: string;
      graphClientSecretSet: boolean;
      graphSenderUser: string;
    }>('/api/graph-mail-settings', { method: 'PUT', body: JSON.stringify(input) }),

  testGraphMail: (email: string) =>
    request<{ ok: true }>('/api/graph-mail-settings/test', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  updateMailSettings: (mail: Settings['mail'] & { smtpPassword?: string }) =>
    request<Settings['mail']>('/api/mail-settings', { method: 'PUT', body: JSON.stringify(mail) }),
  verifyMail: () =>
    request<MailTestResult>('/api/mail-settings/verify', { method: 'POST' }),
  testMail: (email: string) =>
    request<MailTestResult>('/api/mail-settings/test', { method: 'POST', body: JSON.stringify({ email }) }),

  importRecords: (payload: { tasks?: Task[]; credentials?: Credential[]; trackingRecords?: TrackingRecord[] }) =>
    request<{ imported: { tasks: number; credentials: number; trackingRecords: number } }>('/api/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getHelpDeskContext: () => request<HelpDeskContext>('/api/helpdesk/context'),
  getHelpDeskRecent: (branchCode = '') =>
    request<HelpDeskTicket[]>(`/api/helpdesk/recent?branchCode=${encodeURIComponent(branchCode)}`),
  getHelpDeskTickets: (
    branchCode = '',
    scope: 'mine' | 'assigned' | 'all' = 'mine',
    state: 'open' | 'closed' | 'all' = 'open',
    queueFilter: 'all' | 'new' | 'inProgress' | 'unassigned' = 'all',
  ) =>
    request<HelpDeskTicket[]>(`/api/helpdesk/tickets?branchCode=${encodeURIComponent(branchCode)}&scope=${scope}&state=${state}&queueFilter=${queueFilter}`),
  getHelpDeskTicket: (id: string) =>
    request<HelpDeskTicket>(`/api/helpdesk/tickets/${encodeURIComponent(id)}`),
  getHelpDeskUserTickets: (userId: string, branchCode: string, state: 'all' | 'open' | 'closed') =>
    request<HelpDeskTicket[]>(`/api/helpdesk/user-tickets?userId=${encodeURIComponent(userId)}&branchCode=${encodeURIComponent(branchCode)}&state=${state}`),
  createHelpDeskTicket: (input: { branchCode: string; categoryId: string; priorityId: string; subject: string; body: string; ccEmails: string }) =>
    request<HelpDeskTicket>('/api/helpdesk/tickets', { method: 'POST', body: JSON.stringify(input) }),
  replyHelpDeskTicket: (id: string, body: string, internalNote = false) =>
    request(`/api/helpdesk/tickets/${encodeURIComponent(id)}/replies`, { method: 'POST', body: JSON.stringify({ body, internalNote }) }),
  assignHelpDeskTicket: (id: string, userId: string | null) =>
    request<HelpDeskTicket>(`/api/helpdesk/tickets/${encodeURIComponent(id)}/assign`, { method: 'PUT', body: JSON.stringify({ userId }) }),
  resendHelpDeskTicketNotification: (id: string) =>
    request<{ ok: boolean; recipientCount: number; message: string }>(
      `/api/helpdesk/tickets/${encodeURIComponent(id)}/resend-notification`, { method: 'POST' },
    ),
  setHelpDeskTicketStatus: (id: string, statusId: string) =>
    request<HelpDeskTicket>(`/api/helpdesk/tickets/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ statusId }) }),
  setHelpDeskTicketLock: (id: string, locked: boolean) =>
    request<HelpDeskTicket>(`/api/helpdesk/tickets/${encodeURIComponent(id)}/lock`, { method: 'PUT', body: JSON.stringify({ locked }) }),
  getHelpDeskBranchSetup: (branchCode: string) =>
    request<HelpDeskBranchSetup>(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/setup`),
  getHelpDeskReport: (branchCode: string) =>
    branchCode === 'ALL'
      ? request<HelpDeskReport>('/api/helpdesk/report/all')
      : request<HelpDeskReport>(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/report`),
  getHelpDeskAdminAccesses: () =>
    request<{ users: Array<{ id: string; username: string; displayName: string; email: string | null; active: boolean }>; branches: Array<{ code: string; name: string; active: boolean }>; accesses: HelpDeskAdminAccess[] }>('/api/helpdesk/admin/accesses'),
  saveHelpDeskAccess: (input: HelpDeskAdminAccess) =>
    request<HelpDeskAdminAccess>('/api/helpdesk/admin/accesses', { method: 'PUT', body: JSON.stringify(input) }),
  updateHelpDeskBranchSettings: (branchCode: string, input: HelpDeskBranchSetup['setting']) =>
    request(`/api/helpdesk/admin/branch/${encodeURIComponent(branchCode)}/settings`, { method: 'PUT', body: JSON.stringify(input) }),
  createHelpDeskCategory: (branchCode: string, input: { name: string; description: string; active: boolean; sortOrder: number }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/categories`, { method: 'POST', body: JSON.stringify(input) }),
  updateHelpDeskCategory: (branchCode: string, id: string, input: { name: string; description: string; active: boolean; sortOrder: number }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteHelpDeskCategory: (branchCode: string, id: string) =>
    request<{ deactivated?: boolean; ticketCount?: number } | void>(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveHelpDeskCategoryAssignees: (branchCode: string, categoryId: string, userIds: string[]) =>
    request<Array<{ id: string; branchCode: string; categoryId: string; userId: string; userName: string }>>(
      `/api/helpdesk/branch/${encodeURIComponent(branchCode)}/categories/${encodeURIComponent(categoryId)}/assignees`,
      { method: 'PUT', body: JSON.stringify({ userIds }) },
    ),
  getHelpDeskGlobalSettings: () =>
    request<{ id: number; maxAttachments: number; maxAttachmentMb: number; allowedExtensions: string }>('/api/helpdesk/admin/global-settings'),
  updateHelpDeskGlobalSettings: (input: { maxAttachments: number; maxAttachmentMb: number; allowedExtensions: string }) =>
    request<{ id: number; maxAttachments: number; maxAttachmentMb: number; allowedExtensions: string }>(
      '/api/helpdesk/admin/global-settings', { method: 'PUT', body: JSON.stringify(input) },
    ),
  getHelpDeskManagerDashboard: () => request<HelpDeskManagerDashboard>('/api/helpdesk/manager-dashboard'),
  getHelpDeskMySummary: () => request<HelpDeskMySummary>('/api/helpdesk/my-summary'),
  getHelpDeskMyTickets: (filter: 'opened' | 'answered' | 'closed') =>
    request<HelpDeskTicket[]>(`/api/helpdesk/my-tickets?filter=${filter}`),
  createHelpDeskPriority: (branchCode: string, input: { name: string; color: string; level: number; active: boolean; firstResponseMinutes: number; resolutionMinutes: number }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/priorities`, { method: 'POST', body: JSON.stringify(input) }),
  updateHelpDeskPriority: (branchCode: string, id: string, input: { name: string; color: string; level: number; active: boolean; firstResponseMinutes: number; resolutionMinutes: number }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/priorities/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  createHelpDeskStatus: (branchCode: string, input: { code: string; name: string; color: string; closed: boolean; sortOrder: number; active: boolean }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/statuses`, { method: 'POST', body: JSON.stringify(input) }),
  updateHelpDeskStatusDefinition: (branchCode: string, id: string, input: { code: string; name: string; color: string; closed: boolean; sortOrder: number; active: boolean }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/statuses/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  createHelpDeskKnowledgeCategory: (branchCode: string, input: { name: string; description: string; active: boolean; sortOrder: number }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/knowledge-categories`, { method: 'POST', body: JSON.stringify(input) }),
  createHelpDeskArticle: (branchCode: string, input: { categoryId: string; title: string; body: string; active: boolean }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/articles`, { method: 'POST', body: JSON.stringify(input) }),
  createHelpDeskCannedReply: (branchCode: string, input: { title: string; body: string; active: boolean }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/canned-replies`, { method: 'POST', body: JSON.stringify(input) }),
  updateHelpDeskCannedReply: (branchCode: string, id: string, input: { title: string; body: string; active: boolean }) =>
    request(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/canned-replies/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteHelpDeskCannedReply: (branchCode: string, id: string) =>
    request<void>(`/api/helpdesk/branch/${encodeURIComponent(branchCode)}/canned-replies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadHelpDeskAttachments: async (ticketId: string, files: File[]) => {
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    const response = await fetch(`${API_BASE}/api/helpdesk/tickets/${encodeURIComponent(ticketId)}/attachments`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new ApiError(payload.error || 'Help Desk dosya eki yüklenemedi.', response.status);
    }
    return response.json();
  },
  deleteHelpDeskAttachment: (id: string) =>
    request<void>(`/api/helpdesk/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getHelpDeskAttachmentUrl: (id: string) => `${API_BASE}/api/helpdesk/attachments/${encodeURIComponent(id)}`,

};

export function bootstrapToState(payload: BootstrapPayload): AppState {
  const branding = payload.settings.branding ?? { companyName: '', companyLogoDataUrl: '', quickLinks: [] };
  return {
    tasks: payload.tasks,
    credentials: payload.credentials,
    trackingRecords: payload.trackingRecords,
    settings: {
      ...payload.settings,
      branding: {
        ...branding,
        quickLinks: Array.isArray(branding.quickLinks) ? branding.quickLinks : [],
      },
    },
    passwordHash: null,
  };
}
