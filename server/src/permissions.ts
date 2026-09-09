import type { Prisma } from '@prisma/client';

export type SectionPermissions = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExcel: boolean;
};

export type AssetPermissions = {
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
};

export type UserPermissions = {
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
};

export const FULL_SECTION: SectionPermissions = {
  canView: true, canCreate: true, canEdit: true, canDelete: true, canExcel: true,
};

export const ADMIN_PERMISSIONS: UserPermissions = {
  tasks: { ...FULL_SECTION },
  credentials: { ...FULL_SECTION },
  tracking: { ...FULL_SECTION },
  network: { ...FULL_SECTION },
  canAccessSettings: true,
  canManageUsers: true,
  canManageBranches: true,
  canAssignUserBranches: true,
  canSendBranchAnnouncements: true,
  canAccessAssets: true,
  assets: {
  dashboardView: true, cardsView: true, cardsCreate: true, cardsEdit: true, cardsDelete: true,
  assignmentsView: true, assignmentsCreate: true, assignmentsReturn: true,
  transfersView: true, transfersCreate: true, transfersApprove: true,
  countsView: true, countsCreate: true, countsScan: true, countsReview: true, countsCorrect: true, countsComplete: true, countsApprove: true,
  locationsView: true, locationsManage: true,
  labelsView: true, labelsDesign: true, labelsPrint: true,
  documentsView: true, documentsPrint: true,
  reportsView: true, reportsExport: true,
  integrationsView: true, integrationsManage: true,
},
};

export const DEFAULT_PERMISSIONS: UserPermissions = {
  tasks: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExcel: false },
  credentials: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExcel: false },
  tracking: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExcel: false },
  network: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExcel: false },
  canAccessSettings: false,
  canManageUsers: false,
  canManageBranches: false,
  canAssignUserBranches: false,
  canSendBranchAnnouncements: false,
  canAccessAssets: false,
  assets: {
  dashboardView: false, cardsView: false, cardsCreate: false, cardsEdit: false, cardsDelete: false,
  assignmentsView: false, assignmentsCreate: false, assignmentsReturn: false,
  transfersView: false, transfersCreate: false, transfersApprove: false,
  countsView: false, countsCreate: false, countsScan: false, countsReview: false, countsCorrect: false, countsComplete: false, countsApprove: false,
  locationsView: false, locationsManage: false,
  labelsView: false, labelsDesign: false, labelsPrint: false,
  documentsView: false, documentsPrint: false,
  reportsView: false, reportsExport: false,
  integrationsView: false, integrationsManage: false,
},
};

export function normalizePermissions(value: unknown): UserPermissions {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const normalizeSection = (v: unknown): SectionPermissions => {
    const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return {
      canView: Boolean(s.canView),
      canCreate: Boolean(s.canCreate),
      canEdit: Boolean(s.canEdit),
      canDelete: Boolean(s.canDelete),
      canExcel: Boolean(s.canExcel),
    };
  };
  return {
    tasks: normalizeSection(source.tasks),
    credentials: normalizeSection(source.credentials),
    tracking: normalizeSection(source.tracking),
    network: normalizeSection(source.network),
    canAccessSettings: Boolean(source.canAccessSettings),
    canManageUsers: Boolean(source.canManageUsers),
    canManageBranches: Boolean(source.canManageBranches),
    canAssignUserBranches: Boolean(source.canAssignUserBranches),
    canSendBranchAnnouncements: Boolean(source.canSendBranchAnnouncements),
    canAccessAssets: Boolean(source.canAccessAssets),
    assets: {
      ...{
  dashboardView: false, cardsView: false, cardsCreate: false, cardsEdit: false, cardsDelete: false,
  assignmentsView: false, assignmentsCreate: false, assignmentsReturn: false,
  transfersView: false, transfersCreate: false, transfersApprove: false,
  countsView: false, countsCreate: false, countsScan: false, countsReview: false, countsCorrect: false, countsComplete: false, countsApprove: false,
  locationsView: false, locationsManage: false,
  labelsView: false, labelsDesign: false, labelsPrint: false,
  documentsView: false, documentsPrint: false,
  reportsView: false, reportsExport: false,
  integrationsView: false, integrationsManage: false,
},
      ...((source.assets && typeof source.assets === 'object') ? source.assets as Partial<AssetPermissions> : {}),
    },
  };
}

export type BranchRole = 'USER' | 'BRANCH_MANAGER';

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
  assets: { ...ADMIN_PERMISSIONS.assets },
};

export function readBranchRole(value: unknown): BranchRole {
  const source=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
  return source.__branchRole==='BRANCH_MANAGER' ? 'BRANCH_MANAGER' : 'USER';
}

export function serializeBranchPermissions(value: unknown, role: BranchRole): Prisma.InputJsonValue {
  const payload = { ...normalizePermissions(value), __branchRole: role };
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

