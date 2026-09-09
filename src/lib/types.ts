export type Priority = 'dusuk' | 'orta' | 'yuksek';

export interface Task {
  branchCode?: string;
  id: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  priority: Priority;
  completed: boolean;
  createdAt: number;
  deletedAt?: number | null;
  deletedById?: string;
  deletedByName?: string;
}

export interface TrackingRecord {
  branchCode?: string;
  id: string;
  groupName: string;
  serviceDate: string;
  serviceNumber: string;
  serviceLocation: string;
  description: string;
  replacedPart1: string;
  replacedPart2: string;
  replacedPart3: string;
  note: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  deletedById?: string;
  deletedByName?: string;
}

export interface Credential {
  branchCode?: string;
  id: string;
  groupName: string;
  username: string;
  password: string;
  ip: string;
  description: string;
  lastChanged: number;
  createdAt: number;
  deletedAt?: number | null;
  deletedById?: string;
  deletedByName?: string;
}



export interface BranchInfo {
  code: string;
  name: string;
  isHeadOffice: boolean;
  active: boolean;
  permissions: UserPermissions;
}

export interface BranchContext {
  branches: BranchInfo[];
  assignedBranchCodes: string[];
  accessibleBranchCodes: string[];
  primaryBranchCode: string;
  selectedBranchCode: string;
  canSeeAllBranches: boolean;
}

export interface BranchAdminItem extends BranchInfo {
  userCount: number;
  createdAt: number;
  updatedAt: number;
}

export type BranchRole = 'USER' | 'BRANCH_MANAGER';

export interface BranchHelpDeskPermissions {
  canOpen: boolean;
  canCoordinate: boolean;
  canRespond: boolean;
  canChangeStatus: boolean;
  canReopen: boolean;
  canViewAll: boolean;
  canAssign: boolean;
  canClose: boolean;
  canReport: boolean;
  canTopics: boolean;
  canCannedReplies: boolean;
  canKnowledge: boolean;
}

export interface UserBranchAssignment {
  branchCode: string;
  branchName: string;
  isPrimary: boolean;
  role: BranchRole;
  permissions: UserPermissions;
  helpDesk: BranchHelpDeskPermissions;
  assignedAt: number;
}

export interface SectionPermissions {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExcel: boolean;
}

export interface AssetPermissions {
  dashboardView: boolean;
  cardsView: boolean;
  cardsCreate: boolean;
  cardsEdit: boolean;
  cardsDelete: boolean;
  assignmentsView: boolean;
  assignmentsCreate: boolean;
  assignmentsReturn: boolean;
  transfersView: boolean;
  transfersCreate: boolean;
  transfersApprove: boolean;
  countsView: boolean;
  countsCreate: boolean;
  countsScan: boolean;
  countsReview: boolean;
  countsCorrect: boolean;
  countsComplete: boolean;
  countsApprove: boolean;
  locationsView: boolean;
  locationsManage: boolean;
  labelsView: boolean;
  labelsDesign: boolean;
  labelsPrint: boolean;
  documentsView: boolean;
  documentsPrint: boolean;
  reportsView: boolean;
  reportsExport: boolean;
  integrationsView: boolean;
  integrationsManage: boolean;
}

export interface UserPermissions {
  tasks: SectionPermissions;
  credentials: SectionPermissions;
  tracking: SectionPermissions;
  network: SectionPermissions;
  canAccessSettings: boolean;
  canManageUsers: boolean;
  canManageBranches: boolean;
  canAssignUserBranches: boolean;
  canSendBranchAnnouncements: boolean;
  canAccessAssets: boolean;
  assets: AssetPermissions;
}



export type NetworkTopologyNodeKind =
  | 'DEVICE' | 'ROUTER' | 'SWITCH' | 'SERVER' | 'FIREWALL'
  | 'INTERNET' | 'LOCATION' | 'NOTE' | 'CLOUD' | 'AP' | 'PRINTER';

export interface NetworkTopologyNode {
  id: string;
  kind: NetworkTopologyNodeKind;
  monitorId?: string | null;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NetworkTopologyLink {
  id: string;
  from: string;
  to: string;
  label: string;
  style: 'SOLID' | 'DASHED';
}

export interface NetworkTopologyLayout {
  nodes: NetworkTopologyNode[];
  links: NetworkTopologyLink[];
  settings: {
    width: number;
    height: number;
    grid: boolean;
    snap: boolean;
    zoom: number;
  };
}

export interface NetworkTopologyWorkspaceSummary {
  id: string;
  branchCode: string;
  name: string;
  description: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
}

export interface NetworkTopologyWorkspace extends NetworkTopologyWorkspaceSummary {
  layout: NetworkTopologyLayout;
}

export interface NetworkMonitor {
  branchCode: string;
  id: string;
  name: string;
  host: string;
  description: string;
  deviceType: 'UNKNOWN' | 'ROUTER' | 'SWITCH' | 'SERVER' | 'COMPUTER' | 'PRINTER' | 'ACCESS_POINT' | 'FIREWALL' | 'OTHER';
  vendor: string;
  location: string;
  operatingSystem: 'UNKNOWN' | 'WINDOWS' | 'LINUX' | 'NETWORK' | 'OTHER';
  snmpEnabled: boolean;
  snmpVersion: '2c' | '3';
  snmpPort: number;
  snmpCommunitySet: boolean;
  snmpUsername: string;
  snmpAuthProtocol: 'SHA' | 'MD5';
  snmpAuthKeySet: boolean;
  snmpPrivProtocol: 'AES' | 'DES';
  snmpPrivKeySet: boolean;
  intervalSeconds: number;
  failureThreshold: number;
  timeoutMs: number;
  emailTo: string;
  downSubject: string;
  downBody: string;
  upSubject: string;
  upBody: string;
  active: boolean;
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE';
  consecutiveFailures: number;
  lastLatencyMs: number | null;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastNotifiedStatus: string;
  positionX: number;
  positionY: number;
  createdById: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  services?: NetworkService[];
}

export interface NetworkService {
  branchCode: string;
  id: string;
  monitorId: string;
  name: string;
  protocol: 'TCP' | 'HTTP' | 'HTTPS' | 'SSH' | 'FTP' | 'DNS' | 'SMTP';
  port: number;
  path: string;
  expectedStatus: number | null;
  timeoutMs: number;
  active: boolean;
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE';
  consecutiveFailures: number;
  lastLatencyMs: number | null;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NetworkMonitorEvent {
  branchCode: string;
  id: string;
  monitorId: string;
  status: string;
  success: boolean;
  latencyMs: number | null;
  message: string;
  createdAt: number;
}

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  department: string;
  title: string;
  directoryGroups: string[];
  directoryUserPrincipalName: string;
  theme: ThemeMode;
  permissions: UserPermissions;
  active: boolean;
  mustChangePassword: boolean;
  directorySource: string;
  directoryEnabled: boolean;
  directoryLastChangeAt?: number | null;
  directoryLastChanges?: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }>;
  directoryChangeUnread?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionUser extends AppUser {
  isAdmin: boolean;
}

export type ThemeMode = 'dark' | 'light' | 'spring' | 'gray' | 'black' | 'ocean-blue' | 'pastel-glass' | 'corporate-2d';


export type NoteColor = 'yellow' | 'red' | 'orange' | 'darkGreen' | 'turquoise';

export interface UserNote {
  branchCode?: string;
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  createdAt: number;
  updatedAt: number;
}


export interface Announcement {
  branchCode?: string;
  id: string;
  receiptId: string;
  senderId: string;
  senderName: string;
  senderDepartment: string;
  title: string;
  body: string;
  priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  audienceType: 'TEAM' | 'ALL' | 'DEPARTMENT' | 'USERS';
  audienceValue: string;
  seenAt: number | null;
  dismissedAt: number | null;
  dontShowAgainAt: number | null;
  createdAt: number;
  startsAt: number;
  endsAt: number | null;
}


export interface AnnouncementMailboxItem extends Announcement {
  direction: 'inbox' | 'sent';
  recipientCount: number;
  readCount: number;
}

export interface AppMessage {
  branchCode?: string;
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  direction: 'inbox' | 'sent';
  subject: string;
  body: string;
  readAt: number | null;
  createdAt: number;
}


export interface RecordLock {
  id: string;
  module: 'TASKS' | 'TRACKING' | 'CREDENTIALS';
  recordId: string;
  userId: string;
  username: string;
  displayName: string;
  acquiredAt: number;
  expiresAt: number;
  ownedByCurrentUser: boolean;
}

export interface AuditLog {
  branchCode?: string;
  id: string;
  userId: string;
  username: string;
  displayName: string;
  action: string;
  module: string;
  recordId: string;
  recordLabel: string;
  description: string;
  oldData: string;
  newData: string;
  ipAddress: string;
  userAgent: string;
  createdAt: number;
}

export interface MailSettings {
  mailProvider: 'smtp' | 'graph';
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPasswordSet: boolean;
  smtpFrom: string;
  graphEnabled: boolean;
  graphTenantId: string;
  graphClientId: string;
  graphClientSecretSet: boolean;
  graphSenderUser: string;
  reminderEmailEnabled: boolean;
  reminderLeadMinutes: number;
}

export interface BrandingQuickLink {
  id: string;
  label: string;
  url: string;
  active: boolean;
}

export interface BrandingSettings {
  companyName: string;
  companyLogoDataUrl: string;
  quickLinks: BrandingQuickLink[];
}

export interface BackupSettings {
  networkBackupEnabled: boolean;
  networkBackupPath: string;
  backupScheduleEnabled: boolean;
  backupScheduleType: 'daily' | 'weekly' | 'hourly';
  backupScheduleTime: string;
  backupScheduleDay: number;
  backupRetentionDays: number;
}

export interface Settings {
  notifyMinutesBefore: number;
  shakeEnabled: boolean;
  soundEnabled: boolean;
  theme: ThemeMode;
  mail: MailSettings;
  branding: BrandingSettings;
  backup: BackupSettings;
}

export interface AppState {
  tasks: Task[];
  credentials: Credential[];
  trackingRecords: TrackingRecord[];
  settings: Settings;
  passwordHash: string | null;
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  dusuk: 'Düşük',
  orta: 'Orta',
  yuksek: 'Yüksek',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  dusuk: '#10b981',
  orta: '#f59e0b',
  yuksek: '#ef4444',
};


export interface HelpDeskBranchAccess {
  active: boolean;
  canOpen: boolean;
  canStaff: boolean;
  canCoordinate: boolean;
  canRespond: boolean;
  canChangeStatus: boolean;
  canReopen: boolean;
  canViewAll: boolean;
  canAssign: boolean;
  canClose: boolean;
  canReport: boolean;
  canTopics: boolean;
  canCannedReplies: boolean;
  canKnowledge: boolean;
  mutedEmail: boolean;
}

export interface HelpDeskBranchContextItem {
  branchCode: string;
  branchName: string;
  title: string;
  welcomeText: string;
  knowledgeEnabled: boolean;
  showRecentTickets: boolean;
  access: HelpDeskBranchAccess | null;
}

export interface HelpDeskContext {
  branches: HelpDeskBranchContextItem[];
  users: Array<{ id: string; username: string; displayName: string; email: string | null }>;
  canCentralManage: boolean;
}

export interface HelpDeskCategory {
  id: string; branchCode: string; name: string; description: string; active: boolean; sortOrder: number;
}
export interface HelpDeskPriority {
  id: string; branchCode: string; name: string; color: string; level: number; active: boolean;
  firstResponseMinutes: number; resolutionMinutes: number;
}
export interface HelpDeskStatus {
  id: string; branchCode: string; code: string; name: string; color: string; closed: boolean; sortOrder: number; active: boolean;
}
export interface HelpDeskReply {
  id: string; ticketId: string; branchCode: string; authorId: string; authorName: string;
  body: string; isStaff: boolean; internalNote: boolean; createdAt: number;
}
export interface HelpDeskAttachment {
  id: string; ticketId: string; replyId?: string | null; originalName: string; storedName: string;
  mimeType: string; sizeBytes: number; createdAt: number;
}
export interface HelpDeskTicket {
  id: string; branchCode: string; ticketNo: string; trackingId: string; subject: string; body: string;
  requesterId: string; requesterName: string; requesterEmail: string; ccEmails: string; requesterIp: string; requesterMac: string; categoryId: string; priorityId: string; statusId: string;
  assignedUserId?: string | null; assignedUserName: string; locked: boolean; lockedAt: number | null; lockedById: string; lockedByName: string;
  firstReplyAt: number | null; resolvedAt: number | null; closedAt: number | null; dueResponseAt: number | null; dueResolutionAt: number | null;
  lastActivityAt: number; createdAt: number; updatedAt: number; isUnprocessed?: boolean;
  branch?: { code: string; name: string };
  requesterDirectoryGroups?: string[];
  requesterBranches?: Array<{ code: string; name: string; isPrimary: boolean }>;
  requesterPrimaryBranch?: { code: string; name: string; isPrimary: boolean } | null;
  category?: HelpDeskCategory | null; priority?: HelpDeskPriority | null; status?: HelpDeskStatus | null;
  replies?: HelpDeskReply[]; attachments?: HelpDeskAttachment[];
  activities?: Array<{ id: string; action: string; description: string; actorName: string; createdAt: number }>;
}
export interface HelpDeskKnowledgeCategory {
  id: string; branchCode: string; name: string; description: string; active: boolean; sortOrder: number;
}
export interface HelpDeskKnowledgeArticle {
  id: string; branchCode: string; categoryId: string; title: string; body: string; active: boolean;
  createdById: string; createdByName: string; createdAt: number; updatedAt: number;
}
export interface HelpDeskCannedReply {
  id: string; branchCode: string; title: string; body: string; active: boolean;
}
export interface HelpDeskBranchSetup {
  setting: {
    branchCode: string; enabled: boolean; title: string; welcomeText: string; emailSubjectPrefix: string;
    allowAttachments: boolean; maxAttachmentMb: number; knowledgeEnabled: boolean; showRecentTickets: boolean;
  };
  categories: HelpDeskCategory[]; priorities: HelpDeskPriority[]; statuses: HelpDeskStatus[];
  knowledgeCategories: HelpDeskKnowledgeCategory[]; articles: HelpDeskKnowledgeArticle[];
  cannedReplies: HelpDeskCannedReply[];
  staff: Array<{ userId: string; displayName: string; username: string; email: string | null }>;
  categoryAssignees: Array<{ id: string; branchCode: string; categoryId: string; userId: string; userName: string }>;
  globalSetting: { id: number; maxAttachments: number; maxAttachmentMb: number; allowedExtensions: string; };
}
export interface HelpDeskReport {
  total: number; open: number; closed: number; slaResponseBreached: number; slaResolutionBreached: number; avgResolutionMinutes: number;
  byCategory: Array<{ name: string; count: number }>; byPriority: Array<{ name: string; count: number }>;
  byStatus: Array<{ name: string; count: number }>; byAssignee: Array<{ name: string; count: number }>;
}
export interface HelpDeskAdminAccess {
  id?: string; userId: string; branchCode: string; active: boolean; canOpen: boolean; canStaff: boolean;
  canCoordinate: boolean; canRespond: boolean; canChangeStatus: boolean; canReopen: boolean; canViewAll: boolean;
  canAssign: boolean; canClose: boolean; canReport: boolean; canTopics: boolean; canCannedReplies: boolean; canKnowledge: boolean; mutedEmail: boolean;
}

export interface DomainSyncSettings {
  enabled: boolean;
  controller: string;
  useLdaps: boolean;
  port: number;
  baseDn: string;
  username: string;
  passwordSet: boolean;
  intervalMinutes: number;
  lastSyncAt: number | null;
  lastSyncResult: string;
}
export interface DomainSyncResult {
  total: number; created: number; updated: number; disabled: number; helpDeskBranchCode: string;
}
export interface HelpDeskMySummary { opened: number; answered: number; closed: number; }
export interface HelpDeskManagerResponderSummary {
  userId: string; displayName: string; assigned: number; open: number; closed: number;
}
export interface HelpDeskManagerBranchSummary {
  branchCode: string; branchName: string; scope: 'branch' | 'assigned';
  total: number; open: number; closed: number; new: number; inProgress: number; unassigned: number;
  responders: HelpDeskManagerResponderSummary[];
}
export interface HelpDeskManagerDashboard {
  branches: HelpDeskManagerBranchSummary[];
  totals: { total: number; open: number; closed: number; new: number; inProgress: number; unassigned: number };
}
