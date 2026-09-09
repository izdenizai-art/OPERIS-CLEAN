import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './db.js';
import { requireAuth, requirePermission, type AuthRequest } from './auth.js';
import { getBranchContextForUser, getBranchPermissionsForUser, isHeadOfficeAuthorizedUser, isValidBranchCode } from './branch-access.js';
import { normalizePermissions, readBranchRole, serializeBranchPermissions, type BranchRole } from './permissions.js';
import { isLicenseOwner } from './license.js';
import { ensureHelpDeskBranchFoundation, inspectHelpDeskBranchUserData, removeHelpDeskBranchFoundation, syncHelpDeskBranchIdentity } from './helpdesk.js';

export const branchRouter = Router();

const headOfficeOnly = async (req: AuthRequest, res: any, next: any) => {
  if (!req.authUser) {
    res.status(403).json({ error: 'Şube yönetimi yalnızca yetkili kullanıcılar tarafından yapılabilir.' });
    return;
  }
  if (req.authUser.isAdmin || await isHeadOfficeAuthorizedUser(req.authUser.id)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Şube yönetimi yalnızca 100 Merkez Şube yetkili kullanıcıları tarafından yapılabilir.' });
};

const centerPermission = (
  selector: (permissions: ReturnType<typeof normalizePermissions>) => boolean,
  errorMessage: string,
) => async (req: AuthRequest, res: any, next: any) => {
  if (!req.authUser) {
    res.status(403).json({ error: errorMessage });
    return;
  }
  if (req.authUser.isAdmin) {
    next();
    return;
  }
  try {
    const permissions = await getBranchPermissionsForUser(req.authUser.id, '100');
    if (!selector(permissions)) {
      res.status(403).json({ error: errorMessage });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: errorMessage });
  }
};

const viewBranchAdministration = centerPermission(
  permissions => permissions.canManageBranches || permissions.canAssignUserBranches,
  'Şube yönetimi görüntüleme yetkiniz yok.',
);
const manageBranchDefinitions = centerPermission(
  permissions => permissions.canManageBranches,
  'Şube oluşturma / düzenleme / silme yetkiniz yok.',
);
const assignUserBranches = centerPermission(
  permissions => permissions.canAssignUserBranches,
  'Kullanıcıyı şubeye atama yetkiniz yok.',
);

const adminOnly = (req: AuthRequest, res: any, next: any) => {
  if (req.authUser?.isAdmin) {
    next();
    return;
  }
  res.status(403).json({ error: 'Şube, kullanıcı atama ve yetki yönetimi yalnızca OPERİS admin kullanıcıları tarafından yapılabilir.' });
};

const branchSchema = z.object({
  code: z.string().regex(/^\d{3}$/, 'Şube kodu tam 3 haneli sayı olmalıdır.'),
  name: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
});

branchRouter.get('/context', requireAuth, async (req: AuthRequest, res) => {
  const requested = String(req.headers['x-operis-branch-code'] ?? '');
  res.json(await getBranchContextForUser(req.authUser!.id, requested));
});

branchRouter.get('/', requireAuth, adminOnly, async (_req, res) => {
  const branches = await prisma.branch.findMany({
    orderBy: { code: 'asc' },
    include: { _count: { select: { memberships: true } } },
  });
  res.json(branches.map(branch => ({
    code: branch.code,
    name: branch.name,
    isHeadOffice: branch.isHeadOffice,
    active: branch.active,
    userCount: branch._count.memberships,
    createdAt: branch.createdAt.getTime(),
    updatedAt: branch.updatedAt.getTime(),
  })));
});

branchRouter.post('/', requireAuth, adminOnly, async (req: AuthRequest, res) => {
  const data = branchSchema.parse(req.body);
  if (!isValidBranchCode(data.code)) {
    res.status(400).json({ error: 'Şube kodu tam 3 haneli olmalıdır.' });
    return;
  }
  const existing = await prisma.branch.findUnique({ where: { code: data.code } });
  if (existing) {
    res.status(409).json({ error: 'Bu şube kodu zaten tanımlı.' });
    return;
  }
  const branch = await prisma.branch.create({
    data: { code: data.code, name: data.name, active: data.active, isHeadOffice: false },
  });
  if(branch.active)await ensureHelpDeskBranchFoundation(branch.code);
  res.status(201).json({ ...branch, createdAt: branch.createdAt.getTime(), updatedAt: branch.updatedAt.getTime() });
});

branchRouter.put('/:code', requireAuth, adminOnly, async (req, res) => {
  const code = String(req.params.code);
  const data = branchSchema.omit({ code: true }).parse(req.body);
  const current = await prisma.branch.findUnique({ where: { code } });
  if (!current) {
    res.status(404).json({ error: 'Şube bulunamadı.' });
    return;
  }
  const branch = await prisma.branch.update({
    where: { code },
    data: {
      name: data.name,
      active: current.isHeadOffice ? true : data.active,
    },
  });
  await syncHelpDeskBranchIdentity(branch.code,current.name,branch.name);
  if(branch.active)await ensureHelpDeskBranchFoundation(branch.code);
  res.json({ ...branch, createdAt: branch.createdAt.getTime(), updatedAt: branch.updatedAt.getTime() });
});

branchRouter.delete('/:code', requireAuth, adminOnly, async (req, res) => {
  const code = String(req.params.code);
  if (code === '100') {
    res.status(400).json({ error: '100 Merkez Şube silinemez.' });
    return;
  }

  const branch = await prisma.branch.findUnique({ where: { code } });
  if (!branch) {
    res.status(404).json({ error: 'Şube bulunamadı.' });
    return;
  }

  const [
    userCount,
    taskCount,
    credentialCount,
    trackingCount,
    messageCount,
    announcementCount,
    noteCount,
    auditCount,
    assetCount,
    partyCount,
    assignmentCount,
    movementCount,
    inventoryCount,
    inventoryScanCount,
    qrCount,
    labelCount,
    externalConnectionCount,
    networkMonitorCount,
    networkEventCount,
  ] = await Promise.all([
    prisma.userBranch.count({ where: { branchCode: code } }),
    prisma.task.count({ where: { branchCode: code } }),
    prisma.credential.count({ where: { branchCode: code } }),
    prisma.trackingRecord.count({ where: { branchCode: code } }),
    prisma.message.count({ where: { branchCode: code } }),
    prisma.announcement.count({ where: { branchCode: code } }),
    prisma.userNote.count({ where: { branchCode: code } }),
    prisma.auditLog.count({ where: { branchCode: code } }),
    prisma.asset.count({ where: { branchCode: code } }),
    prisma.assetParty.count({ where: { branchCode: code } }),
    prisma.assetAssignment.count({ where: { branchCode: code } }),
    prisma.assetMovement.count({ where: { branchCode: code } }),
    prisma.assetCount.count({ where: { branchCode: code } }),
    prisma.assetCountScan.count({ where: { branchCode: code } }),
    prisma.assetQrToken.count({ where: { branchCode: code } }),
    prisma.assetLabelTemplate.count({ where: { branchCode: code } }),
    prisma.assetExternalConnection.count({ where: { branchCode: code } }),
    prisma.networkMonitor.count({ where: { branchCode: code } }),
    prisma.networkMonitorEvent.count({ where: { branchCode: code } }),
  ]);

  const helpDeskUsage=await inspectHelpDeskBranchUserData(code,branch.name);
  const usageTotal =
    userCount +
    taskCount +
    credentialCount +
    trackingCount +
    messageCount +
    announcementCount +
    noteCount +
    auditCount +
    assetCount +
    partyCount +
    assignmentCount +
    movementCount +
    inventoryCount +
    inventoryScanCount +
    qrCount +
    labelCount +
    externalConnectionCount +
    networkMonitorCount +
    networkEventCount +
    (helpDeskUsage.hasUserData ? 1 : 0);

  if (usageTotal > 0) {
    res.status(409).json({
      error: 'Kayıt var, silinmez.',
      details: {
        users: userCount,
        operationRecords:
          taskCount +
          credentialCount +
          trackingCount +
          messageCount +
          announcementCount +
          noteCount +
          auditCount,
        assetRecords:
          assetCount +
          partyCount +
          assignmentCount +
          movementCount +
          inventoryCount +
          inventoryScanCount +
          qrCount +
          labelCount +
          externalConnectionCount,
        networkRecords: networkMonitorCount + networkEventCount,
        helpDesk: helpDeskUsage.details,
      },
    });
    return;
  }

  await removeHelpDeskBranchFoundation(code);
  await prisma.branch.delete({ where: { code } });
  res.status(204).end();
});

branchRouter.get('/users/:userId', requireAuth, adminOnly, async (req, res) => {
  const userId = String(req.params.userId);
  const [rows,helpDeskRows]=await Promise.all([
    prisma.userBranch.findMany({
      where: { userId },
      include: { branch: true },
      orderBy: [{ isPrimary: 'desc' }, { branchCode: 'asc' }],
    }),
    prisma.helpDeskAccess.findMany({where:{userId}}),
  ]);
  const helpDeskByBranch=new Map(helpDeskRows.map(row=>[row.branchCode,row]));
  res.json(rows.map(row => {
    const access=helpDeskByBranch.get(row.branchCode);
    return {
      branchCode: row.branchCode,
      branchName: row.branch.name,
      isPrimary: row.isPrimary,
      role: readBranchRole(row.permissions),
      permissions: normalizePermissions(row.permissions),
      helpDesk:{
        canOpen:Boolean(access?.active&&access.canOpen),
        canCoordinate:Boolean(access?.active&&access.canCoordinate),
        canRespond:Boolean(access?.active&&access.canRespond),
        canChangeStatus:Boolean(access?.active&&access.canChangeStatus),
        canReopen:Boolean(access?.active&&access.canReopen),
        canViewAll:Boolean(access?.active&&access.canViewAll),
        canAssign:Boolean(access?.active&&access.canAssign),
        canClose:Boolean(access?.active&&access.canClose),
        canReport:Boolean(access?.active&&access.canReport),
        canTopics:Boolean(access?.active&&access.canTopics),
        canCannedReplies:Boolean(access?.active&&access.canCannedReplies),
        canKnowledge:Boolean(access?.active&&access.canKnowledge),
      },
      assignedAt: row.assignedAt.getTime(),
    };
  }));
});

branchRouter.put('/users/:userId', requireAuth, adminOnly, async (req: AuthRequest, res) => {
  const userId = String(req.params.userId);
  const data = z.object({
    assignments: z.array(z.object({
      branchCode: z.string().regex(/^\d{3}$/),
      isPrimary: z.boolean(),
      role: z.enum(['USER','BRANCH_MANAGER']).default('USER'),
      permissions: z.unknown(),
      helpDesk: z.object({
        canOpen:z.boolean(),canCoordinate:z.boolean(),canRespond:z.boolean(),canChangeStatus:z.boolean(),canReopen:z.boolean(),
        canViewAll:z.boolean(),canAssign:z.boolean(),canClose:z.boolean(),canReport:z.boolean(),canTopics:z.boolean(),
        canCannedReplies:z.boolean(),canKnowledge:z.boolean(),
      }),
    })).min(1),
  }).parse(req.body);

  const uniqueAssignments = Array.from(
    new Map(data.assignments.map(item => [item.branchCode, item])).values(),
  );
  const primaryAssignments = uniqueAssignments.filter(item => item.isPrimary);
  if (primaryAssignments.length !== 1) {
    res.status(400).json({ error: 'Tam olarak bir birincil şube seçilmelidir.' });
    return;
  }

  const uniqueCodes = uniqueAssignments.map(item => item.branchCode);
  const existingBranches = await prisma.branch.findMany({
    where: { code: { in: uniqueCodes }, active: true },
    select: { code: true },
  });
  if (existingBranches.length !== uniqueCodes.length) {
    res.status(400).json({ error: 'Geçersiz veya pasif şube seçildi.' });
    return;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    include: { branchMemberships: true },
  });
  if (!targetUser) {
    res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    return;
  }
  if(isLicenseOwner(targetUser.username)){
    res.status(403).json({error:'balamir Süper Admin hesabının şube ve yetki atamaları değiştirilemez.'});
    return;
  }

  const callerIsBalamir = isLicenseOwner(req.authUser!.username);
  const callerIsHeadOfficeMember = await isHeadOfficeAuthorizedUser(req.authUser!.id);

  if (uniqueCodes.includes('100') && !callerIsBalamir && !callerIsHeadOfficeMember) {
    res.status(403).json({
      error: '100 Merkez Şube ataması yalnız balamir veya 100 Merkez Şube yetkili kullanıcıları tarafından yapılabilir.',
    });
    return;
  }

  const targetIsBalamir = isLicenseOwner(targetUser.username);
  if (targetIsBalamir && !uniqueCodes.includes('100')) {
    res.status(400).json({
      error: 'balamir kullanıcısının 100 Merkez Şube yetkisi kaldırılamaz.',
    });
    return;
  }

  const normalizedAssignments = uniqueAssignments.map(item => ({
    branchCode: item.branchCode,
    isPrimary: item.isPrimary,
    role: (targetUser.isAdmin ? 'USER' : item.role) as BranchRole,
    permissions: targetUser.isAdmin
      ? serializeBranchPermissions(targetUser.permissions,'USER')
      : serializeBranchPermissions(item.permissions,item.role),
    helpDesk:item.helpDesk,
  }));

  const previousCodes=targetUser.branchMemberships.map(item=>item.branchCode);
  await prisma.$transaction([
    prisma.userBranch.deleteMany({ where: { userId } }),
    prisma.userBranch.createMany({
      data: normalizedAssignments.map(item => ({
        userId,
        branchCode: item.branchCode,
        isPrimary: item.isPrimary,
        permissions: item.permissions,
        assignedById: req.authUser!.id,
      })),
    }),
  ]);

  if(!targetUser.isAdmin){
    const removedCodes=previousCodes.filter(branchCode=>!uniqueCodes.includes(branchCode));
    if(removedCodes.length){
      await prisma.helpDeskAccess.deleteMany({where:{userId,branchCode:{in:removedCodes}}});
    }
  }
  for(const assignment of normalizedAssignments){
    await ensureHelpDeskBranchFoundation(assignment.branchCode);
    if(!targetUser.isAdmin){
      const hd=assignment.helpDesk;
      await prisma.helpDeskAccess.upsert({
        where:{userId_branchCode:{userId,branchCode:assignment.branchCode}},
        update:{
          active:true,canOpen:hd.canOpen,canStaff:hd.canCoordinate||hd.canRespond,canCoordinate:hd.canCoordinate,
          canRespond:hd.canRespond,canChangeStatus:hd.canChangeStatus,canReopen:hd.canReopen,canViewAll:hd.canViewAll,
          canAssign:hd.canAssign&&hd.canCoordinate,canClose:hd.canClose,canReport:hd.canReport,canTopics:hd.canTopics,
          canCannedReplies:hd.canCannedReplies,canKnowledge:hd.canKnowledge,assignedById:req.authUser!.id,
        },
        create:{
          userId,branchCode:assignment.branchCode,active:true,canOpen:hd.canOpen,canStaff:hd.canCoordinate||hd.canRespond,
          canCoordinate:hd.canCoordinate,canRespond:hd.canRespond,canChangeStatus:hd.canChangeStatus,canReopen:hd.canReopen,
          canViewAll:hd.canViewAll,canAssign:hd.canAssign&&hd.canCoordinate,canClose:hd.canClose,canReport:hd.canReport,
          canTopics:hd.canTopics,canCannedReplies:hd.canCannedReplies,canKnowledge:hd.canKnowledge,assignedById:req.authUser!.id,
        },
      });
    }
  }

  const rows = await prisma.userBranch.findMany({
    where: { userId },
    include: { branch: true },
    orderBy: [{ isPrimary: 'desc' }, { branchCode: 'asc' }],
  });
  const helpDeskRows=await prisma.helpDeskAccess.findMany({where:{userId}});
  const helpDeskByBranch=new Map(helpDeskRows.map(row=>[row.branchCode,row]));
  res.json(rows.map(row => {
    const access=helpDeskByBranch.get(row.branchCode);
    return {
      branchCode: row.branchCode,
      branchName: row.branch.name,
      isPrimary: row.isPrimary,
      role:readBranchRole(row.permissions),
      permissions: normalizePermissions(row.permissions),
      helpDesk:{
        canOpen:Boolean(access?.active&&access.canOpen),
        canCoordinate:Boolean(access?.active&&access.canCoordinate),
        canRespond:Boolean(access?.active&&access.canRespond),
        canChangeStatus:Boolean(access?.active&&access.canChangeStatus),
        canReopen:Boolean(access?.active&&access.canReopen),
        canViewAll:Boolean(access?.active&&access.canViewAll),
        canAssign:Boolean(access?.active&&access.canAssign),
        canClose:Boolean(access?.active&&access.canClose),
        canReport:Boolean(access?.active&&access.canReport),
        canTopics:Boolean(access?.active&&access.canTopics),
        canCannedReplies:Boolean(access?.active&&access.canCannedReplies),
        canKnowledge:Boolean(access?.active&&access.canKnowledge),
      },
      assignedAt: row.assignedAt.getTime(),
    };
  }));
});
