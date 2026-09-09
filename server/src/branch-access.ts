import type { Request } from 'express';
import { prisma } from './db.js';
import { ADMIN_PERMISSIONS, normalizePermissions, type UserPermissions } from './permissions.js';
import { isLicenseOwner } from './license.js';

export type BranchInfo = {
  code: string;
  name: string;
  isHeadOffice: boolean;
  active: boolean;
  permissions: UserPermissions;
};

export type BranchContext = {
  branches: BranchInfo[];
  assignedBranchCodes: string[];
  accessibleBranchCodes: string[];
  primaryBranchCode: string;
  selectedBranchCode: string;
  canSeeAllBranches: boolean;
};

function readOnlyPermissions(source: UserPermissions): UserPermissions {
  return {
    tasks: { canView: source.tasks.canView, canCreate: false, canEdit: false, canDelete: false, canExcel: source.tasks.canExcel },
    credentials: { canView: source.credentials.canView, canCreate: false, canEdit: false, canDelete: false, canExcel: source.credentials.canExcel },
    tracking: { canView: source.tracking.canView, canCreate: false, canEdit: false, canDelete: false, canExcel: source.tracking.canExcel },
    network: { canView: source.network.canView, canCreate: false, canEdit: false, canDelete: false, canExcel: source.network.canExcel },
    canAccessSettings: false,
    canManageUsers: false,
    canManageBranches: false,
    canAssignUserBranches: false,
    canSendBranchAnnouncements: false,
    canAccessAssets: source.canAccessAssets,
    assets: {
      dashboardView: source.assets.dashboardView,
      cardsView: source.assets.cardsView,
      cardsCreate: false,
      cardsEdit: false,
      cardsDelete: false,
      assignmentsView: source.assets.assignmentsView,
      assignmentsCreate: false,
      assignmentsReturn: false,
      transfersView: source.assets.transfersView,
      transfersCreate: false,
      transfersApprove: false,
      countsView: source.assets.countsView,
      countsCreate: false,
      countsScan: false,
      countsReview: source.assets.countsReview,
      countsCorrect: false,
      countsComplete: false,
      countsApprove: false,
      locationsView: source.assets.locationsView,
      locationsManage: false,
      labelsView: source.assets.labelsView,
      labelsDesign: false,
      labelsPrint: false,
      documentsView: source.assets.documentsView,
      documentsPrint: false,
      reportsView: source.assets.reportsView,
      reportsExport: source.assets.reportsExport,
      integrationsView: source.assets.integrationsView,
      integrationsManage: false,
    },
  };
}


const BRANCH_HEADER = 'x-operis-branch-code';

export async function ensureBranchFoundation(): Promise<void> {
  await prisma.branch.upsert({
    where: { code: '100' },
    update: { name: 'Merkez Şube', isHeadOffice: true, active: true },
    create: { code: '100', name: 'Merkez Şube', isHeadOffice: true, active: true },
  });
  await prisma.branch.upsert({
    where: { code: '105' },
    update: { name: 'Bilgi İşlem Şubesi', active: true },
    create: { code: '105', name: 'Bilgi İşlem Şubesi', isHeadOffice: false, active: true },
  });

  await prisma.branch.upsert({
    where: { code: '110' },
    update: { name: 'Malzeme İkmal Şubesi', active: true },
    create: { code: '110', name: 'Malzeme İkmal Şubesi', isHeadOffice: false, active: true },
  });


  const assetBranchMigrationKey = 'v6.3.62-assets-to-110';
  const assetBranchMigration = await prisma.systemMigration.findUnique({
    where: { key: assetBranchMigrationKey },
  });

  if (!assetBranchMigration) {
    // v6.3.62 ilk şubesel geçiş:
    // mevcut Demirbaş modülü kayıtları 110 Malzeme İkmal Şubesi'ne bağlanır.
    // Bu işlem yalnız bir kez uygulanır; sonraki 100 Merkez kayıtları etkilenmez.
    await prisma.$transaction(async tx => {
      await tx.asset.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetParty.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetAssignment.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetMovement.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetCount.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetCountScan.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetQrToken.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetLabelTemplate.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });
      await tx.assetExternalConnection.updateMany({
        where: { branchCode: '100' },
        data: { branchCode: '110' },
      });

      await tx.systemMigration.create({
        data: {
          key: assetBranchMigrationKey,
          note: 'Mevcut Demirbaş modülü kayıtları 110 Malzeme İkmal Şubesi kapsamına taşındı.',
        },
      });
    });
  }

  const membershipPermissionMigrationKey = 'v6.3.62-userbranch-permissions-backfill';
  const membershipPermissionMigration = await prisma.systemMigration.findUnique({
    where: { key: membershipPermissionMigrationKey },
  });

  if (!membershipPermissionMigration) {
    const currentUsers = await prisma.user.findMany({
      include: { branchMemberships: true },
    });
    for (const user of currentUsers) {
      const basePermissions = user.isAdmin ? ADMIN_PERMISSIONS : normalizePermissions(user.permissions);
      for (const membership of user.branchMemberships) {
        const raw = membership.permissions as unknown;
        const normalized = normalizePermissions(raw);
        const hasAnyPermission =
          normalized.tasks.canView ||
          normalized.credentials.canView ||
          normalized.tracking.canView ||
          normalized.network.canView ||
          normalized.canAccessAssets ||
          normalized.canAccessSettings ||
          normalized.canManageUsers ||
          normalized.canManageBranches ||
          normalized.canAssignUserBranches;

        if (!hasAnyPermission) {
          await prisma.userBranch.update({
            where: { id: membership.id },
            data: { permissions: basePermissions },
          });
        }
      }
    }
    await prisma.systemMigration.create({
      data: {
        key: membershipPermissionMigrationKey,
        note: 'Mevcut kullanıcı-şube üyeliklerine kullanıcıların mevcut yetkileri kopyalandı.',
      },
    });
  }

  const users = await prisma.user.findMany({
    include: { branchMemberships: true },
  });

  for (const user of users) {
    const normalized = user.username.trim().toLocaleLowerCase('tr-TR');

    if (isLicenseOwner(user.username)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isAdmin: true, permissions: ADMIN_PERMISSIONS },
      });
      await prisma.userBranch.upsert({
        where: { userId_branchCode: { userId: user.id, branchCode: '100' } },
        update: { isPrimary: true, permissions: ADMIN_PERMISSIONS },
        create: {
          userId: user.id,
          branchCode: '100',
          isPrimary: true,
          permissions: ADMIN_PERMISSIONS,
          assignedById: user.id,
        },
      });
      continue;
    }

    if (normalized.startsWith('test') && user.branchMemberships.length === 0) {
      // İlk şubesel geçişte Test kullanıcısının mevcut Operis yetkileri korunur ve 105'e atanır.
      await prisma.userBranch.create({
        data: {
          userId: user.id,
          branchCode: '105',
          isPrimary: true,
          permissions: normalizePermissions(user.permissions),
          assignedById: '',
        },
      });
      continue;
    }

    if (normalized.startsWith('ikmal') && user.branchMemberships.length === 0) {
      // İlk şubesel geçişte İkmal kullanıcısının mevcut yetkileri korunur ve 110'a atanır.
      await prisma.userBranch.create({
        data: {
          userId: user.id,
          branchCode: '110',
          isPrimary: true,
          permissions: normalizePermissions(user.permissions),
          assignedById: '',
        },
      });
      continue;
    }

    if (user.branchMemberships.length === 0) {
      await prisma.userBranch.create({
        data: {
          userId: user.id,
          branchCode: '100',
          isPrimary: true,
          permissions: normalizePermissions(user.permissions),
          assignedById: '',
        },
      });
    }
  }
}

export async function getBranchContextForUser(userId: string, requestedBranchCode = ''): Promise<BranchContext> {
  // Self-heal legacy/upgraded databases before any UI consumes branch context.
  // This keeps Dashboard, Assets, user assignment and Network selectors from
  // receiving an empty branch list when memberships were never backfilled.
  await ensureBranchFoundation();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Kullanıcı bulunamadı.');

  const memberships = await prisma.userBranch.findMany({
    where: { userId },
    include: { branch: true },
    orderBy: [{ isPrimary: 'desc' }, { branchCode: 'asc' }],
  });

  const activeMemberships = memberships.filter(item => item.branch.active);
  const assignedBranchCodes = activeMemberships.map(item => item.branchCode);
  const canSeeAllBranches = user.isAdmin;

  const allActiveBranches = await prisma.branch.findMany({
    where: { active: true },
    orderBy: { code: 'asc' },
  });

  const membershipByCode = new Map(activeMemberships.map(item => [item.branchCode, item]));
  const fallbackPermissions = user.isAdmin ? ADMIN_PERMISSIONS : normalizePermissions(user.permissions);

  const accessibleBranches = canSeeAllBranches
    ? allActiveBranches
    : allActiveBranches.filter(branch => assignedBranchCodes.includes(branch.code));

  const accessibleBranchCodes = accessibleBranches.map(branch => branch.code);
  const primaryBranchCode =
    activeMemberships.find(item => item.isPrimary)?.branchCode
    ?? activeMemberships[0]?.branchCode
    ?? '100';

  const normalizedRequested = requestedBranchCode.trim().toUpperCase();
  const selectedBranchCode =
    normalizedRequested === 'ALL'
      ? 'ALL'
      : accessibleBranchCodes.includes(normalizedRequested)
        ? normalizedRequested
        : accessibleBranchCodes.length > 1
          ? 'ALL'
          : accessibleBranchCodes[0] ?? primaryBranchCode;

  return {
    branches: accessibleBranches.map(branch => {
      const membership = membershipByCode.get(branch.code);
      return {
        code: branch.code,
        name: branch.name,
        isHeadOffice: branch.isHeadOffice,
        active: branch.active,
        permissions: user.isAdmin
          ? ADMIN_PERMISSIONS
          : membership
            ? normalizePermissions(membership.permissions)
            : readOnlyPermissions(
                normalizePermissions(
                  membershipByCode.get('100')?.permissions ?? fallbackPermissions,
                ),
              ),
      };
    }),
    assignedBranchCodes,
    accessibleBranchCodes,
    primaryBranchCode,
    selectedBranchCode,
    canSeeAllBranches,
  };
}

export async function getBranchPermissionsForUser(userId: string, branchCode: string): Promise<UserPermissions> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Kullanıcı bulunamadı.');
  if (user.isAdmin) return ADMIN_PERMISSIONS;

  const membership = await prisma.userBranch.findUnique({
    where: { userId_branchCode: { userId, branchCode } },
  });
  if (!membership) {
    const error = new Error('Bu şubeye erişim yetkiniz yok.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
  return normalizePermissions(membership.permissions);
}

export async function assertBranchPermission(
  req: Request,
  branchCode: string,
  selector: (permissions: UserPermissions) => boolean,
  errorMessage = 'Bu şubede bu işlem için yetkiniz yok.',
): Promise<UserPermissions> {
  const authUser = (req as Request & { authUser?: { id: string } }).authUser;
  if (!authUser) throw new Error('Oturum kullanıcısı bulunamadı.');
  await assertBranchAccess(req, branchCode);
  const permissions = await getBranchPermissionsForUser(authUser.id, branchCode);
  if (!selector(permissions)) {
    const error = new Error(errorMessage) as Error & { status?: number };
    error.status = 403;
    throw error;
  }
  return permissions;
}

export async function readAccessibleBranchCodesForPermission(
  req: Request,
  selector: (permissions: UserPermissions) => boolean,
): Promise<string[]> {
  const context = await branchContextFromRequest(req);
  return context.accessibleBranchCodes.filter(code => {
    const branch = context.branches.find(item => item.code === code);
    return Boolean(branch && selector(branch.permissions));
  });
}

export async function readBranchCodesForPermission(
  req: Request,
  selector: (permissions: UserPermissions) => boolean,
): Promise<string[]> {
  const context = await branchContextFromRequest(req);
  const candidateCodes = context.selectedBranchCode === 'ALL'
    ? context.accessibleBranchCodes
    : [context.selectedBranchCode];

  return candidateCodes.filter(code => {
    const branch = context.branches.find(item => item.code === code);
    return Boolean(branch && selector(branch.permissions));
  });
}


export async function branchContextFromRequest(req: Request): Promise<BranchContext> {
  const authUser = (req as Request & { authUser?: { id: string } }).authUser;
  if (!authUser) throw new Error('Oturum kullanıcısı bulunamadı.');
  const requested = String(req.headers[BRANCH_HEADER] ?? '');
  return getBranchContextForUser(authUser.id, requested);
}

export async function readBranchCodes(req: Request): Promise<string[]> {
  const context = await branchContextFromRequest(req);
  if (context.selectedBranchCode !== 'ALL') return [context.selectedBranchCode];
  return context.accessibleBranchCodes;
}

export async function writeBranchCode(req: Request): Promise<string> {
  const context = await branchContextFromRequest(req);
  if (context.selectedBranchCode !== 'ALL') return context.selectedBranchCode;
  return context.primaryBranchCode;
}

export async function assertBranchAccess(req: Request, branchCode: string): Promise<void> {
  const context = await branchContextFromRequest(req);
  if (!context.accessibleBranchCodes.includes(branchCode)) {
    const error = new Error('Bu şubeye erişim yetkiniz yok.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

export function isValidBranchCode(value: string): boolean {
  return /^\d{3}$/.test(value);
}


export async function isHeadOfficeAuthorizedUser(userId: string): Promise<boolean> {
  const membership = await prisma.userBranch.findUnique({
    where: { userId_branchCode: { userId, branchCode: '100' } },
    include: { branch: true },
  });
  return Boolean(membership?.branch.active && membership.branch.isHeadOffice);
}
