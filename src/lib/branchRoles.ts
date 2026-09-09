import type { BranchHelpDeskPermissions, BranchRole, UserPermissions } from '@/lib/types';

const FULL_SECTION = { canView: true, canCreate: true, canEdit: true, canDelete: true, canExcel: true };

const FULL_ASSET_PERMISSIONS: UserPermissions['assets'] = {
  dashboardView: true,
  cardsView: true,
  cardsCreate: true,
  cardsEdit: true,
  cardsDelete: true,
  assignmentsView: true,
  assignmentsCreate: true,
  assignmentsReturn: true,
  transfersView: true,
  transfersCreate: true,
  transfersApprove: true,
  countsView: true,
  countsCreate: true,
  countsScan: true,
  countsReview: true,
  countsCorrect: true,
  countsComplete: true,
  countsApprove: true,
  locationsView: true,
  locationsManage: true,
  labelsView: true,
  labelsDesign: true,
  labelsPrint: true,
  documentsView: true,
  documentsPrint: true,
  reportsView: true,
  reportsExport: true,
  integrationsView: true,
  integrationsManage: true,
};

export const BRANCH_MANAGER_PERMISSIONS: UserPermissions = {
  tasks: { ...FULL_SECTION },
  credentials: { ...FULL_SECTION },
  tracking: { ...FULL_SECTION },
  network: { ...FULL_SECTION },
  canAccessSettings: false,
  canManageUsers: false,
  canManageBranches: false,
  canAssignUserBranches: false,
  canSendBranchAnnouncements: true,
  canAccessAssets: true,
  assets: { ...FULL_ASSET_PERMISSIONS },
};

export const BRANCH_MANAGER_HELPDESK: BranchHelpDeskPermissions = {
  canOpen: true,
  canCoordinate: true,
  canRespond: true,
  canChangeStatus: true,
  canReopen: true,
  canViewAll: true,
  canAssign: true,
  canClose: true,
  canReport: true,
  canTopics: true,
  canCannedReplies: true,
  canKnowledge: true,
};

export const EMPTY_BRANCH_HELPDESK: BranchHelpDeskPermissions = {
  canOpen: false,
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
};

export const cloneUserPermissions = (value: UserPermissions): UserPermissions =>
  JSON.parse(JSON.stringify(value)) as UserPermissions;

export const cloneBranchHelpDesk = (value: BranchHelpDeskPermissions): BranchHelpDeskPermissions =>
  ({ ...value });

export const branchRoleLabel = (role: BranchRole) =>
  role === 'BRANCH_MANAGER' ? 'Şube Yetkilisi' : 'Standart Kullanıcı';
