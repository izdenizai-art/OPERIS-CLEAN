import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const prefix = 'operiscap_';
const count = Math.min(750, Math.max(1, Number(process.env.OPERIS_CAPACITY_USER_COUNT || 750)));
const password = String(process.env.OPERIS_CAPACITY_PASSWORD || '');
const action = String(process.env.OPERIS_CAPACITY_ACTION || 'seed').toLowerCase();

if (action !== 'cleanup' && password.length < 12) throw new Error('OPERIS_CAPACITY_PASSWORD must be at least 12 characters.');

const permissions = {
  tasks: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExcel: false },
  credentials: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExcel: false },
  tracking: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExcel: false },
  network: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExcel: false },
  canAccessSettings: false, canManageUsers: false, canManageBranches: false,
  canAssignUserBranches: false, canSendBranchAnnouncements: false, canAccessAssets: true,
  assets: {
    dashboardView: true, cardsView: true, cardsCreate: false, cardsEdit: false, cardsDelete: false,
    assignmentsView: true, assignmentsCreate: false, assignmentsReturn: false,
    transfersView: true, transfersCreate: false, transfersApprove: false,
    countsView: true, countsCreate: false, countsScan: false, countsReview: true,
    countsCorrect: false, countsComplete: false, countsApprove: false,
    locationsView: true, locationsManage: false, labelsView: true, labelsDesign: false,
    labelsPrint: false, documentsView: true, documentsPrint: false, reportsView: true,
    reportsExport: false, integrationsView: true, integrationsManage: false,
  },
};

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } });
  const ids = users.map(row => row.id);
  if (ids.length) {
    await prisma.$transaction([
      prisma.helpDeskAccess.deleteMany({ where: { userId: { in: ids } } }),
      prisma.userSession.deleteMany({ where: { userId: { in: ids } } }),
      prisma.userBranch.deleteMany({ where: { userId: { in: ids } } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }
  console.log(JSON.stringify({ result: 'PASS', action: 'cleanup', removedUsers: ids.length }));
}

async function seed() {
  await cleanup();
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.branch.upsert({
    where: { code: '100' },
    update: { active: true, isHeadOffice: true },
    create: { code: '100', name: 'Merkez Şube', active: true, isHeadOffice: true },
  });
  const rows = Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    username: prefix + String(index + 1).padStart(4, '0'),
    displayName: 'Capacity User ' + (index + 1),
    department: 'LOADTEST',
    title: 'Capacity Test',
    passwordHash,
    permissions,
    active: true,
    isAdmin: false,
    mustChangePassword: false,
    directorySource: '',
    directoryEnabled: true,
    directoryObjectGuid: '',
    directoryUserPrincipalName: '',
  }));
  for (let index = 0; index < rows.length; index += 100) {
    await prisma.user.createMany({ data: rows.slice(index, index + 100), skipDuplicates: true });
  }
  const users = await prisma.user.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } });
  for (let index = 0; index < users.length; index += 100) {
    const batch = users.slice(index, index + 100);
    await prisma.userBranch.createMany({
      data: batch.map(user => ({
        id: crypto.randomUUID(), userId: user.id, branchCode: '100', isPrimary: true,
        permissions, assignedById: 'capacity-test',
      })),
      skipDuplicates: true,
    });
    await prisma.helpDeskAccess.createMany({
      data: batch.map(user => ({
        id: crypto.randomUUID(), userId: user.id, branchCode: '100', active: true,
        canOpen: true, canStaff: true, canCoordinate: false, canRespond: true,
        canChangeStatus: true, canReopen: true, canViewAll: true, canAssign: false,
        canClose: true, canReport: true, canTopics: false, canCannedReplies: false,
        canKnowledge: true, mutedEmail: true, assignedById: 'capacity-test',
      })),
      skipDuplicates: true,
    });
  }
  console.log(JSON.stringify({ result: 'PASS', action: 'seed', users: users.length }));
}

try {
  if (action === 'cleanup') await cleanup();
  else await seed();
} finally {
  await prisma.$disconnect();
}
