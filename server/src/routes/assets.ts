import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import { prisma } from '../db.js';
import { encryptText } from '../crypto.js';
import { syncTblDemirmasConnection } from '../tbldemirmas-sync.js';
import { syncTblDemSatisConnection } from '../tbldemsatis-sync.js';
import {
  countAuthorizedExternalRows,
  getAuthorizedExternalColumns,
  listAuthorizedExternalTables,
  readAuthorizedExternalRows,
  testExternalMssqlConnection,
} from '../external-mssql.js';
import { requireAuth, requirePermission, type AuthRequest } from '../auth.js';
import { assertBranchPermission, branchContextFromRequest, readAccessibleBranchCodesForPermission, readBranchCodesForPermission, writeBranchCode } from '../branch-access.js';

export const assetsRouter = Router();

const requireAnyAssetPermission = (selector:(permissions:any)=>boolean) => async (req:AuthRequest,res:any,next:any) => {
  if(req.authUser?.isAdmin){next();return;}
  const codes=await readAccessibleBranchCodesForPermission(req,selector);
  if(codes.length){next();return;}
  res.status(403).json({error:'Bu işlem için yetkili olduğunuz aktif bir şube bulunmuyor.'});
};

const targetTypes = ['PERSON', 'UNIT', 'LOCATION', 'COMMON_AREA', 'WAREHOUSE', 'VEHICLE', 'PROJECT', 'SERVICE'] as const;
const partyTypes = ['PERSON', 'UNIT', 'LOCATION', 'COMMON_AREA', 'WAREHOUSE', 'VEHICLE', 'PROJECT', 'SERVICE'] as const;


function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function documentNo(prefix: string): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${prefix}-${date}-${crypto.randomInt(100000, 999999)}`;
}

async function audit(
  req: AuthRequest,
  action: string,
  module: string,
  recordId: string,
  label: string,
  branchCodeOverride = '',
): Promise<void> {
  const normalizedBranch = String(branchCodeOverride ?? '').trim().toUpperCase();
  const branchCode = /^(?:\d{3}|ALL)$/.test(normalizedBranch)
    ? normalizedBranch
    : await writeBranchCode(req);
  await prisma.auditLog.create({
    data: {
      branchCode,
      userId: req.authUser?.id ?? '',
      username: req.authUser?.username ?? '',
      displayName: req.authUser?.displayName ?? '',
      action, module, recordId, recordLabel: label,
      description: `${module} modülünde “${label || recordId || 'Kayıt'}” için ${action === 'CREATE' ? 'kayıt eklendi' : action === 'UPDATE' ? 'kayıt güncellendi' : action === 'DELETE' ? 'kayıt silindi' : action === 'RESTORE' ? 'kayıt geri yüklendi' : action.toLocaleLowerCase('tr-TR')} işlemi yapıldı.`,
      ipAddress: req.ip ?? '',
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 1000),
    },
  }).catch(() => undefined);
}


const externalConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().max(255).default(''),
  username: z.string().trim().max(255).default(''),
  password: z.string().max(1000).optional(),
  queryText: z.string().max(10000).default(''),
  purpose: z.string().trim().max(500).default(''),
  enabled: z.boolean().default(false),
  branchVisibility: z.enum(['BRANCH', 'CENTER_ONLY']).default('BRANCH'),
});

function serializeExternalConnection(row: any) {
  return {
    id: row.id,
    branchCode: row.branchCode,
    branchVisibility: row.branchVisibility,
    name: row.name,
    type: row.type,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    passwordSet: Boolean(row.passwordEncrypted),
    queryText: row.queryText,
    purpose: row.purpose,
    enabled: row.enabled,
    lastTestAt: row.lastTestAt?.getTime() ?? null,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function serializeAssetRow(row: any) {
  return {
    ...row,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    sourceSyncedAt: row.sourceSyncedAt?.getTime() ?? null,
    sourceChangedAt: row.sourceChangedAt?.getTime() ?? null,
  };
}

const assetSchema = z.object({
  assetCode: z.string().trim().min(1).max(80),
  externalSource: z.string().trim().max(255).default('MANUAL'),
  externalId: z.string().trim().max(255).default(''),
  name: z.string().trim().min(1).max(250),
  category: z.string().trim().max(120).default(''),
  brand: z.string().trim().max(120).default(''),
  model: z.string().trim().max(120).default(''),
  serialNumber: z.string().trim().max(180).default(''),
  barcode: z.string().trim().max(180).default(''),
  status: z.string().trim().max(40).default('ACTIVE'),
  quantity: z.number().int().min(1).max(999999).default(1),
  description: z.string().max(5000).default(''),
  unitId: z.string().default(''),
  locationId: z.string().default(''),
  purchaseDate: z.string().default(''),
  warrantyEndDate: z.string().default(''),
  sourceSirketKodu: z.string().trim().max(120).default(''),
  sourceBitisYili: z.string().trim().max(80).default(''),
  sourceAlisBelgeNo: z.string().trim().max(180).default(''),
  sourceSatici: z.string().trim().max(250).default(''),
  sourceResBelgeNo: z.string().trim().max(180).default(''),
  sourceGrupKodu: z.string().trim().max(120).default(''),
  sourceSatisTarihi: z.string().default(''),
});



assetsRouter.get('/summary', requireAuth, requireAnyAssetPermission(p=>p.assets.dashboardView), async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.dashboardView);
  const branchWhere = { branchCode: { in: branchCodes } };
  const [total, assigned, warehouse, openCounts, activeTransfers, sales, scrap, labels, documents] = await Promise.all([
    prisma.asset.count({ where: { ...branchWhere, deletedAt: null } }),
    prisma.asset.count({ where: { ...branchWhere, deletedAt: null, currentTargetType: { not: '' } } }),
    prisma.asset.count({
      where: {
        ...branchWhere,
        deletedAt: null,
        OR: [{ currentTargetType: 'WAREHOUSE' }, { status: 'WAREHOUSE' }],
      },
    }),
    prisma.assetCount.count({ where: { ...branchWhere, status: 'OPEN' } }),
    prisma.assetMovement.count({ where: { ...branchWhere, action: 'TRANSFER', createdAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
    prisma.asset.count({ where: { ...branchWhere, status: { in: ['SALE', 'SOLD'] }, deletedAt: null } }),
    prisma.asset.count({ where: { ...branchWhere, status: 'SCRAP', deletedAt: null } }),
    prisma.assetLabelTemplate.count({ where: branchWhere }),
    prisma.assetAssignment.count({ where: branchWhere }),
  ]);
  res.json({
    total,
    assigned,
    warehouse,
    openCounts,
    activeTransfers,
    sales,
    scrap,
    disposed: sales + scrap,
    labels,
    documents,
  });
});

assetsRouter.get('/cards', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsView), async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.cardsView);
  const rows = await prisma.asset.findMany({ where: { branchCode: { in: branchCodes }, deletedAt: null }, orderBy: { updatedAt: 'desc' } });
  res.json(rows.map(serializeAssetRow));
});


assetsRouter.post('/cards/bulk', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsCreate), async (req: AuthRequest, res) => {
  const payload = z.object({
    items: z.array(assetSchema).min(1).max(5000),
  }).parse(req.body);

  const normalizedCodes = payload.items.map(item => item.assetCode.toLocaleUpperCase('tr-TR'));
  const duplicateCodes = normalizedCodes.filter((code, index) => normalizedCodes.indexOf(code) !== index);
  if (duplicateCodes.length > 0) {
    res.status(409).json({ error: `Excel dosyasında yinelenen demirbaş kodları var: ${[...new Set(duplicateCodes)].slice(0, 10).join(', ')}` });
    return;
  }

  const serials = payload.items.map(item => item.serialNumber.trim()).filter(Boolean);
  const duplicateSerials = serials.filter((serial, index) => serials.indexOf(serial) !== index);
  if (duplicateSerials.length > 0) {
    res.status(409).json({ error: `Excel dosyasında yinelenen seri numaraları var: ${[...new Set(duplicateSerials)].slice(0, 10).join(', ')}` });
    return;
  }

  const barcodes = payload.items.map(item => item.barcode.trim()).filter(Boolean);
  const duplicateBarcodes = barcodes.filter((barcode, index) => barcodes.indexOf(barcode) !== index);
  if (duplicateBarcodes.length > 0) {
    res.status(409).json({ error: `Excel dosyasında yinelenen barkod numaraları var: ${[...new Set(duplicateBarcodes)].slice(0, 10).join(', ')}` });
    return;
  }

  const existingCodes = await prisma.asset.findMany({
    where: { deletedAt: null, assetCode: { in: payload.items.map(item => item.assetCode) } },
    select: { assetCode: true },
  });
  if (existingCodes.length > 0) {
    res.status(409).json({ error: `Sistemde zaten bulunan demirbaş kodları var: ${existingCodes.map(item => item.assetCode).slice(0, 10).join(', ')}` });
    return;
  }

  if (serials.length > 0) {
    const existingSerials = await prisma.asset.findMany({
      where: { deletedAt: null, serialNumber: { in: serials } },
      select: { assetCode: true, serialNumber: true },
    });
    if (existingSerials.length > 0) {
      res.status(409).json({ error: `Sistemde zaten kullanılan seri numaraları var: ${existingSerials.map(item => `${item.serialNumber} (${item.assetCode})`).slice(0, 10).join(', ')}` });
      return;
    }
  }

  if (barcodes.length > 0) {
    const existingBarcodes = await prisma.asset.findMany({
      where: { deletedAt: null, barcode: { in: barcodes } },
      select: { assetCode: true, barcode: true },
    });
    if (existingBarcodes.length > 0) {
      res.status(409).json({ error: `Sistemde zaten kullanılan barkod numaraları var: ${existingBarcodes.map(item => `${item.barcode} (${item.assetCode})`).slice(0, 10).join(', ')}` });
      return;
    }
  }

  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.assets.cardsCreate,'Bu şubede toplu demirbaş oluşturma yetkiniz yok.');
  const created = await prisma.$transaction(async transaction => {
    const rows = [];
    for (const data of payload.items) {
      const row = await transaction.asset.create({
        data: {
          ...data,
          branchCode,
          createdById: req.authUser!.id,
          createdByName: req.authUser!.displayName,
        },
      });
      await transaction.assetMovement.create({
        data: {
          assetId: row.id,
          branchCode,
          action: 'CREATE',
          toName: row.name,
          userId: req.authUser!.id,
          userName: req.authUser!.displayName,
        },
      });
      rows.push(row);
    }
    return rows;
  }, { timeout: 120000 });

  await audit(req, 'BULK_CREATE', 'ASSET', 'BULK', `${created.length} demirbaş Excel ile oluşturuldu`, branchCode);
  res.status(201).json({
    created: created.length,
    items: created.map(row => ({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() })),
  });
});

assetsRouter.post('/cards', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsCreate), async (req: AuthRequest, res) => {
  const data = assetSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.assets.cardsCreate,'Bu şubede demirbaş kartı oluşturma yetkiniz yok.');
  if (data.serialNumber) {
    const duplicate = await prisma.asset.findFirst({ where: { serialNumber: data.serialNumber, deletedAt: null } });
    if (duplicate) { res.status(409).json({ error: `Bu seri numarası ${duplicate.assetCode} kartında kullanılıyor.` }); return; }
  }
  if (data.barcode) {
    const duplicate = await prisma.asset.findFirst({ where: { barcode: data.barcode, deletedAt: null } });
    if (duplicate) { res.status(409).json({ error: `Bu barkod numarası ${duplicate.assetCode} kartında kullanılıyor.` }); return; }
  }
  const row = await prisma.asset.create({
    data: { ...data, branchCode, createdById: req.authUser!.id, createdByName: req.authUser!.displayName },
  });
  await prisma.assetMovement.create({
    data: { branchCode: row.branchCode, assetId: row.id, action: 'CREATE', toName: row.name, userId: req.authUser!.id, userName: req.authUser!.displayName },
  });
  await audit(req, 'CREATE', 'ASSET', row.id, row.assetCode, row.branchCode);
  res.status(201).json(serializeAssetRow(row));
});

assetsRouter.patch('/cards/:id/status', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsEdit), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const input = z.object({
    status: z.enum(['ACTIVE', 'PASSIVE', 'SALE', 'SCRAP', 'WAREHOUSE']),
  }).parse(req.body);

  const before = await prisma.asset.findUnique({ where: { id } });
  if (!before || before.deletedAt) {
    res.status(404).json({ error: 'Demirbaş kartı bulunamadı.' });
    return;
  }

  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.cardsEdit);

  const row = await prisma.asset.update({
    where: { id },
    data: { status: input.status },
  });

  await prisma.assetMovement.create({
    data: {
      branchCode: row.branchCode,
      assetId: row.id,
      action: 'STATUS_CHANGE',
      fromName: before.status,
      toName: input.status,
      userId: req.authUser!.id,
      userName: req.authUser!.displayName,
    },
  });

  res.json(serializeAssetRow(row));
});

assetsRouter.put('/cards/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsEdit), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.asset.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Demirbaş bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.cardsEdit);
  const data = assetSchema.parse(req.body);
  if (data.serialNumber) {
    const duplicate = await prisma.asset.findFirst({ where: { serialNumber: data.serialNumber, deletedAt: null, id: { not: id } } });
    if (duplicate) { res.status(409).json({ error: `Bu seri numarası ${duplicate.assetCode} kartında kullanılıyor.` }); return; }
  }
  if (data.barcode) {
    const duplicate = await prisma.asset.findFirst({ where: { barcode: data.barcode, deletedAt: null, id: { not: id } } });
    if (duplicate) { res.status(409).json({ error: `Bu barkod numarası ${duplicate.assetCode} kartında kullanılıyor.` }); return; }
  }
  const sourceManaged = before.externalSource.startsWith('MSSQL:') && before.externalSource.endsWith(':dbo.TBLDEMIRMAS');
  const updateData = sourceManaged
    ? {
        category: data.category,
        brand: data.brand,
        model: data.model,
        serialNumber: data.serialNumber,
        barcode: data.barcode,
        status: data.status,
        description: data.description,
        unitId: data.unitId,
        locationId: data.locationId,
        warrantyEndDate: data.warrantyEndDate,
      }
    : data;
  const row = await prisma.asset.update({ where: { id }, data: updateData });
  await prisma.assetMovement.create({
    data: { branchCode: row.branchCode, assetId: row.id, action: 'UPDATE', toName: row.name, userId: req.authUser!.id, userName: req.authUser!.displayName },
  });
  await audit(req, 'UPDATE', 'ASSET', row.id, row.assetCode, row.branchCode);
  res.json(serializeAssetRow(row));
});

assetsRouter.delete('/cards/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsDelete), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.asset.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Demirbaş bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.cardsDelete);
  const row = await prisma.asset.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(req, 'DELETE', 'ASSET', row.id, row.assetCode, row.branchCode);
  res.status(204).end();
});

const partySchema = z.object({
  type: z.enum(partyTypes),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(250),
  parentId: z.string().default(''),
  externalSource: z.string().default('MANUAL'),
  externalId: z.string().default(''),
  department: z.string().default(''),
  title: z.string().default(''),
  email: z.string().default(''),
  active: z.boolean().default(true),
});

assetsRouter.get('/parties', requireAuth, requireAnyAssetPermission(p=>p.assets.locationsView || p.assets.assignmentsView), async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.locationsView || permissions.assets.assignmentsView);
  const rows = await prisma.assetParty.findMany({ where: { branchCode: { in: branchCodes } }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  res.json(rows.map(row => ({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() })));
});

assetsRouter.post('/parties', requireAuth, requireAnyAssetPermission(p=>p.assets.locationsManage), async (req: AuthRequest, res) => {
  const data = partySchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.assets.locationsManage,'Bu şubede lokasyon/hedef tanımı oluşturma yetkiniz yok.');
  const row = await prisma.assetParty.create({ data: { ...data, branchCode } });
  await audit(req, 'CREATE', 'ASSET_PARTY', row.id, `${row.type}:${row.name}`, row.branchCode);
  res.status(201).json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

assetsRouter.put('/parties/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.locationsManage), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.assetParty.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Tanım bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.locationsManage);
  const row = await prisma.assetParty.update({ where: { id }, data: partySchema.parse(req.body) });
  await audit(req, 'UPDATE', 'ASSET_PARTY', row.id, `${row.type}:${row.name}`, row.branchCode);
  res.json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});


assetsRouter.delete('/parties/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.locationsManage), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.assetParty.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Tanım bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.locationsManage);
  const party = await prisma.assetParty.findUnique({ where: { id } });
  if (!party) {
    res.status(404).json({ error: 'Kayıt bulunamadı.' });
    return;
  }

  const [childCount, assignmentCount, movementCount, countSessionCount, linkedAssetCount] = await Promise.all([
    prisma.assetParty.count({ where: { parentId: id } }),
    prisma.assetAssignment.count({ where: { targetId: id } }),
    prisma.assetMovement.count({ where: { OR: [{ fromId: id }, { toId: id }] } }),
    prisma.assetCount.count({ where: { locationId: id } }),
    prisma.asset.count({
      where: {
        deletedAt: null,
        OR: [
          { currentTargetId: id },
          { unitId: id },
          { locationId: id },
        ],
      },
    }),
  ]);

  if (childCount > 0 || assignmentCount > 0 || movementCount > 0 || countSessionCount > 0 || linkedAssetCount > 0) {
    res.status(409).json({
      error: 'Bu kayıt geçmiş veya aktif işlemlerde kullanıldığı için silinemez. Kayıt düzenlenebilir ya da pasife alınabilir.',
      usage: { childCount, assignmentCount, movementCount, countSessionCount, linkedAssetCount },
    });
    return;
  }

  await prisma.$transaction([
    prisma.assetQrToken.deleteMany({ where: { entityType: 'LOCATION', entityId: id } }),
    prisma.assetParty.delete({ where: { id } }),
  ]);
  await audit(req, 'DELETE', 'ASSET_PARTY', id, `${party.type}:${party.name}`, party.branchCode);
  res.status(204).end();
});

const assignmentSchema = z.object({
  assetId: z.string().min(1),
  targetType: z.enum(targetTypes),
  targetId: z.string().min(1),
  unitId: z.string().default(''),
  locationId: z.string().default(''),
  note: z.string().max(2000).default(''),
});

assetsRouter.get('/assignments', requireAuth, requireAnyAssetPermission(p=>p.assets.assignmentsView), async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.assignmentsView);
  const rows = await prisma.assetAssignment.findMany({ where: { branchCode: { in: branchCodes } }, orderBy: { createdAt: 'desc' }, take: 1000 });
  res.json(rows.map(row => ({ ...row, startAt: row.startAt.getTime(), endAt: row.endAt?.getTime() ?? null, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() })));
});

assetsRouter.post('/assignments', requireAuth, requireAnyAssetPermission(p=>p.assets.assignmentsCreate), async (req: AuthRequest, res) => {
  const data = assignmentSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  const [asset, target] = await Promise.all([
    prisma.asset.findUnique({ where: { id: data.assetId } }),
    prisma.assetParty.findUnique({ where: { id: data.targetId } }),
  ]);
  if (!asset || !target) { res.status(404).json({ error: 'Demirbaş veya zimmet hedefi bulunamadı.' }); return; }
  await assertBranchPermission(req, asset.branchCode, permissions => permissions.assets.assignmentsCreate);
  await assertBranchPermission(req, target.branchCode, permissions => permissions.assets.assignmentsCreate);
  if (asset.branchCode !== branchCode || target.branchCode !== branchCode) {
    res.status(403).json({ error: 'Farklı şubeler arasında zimmet işlemi yapılamaz.' });
    return;
  }

  const result = await prisma.$transaction(async tx => {
    const old = await tx.assetAssignment.findFirst({ where: { assetId: asset.id, status: 'ACTIVE' } });
    if (old) await tx.assetAssignment.update({ where: { id: old.id }, data: { status: 'CLOSED', endAt: new Date() } });

    const doc = documentNo('ZMT');
    const assignment = await tx.assetAssignment.create({
      data: {
        branchCode, documentNo: doc, assetId: asset.id, targetType: data.targetType, targetId: target.id, targetName: target.name,
        unitId: data.unitId, locationId: data.locationId, note: data.note,
        createdById: req.authUser!.id, createdByName: req.authUser!.displayName,
      },
    });
    const documentToken = createOpaqueToken();
    await tx.assetQrToken.create({
      data: {
        branchCode,
        tokenHash: tokenHash(documentToken),
        entityType: 'DOCUMENT',
        entityId: assignment.id,
        createdById: req.authUser!.id,
      },
    });
    await tx.asset.update({
      where: { id: asset.id },
      data: {
        currentTargetType: data.targetType, currentTargetId: target.id, currentTargetName: target.name,
        unitId: data.unitId, locationId: data.locationId,
      },
    });
    await tx.assetMovement.create({
      data: {
        branchCode, assetId: asset.id, action: old ? 'TRANSFER' : 'ASSIGN', documentNo: doc,
        fromType: old?.targetType ?? '', fromId: old?.targetId ?? '', fromName: old?.targetName ?? '',
        toType: data.targetType, toId: target.id, toName: target.name, note: data.note,
        userId: req.authUser!.id, userName: req.authUser!.displayName,
      },
    });
    return assignment;
  });

  await audit(req, 'CREATE', 'ASSET_ASSIGNMENT', result.id, result.documentNo, result.branchCode);
  res.status(201).json({ ...result, startAt: result.startAt.getTime(), endAt: null, createdAt: result.createdAt.getTime(), updatedAt: result.updatedAt.getTime() });
});

assetsRouter.post('/assignments/:id/return', requireAuth, requireAnyAssetPermission(p=>p.assets.assignmentsReturn), async (req: AuthRequest, res) => {
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: routeParam(req.params.id) } });
  if (assignment) await assertBranchPermission(req, assignment.branchCode, permissions => permissions.assets.assignmentsReturn);
  if (!assignment || assignment.status !== 'ACTIVE') { res.status(404).json({ error: 'Aktif zimmet bulunamadı.' }); return; }
  await prisma.$transaction([
    prisma.assetAssignment.update({ where: { id: assignment.id }, data: { status: 'RETURNED', endAt: new Date() } }),
    prisma.asset.update({ where: { id: assignment.assetId }, data: { currentTargetType: '', currentTargetId: '', currentTargetName: '' } }),
    prisma.assetMovement.create({
      data: { branchCode: assignment.branchCode, assetId: assignment.assetId, action: 'RETURN', documentNo: assignment.documentNo, fromType: assignment.targetType, fromId: assignment.targetId, fromName: assignment.targetName, userId: req.authUser!.id, userName: req.authUser!.displayName },
    }),
  ]);
  await audit(req, 'RETURN', 'ASSET_ASSIGNMENT', assignment.id, assignment.documentNo, assignment.branchCode);
  res.status(204).end();
});

assetsRouter.get('/movements', requireAuth, requireAnyAssetPermission(p=>p.assets.reportsView), async (req, res) => {
  const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : undefined;
  const targetId = typeof req.query.targetId === 'string' ? req.query.targetId : undefined;
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.transfersView);
  const rows = await prisma.assetMovement.findMany({
    where: { branchCode: { in: branchCodes }, ...(assetId ? { assetId } : {}), ...(targetId ? { OR: [{ fromId: targetId }, { toId: targetId }] } : {}) },
    orderBy: { createdAt: 'desc' }, take: 5000,
  });
  res.json(rows.map(row => ({ ...row, createdAt: row.createdAt.getTime() })));
});

const countSchema = z.object({ name: z.string().trim().min(1), locationId: z.string().min(1) });
assetsRouter.get('/counts', requireAuth, requireAnyAssetPermission(p=>p.assets.countsView), async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.countsView);
  const rows = await prisma.assetCount.findMany({ where: { branchCode: { in: branchCodes } }, orderBy: { createdAt: 'desc' } });
  res.json(rows.map(row => ({ ...row, startedAt: row.startedAt.getTime(), completedAt: row.completedAt?.getTime() ?? null, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() })));
});

assetsRouter.post('/counts', requireAuth, requireAnyAssetPermission(p=>p.assets.countsCreate), async (req: AuthRequest, res) => {
  const data = countSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  const location = await prisma.assetParty.findUnique({ where: { id: data.locationId } });
  if (!location) { res.status(404).json({ error: 'Sayım lokasyonu bulunamadı.' }); return; }
  await assertBranchPermission(req, location.branchCode, permissions => permissions.assets.countsCreate);
  if (location.branchCode !== branchCode) { res.status(403).json({ error: 'Sayım yalnız aktif şube lokasyonunda başlatılabilir.' }); return; }
  const row = await prisma.assetCount.create({
    data: { branchCode, countNo: documentNo('SYM'), name: data.name, locationId: location.id, locationName: location.name, createdById: req.authUser!.id, createdByName: req.authUser!.displayName },
  });
  res.status(201).json({ ...row, startedAt: row.startedAt.getTime(), completedAt: null, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

assetsRouter.post('/counts/:id/scan', requireAuth, requireAnyAssetPermission(p=>p.assets.countsScan), async (req: AuthRequest, res) => {
  const parsed = z.object({ code: z.string().trim().min(1) }).parse(req.body);
  const count = await prisma.assetCount.findUnique({ where: { id: routeParam(req.params.id) } });
  if (count) await assertBranchPermission(req, count.branchCode, permissions => permissions.assets.countsScan);
  if (!count || count.status !== 'OPEN') { res.status(409).json({ error: 'Sayım açık değil.' }); return; }

  const token = parsed.code.replace(/^operis:\/\/scan\/v1\//, '');
  const hash = tokenHash(token);
  const qr = await prisma.assetQrToken.findUnique({ where: { tokenHash: hash } });
  let asset = qr?.entityType === 'ASSET' ? await prisma.asset.findUnique({ where: { id: qr.entityId } }) : null;
  if (!asset) asset = await prisma.asset.findFirst({ where: { OR: [{ barcode: parsed.code }, { serialNumber: parsed.code }, { assetCode: parsed.code }], deletedAt: null } });
  if (!asset) { res.status(404).json({ error: 'Kayıtsız demirbaş.', result: 'UNREGISTERED' }); return; }
  await assertBranchPermission(req, asset.branchCode, permissions => permissions.assets.countsScan);
  if (asset.branchCode !== count.branchCode) { res.status(403).json({ error: 'Farklı şubeye ait demirbaş bu sayımda okutulamaz.', result: 'WRONG_BRANCH' }); return; }

  const result = asset.locationId === count.locationId ? 'MATCHED' : 'WRONG_LOCATION';
  try {
    const scan = await prisma.assetCountScan.create({
      data: { branchCode: count.branchCode, countId: count.id, assetId: asset.id, scannedCode: parsed.code, locationId: count.locationId, result, scannedById: req.authUser!.id, scannedByName: req.authUser!.displayName },
    });
    res.status(201).json({ scan: { ...scan, scannedAt: scan.scannedAt.getTime() }, asset });
  } catch {
    res.status(409).json({ error: 'Bu demirbaş aynı sayımda daha önce okutuldu.', result: 'DUPLICATE' });
  }
});


assetsRouter.get('/counts/:id/scans', requireAuth, requireAnyAssetPermission(p=>p.assets.countsReview), async (req, res) => {
  const countId = routeParam(req.params.id);
  const count = await prisma.assetCount.findUnique({ where: { id: countId } });
  if (!count) {
    res.status(404).json({ error: 'Sayım bulunamadı.' });
    return;
  }
  await assertBranchPermission(req, count.branchCode, permissions => permissions.assets.countsReview);

  const scans = await prisma.assetCountScan.findMany({
    where: { countId, branchCode: count.branchCode },
    orderBy: { scannedAt: 'desc' },
    take: 5000,
  });
  const assets = await prisma.asset.findMany({
    where: { id: { in: scans.map(scan => scan.assetId) } },
  });
  const assetMap = new Map(assets.map(asset => [asset.id, asset]));

  res.json(scans.map(scan => ({
    ...scan,
    scannedAt: scan.scannedAt.getTime(),
    asset: assetMap.get(scan.assetId) ?? null,
  })));
});

assetsRouter.put('/counts/:countId/scans/:scanId', requireAuth, requireAnyAssetPermission(p=>p.assets.countsCorrect), async (req: AuthRequest, res) => {
  const countId = routeParam(req.params.countId);
  const scanId = routeParam(req.params.scanId);
  const parsed = z.object({
    result: z.enum(['MATCHED', 'WRONG_LOCATION', 'REVIEW_REQUIRED']).optional(),
    note: z.string().max(2000).optional(),
  }).parse(req.body);

  const count = await prisma.assetCount.findUnique({ where: { id: countId } });
  if (!count) { res.status(404).json({ error: 'Sayım bulunamadı.' }); return; }
  await assertBranchPermission(req, count.branchCode, permissions => permissions.assets.countsCorrect);
  const existing = await prisma.assetCountScan.findFirst({ where: { id: scanId, countId, branchCode: count.branchCode } });
  if (!existing) {
    res.status(404).json({ error: 'Sayım okutması bulunamadı.' });
    return;
  }

  const updated = await prisma.assetCountScan.update({
    where: { id: scanId },
    data: {
      ...(parsed.result ? { result: parsed.result } : {}),
      ...(parsed.note !== undefined ? { note: parsed.note } : {}),
    },
  });

  await audit(req, 'UPDATE', 'ASSET_COUNT_SCAN', updated.id, `${countId}:${updated.assetId}`, updated.branchCode);
  res.json({ ...updated, scannedAt: updated.scannedAt.getTime() });
});

assetsRouter.delete('/counts/:countId/scans/:scanId', requireAuth, requireAnyAssetPermission(p=>p.assets.countsCorrect), async (req: AuthRequest, res) => {
  const countId = routeParam(req.params.countId);
  const scanId = routeParam(req.params.scanId);
  const count = await prisma.assetCount.findUnique({ where: { id: countId } });
  if (!count) { res.status(404).json({ error: 'Sayım bulunamadı.' }); return; }
  await assertBranchPermission(req, count.branchCode, permissions => permissions.assets.countsCorrect);
  const existing = await prisma.assetCountScan.findFirst({ where: { id: scanId, countId, branchCode: count.branchCode } });
  if (!existing) {
    res.status(404).json({ error: 'Sayım okutması bulunamadı.' });
    return;
  }

  await prisma.assetCountScan.delete({ where: { id: scanId } });
  await audit(req, 'DELETE', 'ASSET_COUNT_SCAN', scanId, `${countId}:${existing.assetId}`, existing.branchCode);
  res.status(204).end();
});

assetsRouter.post('/counts/:id/complete', requireAuth, requireAnyAssetPermission(p=>p.assets.countsComplete), async (req, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.assetCount.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Sayım bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.countsComplete);
  const row = await prisma.assetCount.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
  res.json({ ...row, startedAt: row.startedAt.getTime(), completedAt: row.completedAt?.getTime() ?? null, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

assetsRouter.get('/counts/:id/differences', requireAuth, requireAnyAssetPermission(p=>p.assets.reportsView), async (req, res) => {
  const count = await prisma.assetCount.findUnique({ where: { id: routeParam(req.params.id) } });
  if (!count) { res.status(404).json({ error: 'Sayım bulunamadı.' }); return; }
  await assertBranchPermission(req, count.branchCode, permissions => permissions.assets.reportsView);
  const [expected, scans] = await Promise.all([
    prisma.asset.findMany({ where: { branchCode: count.branchCode, locationId: count.locationId, deletedAt: null } }),
    prisma.assetCountScan.findMany({ where: { branchCode: count.branchCode, countId: count.id } }),
  ]);
  const scanned = new Set(scans.map(scan => scan.assetId));
  const missing = expected.filter(asset => !scanned.has(asset.id));
  const wrongLocation = scans.filter(scan => scan.result === 'WRONG_LOCATION');
  res.json({
    count,
    totals: { expected: expected.length, scanned: scans.length, matched: scans.filter(s => s.result === 'MATCHED').length, missing: missing.length, wrongLocation: wrongLocation.length },
    missing,
    wrongLocation,
  });
});

assetsRouter.post('/qr/:entityType/:entityId', requireAuth, requireAnyAssetPermission(p=>p.assets.labelsPrint || p.assets.locationsManage), async (req: AuthRequest, res) => {
  const entityType = routeParam(req.params.entityType).toUpperCase();
  if (!['ASSET', 'LOCATION', 'DOCUMENT'].includes(entityType)) { res.status(400).json({ error: 'QR türü geçersiz.' }); return; }
  const entityId = routeParam(req.params.entityId);
  const branchCode = entityType === 'ASSET'
    ? (await prisma.asset.findUnique({ where: { id: entityId } }))?.branchCode
    : entityType === 'LOCATION'
      ? (await prisma.assetParty.findUnique({ where: { id: entityId } }))?.branchCode
      : (await prisma.assetAssignment.findUnique({ where: { id: entityId } }))?.branchCode;
  if (!branchCode) { res.status(404).json({ error: 'QR hedefi bulunamadı.' }); return; }
  await assertBranchPermission(req, branchCode, permissions => permissions.assets.labelsPrint || permissions.assets.locationsManage);
  await prisma.assetQrToken.updateMany({ where: { entityType, entityId: routeParam(req.params.entityId), active: true }, data: { active: false, revokedAt: new Date() } });
  const token = createOpaqueToken();
  await prisma.assetQrToken.create({ data: { branchCode, tokenHash: tokenHash(token), entityType, entityId, createdById: req.authUser!.id } });
  res.status(201).json({ payload: `operis://scan/v1/${token}` });
});

assetsRouter.post('/qr/resolve', requireAuth, async (req, res) => {
  const parsed = z.object({ payload: z.string().min(1) }).parse(req.body);
  const token = parsed.payload.replace(/^operis:\/\/scan\/v1\//, '');
  const qr = await prisma.assetQrToken.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!qr || !qr.active) { res.status(404).json({ error: 'QR geçersiz veya pasif.' }); return; }
  await assertBranchPermission(req, qr.branchCode, permissions => permissions.assets.cardsView || permissions.assets.locationsView || permissions.assets.documentsView);
  if (qr.entityType === 'ASSET') {
    const asset = await prisma.asset.findUnique({ where: { id: qr.entityId } });
    res.json({ entityType: 'ASSET', entity: asset });
    return;
  }
  if (qr.entityType === 'LOCATION') {
    const location = await prisma.assetParty.findUnique({ where: { id: qr.entityId } });
    res.json({ entityType: 'LOCATION', entity: location });
    return;
  }
  const document = await prisma.assetAssignment.findUnique({ where: { id: qr.entityId } });
  res.json({ entityType: 'DOCUMENT', entity: document });
});

assetsRouter.get('/qr/image', requireAuth, async (req, res) => {
  const payload = typeof req.query.payload === 'string' ? req.query.payload : '';
  if (!payload.startsWith('operis://scan/v1/')) { res.status(400).end(); return; }
  const png = await QRCode.toBuffer(payload, { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' });
  res.type('png').send(png);
});


const labelTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  widthMm: z.number().min(10).max(300),
  heightMm: z.number().min(10).max(300),
  printerLanguage: z.enum(['WINDOWS', 'ZPL', 'TSPL', 'TPCL', 'PDF']),
  layoutJson: z.string().min(2).max(200000),
  isDefault: z.boolean().default(false),
});

assetsRouter.get('/labels', requireAuth, requireAnyAssetPermission(p=>p.assets.labelsView), async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.labelsView);
  const rows = await prisma.assetLabelTemplate.findMany({ where: { branchCode: { in: branchCodes } }, orderBy: { updatedAt: 'desc' } });
  res.json(rows.map(row => ({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() })));
});

assetsRouter.post('/labels', requireAuth, requireAnyAssetPermission(p=>p.assets.labelsDesign), async (req: AuthRequest, res) => {
  const parsed = labelTemplateSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.assets.labelsDesign,'Bu şubede etiket şablonu oluşturma yetkiniz yok.');
  if (parsed.isDefault) await prisma.assetLabelTemplate.updateMany({ where: { branchCode }, data: { isDefault: false } });
  const row = await prisma.assetLabelTemplate.create({ data: { ...parsed, branchCode, createdById: req.authUser!.id } });
  await audit(req, 'CREATE', 'ASSET_LABEL_TEMPLATE', row.id, row.name, row.branchCode);
  res.status(201).json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

assetsRouter.put('/labels/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.labelsDesign), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.assetLabelTemplate.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Etiket şablonu bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.labelsDesign);
  const parsed = labelTemplateSchema.parse(req.body);
  if (parsed.isDefault) {
    await prisma.assetLabelTemplate.updateMany({ where: { branchCode: before.branchCode, id: { not: id } }, data: { isDefault: false } });
  }
  const row = await prisma.assetLabelTemplate.update({ where: { id }, data: parsed });
  await audit(req, 'UPDATE', 'ASSET_LABEL_TEMPLATE', row.id, row.name, row.branchCode);
  res.json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

assetsRouter.delete('/labels/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.labelsDesign), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.assetLabelTemplate.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Etiket şablonu bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.labelsDesign);
  const row = await prisma.assetLabelTemplate.findUnique({ where: { id } });
  if (!row) {
    res.status(404).json({ error: 'Etiket şablonu bulunamadı.' });
    return;
  }
  await prisma.assetLabelTemplate.delete({ where: { id } });
  await audit(req, 'DELETE', 'ASSET_LABEL_TEMPLATE', row.id, row.name, row.branchCode);
  res.status(204).end();
});


assetsRouter.get('/reports/assignment-history', requireAuth, requireAnyAssetPermission(p=>p.assets.reportsView), async (req, res) => {
  const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : undefined;
  const targetId = typeof req.query.targetId === 'string' ? req.query.targetId : undefined;
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.assets.reportsView);
  const rows = await prisma.assetAssignment.findMany({
    where: { branchCode: { in: branchCodes }, ...(assetId ? { assetId } : {}), ...(targetId ? { targetId } : {}) },
    orderBy: { startAt: 'desc' }, take: 5000,
  });
  res.json(rows.map(row => ({ ...row, startAt: row.startAt.getTime(), endAt: row.endAt?.getTime() ?? null })));
});



async function getAuthorizedExternalConnection(req: AuthRequest, id: string, manage = false) {
  const connection = await prisma.assetExternalConnection.findUnique({ where: { id } });
  if (!connection) {
    const error = new Error('Harici veri kaynağı bulunamadı.') as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  await assertBranchPermission(
    req,
    connection.branchCode,
    permissions => manage ? permissions.assets.integrationsManage : permissions.assets.integrationsView,
    manage ? 'Bu şubede harici veri kaynağı yönetme yetkiniz yok.' : 'Bu şubede harici veri kaynağı görüntüleme yetkiniz yok.',
  );

  if (connection.branchVisibility === 'CENTER_ONLY') {
    const context = await branchContextFromRequest(req);
    if (!context.canSeeAllBranches) {
      const error = new Error('Bu harici veri kaynağı yalnız 100 Merkez görünümüne açıktır.') as Error & { status?: number };
      error.status = 403;
      throw error;
    }
  }

  return connection;
}

assetsRouter.post('/external-connections/:id/test', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsManage), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  try {
    const connection = await getAuthorizedExternalConnection(req, id, true);
    const result = await testExternalMssqlConnection(connection);
    await prisma.assetExternalConnection.update({
      where: { id },
      data: {
        lastTestAt: new Date(),
        lastTestResult: `OK | ${result.server} | ${result.database} | ${result.login}`,
      },
    });
    await audit(req, 'TEST', 'ASSET_EXTERNAL_CONNECTION', id, `${connection.branchCode}:${connection.name}:OK`, connection.branchCode);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bağlantı sınanamadı.';
    await prisma.assetExternalConnection.update({
      where: { id },
      data: { lastTestAt: new Date(), lastTestResult: `ERROR | ${message.slice(0, 900)}` },
    }).catch(() => undefined);
    res.json({
      ok: false,
      database: '',
      server: '',
      login: '',
      serverTime: '',
      message,
    });
  }
});

assetsRouter.post('/sync-external-asset-data', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsView), async (req:AuthRequest,res)=>{
  const branchCodes=await readAccessibleBranchCodesForPermission(req, permissions=>permissions.assets.cardsView);
  const connections=await prisma.assetExternalConnection.findMany({
    where:{
      branchCode:{in:branchCodes},
      type:'MSSQL',
    },
    orderBy:[{branchCode:'asc'},{name:'asc'}],
  });

  const results:Array<{
    connectionId:string;
    connectionName:string;
    branchCode:string;
    demirmas?:{scanned:number;fetched:number;created:number;updated:number;unchanged:number;protectedOperis:number};
    demsatis?:{scanned:number;fetched:number;created:number;updated:number;unchanged:number;autoMarkedSales:number};
    errors:string[];
  }>=[];

  for(const connection of connections){
    const item={
      connectionId:connection.id,
      connectionName:connection.name,
      branchCode:connection.branchCode,
      errors:[] as string[],
    } as {
      connectionId:string;
      connectionName:string;
      branchCode:string;
      demirmas?:{scanned:number;fetched:number;created:number;updated:number;unchanged:number;protectedOperis:number};
      demsatis?:{scanned:number;fetched:number;created:number;updated:number;unchanged:number;autoMarkedSales:number};
      errors:string[];
    };

    try{
      item.demirmas=await syncTblDemirmasConnection(connection.id,true);
    }catch(error){
      item.errors.push(`TBLDEMIRMAS: ${error instanceof Error ? error.message : 'Senkron hatası'}`);
    }

    try{
      item.demsatis=await syncTblDemSatisConnection(connection.id,true);
    }catch(error){
      item.errors.push(`TBLDEMSATIS: ${error instanceof Error ? error.message : 'Senkron hatası'}`);
    }

    results.push(item);
  }

  res.json({
    connectionCount:connections.length,
    results,
    hasErrors:results.some(item=>item.errors.length>0),
  });
});

assetsRouter.get('/sales-external', requireAuth, requireAnyAssetPermission(p=>p.assets.cardsView), async (req,res)=>{
  const branchCodes=await readBranchCodesForPermission(req, permissions=>permissions.assets.cardsView);
  const [rows, operisSales]=await Promise.all([
    prisma.assetSaleExternal.findMany({
      where:{branchCode:{in:branchCodes}},
      orderBy:[{sourceChangedAt:'desc'},{demirKodu:'desc'}],
    }),
    prisma.asset.findMany({
      where:{branchCode:{in:branchCodes},deletedAt:null,status:'SALE'},
      orderBy:[{updatedAt:'desc'},{assetCode:'desc'}],
    }),
  ]);

  const sqlRows=rows.map(r=>({
    ...r,
    sourceType:'SQL',
    sourceChangedAt:r.sourceChangedAt?.getTime()??null,
    sourceSyncedAt:r.sourceSyncedAt?.getTime()??null,
    createdAt:r.createdAt.getTime(),
    updatedAt:r.updatedAt.getTime(),
  }));

  const localRows=operisSales.map(asset=>({
    id:`operis-sale:${asset.id}`,
    branchCode:asset.branchCode,
    connectionId:'OPERIS',
    sirketKodu:asset.sourceSirketKodu,
    demirKodu:asset.assetCode,
    tarih:asset.sourceSatisTarihi || asset.updatedAt.toISOString().slice(0,10),
    belgeNo:asset.sourceResBelgeNo,
    alici:asset.currentTargetName || '',
    satisMiktari:asset.quantity,
    aciklama:asset.description || 'Operis Demirbaş Kartında Satış olarak işaretlendi.',
    sourceType:'OPERIS_STATUS',
    sourceChangedAt:asset.updatedAt.getTime(),
    sourceSyncedAt:asset.updatedAt.getTime(),
    createdAt:asset.createdAt.getTime(),
    updatedAt:asset.updatedAt.getTime(),
  }));

  res.json([...localRows,...sqlRows]);
});

assetsRouter.post('/external-connections/:id/sync-tbldemsatis', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsManage), async (req:AuthRequest,res)=>{
  const id=routeParam(req.params.id);
  const connection=await getAuthorizedExternalConnection(req,id,true);
  res.json(await syncTblDemSatisConnection(connection.id));
});

assetsRouter.post('/external-connections/:id/sync-tbldemirmas', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsManage), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const connection = await getAuthorizedExternalConnection(req, id, true);
  const result = await syncTblDemirmasConnection(connection.id);
  res.json(result);
});

assetsRouter.get('/external-connections/:id/tables', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsView), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const connection = await getAuthorizedExternalConnection(req, id, false);
  const tables = await listAuthorizedExternalTables(connection);
  res.json({ tables });
});

assetsRouter.get('/external-connections/:id/table-columns', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsView), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const schemaName = String(req.query.schema ?? '');
  const tableName = String(req.query.table ?? '');
  const connection = await getAuthorizedExternalConnection(req, id, false);
  const columns = await getAuthorizedExternalColumns(connection, schemaName, tableName);
  res.json({ schemaName, tableName, columns });
});

assetsRouter.get('/external-connections/:id/table-data', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsView), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const schemaName = String(req.query.schema ?? '');
  const tableName = String(req.query.table ?? '');
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit ?? 1000) || 1000));

  const connection = await getAuthorizedExternalConnection(req, id, false);
  const [columns, total, rows] = await Promise.all([
    getAuthorizedExternalColumns(connection, schemaName, tableName),
    countAuthorizedExternalRows(connection, schemaName, tableName),
    readAuthorizedExternalRows(connection, schemaName, tableName, offset, limit),
  ]);

  res.json({
    schemaName,
    tableName,
    columns,
    total,
    offset,
    limit,
    rows,
    hasMore: offset + rows.length < total,
  });
});

assetsRouter.get('/external-connections', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsView), async (req, res) => {
  const context = await branchContextFromRequest(req);
  const branchCodes = await readAccessibleBranchCodesForPermission(req, permissions => permissions.assets.integrationsView);

  const rows = await prisma.assetExternalConnection.findMany({
    where: context.canSeeAllBranches
      ? { branchCode: { in: branchCodes } }
      : { branchCode: { in: branchCodes }, branchVisibility: 'BRANCH' },
    orderBy: [{ branchCode: 'asc' }, { name: 'asc' }],
  });
  res.json(rows.map(serializeExternalConnection));
});

assetsRouter.post('/external-connections', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsManage), async (req: AuthRequest, res) => {
  const data = externalConnectionSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.assets.integrationsManage,'Bu şubede harici bağlantı oluşturma yetkiniz yok.');
  const row = await prisma.assetExternalConnection.create({
    data: {
      branchCode,
      branchVisibility: data.branchVisibility,
      name: data.name,
      type: data.type,
      host: data.host,
      port: data.port,
      database: data.database,
      username: data.username,
      passwordEncrypted: data.password ? encryptText(data.password) : '',
      queryText: data.queryText,
      purpose: data.purpose,
      enabled: data.enabled,
    },
  });
  await audit(req, 'CREATE', 'ASSET_EXTERNAL_CONNECTION', row.id, `${branchCode}:${row.name}`, row.branchCode);
  res.status(201).json(serializeExternalConnection(row));
});

assetsRouter.put('/external-connections/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsManage), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.assetExternalConnection.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Harici veri kaynağı bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.integrationsManage);
  const data = externalConnectionSchema.parse(req.body);
  const row = await prisma.assetExternalConnection.update({
    where: { id },
    data: {
      branchVisibility: data.branchVisibility,
      name: data.name,
      type: data.type,
      host: data.host,
      port: data.port,
      database: data.database,
      username: data.username,
      passwordEncrypted: data.password ? encryptText(data.password) : before.passwordEncrypted,
      queryText: data.queryText,
      purpose: data.purpose,
      enabled: data.enabled,
    },
  });
  await audit(req, 'UPDATE', 'ASSET_EXTERNAL_CONNECTION', row.id, `${row.branchCode}:${row.name}`, row.branchCode);
  res.json(serializeExternalConnection(row));
});

assetsRouter.delete('/external-connections/:id', requireAuth, requireAnyAssetPermission(p=>p.assets.integrationsManage), async (req: AuthRequest, res) => {
  const id = routeParam(req.params.id);
  const before = await prisma.assetExternalConnection.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Harici veri kaynağı bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.assets.integrationsManage);
  await prisma.assetExternalConnection.delete({ where: { id } });
  await audit(req, 'DELETE', 'ASSET_EXTERNAL_CONNECTION', id, `${before.branchCode}:${before.name}`, before.branchCode);
  res.status(204).end();
});
