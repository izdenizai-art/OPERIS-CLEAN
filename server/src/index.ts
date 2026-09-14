import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from './db.js';
import { clearSession, publicUser, requireAuth, requirePermission, setSession, type AuthRequest } from './auth.js';
import { activeLoginBlock, clearLoginBlock, normalizeClientIp, observeMacAddress, recordFailedLogin, recordSuccessfulLogin } from './login-security.js';
import { ADMIN_PERMISSIONS, normalizePermissions, serializeBranchPermissions } from './permissions.js';
import { decryptText, encryptText } from './crypto.js';
import { createResetToken, getMailSettings, hashResetToken, sendMail, sendTestMail, updateMailSettings, verifyMailConnection } from './mailer.js';
import { getGraphMailSettings, sendGraphMail, testGraphMail, updateGraphMailSettings } from './graph-mailer.js';
import archiver from 'archiver';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { startReminderScheduler } from './reminders.js';
import { getLicenseStatus, isLicenseOwner, updateLicenseExpiry } from './license.js';
import { adminToolsRouter } from './routes/admin-tools.js';
import { assetsRouter } from './routes/assets.js';
import { networkMonitorRouter, startNetworkMonitorScheduler } from './network-monitor.js';
import { helpDeskRouter, ensureHelpDeskFoundation } from './helpdesk.js';
import { startTblDemirmasHourlyScheduler } from './tbldemirmas-sync.js';
import { startTblDemSatisHourlyScheduler } from './tbldemsatis-sync.js';
import { DomainConnectionError, getDomainSyncSettings, updateDomainSyncSettings, testDomainConnection, syncDomainUsers, syncDomainUserForLogin, startDomainSyncScheduler } from './domain-sync.js';
import { branchRouter } from './branch-routes.js';
import { assertBranchAccess, assertBranchPermission, branchContextFromRequest, ensureBranchFoundation, readBranchCodes, readBranchCodesForPermission, writeBranchCode } from './branch-access.js';
import type { User } from '@prisma/client';

const CURRENT_VERSION = '6.3.63';
const RELEASE_NAME = 'Enterprise Sürüm Önceliği ve Duyuru Sıralama Hotfix';
const RELEASE_HEADLINES = [
  'Güncelleme sonrasında önce Sürüm Güncelleme ekranı açılır',
  'Sürüm ekranı kapatıldıktan sonra bekleyen duyuru gösterilir',
  'Duyurular sürüm ekranı açıkken okundu olarak işaretlenmez',
  'İstemci ve sunucu sürüm sabitleri 6.3.63 olarak eşitlendi',
  'Duyuru Gelen ve Gönderilen kutuları kalıcı olarak korunur',
  'Tema bazlı yüksek kontrastlı duyuru görünümü korunur',
  'Enterprise otomatik geri alma ve veritabanı koruma mekanizması korunur',
] as const;

async function ensureAssetIdentifierUniqueIndexes(): Promise<void> {
  const statements = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "Asset_active_serialNumber_unique"
     ON "Asset" ("serialNumber")
     WHERE "serialNumber" <> '' AND "deletedAt" IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Asset_active_barcode_unique"
     ON "Asset" ("barcode")
     WHERE "barcode" <> '' AND "deletedAt" IS NULL`,
  ];

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      console.error('[ASSET UNIQUE INDEX]', error);
    }
  }
}

const app = express();
app.use(helmet({
  // Yerel ağda HTTP ile çalışırken tarayıcının JS/CSS kaynaklarını zorla HTTPS'e
  // yükseltmesini engeller. HTTPS reverse proxy kullanıldığında aynı paket çalışır.
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'upgrade-insecure-requests': null,
    },
  },
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
}));
const port = Number(process.env.PORT ?? 3001);
const bindHost = process.env.BIND_HOST?.trim() || '0.0.0.0';

function operisAllowedOrigins(): Set<string> {
  const origins = new Set(
    (process.env.CLIENT_ORIGIN ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
  origins.add(`http://localhost:${port}`);
  origins.add(`http://127.0.0.1:${port}`);
  origins.add(`http://${os.hostname()}:${port}`);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        origins.add(`http://${address.address}:${port}`);
      }
    }
  }
  return origins;
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, operisAllowedOrigins().has(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

type RemoteAccessMode = 'SERVER_ONLY' | 'LOCAL_NETWORK' | 'ALL_ALLOWED';

let remoteAccessCache: { mode: RemoteAccessMode; loadedAt: number } | null = null;

function normalizeRemoteAddress(value: string | undefined | null) {
  const raw = String(value ?? '').trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function serverIPv4Addresses() {
  const values = new Set<string>(['127.0.0.1']);
  if (bindHost && bindHost !== '0.0.0.0' && bindHost !== '::') values.add(bindHost);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4') values.add(address.address);
    }
  }
  return values;
}

function firstForwardedClientIp(req: express.Request) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  const realIp = String(req.headers['x-real-ip'] ?? '').trim();
  return normalizeRemoteAddress(forwarded || realIp);
}

function remoteAccessClientIp(req: express.Request) {
  const socketIp = normalizeRemoteAddress(req.socket.remoteAddress);
  const loopbackSocket = socketIp === '::1' || socketIp === '127.0.0.1';

  // Forwarding headers are attacker-controlled on direct connections. Trust them
  // only when the TCP peer is a loopback reverse proxy running on this server.
  if (loopbackSocket) {
    const forwarded = firstForwardedClientIp(req);
    if (forwarded) return forwarded;
  }
  return socketIp;
}

function ipv4ToInt(ip: string) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isInSubnet(ip: string, network: string, prefixLength: number) {
  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  if (ipInt == null || networkInt == null || prefixLength < 0 || prefixLength > 32) return false;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}

function isLocalNetworkAddress(ip: string) {
  if (serverIPv4Addresses().has(ip)) return true;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const prefix = typeof address.cidr === 'string' && address.cidr.includes('/')
        ? Number(address.cidr.split('/')[1])
        : null;
      if (prefix != null && Number.isInteger(prefix) && isInSubnet(ip, address.address, prefix)) return true;
    }
  }
  return false;
}

async function currentRemoteAccessMode(): Promise<RemoteAccessMode> {
  if (remoteAccessCache && Date.now() - remoteAccessCache.loadedAt < 3000) return remoteAccessCache.mode;
  const row = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const mode: RemoteAccessMode = row.remoteAccessMode === 'SERVER_ONLY' || row.remoteAccessMode === 'LOCAL_NETWORK'
    ? row.remoteAccessMode
    : 'ALL_ALLOWED';
  remoteAccessCache = { mode, loadedAt: Date.now() };
  return mode;
}

async function syncRemoteAccessFirewall(mode: RemoteAccessMode) {
  if (process.platform !== 'win32') return { applied: false, reason: 'Windows dışında firewall değişikliği uygulanmadı.' };

  const localAddress = bindHost && bindHost !== '0.0.0.0' && bindHost !== '::' ? bindHost : 'Any';
  const names = [
    `Operis Enterprise TCP ${port}`,
    `Operis Enterprise TCP ${port} - DomainPrivate`,
    `Operis Enterprise TCP ${port} - PublicLocalSubnet`,
    `Operis Enterprise TCP ${port} - ManagedAccess`,
  ];

  const escapedNames = names.map(name => `'${name.replaceAll("'", "''")}'`).join(',');
  const remoteAddress = mode === 'LOCAL_NETWORK' ? 'LocalSubnet' : 'Any';
  const createRule = mode === 'SERVER_ONLY'
    ? ''
    : `New-NetFirewallRule -DisplayName 'Operis Enterprise TCP ${port} - ManagedAccess' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -LocalAddress '${localAddress.replaceAll("'", "''")}' -RemoteAddress '${remoteAddress}' -Profile Any | Out-Null`;

  const script = [
    "$ErrorActionPreference='Stop'",
    `$names=@(${escapedNames})`,
    "foreach($name in $names){ Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue }",
    createRule,
  ].filter(Boolean).join('; ');

  await new Promise<void>((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', script],
      { windowsHide: true, timeout: 90000, encoding: 'utf8' }, (error, _stdout, stderr) => {
        if (error) { reject(new Error(String(stderr || error.message || 'Windows Firewall güncellenemedi.').trim())); return; }
        resolve();
      });
  });

  return { applied: true, reason: mode === 'SERVER_ONLY' ? 'Harici inbound allow kuralı kaldırıldı.' : `Firewall ${remoteAddress} erişimine göre güncellendi.` };
}

app.use(async (req, res, next) => {
  try {
    const mode = await currentRemoteAccessMode();
    if (mode === 'ALL_ALLOWED') { next(); return; }

    const remoteIp = remoteAccessClientIp(req);
    const ownServer = serverIPv4Addresses().has(remoteIp) || remoteIp === '::1';
    if (ownServer) { next(); return; }

    if (mode === 'LOCAL_NETWORK' && isLocalNetworkAddress(remoteIp)) { next(); return; }

    res.status(403).json({
      error: mode === 'SERVER_ONLY'
        ? 'OPERİS sunucu dışı erişime kapalıdır. Sunucunun kendi IP adresinden erişin.'
        : 'OPERİS yalnız sunucu ve yerel ağ erişimine açıktır.',
      code: 'REMOTE_ACCESS_BLOCKED',
      remoteAccessMode: mode,
      clientIp: remoteIp,
    });
  } catch (error) {
    next(error);
  }
});


const sectionSchema = z.object({
  canView: z.boolean(), canCreate: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean(), canExcel: z.boolean(),
});

const assetPermissionsSchema = z.object({
  dashboardView: z.boolean(),
  cardsView: z.boolean(),
  cardsCreate: z.boolean(),
  cardsEdit: z.boolean(),
  cardsDelete: z.boolean(),
  assignmentsView: z.boolean(),
  assignmentsCreate: z.boolean(),
  assignmentsReturn: z.boolean(),
  transfersView: z.boolean(),
  transfersCreate: z.boolean(),
  transfersApprove: z.boolean(),
  countsView: z.boolean(),
  countsCreate: z.boolean(),
  countsScan: z.boolean(),
  countsReview: z.boolean(),
  countsCorrect: z.boolean(),
  countsComplete: z.boolean(),
  countsApprove: z.boolean(),
  locationsView: z.boolean(),
  locationsManage: z.boolean(),
  labelsView: z.boolean(),
  labelsDesign: z.boolean(),
  labelsPrint: z.boolean(),
  documentsView: z.boolean(),
  documentsPrint: z.boolean(),
  reportsView: z.boolean(),
  reportsExport: z.boolean(),
  integrationsView: z.boolean(),
  integrationsManage: z.boolean(),
});

const permissionsSchema = z.object({
  tasks: sectionSchema,
  credentials: sectionSchema,
  tracking: sectionSchema,
  network: sectionSchema,
  canAccessSettings: z.boolean(),
  canManageUsers: z.boolean(),
  canManageBranches: z.boolean(),
  canAssignUserBranches: z.boolean(),
  canSendBranchAnnouncements: z.boolean(),
  canAccessAssets: z.boolean(),
  assets: assetPermissionsSchema,
});
const usernameSchema = z.string().trim().min(3).max(50).regex(/^[\p{L}\p{N}._-]+$/u);

function canonicalSuperAdminCandidate(value:string){
  return value.trim().normalize('NFKC').replace(/[Iİı]/g,'i').toLowerCase();
}

function normalizeLoginUsername(value:string){
  const trimmed=value.trim().normalize('NFKC');
  if(canonicalSuperAdminCandidate(trimmed)==='balamir')return 'balamir';
  return trimmed.toLocaleLowerCase('tr-TR');
}
const passwordSchema = z.string()
  .min(8, 'Şifre en az 8 karakter olmalıdır.')
  .max(200)
  .regex(/[A-ZÇĞİÖŞÜ]/u, 'Şifre en az bir büyük harf içermelidir.')
  .regex(/[a-zçğıöşü]/u, 'Şifre en az bir küçük harf içermelidir.')
  .regex(/[0-9]/, 'Şifre en az bir rakam içermelidir.')
  .regex(/[^\p{L}\p{N}\s]/u, 'Şifre en az bir özel karakter içermelidir.');
const emailSchema = z.string().trim().email().max(254);
const departmentSchema = z.string().trim().max(120);
const themeSchema = z.enum(['dark', 'light', 'spring', 'gray', 'black', 'ocean-blue', 'pastel-glass', 'corporate-2d']);



function safeDecryptText(value: string): string {
  try {
    return decryptText(value);
  } catch (error) {
    console.error('Şifreli alan çözülemedi:', error);
    return '[Şifreleme anahtarı uyuşmuyor]';
  }
}

function serializeAudit(value: unknown): string {
  if (value == null) return '';
  try {
    const text = JSON.stringify(value);
    return text.length > 20000 ? `${text.slice(0, 20000)}…` : text;
  } catch {
    return String(value);
  }
}

const AUDIT_MODULE_TR: Record<string, string> = {
  AUTH: 'Kimlik Doğrulama', TASKS: 'Yaklaşan İşler', TRACKING: 'Takip Kayıtları',
  CREDENTIALS: 'Şifreler / Erişim Bilgileri', RELEASE: 'Sürüm Bilgileri', LICENSE: 'Lisans',
  SESSION: 'Oturum Yönetimi', GRAPH_MAIL_SETTINGS: 'Microsoft Graph E-posta Ayarları',
  GRAPH_MAIL: 'Microsoft Graph E-posta', REPORTS: 'Raporlar', USERS: 'Kullanıcı Yönetimi',
  NOTES: 'Notlar', ANNOUNCEMENT: 'Duyurular', NETWORK: 'Network İzleme',
  NETWORK_MONITOR: 'Network İzleme', NETWORK_SERVICE: 'Network Servis İzleme', NETWORK_TOPOLOGY: 'Ağ Mimarisi / Topoloji',
  ASSETS: 'Demirbaş Yönetimi', ADMIN_TOOLS: 'Yönetim Araçları',
};

const AUDIT_ACTION_TR: Record<string, string> = {
  LOGIN: 'Giriş Yapıldı', CREATE: 'Kayıt Eklendi', UPDATE: 'Kayıt Güncellendi',
  DELETE: 'Kayıt Silindi', RESTORE: 'Kayıt Geri Yüklendi', SEND_MAIL: 'E-posta Gönderildi',
  TEST_MAIL: 'E-posta Testi Yapıldı', ACKNOWLEDGE: 'Onaylandı', REVOKE: 'Oturum Sonlandırıldı',
  REVOKE_ALL: 'Tüm Oturumlar Sonlandırıldı', LOCK_ACQUIRE: 'Düzenleme Kilidi Alındı',
  LOCK_REFRESH: 'Düzenleme Kilidi Yenilendi', LOCK_RELEASE: 'Düzenleme Kilidi Bırakıldı',
  LOCK_FORCE_RELEASE: 'Düzenleme Kilidi Zorla Kaldırıldı',
};

const AUDIT_FIELD_TR: Record<string, string> = {
  title: 'Başlık', description: 'Açıklama', name: 'Ad', groupName: 'Grup Adı',
  username: 'Kullanıcı Adı', email: 'E-posta', status: 'Durum', priority: 'Öncelik',
  dueDate: 'Tarih', serviceDate: 'Servis Tarihi', serviceNumber: 'Servis Numarası',
  serviceLocation: 'Servis Yeri', note: 'Not', host: 'IP / Host', deviceType: 'Cihaz Tipi',
  vendor: 'Üretici', location: 'Lokasyon', active: 'Aktif', port: 'Port', protocol: 'Protokol',
  displayName: 'Ad Soyad', department: 'Departman', role: 'Rol', deletedAt: 'Silinme Tarihi',
};

function auditPlain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function auditDisplayValue(value: unknown): string {
  if (value == null || value === '') return 'boş';
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (typeof value === 'object') {
    try { return JSON.stringify(value).slice(0, 250); } catch { return String(value); }
  }
  const text = String(value);
  return text.length > 250 ? `${text.slice(0, 250)}…` : text;
}

function auditDescription(action: string, module: string, recordLabel: string, oldData?: unknown, newData?: unknown): string {
  const moduleTr = AUDIT_MODULE_TR[module] ?? module;
  const actionTr = AUDIT_ACTION_TR[action] ?? action;
  const label = recordLabel || 'Kayıt';
  if (action === 'CREATE') return `${moduleTr} modülünde “${label}” kaydı eklendi.`;
  if (action === 'DELETE') return `${moduleTr} modülünde “${label}” kaydı silindi. Silinen kayıt bilgileri işlem geçmişinde saklandı.`;
  if (action === 'RESTORE') return `${moduleTr} modülünde “${label}” kaydı geri yüklendi.`;
  if (action === 'UPDATE') {
    const before = auditPlain(oldData);
    const after = auditPlain(newData);
    const ignored = new Set(['updatedAt', 'createdAt', 'password', 'passwordHash', 'token', 'resetToken']);
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const changes = keys.filter(key => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .slice(0, 20)
      .map(key => `${AUDIT_FIELD_TR[key] ?? key}: “${auditDisplayValue(before[key])}” → “${auditDisplayValue(after[key])}”`);
    return changes.length
      ? `${moduleTr} modülünde “${label}” kaydı güncellendi. Değişiklikler: ${changes.join('; ')}.`
      : `${moduleTr} modülünde “${label}” kaydı güncellendi.`;
  }
  return `${moduleTr} modülünde “${label}” için ${actionTr.toLocaleLowerCase('tr-TR')}.`;
}

async function writeAudit(
  req: AuthRequest,
  action: string,
  module: string,
  recordId = '',
  recordLabel = '',
  oldData?: unknown,
  newData?: unknown,
) {
  try {
    const branchFromData = [newData, oldData]
      .map(value => {
        if (!value || typeof value !== 'object') return '';
        const candidate = String((value as Record<string, unknown>).branchCode ?? '').trim().toUpperCase();
        return /^(?:\d{3}|ALL)$/.test(candidate) ? candidate : '';
      })
      .find(Boolean);
    const branchCode = branchFromData || (req.authUser ? await writeBranchCode(req) : '100');
    await prisma.auditLog.create({
      data: {
        branchCode,
        userId: req.authUser?.id ?? '',
        username: req.authUser?.username ?? '',
        displayName: req.authUser?.displayName ?? '',
        action,
        module,
        recordId,
        recordLabel,
        description: auditDescription(action, module, recordLabel, oldData, newData),
        oldData: serializeAudit(oldData),
        newData: serializeAudit(newData),
        ipAddress: req.ip ?? '',
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 1000),
      },
    });
  } catch (error) {
    console.error('Audit kaydı oluşturulamadı:', error);
  }
}

const LOCK_TTL_MS = 5 * 60 * 1000;
const lockModuleSchema = z.enum(['TASKS', 'TRACKING', 'CREDENTIALS']);

async function activeRecordLock(module: string, recordId: string) {
  const now = new Date();
  await prisma.recordLock.deleteMany({ where: { expiresAt: { lte: now } } });
  return prisma.recordLock.findUnique({ where: { module_recordId: { module, recordId } } });
}

async function assertRecordLockPermission(
  req: AuthRequest,
  module: 'TASKS' | 'TRACKING' | 'CREDENTIALS',
  recordId: string,
) {
  if (module === 'TASKS') {
    const record = await prisma.task.findUnique({ where: { id: recordId }, select: { branchCode: true, deletedAt: true } });
    if (!record || record.deletedAt) {
      const error = new Error('İş kaydı bulunamadı.') as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    await assertBranchPermission(req, record.branchCode, permissions => permissions.tasks.canEdit, 'Bu şubede iş düzenleme yetkiniz yok.');
    return;
  }

  if (module === 'CREDENTIALS') {
    const record = await prisma.credential.findUnique({ where: { id: recordId }, select: { branchCode: true, deletedAt: true } });
    if (!record || record.deletedAt) {
      const error = new Error('Bilgi kaydı bulunamadı.') as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    await assertBranchPermission(req, record.branchCode, permissions => permissions.credentials.canEdit, 'Bu şubede bilgi düzenleme yetkiniz yok.');
    return;
  }

  const record = await prisma.trackingRecord.findUnique({ where: { id: recordId }, select: { branchCode: true, deletedAt: true } });
  if (!record || record.deletedAt) {
    const error = new Error('Takip kaydı bulunamadı.') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  await assertBranchPermission(req, record.branchCode, permissions => permissions.tracking.canEdit, 'Bu şubede takip kaydı düzenleme yetkiniz yok.');
}

async function assertRecordLock(req: AuthRequest, module: 'TASKS' | 'TRACKING' | 'CREDENTIALS', recordId: string) {
  const lock = await activeRecordLock(module, recordId);
  if (!lock) {
    const error = new Error('Düzenleme kilidi bulunamadı. Kaydı yeniden açın.');
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
  if (lock.userId !== req.authUser!.id && !req.authUser!.isAdmin) {
    const error = new Error(`Bu kayıt şu anda ${lock.displayName || lock.username} tarafından düzenleniyor.`);
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
}

function routeId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
    throw new Error('Geçersiz kayıt kimliği.');
  }
  return value;
}


app.post('/api/record-locks/acquire', requireAuth, async (req: AuthRequest, res) => {
  const parsed = z.object({ module: lockModuleSchema, recordId: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Kilit bilgisi geçersiz.' }); return; }
  const { module, recordId } = parsed.data;
  await assertRecordLockPermission(req, module, recordId);
  const existing = await activeRecordLock(module, recordId);
  if (existing && existing.userId !== req.authUser!.id) {
    res.status(409).json({
      error: `Bu kayıt şu anda ${existing.displayName || existing.username} tarafından düzenleniyor.`,
      lock: { ...existing, acquiredAt: existing.acquiredAt.getTime(), expiresAt: existing.expiresAt.getTime(), ownedByCurrentUser: false },
    });
    return;
  }

  const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
  const row = existing
    ? await prisma.recordLock.update({ where: { id: existing.id }, data: { expiresAt } })
    : await prisma.recordLock.create({ data: {
        module, recordId, userId: req.authUser!.id, username: req.authUser!.username,
        displayName: req.authUser!.displayName, expiresAt,
      } });

  await writeAudit(req, existing ? 'LOCK_REFRESH' : 'LOCK_ACQUIRE', module, recordId, row.displayName);
  res.json({ ...row, acquiredAt: row.acquiredAt.getTime(), expiresAt: row.expiresAt.getTime(), ownedByCurrentUser: true });
});

app.post('/api/record-locks/:id/heartbeat', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const row = await prisma.recordLock.findUnique({ where: { id } });
  if (!row || row.userId !== req.authUser!.id) { res.status(404).json({ error: 'Düzenleme kilidi bulunamadı.' }); return; }
  const updated = await prisma.recordLock.update({ where: { id }, data: { expiresAt: new Date(Date.now() + LOCK_TTL_MS) } });
  res.json({ ...updated, acquiredAt: updated.acquiredAt.getTime(), expiresAt: updated.expiresAt.getTime(), ownedByCurrentUser: true });
});

app.delete('/api/record-locks/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const row = await prisma.recordLock.findUnique({ where: { id } });
  if (!row) { res.status(204).end(); return; }
  if (row.userId !== req.authUser!.id && !req.authUser!.isAdmin) { res.status(403).json({ error: 'Bu kilidi kaldırma yetkiniz yok.' }); return; }
  await prisma.recordLock.delete({ where: { id } });
  await writeAudit(req, 'LOCK_RELEASE', row.module, row.recordId, row.displayName);
  res.status(204).end();
});

app.delete('/api/admin/record-locks/:id/force', requireAuth, requirePermission((_p, u) => u.isAdmin), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const row = await prisma.recordLock.findUnique({ where: { id } });
  if (!row) { res.status(204).end(); return; }
  await prisma.recordLock.delete({ where: { id } });
  await writeAudit(req, 'LOCK_FORCE_RELEASE', row.module, row.recordId, row.displayName);
  res.status(204).end();
});

function currentDatabaseProvider(): 'sqlite' | 'postgresql' | 'unknown' {
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim().toLowerCase();
  if (databaseUrl.startsWith('file:')) return 'sqlite';
  if (databaseUrl.startsWith('postgresql:') || databaseUrl.startsWith('postgres:')) return 'postgresql';
  return 'unknown';
}

app.get('/api/health', async (req, res) => {
  const databaseProvider = currentDatabaseProvider();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    res.json({
      ok: true,
      version: CURRENT_VERSION,
      protocol: req.protocol,
      host: req.get('host') ?? '',
      origin: req.get('origin') ?? '',
      listeningOn: `0.0.0.0:${port}`,
      allowedOrigins: [...operisAllowedOrigins()],
      database: { provider: databaseProvider, connected: true },
    });
  } catch (error) {
    console.error('[DATABASE HEALTH]', error);
    res.status(503).json({
      ok: false,
      version: CURRENT_VERSION,
      code: 'DATABASE_UNAVAILABLE',
      database: { provider: databaseProvider, connected: false },
    });
  }
});

app.get('/api/version-info', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    version: CURRENT_VERSION,
    name: RELEASE_NAME,
    headlines: RELEASE_HEADLINES,
  });
});
app.get('/api/auth/status', async (_req, res) => {
  const settings = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const license = await getLicenseStatus();
  res.json({
    hasUsers: (await prisma.user.count()) > 0,
    license: { expired: license.expired, expiresAt: license.expiresAt },
    branding: {
      companyName: settings.companyName,
      companyLogoDataUrl: settings.companyLogoDataUrl,
      quickLinks: parseBrandingQuickLinks(settings.quickLinksJson),
    },
  });
});
app.post('/api/auth/setup', async (req, res) => {
  if (await prisma.user.count()) { res.status(409).json({ error: 'İlk kurulum daha önce tamamlanmış.' }); return; }
  const parsed = z.object({ username: usernameSchema, displayName: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz veri.' }); return; }
  if(canonicalSuperAdminCandidate(parsed.data.username)!=='balamir'){
    res.status(400).json({error:'İlk kurulum Süper Admin kullanıcı adı balamir olmalıdır.'});
    return;
  }
  const user = await prisma.user.create({ data: {
    username: 'balamir',
    displayName: parsed.data.displayName,
    email: parsed.data.email.toLocaleLowerCase('tr-TR'),
    department: '',
    theme: 'dark',
    passwordHash: await bcrypt.hash(parsed.data.password, 12),
    permissions: ADMIN_PERMISSIONS,
    active: true, isAdmin: true,
  }});
  await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await setSession(req, res, user.id);
  res.status(201).json({ user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ username: usernameSchema, password: z.string().min(1).max(200) }).safeParse(req.body);
  const ipAddress = normalizeClientIp(req.headers['x-forwarded-for'] as string | undefined) || normalizeClientIp(req.socket.remoteAddress);
  const macAddress = await observeMacAddress(ipAddress);
  const block = await activeLoginBlock(ipAddress);
  if (block) {
    await prisma.loginSecurityEvent.create({
      data:{usernameAttempt:parsed.success?parsed.data.username.slice(0,120):'',ipAddress,macAddress,success:false,reason:`Engelli IP giriş denemesi: ${block.reason}`},
    });
    res.status(429).json({error:`Bu ağ adresinden giriş geçici olarak engellendi. Tekrar deneyebileceğiniz zaman: ${block.blockedUntil?.toLocaleString('tr-TR')}`,
      code:'LOGIN_BLOCKED',blockedUntil:block.blockedUntil?.getTime()??null});
    return;
  }
  if (!parsed.success) {
    const newBlock=await recordFailedLogin('',ipAddress,macAddress);
    res.status(newBlock?429:400).json({error:newBlock?`Çok sayıda başarısız giriş nedeniyle erişim geçici olarak engellendi. ${newBlock.blockedUntil?.toLocaleString('tr-TR')} sonrasında tekrar deneyin.`:'Kullanıcı adı veya şifre hatalı.',
      code:newBlock?'LOGIN_BLOCKED':'LOGIN_FAILED',blockedUntil:newBlock?.blockedUntil?.getTime()??null});
    return;
  }
  const normalizedUsername=normalizeLoginUsername(parsed.data.username);
  let user=await prisma.user.findUnique({where:{username:normalizedUsername}});

  if(!user || user.directorySource==='AD'){
    try{
      const domainCheck=await syncDomainUserForLogin(normalizedUsername,parsed.data.password);
      if(domainCheck.checked){
        if(!domainCheck.found||!domainCheck.enabled||!domainCheck.user){
          await prisma.loginSecurityEvent.create({
            data:{usernameAttempt:normalizedUsername,ipAddress,macAddress,success:false,reason:'Active Directory hesabı pasif, kaldırılmış veya bulunamadı.'},
          });
          res.status(403).json({
            error:'Domain hesabınız aktif değil veya Active Directory üzerinde bulunamadı. Sistem yöneticinizle görüşün.',
            code:'DOMAIN_ACCOUNT_INACTIVE',
          });
          return;
        }
        if(domainCheck.credentialsValid===false){
          await prisma.loginSecurityEvent.create({
            data:{usernameAttempt:normalizedUsername,ipAddress,macAddress,success:false,reason:'Active Directory kullanıcı adı veya parolası geçersiz.'},
          });
          res.status(401).json({error:'Kullanıcı adı veya şifre hatalı.',code:'LOGIN_FAILED'});
          return;
        }
        user=domainCheck.user;
      }
    }catch(error){
      if(user?.directorySource==='AD'){
        // Offline-first AD cache: DC erişilemiyorsa OPERİS'e daha önce aktarılmış
        // kullanıcının son senkronize active/profile verisi ve yerel parola hash'i ile devam edilir.
        // DC tekrar erişilebilir olduğunda login-time sync ve scheduler veriyi yeniden eşitler.
        console.error('[DOMAIN LOGIN CHECK - OFFLINE CACHE]',error);
      }
    }
  }

  const passwordOk=Boolean(user?.active && await bcrypt.compare(parsed.data.password,user.passwordHash));
  if(!user||!user.active||!passwordOk){
    const newBlock=await recordFailedLogin(normalizedUsername,ipAddress,macAddress);
    res.status(newBlock?429:401).json({error:newBlock?`Çok sayıda başarısız giriş nedeniyle erişim geçici olarak engellendi. ${newBlock.blockedUntil?.toLocaleString('tr-TR')} sonrasında tekrar deneyin.`:'Kullanıcı adı veya şifre hatalı.',
      code:newBlock?'LOGIN_BLOCKED':'LOGIN_FAILED',blockedUntil:newBlock?.blockedUntil?.getTime()??null});
    return;
  }
  const license=await getLicenseStatus();
  if(license.expired&&!isLicenseOwner(user.username)){
    res.status(423).json({error:'Erişim reddedildi. Lisans süresi sona ermiştir. Lisans tarihi güncellenene kadar uygulamaya erişemezsiniz.',code:'LICENSE_EXPIRED',expiresAt:license.expiresAt});
    return;
  }
  await recordSuccessfulLogin(user.username,ipAddress,macAddress);
  await setSession(req,res,user.id);
  await writeAudit(Object.assign(req,{authUser:publicUser(user)}) as AuthRequest,'LOGIN','AUTH',user.id,user.displayName,null,{ipAddress,macAddress,security:'Başarılı giriş'});
  res.json({user:publicUser(user)});
});

const firstLoginEmailSchema = z.string().trim().max(254).refine(
  value => /^[^\s@]+@[^\s@]+\.com\.tr$/i.test(value),
  'E-posta adresi @ işareti içermeli ve .com.tr ile bitmelidir.',
);

app.post('/api/auth/complete-first-login', requireAuth, async (req: AuthRequest, res) => {
  if (!req.authUser!.mustChangePassword) {
    res.status(409).json({ error: 'İlk giriş bilgileri daha önce tamamlanmış.' });
    return;
  }
  const isDomainUser=req.authUser!.directorySource==='AD';
  const d=z.object({
    displayName:z.string().trim().min(3,'Ad Soyad zorunludur.').max(100),
    email:firstLoginEmailSchema,
    department:z.string().trim().min(2,'Çalıştığınız birim zorunludur.').max(120),
    title:z.string().trim().min(2,'Ünvan zorunludur.').max(120),
    password:isDomainUser?z.string().optional():passwordSchema,
  }).parse(req.body);
  const normalizedEmail=d.email.toLocaleLowerCase('tr-TR');
  const emailOwner=await prisma.user.findFirst({where:{email:normalizedEmail,id:{not:req.authUser!.id}},select:{id:true}});
  if(emailOwner){res.status(409).json({error:'Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.',field:'email'});return;}
  const user=await prisma.user.update({where:{id:req.authUser!.id},data:{
    displayName:d.displayName,email:normalizedEmail,department:d.department,title:d.title,
    ...(!isDomainUser&&d.password?{passwordHash:await bcrypt.hash(d.password,12)}:{}),
    mustChangePassword:false,
  }});
  await prisma.userSession.updateMany({where:{userId:user.id,revokedAt:null,id:{not:req.authSessionId}},data:{
    revokedAt:new Date(),revokeReason:'İlk giriş profil ve şifre doğrulaması tamamlandı.',
  }});
  await writeAudit(req,'UPDATE','USERS',user.id,user.displayName,null,{firstLoginProfileCompleted:true,email:user.email,department:user.department,title:user.title});
  res.json({user:publicUser(user)});
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  if(req.authUser!.mustChangePassword){
    res.status(409).json({error:'İlk girişte şifre ile birlikte Ad Soyad, E-posta, Birim ve Ünvan bilgileri tamamlanmalıdır.',code:'FIRST_LOGIN_PROFILE_REQUIRED'});
    return;
  }
  const d=z.object({password:passwordSchema}).parse(req.body);
  const user=await prisma.user.update({where:{id:req.authUser!.id},data:{passwordHash:await bcrypt.hash(d.password,12)}});
  await prisma.userSession.updateMany({where:{userId:user.id,revokedAt:null,id:{not:req.authSessionId}},data:{revokedAt:new Date()}});
  res.json({user:publicUser(user)});
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) { res.status(200).json({ ok: true }); return; }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLocaleLowerCase('tr-TR') } });
  if (user?.active) {
    const token = createResetToken();
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await prisma.passwordResetToken.create({
      data: { tokenHash: hashResetToken(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    const origin = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const link = `${origin}/?resetToken=${encodeURIComponent(token)}`;
    await sendMail(
      user.email!,
      'OPERİS Şifre Sıfırlama',
      `Merhaba ${user.displayName || user.username},\n\nŞifrenizi sıfırlamak için aşağıdaki bağlantıyı 30 dakika içinde açın:\n${link}\n\nBu isteği siz yapmadıysanız e-postayı yok sayın.`,
      `<p>Merhaba <strong>${user.displayName || user.username}</strong>,</p><p>Şifrenizi sıfırlamak için aşağıdaki bağlantıyı 30 dakika içinde açın:</p><p><a href="${link}">Şifremi sıfırla</a></p><p>Bu isteği siz yapmadıysanız e-postayı yok sayın.</p>`,
    ).catch(error => console.error('OPERİS şifre sıfırlama e-postası gönderilemedi:', error));
  }
  res.json({ ok: true });
});
app.post('/api/auth/reset-password', async (req, res) => {
  const d = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).parse(req.body);
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(d.token) } });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.' }); return;
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: token.userId }, data: { passwordHash: await bcrypt.hash(d.password, 12) } }),
    prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
  clearSession(res);
  res.status(204).end();
});

app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.status(204).end(); });
app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => res.json({ user: req.authUser }));

const manageUsers = requirePermission((_p, u) => u.isAdmin);

app.get('/api/admin/login-security', requireAuth, manageUsers, async (_req:AuthRequest,res)=>{
  const [blocks,events]=await Promise.all([
    prisma.loginSecurityBlock.findMany({orderBy:[{active:'desc'},{updatedAt:'desc'}],take:500}),
    prisma.loginSecurityEvent.findMany({orderBy:{createdAt:'desc'},take:1000}),
  ]);
  res.json({
    blocks:blocks.map(r=>({...r,lastStrikeAt:r.lastStrikeAt?.getTime()??null,blockedUntil:r.blockedUntil?.getTime()??null,clearedAt:r.clearedAt?.getTime()??null,createdAt:r.createdAt.getTime(),updatedAt:r.updatedAt.getTime()})),
    events:events.map(r=>({...r,createdAt:r.createdAt.getTime()})),
  });
});
app.post('/api/admin/login-security/:ip/unblock', requireAuth, manageUsers, async (req:AuthRequest,res)=>{
  const ipAddress=decodeURIComponent(String(req.params.ip));const row=await clearLoginBlock(ipAddress,{id:req.authUser!.id,displayName:req.authUser!.displayName,username:req.authUser!.username});
  if(!row){res.status(404).json({error:'Engel kaydı bulunamadı.'});return;}
  await writeAudit(req,'UPDATE','SECURITY',row.id,`Giriş Engeli ${ipAddress}`,null,{ipAddress,action:'Yönetici engeli kaldırdı'});
  res.json({...row,lastStrikeAt:row.lastStrikeAt?.getTime()??null,blockedUntil:row.blockedUntil?.getTime()??null,clearedAt:row.clearedAt?.getTime()??null,createdAt:row.createdAt.getTime(),updatedAt:row.updatedAt.getTime()});
});

app.get('/api/bootstrap', requireAuth, async (req: AuthRequest, res) => {
  const p = req.authUser!.permissions;
  const showDeleted = Boolean(req.authUser!.isAdmin);
  const branchContext = await branchContextFromRequest(req);
  const branchCodes = branchContext.selectedBranchCode === 'ALL'
    ? branchContext.accessibleBranchCodes
    : [branchContext.selectedBranchCode];
  const taskBranchCodes = await readBranchCodesForPermission(req, permissions => permissions.tasks.canView);
  const credentialBranchCodes = await readBranchCodesForPermission(req, permissions => permissions.credentials.canView);
  const trackingBranchCodes = await readBranchCodesForPermission(req, permissions => permissions.tracking.canView);
  const branchWhere = { branchCode: { in: branchCodes } };
  // Ayrıntılı İşlem Geçmişi özel kuralı:
  // Merkez Şube yetkisi olan yönetici, hangi şube ekranı seçili olursa olsun
  // erişebildiği TÜM şubelerin loglarını tek kronolojik listede görür.
  const auditBranchCodes = branchContext.canSeeAllBranches
    ? branchContext.accessibleBranchCodes
    : branchCodes;
  const auditBranchWhere = { branchCode: { in: auditBranchCodes } };
  const [tasks, credentials, trackingRecords, settings, users, messages, messageUsers, auditLogs, notes, currentUserRecord, announcementReceipts] = await Promise.all([
    taskBranchCodes.length ? prisma.task.findMany({ where: showDeleted ? { branchCode: { in: taskBranchCodes } } : { branchCode: { in: taskBranchCodes }, deletedAt: null }, orderBy: { createdAt: 'desc' } }) : [],
    credentialBranchCodes.length ? prisma.credential.findMany({ where: showDeleted ? { branchCode: { in: credentialBranchCodes } } : { branchCode: { in: credentialBranchCodes }, deletedAt: null }, orderBy: { createdAt: 'desc' } }) : [],
    trackingBranchCodes.length ? prisma.trackingRecord.findMany({ where: showDeleted ? { branchCode: { in: trackingBranchCodes } } : { branchCode: { in: trackingBranchCodes }, deletedAt: null }, orderBy: { serviceDate: 'desc' } }) : [],
    prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    (req.authUser!.isAdmin || p.canManageUsers)
      ? (branchContext.canSeeAllBranches
          ? prisma.user.findMany({ orderBy: [{ isAdmin: 'desc' }, { username: 'asc' }] })
          : prisma.user.findMany({
              where: { branchMemberships: { some: { branchCode: { in: branchContext.accessibleBranchCodes } } } },
              orderBy: [{ isAdmin: 'desc' }, { username: 'asc' }],
            }))
      : [],
    prisma.message.findMany({
      where: { OR: [{ recipientId: req.authUser!.id }, { senderId: req.authUser!.id }] },
      include: { sender: true, recipient: true },
      orderBy: { createdAt: 'desc' },
      take: 250,
    }),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { displayName: 'asc' },
    }),
    req.authUser!.isAdmin ? prisma.auditLog.findMany({
      where: auditBranchWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: branchContext.canSeeAllBranches ? 2000 : 1000,
    }) : [],
    prisma.userNote.findMany({ where: { userId: req.authUser!.id, branchCode: { in: branchCodes } }, orderBy: { updatedAt: 'desc' } }),
    prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { lastSeenVersion: true } }),
    prisma.announcementReceipt.findMany({
      where: {
        userId: req.authUser!.id,
        announcement: {
          active: true,
          startsAt: { lte: new Date() },
          AND: [
            { OR: [{ branchCode: { in: branchCodes } }, { branchCode: 'ALL' }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
          ],
        },
      },
      include: { announcement: true },
      orderBy: { announcement: { createdAt: 'desc' } },
    }),
  ]);
  const licenseStatus = await getLicenseStatus();
  res.json({
    user: req.authUser,
    branchContext,
    tasks: tasks.map(t => ({
      ...t,
      createdAt: t.createdAt.getTime(),
      deletedAt: t.deletedAt?.getTime() ?? null,
    })),
    credentials: credentials.map(c => ({
      id: c.id, branchCode: c.branchCode, groupName: safeDecryptText(c.groupNameEncrypted), username: safeDecryptText(c.usernameEncrypted),
      password: safeDecryptText(c.passwordEncrypted), ip: safeDecryptText(c.ipEncrypted),
      description: safeDecryptText(c.descriptionEncrypted), lastChanged: c.lastChanged.getTime(), createdAt: c.createdAt.getTime(),
      deletedAt: c.deletedAt?.getTime() ?? null, deletedById: c.deletedById, deletedByName: c.deletedByName,
    })),
    trackingRecords: trackingRecords.map(r => ({
      ...r,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      deletedAt: r.deletedAt?.getTime() ?? null,
    })),
    settings: {
      notifyMinutesBefore: settings.notifyMinutesBefore,
      shakeEnabled: settings.shakeEnabled,
      soundEnabled: settings.soundEnabled,
      theme: req.authUser!.theme,
      mail: { ...(await getMailSettings()), ...(await getGraphMailSettings()) },
      branding: {
        companyName: settings.companyName,
        companyLogoDataUrl: settings.companyLogoDataUrl,
      },
      backup: {
        networkBackupEnabled: settings.networkBackupEnabled,
        networkBackupPath: settings.networkBackupPath,
        backupScheduleEnabled: settings.backupScheduleEnabled,
        backupScheduleType: settings.backupScheduleType,
        backupScheduleTime: settings.backupScheduleTime,
        backupScheduleDay: settings.backupScheduleDay,
        backupRetentionDays: settings.backupRetentionDays,
      },
    },
    users: users.map(publicUser),
    messageUsers: messageUsers.map(publicUser),
    auditLogs: auditLogs.map(log => ({ ...log, createdAt: log.createdAt.getTime() })),
    notes: notes.map(note => ({ ...note, createdAt: note.createdAt.getTime(), updatedAt: note.updatedAt.getTime() })),
    license: {
      ...licenseStatus,
      canManage: isLicenseOwner(req.authUser!.username),
    },
    releaseInfo: {
      version: CURRENT_VERSION,
      name: RELEASE_NAME,
      headlines: RELEASE_HEADLINES,
      shouldShow: currentUserRecord?.lastSeenVersion !== CURRENT_VERSION,
    },
    messages: messages.map(m => ({
      id: m.id,
      branchCode: m.branchCode,
      senderId: m.senderId,
      senderName: m.sender.displayName || m.sender.username,
      recipientId: m.recipientId,
      recipientName: m.recipient.displayName || m.recipient.username,
      direction: m.senderId === req.authUser!.id ? 'sent' : 'inbox',
      subject: m.subject,
      body: m.body,
      readAt: m.readAt?.getTime() ?? null,
      createdAt: m.createdAt.getTime(),
    })),
    announcements: announcementReceipts.map(receipt => ({
      id: receipt.announcement.id,
      branchCode: receipt.announcement.branchCode,
      receiptId: receipt.id,
      senderId: receipt.announcement.senderId,
      senderName: receipt.announcement.senderName,
      senderDepartment: receipt.announcement.senderDepartment,
      title: receipt.announcement.title,
      body: receipt.announcement.body,
      priority: receipt.announcement.priority,
      audienceType: receipt.announcement.audienceType,
      audienceValue: receipt.announcement.audienceValue,
      seenAt: receipt.seenAt?.getTime() ?? null,
      dismissedAt: receipt.dismissedAt?.getTime() ?? null,
      dontShowAgainAt: receipt.dontShowAgainAt?.getTime() ?? null,
      createdAt: receipt.announcement.createdAt.getTime(),
      startsAt: receipt.announcement.startsAt.getTime(),
      endsAt: receipt.announcement.endsAt?.getTime() ?? null,
    })),
  });
});


app.post('/api/release/acknowledge', requireAuth, async (req: AuthRequest, res) => {
  await prisma.user.update({
    where: { id: req.authUser!.id },
    data: { lastSeenVersion: CURRENT_VERSION },
  });
  await writeAudit(req, 'ACKNOWLEDGE', 'RELEASE', CURRENT_VERSION, RELEASE_NAME);
  res.status(204).end();
});


app.get('/api/license/status', requireAuth, async (req: AuthRequest, res) => {
  const status = await getLicenseStatus();
  res.json({ ...status, canManage: isLicenseOwner(req.authUser!.username) });
});

app.put('/api/license/expiry', requireAuth, async (req: AuthRequest, res) => {
  if (!isLicenseOwner(req.authUser!.username)) {
    res.status(403).json({ error: 'Lisans süresini yalnızca balamir kullanıcısı değiştirebilir.' });
    return;
  }
  const parsed = z.object({ expiresAt: z.string().datetime().nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Geçerli bir lisans bitiş tarihi girin.' });
    return;
  }
  const status = await updateLicenseExpiry(parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null);
  await writeAudit(req, 'UPDATE', 'LICENSE', 'license-expiry', parsed.data.expiresAt ?? 'Süresiz');
  res.json({ ...status, canManage: true });
});

const taskSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().trim().min(1).max(250), description: z.string().max(5000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/),
  priority: z.enum(['dusuk','orta','yuksek']), completed: z.boolean(), createdAt: z.number(),
});
app.post('/api/tasks', requireAuth, async (req: AuthRequest, res) => {
  const d = taskSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,permissions=>permissions.tasks.canCreate,'Bu şubede iş ekleme yetkiniz yok.');
  const row = await prisma.task.create({ data: { ...d, branchCode, createdAt: new Date(d.createdAt) } });
  await writeAudit(req, 'CREATE', 'TASKS', row.id, row.title, null, row);
  res.status(201).json({ ...row, createdAt: row.createdAt.getTime(), deletedAt: null });
});
app.put('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  await assertRecordLock(req, 'TASKS', id);
  const before = await prisma.task.findUnique({ where: { id } });
  if (before) await assertBranchPermission(req, before.branchCode, permissions => permissions.tasks.canEdit);
  if (!before || before.deletedAt) { res.status(404).json({ error: 'İş kaydı bulunamadı.' }); return; }
  const d = taskSchema.parse({ ...req.body, id });
  const row = await prisma.task.update({ where: { id }, data: { ...d, createdAt: new Date(d.createdAt) } });
  await writeAudit(req, 'UPDATE', 'TASKS', id, row.title, before, row);
  await prisma.recordLock.deleteMany({ where: { module: 'TASKS', recordId: id, userId: req.authUser!.id } });
  res.json({ ...row, createdAt: row.createdAt.getTime(), deletedAt: null });
});
app.delete('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const before = await prisma.task.findUnique({ where: { id } });
  if (before) await assertBranchPermission(req, before.branchCode, permissions => permissions.tasks.canDelete);
  if (!before) { res.status(404).json({ error: 'İş kaydı bulunamadı.' }); return; }
  const row = await prisma.task.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: req.authUser!.id, deletedByName: req.authUser!.displayName },
  });
  await writeAudit(req, 'DELETE', 'TASKS', id, row.title, before, row);
  res.json({ ...row, createdAt: row.createdAt.getTime(), deletedAt: row.deletedAt?.getTime() ?? null });
});
app.post('/api/tasks/:id/restore', requireAuth, requirePermission((_p, u) => u.isAdmin), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const before = await prisma.task.findUnique({ where: { id } });
  if (before) await assertBranchAccess(req, before.branchCode);
  if (!before) { res.status(404).json({ error: 'İş kaydı bulunamadı.' }); return; }
  const row = await prisma.task.update({ where: { id }, data: { deletedAt: null, deletedById: '', deletedByName: '' } });
  await writeAudit(req, 'RESTORE', 'TASKS', id, row.title, before, row);
  res.json({ ...row, createdAt: row.createdAt.getTime(), deletedAt: null });
});

const credentialSchema = z.object({
  id: z.string().min(1).max(100), groupName: z.string().max(500), username: z.string().max(500),
  password: z.string().max(5000), ip: z.string().max(500), description: z.string().max(5000),
  lastChanged: z.number(), createdAt: z.number(),
});
function credentialData(d: z.infer<typeof credentialSchema>) {
  return {
    groupNameEncrypted: encryptText(d.groupName), usernameEncrypted: encryptText(d.username),
    passwordEncrypted: encryptText(d.password), ipEncrypted: encryptText(d.ip),
    descriptionEncrypted: encryptText(d.description), lastChanged: new Date(d.lastChanged), createdAt: new Date(d.createdAt),
  };
}
app.post('/api/credentials', requireAuth, async (req: AuthRequest, res) => {
  const d = credentialSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,permissions=>permissions.credentials.canCreate,'Bu şubede bilgi ekleme yetkiniz yok.');
  await prisma.credential.create({ data: { id: d.id, branchCode, ...credentialData(d) } });
  await writeAudit(req, 'CREATE', 'CREDENTIALS', d.id, d.groupName || d.username, null, { ...d, password: '***' });
  res.status(201).json({ ...d, branchCode, deletedAt: null, deletedById: '', deletedByName: '' });
});
app.put('/api/credentials/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  await assertRecordLock(req, 'CREDENTIALS', id);
  const before = await prisma.credential.findUnique({ where: { id } });
  if (before) await assertBranchPermission(req, before.branchCode, permissions => permissions.credentials.canEdit);
  if (!before || before.deletedAt) { res.status(404).json({ error: 'Bilgi kaydı bulunamadı.' }); return; }
  const d = credentialSchema.parse({ ...req.body, id });
  await prisma.credential.update({ where: { id }, data: credentialData(d) });
  await writeAudit(req, 'UPDATE', 'CREDENTIALS', id, d.groupName || d.username, { id }, { ...d, password: '***' });
  await prisma.recordLock.deleteMany({ where: { module: 'CREDENTIALS', recordId: id, userId: req.authUser!.id } });
  res.json({ ...d, branchCode: before.branchCode, deletedAt: null, deletedById: '', deletedByName: '' });
});
app.delete('/api/credentials/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const before = await prisma.credential.findUnique({ where: { id } });
  if (before) await assertBranchPermission(req, before.branchCode, permissions => permissions.credentials.canDelete);
  if (!before) { res.status(404).json({ error: 'Bilgi kaydı bulunamadı.' }); return; }
  const row = await prisma.credential.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: req.authUser!.id, deletedByName: req.authUser!.displayName },
  });
  await writeAudit(req, 'DELETE', 'CREDENTIALS', id, id, { id }, { deletedAt: row.deletedAt });
  res.json({ id, deletedAt: row.deletedAt?.getTime() ?? null, deletedById: row.deletedById, deletedByName: row.deletedByName });
});
app.post('/api/credentials/:id/restore', requireAuth, requirePermission((_p, u) => u.isAdmin), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const before = await prisma.credential.findUnique({ where: { id } });
  if (before) await assertBranchAccess(req, before.branchCode);
  if (!before) { res.status(404).json({ error: 'Bilgi kaydı bulunamadı.' }); return; }
  await prisma.credential.update({ where: { id }, data: { deletedAt: null, deletedById: '', deletedByName: '' } });
  await writeAudit(req, 'RESTORE', 'CREDENTIALS', id, id, { deletedAt: before.deletedAt }, { deletedAt: null });
  res.json({ id, deletedAt: null, deletedById: '', deletedByName: '' });
});

const trackingSchema = z.object({
  id: z.string().min(1).max(100), groupName: z.string().max(500), serviceDate: z.string().max(20),
  serviceNumber: z.string().max(500), serviceLocation: z.string().max(1000), description: z.string().max(5000),
  replacedPart1: z.string().max(1000), replacedPart2: z.string().max(1000), replacedPart3: z.string().max(1000),
  note: z.string().max(5000), pinned: z.boolean().default(false), createdAt: z.number(), updatedAt: z.number(),
});
app.post('/api/tracking', requireAuth, async (req: AuthRequest, res) => {
  const d = trackingSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,permissions=>permissions.tracking.canCreate,'Bu şubede takip kaydı ekleme yetkiniz yok.');
  const row = await prisma.trackingRecord.create({ data: { ...d, branchCode, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) } });
  await writeAudit(req, 'CREATE', 'TRACKING', row.id, row.groupName || row.serviceNumber, null, row);
  res.status(201).json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(), deletedAt: null });
});
app.put('/api/tracking/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  await assertRecordLock(req, 'TRACKING', id);
  const before = await prisma.trackingRecord.findUnique({ where: { id } });
  if (before) await assertBranchPermission(req, before.branchCode, permissions => permissions.tracking.canEdit);
  if (!before || before.deletedAt) { res.status(404).json({ error: 'Takip kaydı bulunamadı.' }); return; }
  const d = trackingSchema.parse({ ...req.body, id });
  const row = await prisma.trackingRecord.update({ where: { id }, data: { ...d, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) } });
  await writeAudit(req, 'UPDATE', 'TRACKING', id, row.groupName || row.serviceNumber, before, row);
  await prisma.recordLock.deleteMany({ where: { module: 'TRACKING', recordId: id, userId: req.authUser!.id } });
  res.json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(), deletedAt: null });
});
app.delete('/api/tracking/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const before = await prisma.trackingRecord.findUnique({ where: { id } });
  if (before) await assertBranchPermission(req, before.branchCode, permissions => permissions.tracking.canDelete);
  if (!before) { res.status(404).json({ error: 'Takip kaydı bulunamadı.' }); return; }
  const row = await prisma.trackingRecord.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: req.authUser!.id, deletedByName: req.authUser!.displayName },
  });
  await writeAudit(req, 'DELETE', 'TRACKING', id, row.groupName || row.serviceNumber, before, row);
  res.json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(), deletedAt: row.deletedAt?.getTime() ?? null });
});
app.post('/api/tracking/:id/restore', requireAuth, requirePermission((_p, u) => u.isAdmin), async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const before = await prisma.trackingRecord.findUnique({ where: { id } });
  if (before) await assertBranchAccess(req, before.branchCode);
  if (!before) { res.status(404).json({ error: 'Takip kaydı bulunamadı.' }); return; }
  const row = await prisma.trackingRecord.update({ where: { id }, data: { deletedAt: null, deletedById: '', deletedByName: '' } });
  await writeAudit(req, 'RESTORE', 'TRACKING', id, row.groupName || row.serviceNumber, before, row);
  res.json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(), deletedAt: null });
});

app.put('/api/settings', requireAuth, requirePermission(p => p.canAccessSettings), async (req: AuthRequest, res) => {
  const d = z.object({ notifyMinutesBefore: z.number().int().min(0).max(10080), shakeEnabled: z.boolean(), soundEnabled: z.boolean() }).parse(req.body);
  const row = await prisma.appSettings.upsert({ where: { id: 1 }, update: d, create: { id: 1, ...d } });
  res.json({ notifyMinutesBefore: row.notifyMinutesBefore, shakeEnabled: row.shakeEnabled, soundEnabled: row.soundEnabled, theme: req.authUser!.theme });
});

app.put('/api/profile/theme', requireAuth, async (req: AuthRequest, res) => {
  const d = z.object({ theme: themeSchema }).parse(req.body);
  const user = await prisma.user.update({ where: { id: req.authUser!.id }, data: { theme: d.theme } });
  res.json(publicUser(user));
});

app.put('/api/profile', requireAuth, async (req: AuthRequest, res) => {
  const d = z.object({
    displayName: z.string().trim().min(1).max(100),
    email: z.union([emailSchema, z.literal('')]),
    department: departmentSchema,
    title: z.string().trim().max(120).default(''),
    theme: themeSchema,
  }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.authUser!.id },
    data: {
      displayName: d.displayName,
      email: d.email ? d.email.toLocaleLowerCase('tr-TR') : null,
      department: d.department,
      title: d.title,
      theme: d.theme,
    },
  });
  res.json(publicUser(user));
});


const mailSettingsSchema = z.object({
  mailProvider: z.enum(['smtp', 'graph']),
  smtpEnabled: z.boolean(),
  smtpHost: z.string().trim().max(255),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(255),
  smtpPassword: z.string().max(500).optional(),
  smtpFrom: z.string().trim().max(255),
  reminderEmailEnabled: z.boolean(),
  reminderLeadMinutes: z.number().int().min(1).max(10080),
});
app.put('/api/mail-settings', requireAuth, requirePermission((p, u) => u.isAdmin || p.canAccessSettings || p.canManageUsers), async (req, res) => {
  res.json(await updateMailSettings(mailSettingsSchema.parse(req.body)));
});
app.post('/api/mail-settings/verify', requireAuth, requirePermission((p, u) => u.isAdmin || p.canAccessSettings || p.canManageUsers), async (_req: AuthRequest, res) => {
  res.json(await verifyMailConnection());
});

app.post('/api/mail-settings/test', requireAuth, requirePermission((p, u) => u.isAdmin || p.canAccessSettings || p.canManageUsers), async (req: AuthRequest, res) => {
  const d = z.object({ email: emailSchema }).parse(req.body);
  res.json(await sendTestMail(d.email));
});





app.get('/api/admin/remote-access', requireAuth, requirePermission((_p, u) => u.isAdmin), async (_req: AuthRequest, res) => {
  const mode = await currentRemoteAccessMode();
  res.json({
    mode,
    bindHost,
    port,
    serverAddresses: [...serverIPv4Addresses()].filter(value => value !== '127.0.0.1'),
    localhostAvailable: true,
  });
});

app.put('/api/admin/remote-access', requireAuth, requirePermission((_p, u) => u.isAdmin), async (req: AuthRequest, res) => {
  const input = z.object({ mode: z.enum(['SERVER_ONLY','LOCAL_NETWORK','ALL_ALLOWED']) }).parse(req.body);
  const before = await currentRemoteAccessMode();
  const row = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: { remoteAccessMode: input.mode },
    create: { id: 1, remoteAccessMode: input.mode },
  });
  remoteAccessCache = { mode: input.mode, loadedAt: Date.now() };

  let firewall: { applied: boolean; reason: string };
  try {
    firewall = await syncRemoteAccessFirewall(input.mode);
  } catch (error) {
    // Backend access control is authoritative; report firewall failure instead of hiding it.
    firewall = { applied: false, reason: error instanceof Error ? error.message : 'Windows Firewall güncellenemedi.' };
  }

  await writeAudit(req, 'UPDATE', 'SECURITY', 'REMOTE_ACCESS', 'Sunucu Dışı Erişim', { mode: before }, { mode: row.remoteAccessMode, firewall });
  res.json({
    mode: row.remoteAccessMode as RemoteAccessMode,
    bindHost,
    port,
    serverAddresses: [...serverIPv4Addresses()].filter(value => value !== '127.0.0.1'),
    localhostAvailable: true,
    firewall,
  });
});

app.use('/api/admin', adminToolsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/network-monitors', networkMonitorRouter);
app.use('/api/helpdesk', helpDeskRouter);
app.use('/api/branches', branchRouter);

app.get('/api/admin/sessions', requireAuth, requirePermission((_permissions, user) => user.isAdmin), async (_req: AuthRequest, res) => {
  const onlineThreshold = new Date(Date.now() - 5 * 60 * 1000);
  const sessions = await prisma.userSession.findMany({
    include: { user: true },
    orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }],
    take: 500,
  });

  res.json(sessions.map(session => ({
    id: session.id,
    userId: session.userId,
    username: session.user.username,
    displayName: session.user.displayName,
    department: session.user.department,
    deviceName: session.deviceName,
    deviceType: session.deviceType,
    browser: session.browser,
    operatingSystem: session.operatingSystem,
    ipAddress: session.ipAddress,
    macAddress: session.macAddress || null,
    macAvailable: Boolean(session.macAddress),
    createdAt: session.createdAt.getTime(),
    lastSeenAt: session.lastSeenAt.getTime(),
    revokedAt: session.revokedAt?.getTime() ?? null,
    online: !session.revokedAt && session.lastSeenAt >= onlineThreshold,
  })));
});

app.post('/api/admin/sessions/:id/revoke', requireAuth, requirePermission((_permissions, user) => user.isAdmin), async (req: AuthRequest, res) => {
  const session = await prisma.userSession.findUnique({ where: { id: routeId(req.params.id) }, include: { user: true } });
  if (!session) { res.status(404).json({ error: 'Oturum bulunamadı.' }); return; }
  if(isLicenseOwner(session.user.username)&&session.userId!==req.authUser!.id){
    res.status(403).json({error:'balamir Süper Admin oturumunu başka bir Admin sonlandıramaz.'});
    return;
  }

  await prisma.userSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date(), revokedById: req.authUser!.id, revokeReason: 'Yönetici tarafından sonlandırıldı' },
  });
  await writeAudit(req, 'REVOKE', 'SESSION', session.id, `${session.user.username} · ${session.deviceName}`);
  res.status(204).end();
});

app.post('/api/admin/users/:id/revoke-sessions', requireAuth, requirePermission((_permissions, user) => user.isAdmin), async (req: AuthRequest, res) => {
  const userId = routeId(req.params.id);
  const targetUser=await prisma.user.findUnique({where:{id:userId},select:{username:true}});
  if(!targetUser){res.status(404).json({error:'Kullanıcı bulunamadı.'});return;}
  if(isLicenseOwner(targetUser.username)&&userId!==req.authUser!.id){
    res.status(403).json({error:'balamir Süper Admin oturumlarını başka bir Admin sonlandıramaz.'});
    return;
  }
  const result = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: req.authUser!.id, revokeReason: 'Yönetici tarafından tüm oturumlar sonlandırıldı' },
  });
  await writeAudit(req, 'REVOKE_ALL', 'SESSION', userId, `${result.count} oturum`);
  res.json({ count: result.count });
});

app.get('/api/admin/audit-logs', requireAuth, requirePermission((_p, u) => u.isAdmin), async (req: AuthRequest, res) => {
  const context = await branchContextFromRequest(req);
  const auditBranchCodes = context.canSeeAllBranches
    ? context.accessibleBranchCodes
    : context.selectedBranchCode === 'ALL'
      ? context.accessibleBranchCodes
      : [context.selectedBranchCode];

  const rows = await prisma.auditLog.findMany({
    where: { branchCode: { in: auditBranchCodes } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: context.canSeeAllBranches ? 2000 : 1000,
  });

  res.json(rows.map(row => ({ ...row, createdAt: row.createdAt.getTime() })));
});

const reportMailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});


const graphSettingsSchema = z.object({
  mailProvider: z.enum(['smtp', 'graph']),
  graphEnabled: z.boolean(),
  graphTenantId: z.string().trim().max(100),
  graphClientId: z.string().trim().max(100),
  graphClientSecret: z.string().max(500).optional(),
  graphSenderUser: emailSchema,
});

app.put('/api/graph-mail-settings', requireAuth, requirePermission(p => p.canAccessSettings), async (req: AuthRequest, res) => {
  const parsed = graphSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Microsoft Graph ayarları geçersiz.' });
    return;
  }

  const saved = await updateGraphMailSettings(parsed.data);
  await writeAudit(req, 'UPDATE', 'GRAPH_MAIL_SETTINGS', '', 'Microsoft Graph OAuth2 ayarları', null, {
    ...saved,
    graphClientSecretSet: saved.graphClientSecretSet,
  });
  res.json(saved);
});

app.post('/api/graph-mail-settings/test', requireAuth, requirePermission(p => p.canAccessSettings), async (req: AuthRequest, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Geçerli bir test e-posta adresi girin.' });
    return;
  }

  await testGraphMail(parsed.data.email);
  await writeAudit(req, 'TEST_MAIL', 'GRAPH_MAIL', '', parsed.data.email);
  res.json({ ok: true });
});

app.post('/api/mail/send-report', requireAuth, reportMailUpload.single('attachment'), async (req: AuthRequest, res) => {
  const parsed = z.object({
    to: emailSchema,
    subject: z.string().trim().min(1).max(200),
    body: z.string().max(5000).default(''),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Alıcı, konu veya mesaj bilgisi geçersiz.' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Eklenecek rapor dosyası bulunamadı.' });
    return;
  }

  const selectedMailSettings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const attachment = {
    filename: req.file.originalname,
    content: req.file.buffer,
    contentType: req.file.mimetype,
  };

  if (selectedMailSettings?.mailProvider === 'graph') {
    await sendGraphMail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body || 'Operis uygulamasından gönderilen rapor ektedir.',
      attachments: [attachment],
    });
  } else {
    await sendMail(
      parsed.data.to,
      parsed.data.subject,
      parsed.data.body || 'Operis uygulamasından gönderilen rapor ektedir.',
      `<p>${(parsed.data.body || 'Operis uygulamasından gönderilen rapor ektedir.').replace(/[<>&]/g, '')}</p>`,
      [attachment],
    );
  }

  await writeAudit(req, 'SEND_MAIL', 'REPORTS', '', parsed.data.subject, null, {
    to: parsed.data.to,
    fileName: req.file.originalname,
    size: req.file.size,
  });

  res.json({ ok: true });
});

app.get('/api/users', requireAuth, manageUsers, async (req: AuthRequest, res) => {
  const context = await branchContextFromRequest(req);
  const rows = context.canSeeAllBranches
    ? await prisma.user.findMany({ orderBy: [{ isAdmin: 'desc' }, { username: 'asc' }] })
    : await prisma.user.findMany({
        where: {
          branchMemberships: { some: { branchCode: { in: context.accessibleBranchCodes } } },
        },
        orderBy: [{ isAdmin: 'desc' }, { username: 'asc' }],
      });
  const ids=rows.map(row=>row.id);
  const [dcAudits,dcAcks]=ids.length?await Promise.all([
    prisma.auditLog.findMany({
      where:{module:'USERS',action:'DOMAIN_SYNC_CHANGE',recordId:{in:ids}},
      orderBy:{createdAt:'desc'},
    }),
    prisma.auditLog.findMany({
      where:{module:'USERS',action:'DOMAIN_SYNC_ACK',recordId:{in:ids},userId:req.authUser!.id},
      orderBy:{createdAt:'desc'},
    }),
  ]):[[],[]];
  const latestDcAudit=new Map<string,(typeof dcAudits)[number]>();
  const latestDcAck=new Map<string,(typeof dcAcks)[number]>();
  for(const audit of dcAudits)if(!latestDcAudit.has(audit.recordId))latestDcAudit.set(audit.recordId,audit);
  for(const ack of dcAcks)if(!latestDcAck.has(ack.recordId))latestDcAck.set(ack.recordId,ack);
  res.json(rows.map(row=>{
    const audit=latestDcAudit.get(row.id);
    const ack=latestDcAck.get(row.id);
    let directoryLastChanges:Array<{field:string;label:string;oldValue:unknown;newValue:unknown}>=[];
    if(audit){try{const parsed=JSON.parse(audit.newData);directoryLastChanges=Array.isArray(parsed?.changes)?parsed.changes:[];}catch{}}
    const directoryChangeUnread=Boolean(audit&&(!ack||ack.createdAt<audit.createdAt));
    return {...publicUser(row),directoryLastChangeAt:audit?.createdAt.getTime()??null,directoryLastChanges,directoryChangeUnread};
  }));
});

app.post('/api/users/:id/domain-sync-ack', requireAuth, manageUsers, async (req:AuthRequest,res)=>{
  const id=String(req.params.id||'').trim();
  const context=await branchContextFromRequest(req);
  const user=context.canSeeAllBranches
    ? await prisma.user.findUnique({where:{id},select:{id:true,username:true,directorySource:true}})
    : await prisma.user.findFirst({
        where:{id,branchMemberships:{some:{branchCode:{in:context.accessibleBranchCodes}}}},
        select:{id:true,username:true,directorySource:true},
      });
  if(!user){res.status(404).json({error:'Kullanıcı bulunamadı veya bu kullanıcıyı görüntüleme yetkiniz yok.'});return;}
  if(user.directorySource!=='AD'){res.status(400).json({error:'Bu kullanıcı Active Directory kullanıcısı değil.'});return;}
  await prisma.auditLog.create({data:{
    branchCode:'100',userId:req.authUser!.id,username:req.authUser!.username,displayName:req.authUser!.displayName,
    action:'DOMAIN_SYNC_ACK',module:'USERS',recordId:user.id,recordLabel:user.username,
    description:'DC kullanıcı değişikliği görüntülendi.',
  }});
  res.json({ok:true});
});
app.post('/api/users', requireAuth, manageUsers, async (req: AuthRequest, res) => {
  const d=z.object({
    username:usernameSchema,displayName:z.string().trim().min(1).max(100),email:emailSchema,department:departmentSchema.default(''),
    password:passwordSchema,isAdmin:z.boolean().default(false),permissions:permissionsSchema,
    assignments:z.array(z.object({
      branchCode:z.string().regex(/^\d{3}$/),isPrimary:z.boolean(),role:z.enum(['USER','BRANCH_MANAGER']).default('USER'),permissions:permissionsSchema,
      helpDesk:z.object({
        canOpen:z.boolean(),canCoordinate:z.boolean(),canRespond:z.boolean(),canChangeStatus:z.boolean(),canReopen:z.boolean(),
        canViewAll:z.boolean(),canAssign:z.boolean(),canClose:z.boolean(),canReport:z.boolean(),
        canTopics:z.boolean(),canCannedReplies:z.boolean(),canKnowledge:z.boolean(),
      }).optional(),
    })).min(1),
  }).parse(req.body);
  if(canonicalSuperAdminCandidate(d.username)==='balamir'){
    res.status(409).json({error:'balamir kullanıcı adı ve büyük/küçük harf varyasyonları Süper Admin hesabına rezerve edilmiştir.'});
    return;
  }

  const unique=Array.from(new Map(d.assignments.map(item=>[item.branchCode,item])).values());
  if(unique.filter(item=>item.isPrimary).length!==1){res.status(400).json({error:'Tam olarak bir birincil şube seçilmelidir.'});return;}
  const callerContext=await branchContextFromRequest(req);
  const requestedCodes=unique.map(item=>item.branchCode);
  if(!callerContext.canSeeAllBranches&&requestedCodes.some(code=>!callerContext.accessibleBranchCodes.includes(code))){
    res.status(403).json({error:'Yetkili olmadığınız şubeye kullanıcı atayamazsınız.'});return;
  }
  const branches=await prisma.branch.findMany({where:{code:{in:requestedCodes},active:true},select:{code:true}});
  if(branches.length!==requestedCodes.length){res.status(400).json({error:'Seçilen şubelerden biri bulunamadı veya pasif.'});return;}
  const primary=unique.find(item=>item.isPrimary)!;
  const passwordHash=await bcrypt.hash(d.password,12);
  const user=await prisma.$transaction(async tx=>{
    const created=await tx.user.create({data:{username:d.username.toLocaleLowerCase('tr-TR'),displayName:d.displayName,email:d.email.toLocaleLowerCase('tr-TR'),
      department:d.department,theme:'dark',passwordHash,permissions:d.isAdmin?ADMIN_PERMISSIONS:normalizePermissions(primary.permissions),active:true,isAdmin:d.isAdmin,mustChangePassword:true}});
    for(const item of unique){
      const branchPermissions=d.isAdmin
        ? serializeBranchPermissions(ADMIN_PERMISSIONS,'USER')
        : serializeBranchPermissions(item.permissions,item.role);
      await tx.userBranch.create({data:{userId:created.id,branchCode:item.branchCode,isPrimary:item.isPrimary,permissions:branchPermissions,assignedById:req.authUser!.id}});
      if(item.helpDesk){
        const hd=item.helpDesk;
        if(hd.canOpen||hd.canCoordinate||hd.canRespond||hd.canViewAll||hd.canReport){
          await tx.helpDeskAccess.upsert({
            where:{userId_branchCode:{userId:created.id,branchCode:item.branchCode}},
            update:{active:true,canOpen:Boolean(hd.canOpen),canStaff:Boolean(hd.canCoordinate||hd.canRespond),canCoordinate:Boolean(hd.canCoordinate),
              canRespond:Boolean(hd.canRespond),canChangeStatus:Boolean(hd.canChangeStatus),canReopen:Boolean(hd.canReopen),canViewAll:Boolean(hd.canViewAll),
              canAssign:Boolean(hd.canAssign&&hd.canCoordinate),canClose:Boolean(hd.canClose),canReport:Boolean(hd.canReport),assignedById:req.authUser!.id},
            create:{userId:created.id,branchCode:item.branchCode,active:true,canOpen:Boolean(hd.canOpen),canStaff:Boolean(hd.canCoordinate||hd.canRespond),
              canCoordinate:Boolean(hd.canCoordinate),canRespond:Boolean(hd.canRespond),canChangeStatus:Boolean(hd.canChangeStatus),canReopen:Boolean(hd.canReopen),
              canViewAll:Boolean(hd.canViewAll),canAssign:Boolean(hd.canAssign&&hd.canCoordinate),canClose:Boolean(hd.canClose),canReport:Boolean(hd.canReport),
              canTopics:false,canCannedReplies:false,canKnowledge:false,mutedEmail:false,assignedById:req.authUser!.id},
          });
        }
      }
    }
    return created;
  });
  await writeAudit(req,'CREATE','USERS',user.id,user.displayName,null,{username:user.username,department:user.department,branches:unique.map(item=>item.branchCode)});
  res.status(201).json(publicUser(user));
});
app.put('/api/users/:id', requireAuth, manageUsers, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const target = await prisma.user.findUnique({ where: { id }, include: { branchMemberships: true } });
  if (!target) { res.status(404).json({ error: 'Kullanıcı bulunamadı.' }); return; }
  if(isLicenseOwner(target.username)){res.status(403).json({error:'balamir Süper Admin hesabı kullanıcı yönetiminden değiştirilemez. Hesap sahibi kendi profilinden güncelleme yapabilir.'});return;}
  const callerBranchContext = await branchContextFromRequest(req);
  if (!callerBranchContext.canSeeAllBranches && !target.branchMemberships.some(item => callerBranchContext.accessibleBranchCodes.includes(item.branchCode))) {
    res.status(403).json({ error: 'Bu kullanıcı sizin yetkili olduğunuz şubelerde değil.' });
    return;
  }
  const d = z.object({ displayName: z.string().trim().min(1).max(100), email: emailSchema, department: departmentSchema.default(''), active: z.boolean(), isAdmin:z.boolean(), permissions: permissionsSchema }).parse(req.body);
  if(target.isAdmin&&!d.isAdmin){
    const adminCount=await prisma.user.count({where:{isAdmin:true,active:true}});
    if(adminCount<=1){res.status(409).json({error:'Sistemde en az bir aktif Admin rolü kalmalıdır.'});return;}
  }
  const normalizedPermissions = normalizePermissions(d.permissions);
  const nextPermissions=d.isAdmin?ADMIN_PERMISSIONS:normalizedPermissions;
  const updateData = target.directorySource==='AD'
    ? { isAdmin:d.isAdmin, permissions:nextPermissions }
    : {
        displayName: d.displayName,
        email: d.email.toLocaleLowerCase('tr-TR'),
        department: d.department,
        active: d.isAdmin?true:d.active,
        isAdmin:d.isAdmin,
        permissions: nextPermissions,
      };
  const user = await prisma.user.update({ where: { id }, data: updateData });
  await writeAudit(req, 'UPDATE', 'USERS', user.id, user.displayName, {
    displayName: target.displayName,
    department: target.department,
    isAdmin:target.isAdmin,
    permissions: normalizePermissions(target.permissions),
  }, {
    displayName: user.displayName,
    department: user.department,
    isAdmin:user.isAdmin,
    permissions: nextPermissions,
  });
  res.json(publicUser(user));
});
app.put('/api/users/:id/password', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  if (!req.authUser!.isAdmin && !req.authUser!.permissions.canManageUsers && req.authUser!.id !== id) {
    res.status(403).json({ error: 'Bu şifreyi değiştirme yetkiniz yok.' }); return;
  }
  const target=await prisma.user.findUnique({where:{id},select:{directorySource:true,username:true}});
  if(!target){res.status(404).json({error:'Kullanıcı bulunamadı.'});return;}
  if(isLicenseOwner(target.username)&&req.authUser!.id!==id){res.status(403).json({error:'balamir Süper Admin parolasını yalnız hesap sahibi değiştirebilir.'});return;}
  if(target.directorySource==='AD'){
    res.status(400).json({error:'Active Directory kullanıcısının parolası OPERİS üzerinden değiştirilemez. Parola Domain Controller üzerinde yönetilir.'});
    return;
  }
  const d = z.object({ password: passwordSchema }).parse(req.body);
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(d.password, 12), mustChangePassword: true } });
  res.status(204).end();
});
app.delete('/api/users/:id', requireAuth, manageUsers, async (req, res) => {
  const id = routeId(req.params.id);
  const target = await prisma.user.findUnique({ where: { id }, include: { branchMemberships: true } });
  if(!target){res.status(404).json({error:'Kullanıcı bulunamadı.'});return;}
  if(isLicenseOwner(target.username)){res.status(403).json({error:'balamir Süper Admin hesabı silinemez.'});return;}
  if(target.isAdmin){res.status(400).json({error:'Yönetici kullanıcı silinemez.'});return;}
  if(target.directorySource==='AD'){
    res.status(400).json({error:'Active Directory kullanıcısı OPERİS üzerinden silinemez. Hesap yaşam döngüsü Domain Controller tarafından yönetilir.'});
    return;
  }
  const callerBranchContext = await branchContextFromRequest(req);
  if (!callerBranchContext.canSeeAllBranches && !target.branchMemberships.some(item => callerBranchContext.accessibleBranchCodes.includes(item.branchCode))) {
    res.status(403).json({ error: 'Bu kullanıcı sizin yetkili olduğunuz şubelerde değil.' });
    return;
  }
  await prisma.user.delete({ where: { id } }); res.status(204).end();
});

app.get('/api/admin/domain-sync/settings', requireAuth, requirePermission((_p,u)=>u.isAdmin), async (_req,res)=>{
  res.json(await getDomainSyncSettings());
});
app.put('/api/admin/domain-sync/settings', requireAuth, requirePermission((_p,u)=>u.isAdmin), async (req:AuthRequest,res)=>{
  const input=z.object({enabled:z.boolean(),controller:z.string().trim().min(1).max(255),useLdaps:z.boolean(),port:z.number().int().min(1).max(65535),
    baseDn:z.string().trim().min(1).max(500),username:z.string().trim().min(1).max(255),password:z.string().max(500).optional(),intervalMinutes:z.number().int().min(15).max(1440)}).parse(req.body);
  res.json(await updateDomainSyncSettings(input));
});
app.post('/api/admin/domain-sync/test', requireAuth, requirePermission((_p,u)=>u.isAdmin), async (_req,res)=>{
  try{
    res.json(await testDomainConnection());
  }catch(error){
    if(error instanceof DomainConnectionError){
      res.status(502).json({error:error.message,code:error.code,detail:error.detail});
      return;
    }
    throw error;
  }
});
app.post('/api/admin/domain-sync/run', requireAuth, requirePermission((_p,u)=>u.isAdmin), async (_req,res)=>res.json(await syncDomainUsers()));




const noteSchema = z.object({
  title: z.string().trim().max(120).default(''),
  content: z.string().trim().min(1).max(4000),
  color: z.enum(['yellow', 'red', 'orange', 'darkGreen', 'turquoise']),
});

app.get('/api/notes', requireAuth, async (req: AuthRequest, res) => {
  const branchCodes = await readBranchCodes(req);
  const rows = await prisma.userNote.findMany({ where: { userId: req.authUser!.id, branchCode: { in: branchCodes } }, orderBy: { updatedAt: 'desc' } });
  res.json(rows.map(note => ({ ...note, createdAt: note.createdAt.getTime(), updatedAt: note.updatedAt.getTime() })));
});

app.post('/api/notes', requireAuth, async (req: AuthRequest, res) => {
  const data = noteSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  const row = await prisma.userNote.create({ data: { userId: req.authUser!.id, branchCode, ...data } });
  await writeAudit(req, 'CREATE', 'NOTES', row.id, row.title || row.content.slice(0, 50), null, row);
  res.status(201).json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

app.put('/api/notes/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const data = noteSchema.parse(req.body);
    const branchCodes = await readBranchCodes(req);
  const before = await prisma.userNote.findFirst({ where: { id, userId: req.authUser!.id, branchCode: { in: branchCodes } } });
  if (!before) { res.status(404).json({ error: 'Not bulunamadı.' }); return; }
  const row = await prisma.userNote.update({ where: { id }, data });
  await writeAudit(req, 'UPDATE', 'NOTES', id, row.title || row.content.slice(0, 50), before, row);
  res.json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

app.delete('/api/notes/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
    const branchCodes = await readBranchCodes(req);
  const before = await prisma.userNote.findFirst({ where: { id, userId: req.authUser!.id, branchCode: { in: branchCodes } } });
  if (!before) { res.status(404).json({ error: 'Not bulunamadı.' }); return; }
  await prisma.userNote.delete({ where: { id } });
  await writeAudit(req, 'DELETE', 'NOTES', id, before.title || before.content.slice(0, 50), before, null);
  res.status(204).end();
});



const announcementSchema = z.object({
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(10000),
  priority: z.enum(['NORMAL', 'IMPORTANT', 'CRITICAL']).default('NORMAL'),
  audienceType: z.enum(['TEAM', 'ALL', 'DEPARTMENT', 'USERS']),
  audienceValue: z.string().max(10000).default(''),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

app.get('/api/announcements', requireAuth, async (req: AuthRequest, res) => {
  const branchCodes = await readBranchCodes(req);
  const now = new Date();
  const receipts = await prisma.announcementReceipt.findMany({
    where: {
      userId: req.authUser!.id,
      announcement: {
        active: true,
        startsAt: { lte: now },
        AND: [
          { OR: [{ branchCode: { in: branchCodes } }, { branchCode: 'ALL' }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
    },
    include: { announcement: true },
    orderBy: { announcement: { createdAt: 'desc' } },
    take: 250,
  });
  res.json(receipts.map(receipt => ({
    id: receipt.announcement.id,
    branchCode: receipt.announcement.branchCode,
    receiptId: receipt.id,
    senderId: receipt.announcement.senderId,
    senderName: receipt.announcement.senderName,
    senderDepartment: receipt.announcement.senderDepartment,
    title: receipt.announcement.title,
    body: receipt.announcement.body,
    priority: receipt.announcement.priority,
    audienceType: receipt.announcement.audienceType,
    audienceValue: receipt.announcement.audienceValue,
    seenAt: receipt.seenAt?.getTime() ?? null,
    dismissedAt: receipt.dismissedAt?.getTime() ?? null,
    dontShowAgainAt: receipt.dontShowAgainAt?.getTime() ?? null,
    createdAt: receipt.announcement.createdAt.getTime(),
    startsAt: receipt.announcement.startsAt.getTime(),
    endsAt: receipt.announcement.endsAt?.getTime() ?? null,
  })));
});


app.get('/api/announcements/inbox', requireAuth, async (req: AuthRequest, res) => {
  const branchCodes = await readBranchCodes(req);
  const receipts = await prisma.announcementReceipt.findMany({
    where: { userId: req.authUser!.id, announcement: { OR: [{ branchCode: { in: branchCodes } }, { branchCode: 'ALL' }] } },
    include: { announcement: true },
    orderBy: { announcement: { createdAt: 'desc' } },
  });

  res.json(receipts.map(receipt => ({
    id: receipt.announcement.id,
    branchCode: receipt.announcement.branchCode,
    receiptId: receipt.id,
    senderId: receipt.announcement.senderId,
    senderName: receipt.announcement.senderName,
    senderDepartment: receipt.announcement.senderDepartment,
    title: receipt.announcement.title,
    body: receipt.announcement.body,
    priority: receipt.announcement.priority,
    audienceType: receipt.announcement.audienceType,
    audienceValue: receipt.announcement.audienceValue,
    seenAt: receipt.seenAt?.getTime() ?? null,
    dismissedAt: receipt.dismissedAt?.getTime() ?? null,
    dontShowAgainAt: receipt.dontShowAgainAt?.getTime() ?? null,
    createdAt: receipt.announcement.createdAt.getTime(),
    startsAt: receipt.announcement.startsAt.getTime(),
    endsAt: receipt.announcement.endsAt?.getTime() ?? null,
    direction: 'inbox',
    recipientCount: 1,
    readCount: receipt.seenAt ? 1 : 0,
  })));
});

app.get('/api/announcements/sent', requireAuth, async (req: AuthRequest, res) => {
  const branchCodes = await readBranchCodes(req);
  const announcements = await prisma.announcement.findMany({
    where: { senderId: req.authUser!.id, OR: [{ branchCode: { in: branchCodes } }, { branchCode: 'ALL' }] },
    include: { receipts: { select: { seenAt: true } } },
    orderBy: { createdAt: 'desc' },
  });

  res.json(announcements.map(announcement => ({
    id: announcement.id,
    branchCode: announcement.branchCode,
    receiptId: '',
    senderId: announcement.senderId,
    senderName: announcement.senderName,
    senderDepartment: announcement.senderDepartment,
    title: announcement.title,
    body: announcement.body,
    priority: announcement.priority,
    audienceType: announcement.audienceType,
    audienceValue: announcement.audienceValue,
    seenAt: null,
    dismissedAt: null,
    dontShowAgainAt: null,
    createdAt: announcement.createdAt.getTime(),
    startsAt: announcement.startsAt.getTime(),
    endsAt: announcement.endsAt?.getTime() ?? null,
    direction: 'sent',
    recipientCount: announcement.receipts.length,
    readCount: announcement.receipts.filter(receipt => receipt.seenAt).length,
  })));
});

app.post('/api/announcements', requireAuth, async (req: AuthRequest, res) => {
  const user = req.authUser!;
  const data = announcementSchema.parse(req.body);
  const requestedBranchCode=String(req.headers['x-operis-branch-code']??'').trim().toUpperCase();
  const globalAnnouncement=user.isAdmin&&requestedBranchCode==='ALL';
  if(!user.isAdmin&&requestedBranchCode==='ALL'){
    res.status(403).json({error:'Genel duyuru yalnız Admin tarafından gönderilebilir.'});
    return;
  }
  const branchCode=globalAnnouncement?'ALL':await writeBranchCode(req);
  if(!user.isAdmin){
    await assertBranchPermission(
      req,
      branchCode,
      permissions=>permissions.canSendBranchAnnouncements,
      'Bu şubede duyuru gönderme yetkiniz yok.',
    );
  }

  const branchMembershipFilter=globalAnnouncement?{}:{branchMemberships:{some:{branchCode}}};
  let recipients: User[] = [];
  if (data.audienceType === 'ALL') {
    recipients = await prisma.user.findMany({ where: { active: true, ...branchMembershipFilter } });
  } else if (data.audienceType === 'DEPARTMENT') {
    const departments = data.audienceValue.split('|').map(value => value.trim()).filter(Boolean);
    recipients = await prisma.user.findMany({ where: { active: true, department: { in: departments }, ...branchMembershipFilter } });
  } else if (data.audienceType === 'USERS') {
    const userIds = data.audienceValue.split('|').map(value => value.trim()).filter(Boolean);
    recipients = await prisma.user.findMany({ where: { active: true, id: { in: userIds }, ...branchMembershipFilter } });
  } else {
    if (!user.department.trim()) {
      res.status(400).json({ error: 'Kullanıcının departman bilgisi tanımlı değil.' });
      return;
    }
    recipients = await prisma.user.findMany({ where: { active: true, department: user.department, ...branchMembershipFilter } });
  }

  if (!recipients.some(recipient => recipient.id === user.id)) {
    const senderRecord = await prisma.user.findUnique({ where: { id: user.id } });
    if (senderRecord) recipients.push(senderRecord);
  }

  const uniqueRecipients = Array.from(new Map(recipients.map(recipient => [recipient.id, recipient])).values());

  const announcement = await prisma.$transaction(async tx => {
    const created = await tx.announcement.create({
      data: {
        senderId: user.id,
        senderName: user.displayName || user.username,
        branchCode,
        senderDepartment: user.department,
        title: data.title,
        body: data.body,
        priority: data.priority,
        audienceType: data.audienceType,
        audienceValue: data.audienceValue,
        startsAt: data.startsAt ? new Date(data.startsAt) : new Date(),
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
      },
    });

    await tx.announcementReceipt.createMany({
      data: uniqueRecipients.map(recipient => ({
        announcementId: created.id,
        userId: recipient.id,
      })),
    });

    return created;
  });

  await writeAudit(req, 'CREATE', 'ANNOUNCEMENT', announcement.id, announcement.title, null, {
    audienceType: announcement.audienceType,
    recipientCount: uniqueRecipients.length,
  });

  res.status(201).json({
    id: announcement.id,
    recipientCount: uniqueRecipients.length,
  });
});

app.post('/api/announcements/:id/seen', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const receipt = await prisma.announcementReceipt.findUnique({
    where: { announcementId_userId: { announcementId: id, userId: req.authUser!.id } },
  });
  if (!receipt) {
    res.status(404).json({ error: 'Duyuru bulunamadı.' });
    return;
  }
  const updated = await prisma.announcementReceipt.update({
    where: { id: receipt.id },
    data: { seenAt: receipt.seenAt ?? new Date() },
  });
  res.json({ seenAt: updated.seenAt?.getTime() ?? null });
});

app.post('/api/announcements/:id/dismiss', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const parsed = z.object({ dontShowAgain: z.boolean().default(false) }).parse(req.body ?? {});
  const receipt = await prisma.announcementReceipt.findUnique({
    where: { announcementId_userId: { announcementId: id, userId: req.authUser!.id } },
  });
  if (!receipt) {
    res.status(404).json({ error: 'Duyuru bulunamadı.' });
    return;
  }
  const now = new Date();
  const updated = await prisma.announcementReceipt.update({
    where: { id: receipt.id },
    data: {
      seenAt: receipt.seenAt ?? now,
      dismissedAt: now,
      dontShowAgainAt: parsed.dontShowAgain ? now : null,
    },
  });
  res.json({
    dismissedAt: updated.dismissedAt?.getTime() ?? null,
    dontShowAgainAt: updated.dontShowAgainAt?.getTime() ?? null,
  });
});

app.delete('/api/announcements/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (announcement&&announcement.branchCode!=='ALL') await assertBranchAccess(req, announcement.branchCode);
  if (!announcement || (!req.authUser!.isAdmin && announcement.senderId !== req.authUser!.id)) {
    res.status(404).json({ error: 'Duyuru bulunamadı.' });
    return;
  }
  await prisma.announcement.update({ where: { id }, data: { active: false } });
  await writeAudit(req, 'DELETE', 'ANNOUNCEMENT', id, announcement.title);
  res.status(204).end();
});


const messageSchema = z.object({
  recipientId: z.string().uuid(),
  subject: z.string().trim().max(160).default(''),
  body: z.string().trim().min(1).max(5000),
});

app.get('/api/messages', requireAuth, async (req: AuthRequest, res) => {
  const rows = await prisma.message.findMany({
    where: { OR: [{ recipientId: req.authUser!.id }, { senderId: req.authUser!.id }] },
    include: { sender: true, recipient: true },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });
  res.json(rows.map(m => ({
    id: m.id,
    branchCode: m.branchCode,
    senderId: m.senderId,
    senderName: m.sender.displayName || m.sender.username,
    recipientId: m.recipientId,
    recipientName: m.recipient.displayName || m.recipient.username,
    direction: m.senderId === req.authUser!.id ? 'sent' : 'inbox',
    subject: m.subject,
    body: m.body,
    readAt: m.readAt?.getTime() ?? null,
    createdAt: m.createdAt.getTime(),
  })));
});

app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
  const d = messageSchema.parse(req.body);
  if (d.recipientId === req.authUser!.id) {
    res.status(400).json({ error: 'Kendinize mesaj gönderemezsiniz.' });
    return;
  }
  const recipient = await prisma.user.findUnique({ where: { id: d.recipientId } });
  if (!recipient?.active) {
    res.status(404).json({ error: 'Alıcı kullanıcı bulunamadı.' });
    return;
  }
  const branchCode = await writeBranchCode(req);
  const row = await prisma.message.create({
    data: { senderId: req.authUser!.id, recipientId: d.recipientId, branchCode, subject: d.subject, body: d.body },
  });
  res.status(201).json({
    id: row.id,
    branchCode: row.branchCode,
    senderId: row.senderId,
    senderName: req.authUser!.displayName || req.authUser!.username,
    recipientId: row.recipientId,
    recipientName: recipient.displayName || recipient.username,
    direction: 'sent',
    subject: row.subject,
    body: row.body,
    readAt: null,
    createdAt: row.createdAt.getTime(),
  });
});

app.put('/api/messages/:id/read', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const row = await prisma.message.findUnique({ where: { id } });
  if (!row || row.recipientId !== req.authUser!.id) {
    res.status(404).json({ error: 'Mesaj bulunamadı.' });
    return;
  }
  const updated = await prisma.message.update({ where: { id }, data: { readAt: row.readAt ?? new Date() } });
  res.json({ readAt: updated.readAt?.getTime() ?? null });
});

app.delete('/api/messages/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = routeId(req.params.id);
  const row = await prisma.message.findUnique({ where: { id } });
  if (!row || (row.recipientId !== req.authUser!.id && row.senderId !== req.authUser!.id)) {
    res.status(404).json({ error: 'Mesaj bulunamadı.' });
    return;
  }
  await prisma.message.delete({ where: { id } });
  res.status(204).end();
});


function apiRestoreMaxBytes(): number {
  const requestedMb = Number(process.env.OPERIS_API_RESTORE_MAX_MB ?? 250);
  const safeMb = Number.isFinite(requestedMb)
    ? Math.min(4096, Math.max(64, Math.floor(requestedMb)))
    : 250;
  return safeMb * 1024 * 1024;
}

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: apiRestoreMaxBytes() },
  fileFilter: (_req, file, cb) => cb(null, file.originalname.toLocaleLowerCase('tr-TR').endsWith('.zip')),
});
const adminOnly = requirePermission((_p, u) => u.isAdmin);

const DEFAULT_BRANDING_QUICK_LINKS = [
  { id: 'ebys', label: 'EBYS GİRİŞ', url: 'https://ebys.izdeniz.com.tr/dys/documentmanagement/', active: true },
  { id: 'helpdesk', label: 'BİLGİ İŞLEM DESTEK', url: 'http://ticket.izdeniz.com.tr/#login', active: true },
] as const;

function parseBrandingQuickLinks(raw: string) {
  if (!raw.trim()) return DEFAULT_BRANDING_QUICK_LINKS.map(link => ({ ...link }));
  try {
    const parsed = JSON.parse(raw);
    const result = z.array(z.object({
      id: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(80),
      url: z.string().trim().url().refine(value => /^https?:\/\//i.test(value)),
      active: z.boolean(),
    })).max(12).safeParse(parsed);
    return result.success ? result.data : DEFAULT_BRANDING_QUICK_LINKS.map(link => ({ ...link }));
  } catch {
    return DEFAULT_BRANDING_QUICK_LINKS.map(link => ({ ...link }));
  }
}

const logoSchema = z.object({
  companyName: z.string().trim().max(160),
  companyLogoDataUrl: z.string().max(2_500_000).refine(value =>
    value === '' || /^data:image\/jpeg;base64,/i.test(value),
    'Yalnızca JPEG şirket logosu yüklenebilir.'
  ),
  quickLinks: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    url: z.string().trim().url().refine(value => /^https?:\/\//i.test(value), 'Bağlantı http:// veya https:// ile başlamalıdır.'),
    active: z.boolean(),
  })).max(12),
});

const backupSettingsSchema = z.object({
  networkBackupEnabled: z.boolean(),
  networkBackupPath: z.string().trim().max(500),
  backupScheduleEnabled: z.boolean(),
  backupScheduleType: z.enum(['daily', 'weekly', 'hourly']),
  backupScheduleTime: z.string().regex(/^\d{2}:\d{2}$/),
  backupScheduleDay: z.number().int().min(0).max(6),
  backupRetentionDays: z.number().int().min(1).max(3650),
});

app.put(
  '/api/admin/branding',
  requireAuth,
  requirePermission((permissions, user) => user.isAdmin || permissions.canAccessSettings),
  async (req, res) => {
    const data = logoSchema.parse(req.body);
    const stored = {
      companyName: data.companyName,
      companyLogoDataUrl: data.companyLogoDataUrl,
      quickLinksJson: JSON.stringify(data.quickLinks),
    };
    const settings = await prisma.appSettings.upsert({
      where: { id: 1 },
      update: stored,
      create: { id: 1, ...stored },
    });
    res.json({
      companyName: settings.companyName,
      companyLogoDataUrl: settings.companyLogoDataUrl,
      quickLinks: parseBrandingQuickLinks(settings.quickLinksJson),
    });
  },
);

app.put('/api/admin/backup/settings', requireAuth, adminOnly, async (req, res) => {
  const data = backupSettingsSchema.parse(req.body);
  if (data.networkBackupEnabled && !/^\\\\[^\\]+\\[^\\]+/.test(data.networkBackupPath)) {
    res.status(400).json({ error: 'Network yolu \\\\SUNUCU\\PAYLASIM biçiminde olmalıdır.' });
    return;
  }
  await prisma.appSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  res.json({ ok: true });
});

app.post('/api/admin/backup/test-network', requireAuth, adminOnly, async (_req, res) => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings?.networkBackupEnabled || !settings.networkBackupPath) {
    res.status(400).json({ error: 'Network yedekleme etkin değil.' });
    return;
  }
  try {
    fs.accessSync(settings.networkBackupPath, fs.constants.W_OK);
    const probe = path.join(settings.networkBackupPath, `.yaklasan-isler-test-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    res.json({ ok: true, message: 'Network klasörüne yazma testi başarılı.' });
  } catch (error) {
    res.status(500).json({ error: `Network klasörüne yazılamadı: ${error instanceof Error ? error.message : String(error)}` });
  }
});

function runPowerShell(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], { windowsHide: true }, error => {
      if (error) reject(error); else resolve();
    });
  });
}

app.post('/api/admin/backup/apply-schedule', requireAuth, adminOnly, async (_req, res) => {
  if (!ensureSqliteFileBackupProvider(res)) return;
  if (process.platform !== 'win32') {
    res.status(400).json({ error: 'Zamanlanmış görev yalnızca Windows üzerinde uygulanabilir.' });
    return;
  }
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    res.status(404).json({ error: 'Yedekleme ayarları bulunamadı.' });
    return;
  }
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../windows/configure-backup-task.ps1');
  await runPowerShell(scriptPath, [
    '-Enabled', String(settings.backupScheduleEnabled),
    '-ScheduleType', settings.backupScheduleType,
    '-Time', settings.backupScheduleTime,
    '-Day', String(settings.backupScheduleDay),
    '-NetworkEnabled', String(settings.networkBackupEnabled),
    '-NetworkPath', settings.networkBackupPath,
    '-RetentionDays', String(settings.backupRetentionDays),
  ]);
  res.json({ ok: true, message: settings.backupScheduleEnabled ? 'Zamanlanmış görev uygulandı.' : 'Zamanlanmış görev kaldırıldı.' });
});

const outlookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});
const outlookAttachments = new Map<string, { fileName: string; mimeType: string; buffer: Buffer; expiresAt: number }>();

app.post('/api/outlook/attachment', requireAuth, outlookUpload.single('attachment'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Ek dosya bulunamadı.' });
    return;
  }
  const token = crypto.randomBytes(24).toString('hex');
  outlookAttachments.set(token, {
    fileName: req.file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_'),
    mimeType: req.file.mimetype || 'application/octet-stream',
    buffer: req.file.buffer,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const subject = String(req.body.subject ?? 'Yaklaşan İşler Raporu').slice(0, 180);
  const base = `${req.protocol}://${req.get('host')}`;
  const downloadUrl = `${base}/api/outlook/download/${token}`;
  const protocolUrl = `yaklasanisler-mail:?url=${encodeURIComponent(downloadUrl)}&subject=${encodeURIComponent(subject)}`;
  res.json({ protocolUrl });
});

app.get('/api/outlook/download/:token', (req, res) => {
  const token = routeId(req.params.token);
  const item = outlookAttachments.get(token);
  if (!item || item.expiresAt < Date.now()) {
    outlookAttachments.delete(token);
    res.status(404).send('Ek dosya süresi dolmuş veya bulunamamış.');
    return;
  }
  outlookAttachments.delete(token);
  res.setHeader('Content-Type', item.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.fileName)}"`);
  res.send(item.buffer);
});

setInterval(() => {
  const now = Date.now();
  for (const [token, item] of outlookAttachments) {
    if (item.expiresAt < now) outlookAttachments.delete(token);
  }
}, 60_000).unref();



function ensureSqliteFileBackupProvider(res: express.Response): boolean {
  const provider = currentDatabaseProvider();
  if (provider === 'sqlite') return true;
  res.status(409).json({
    error: provider === 'postgresql'
      ? 'Bu kurulum PostgreSQL kullanıyor. SQLite dosya yedeği/restore akışı çalıştırılmadı; PostgreSQL için pg_dump/pg_restore yedekleme akışını kullanın.'
      : 'Veritabanı sağlayıcısı tanınamadı; dosya tabanlı backup işlemi güvenlik nedeniyle durduruldu.',
    code: provider === 'postgresql' ? 'POSTGRESQL_BACKUP_PROVIDER' : 'DATABASE_PROVIDER_UNKNOWN',
    provider,
  });
  return false;
}

function databaseFilePath(): string {
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (databaseUrl.startsWith('file:')) {
    const sqlitePath = databaseUrl.slice('file:'.length);
    if (sqlitePath && path.isAbsolute(sqlitePath)) return sqlitePath;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/yaklasan-isler.db');
}

function helpDeskAttachmentDirectory(): string {
  return path.resolve(process.env.OPERIS_DATA_DIR || './data', 'helpdesk-attachments');
}

function protectedBackupDirectory(): string {
  const dataRoot = String(process.env.OPERIS_DATA_DIR ?? '').trim();
  if (dataRoot) return path.resolve(dataRoot, 'protected-backups');
  return path.resolve(path.dirname(databaseFilePath()), '../../protected-backups');
}

type BackupAttachmentManifestItem = { name: string; size: number; sha256: string };

function helpDeskAttachmentManifest(): BackupAttachmentManifestItem[] {
  const directory = helpDeskAttachmentDirectory();
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(item => item.isFile())
    .map(item => {
      const name = path.basename(item.name);
      const filePath = path.join(directory, name);
      const data = fs.readFileSync(filePath);
      return {
        name,
        size: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

app.get('/api/admin/backup', requireAuth, adminOnly, async (_req, res) => {
  if (!ensureSqliteFileBackupProvider(res)) return;
  const dbFile = databaseFilePath();
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  if (!fs.existsSync(dbFile)) {
    res.status(404).json({ error: 'Veritabanı dosyası bulunamadı.' });
    return;
  }
  const attachmentDirectory = helpDeskAttachmentDirectory();
  const helpDeskAttachments = helpDeskAttachmentManifest();
  const rawBackupBytes = fs.statSync(dbFile).size
    + (fs.existsSync(envFile) ? fs.statSync(envFile).size : 0)
    + helpDeskAttachments.reduce((total, item) => total + item.size, 0)
    + 1024 * 1024;
  const restoreLimitBytes = apiRestoreMaxBytes();
  if (rawBackupBytes > restoreLimitBytes) {
    res.status(413).json({
      error: `Tam yedek tahmini ham boyutu ${(rawBackupBytes / 1024 / 1024).toFixed(1)} MB. API restore limiti ${(restoreLimitBytes / 1024 / 1024).toFixed(0)} MB. Bu yedek UI üzerinden güvenli geri yüklenemeyeceği için oluşturulmadı; zamanlanmış/dosya sistemi yedeğini kullanın veya OPERIS_API_RESTORE_MAX_MB değerini kontrollü artırın.`,
      code: 'BACKUP_TOO_LARGE_FOR_API_RESTORE',
      rawBackupBytes,
      restoreLimitBytes,
    });
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `yaklasan-isler-tam-yedek-${stamp}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', error => {
    console.error('Yedek oluşturma hatası:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Yedek oluşturulamadı.' });
    else res.end();
  });
  archive.pipe(res);
  archive.file(dbFile, { name: 'database/yaklasan-isler.db' });
  if (fs.existsSync(envFile)) archive.file(envFile, { name: 'config/server.env' });

  for (const item of helpDeskAttachments) {
    archive.file(path.join(attachmentDirectory, item.name), { name: `helpdesk-attachments/${item.name}` });
  }

  archive.append(JSON.stringify({
    formatVersion: 2,
    product: 'OPERIS',
    version: CURRENT_VERSION,
    createdAt: new Date().toISOString(),
    databaseSha256: crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex'),
    helpDeskAttachments,
  }, null, 2), { name: 'metadata.json' });
  await archive.finalize();
});

function compareReleaseVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

app.post('/api/admin/restore', requireAuth, adminOnly, backupUpload.single('backup'), async (req: AuthRequest, res) => {
  if (!ensureSqliteFileBackupProvider(res)) return;
  if (!req.file?.buffer) {
    res.status(400).json({ error: 'ZIP yedek dosyası seçilmedi.' });
    return;
  }
  const zip = new AdmZip(req.file.buffer);
  const dbEntry = zip.getEntry('database/yaklasan-isler.db');
  const metadataEntry = zip.getEntry('metadata.json');
  if (!dbEntry || !metadataEntry) {
    res.status(400).json({ error: 'Geçersiz yedek: veritabanı veya metadata bulunamadı.' });
    return;
  }
  const metadata = JSON.parse(metadataEntry.getData().toString('utf8')) as {
    formatVersion?: number;
    product?: string;
    version?: string;
    databaseSha256?: string;
    helpDeskAttachments?: BackupAttachmentManifestItem[];
  };
  const acceptedBackupProducts = new Set(['OPERIS', 'Yaklaşan İşler']);
  if (!metadata.product || !acceptedBackupProducts.has(metadata.product)) {
    res.status(400).json({ error: 'Bu dosya geçerli bir OPERİS yedeği değil.', code: 'BACKUP_PRODUCT_MISMATCH' });
    return;
  }
  if (metadata.version) {
    const versionComparison = compareReleaseVersions(metadata.version, CURRENT_VERSION);
    if (versionComparison === null) {
      res.status(400).json({ error: 'Yedek sürüm bilgisi geçersiz.', code: 'BACKUP_VERSION_INVALID' });
      return;
    }
    if (versionComparison > 0) {
      res.status(409).json({
        error: `Bu yedek OPERİS ${metadata.version} sürümünden alınmış. Çalışan sürüm ${CURRENT_VERSION}; daha yeni sürüm yedeği eski uygulamaya geri yüklenemez.`,
        code: 'BACKUP_VERSION_NEWER',
      });
      return;
    }
  }
  const incomingDb = dbEntry.getData();
  const checksum = crypto.createHash('sha256').update(incomingDb).digest('hex');
  if (metadata.databaseSha256 && metadata.databaseSha256 !== checksum) {
    res.status(400).json({ error: 'Yedek bütünlük kontrolünden geçemedi.' });
    return;
  }

  const hasAttachmentManifest = Array.isArray(metadata.helpDeskAttachments);
  const attachmentManifest = hasAttachmentManifest ? metadata.helpDeskAttachments! : [];
  const attachmentEntries = new Map<string, any>(
    (zip.getEntries() as any[])
      .filter(entry => !entry.isDirectory && entry.entryName.startsWith('helpdesk-attachments/'))
      .map(entry => [path.basename(entry.entryName), entry]),
  );

  if (hasAttachmentManifest) {
    if (attachmentEntries.size !== attachmentManifest.length) {
      res.status(400).json({ error: 'Help Desk ek dosyası manifesti ile ZIP içeriği uyuşmuyor.', code: 'BACKUP_ATTACHMENT_COUNT_MISMATCH' });
      return;
    }
    for (const item of attachmentManifest) {
      if (!item?.name || path.basename(item.name) !== item.name || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isInteger(item.size) || item.size < 0) {
        res.status(400).json({ error: 'Help Desk ek dosyası manifesti geçersiz.', code: 'BACKUP_ATTACHMENT_MANIFEST_INVALID' });
        return;
      }
      const entry = attachmentEntries.get(item.name);
      if (!entry) {
        res.status(400).json({ error: `Help Desk ek dosyası yedekte bulunamadı: ${item.name}`, code: 'BACKUP_ATTACHMENT_MISSING' });
        return;
      }
      const data = entry.getData();
      const fileChecksum = crypto.createHash('sha256').update(data).digest('hex');
      if (data.length !== item.size || fileChecksum !== item.sha256) {
        res.status(400).json({ error: `Help Desk ek dosyası bütünlük kontrolünden geçemedi: ${item.name}`, code: 'BACKUP_ATTACHMENT_HASH_MISMATCH' });
        return;
      }
    }
  }

  const dbFile = databaseFilePath();
  const attachmentDirectory = helpDeskAttachmentDirectory();
  const backupDir = protectedBackupDirectory();
  fs.mkdirSync(backupDir, { recursive: true });
  const restoreStamp = Date.now();
  const currentBackup = path.join(backupDir, `pre-restore-${restoreStamp}.db`);
  const currentAttachmentBackup = path.join(backupDir, `pre-restore-helpdesk-attachments-${restoreStamp}`);
  fs.copyFileSync(dbFile, currentBackup);
  if (fs.existsSync(attachmentDirectory)) {
    fs.cpSync(attachmentDirectory, currentAttachmentBackup, { recursive: true });
  }

  const tempFile = path.join(os.tmpdir(), `yaklasan-isler-restore-${restoreStamp}.db`);
  const tempAttachmentDirectory = path.join(os.tmpdir(), `operis-helpdesk-attachments-${restoreStamp}`);
  fs.writeFileSync(tempFile, incomingDb);

  if (hasAttachmentManifest) {
    fs.mkdirSync(tempAttachmentDirectory, { recursive: true });
    for (const item of attachmentManifest) {
      fs.writeFileSync(path.join(tempAttachmentDirectory, item.name), attachmentEntries.get(item.name).getData());
    }
  }

  await prisma.$disconnect();
  try {
    fs.copyFileSync(tempFile, dbFile);
    if (hasAttachmentManifest) {
      fs.rmSync(attachmentDirectory, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(attachmentDirectory), { recursive: true });
      fs.cpSync(tempAttachmentDirectory, attachmentDirectory, { recursive: true });
    }
  } catch (error) {
    fs.copyFileSync(currentBackup, dbFile);
    if (hasAttachmentManifest) {
      fs.rmSync(attachmentDirectory, { recursive: true, force: true });
      if (fs.existsSync(currentAttachmentBackup)) {
        fs.cpSync(currentAttachmentBackup, attachmentDirectory, { recursive: true });
      }
    }
    await prisma.$connect().catch(() => undefined);
    throw error;
  } finally {
    fs.rmSync(tempFile, { force: true });
    fs.rmSync(tempAttachmentDirectory, { recursive: true, force: true });
  }

  res.json({
    ok: true,
    restartRequired: true,
    helpDeskAttachmentsRestored: hasAttachmentManifest,
    sourceVersion: metadata.version ?? null,
    sourceFormatVersion: metadata.formatVersion ?? 1,
    warning: hasAttachmentManifest ? '' : 'Eski yedekte Help Desk ek dosyası manifesti yoktu; mevcut fiziksel ek klasörü korundu.',
  });
  setTimeout(() => process.exit(1), 1200);
});

app.post('/api/import', requireAuth, async (req: AuthRequest, res) => {
  const body = z.object({
    tasks: z.array(taskSchema).max(5000).default([]),
    credentials: z.array(credentialSchema).max(5000).default([]),
    trackingRecords: z.array(trackingSchema).max(5000).default([]),
  }).parse(req.body);

  const branchCode = await writeBranchCode(req);
  if (body.tasks.length) {
    await assertBranchPermission(req, branchCode, permissions => permissions.tasks.canExcel, 'Bu şubede İşler içe aktarma yetkiniz yok.');
  }
  if (body.credentials.length) {
    await assertBranchPermission(req, branchCode, permissions => permissions.credentials.canExcel, 'Bu şubede Bilgiler içe aktarma yetkiniz yok.');
  }
  if (body.trackingRecords.length) {
    await assertBranchPermission(req, branchCode, permissions => permissions.tracking.canExcel, 'Bu şubede Takip içe aktarma yetkiniz yok.');
  }

  const [existingTasks, existingCredentials, existingTracking] = await Promise.all([
    body.tasks.length
      ? prisma.task.findMany({ where: { id: { in: body.tasks.map(item => item.id) } }, select: { id: true, branchCode: true } })
      : [],
    body.credentials.length
      ? prisma.credential.findMany({ where: { id: { in: body.credentials.map(item => item.id) } }, select: { id: true, branchCode: true } })
      : [],
    body.trackingRecords.length
      ? prisma.trackingRecord.findMany({ where: { id: { in: body.trackingRecords.map(item => item.id) } }, select: { id: true, branchCode: true } })
      : [],
  ]);

  const crossBranchConflicts = [
    ...existingTasks.filter(item => item.branchCode !== branchCode).map(item => `İş:${item.id}@${item.branchCode}`),
    ...existingCredentials.filter(item => item.branchCode !== branchCode).map(item => `Bilgi:${item.id}@${item.branchCode}`),
    ...existingTracking.filter(item => item.branchCode !== branchCode).map(item => `Takip:${item.id}@${item.branchCode}`),
  ];
  if (crossBranchConflicts.length) {
    res.status(409).json({
      error: 'İçe aktarma durduruldu. Aynı kayıt kimliği başka bir şubede mevcut.',
      code: 'IMPORT_CROSS_BRANCH_ID_CONFLICT',
      detail: crossBranchConflicts.slice(0, 25).join(', '),
    });
    return;
  }

  await prisma.$transaction([
    ...body.tasks.map(d => prisma.task.upsert({
      where: { id: d.id },
      update: { ...d, branchCode, createdAt: new Date(d.createdAt) },
      create: { ...d, branchCode, createdAt: new Date(d.createdAt) },
    })),
    ...body.credentials.map(d => prisma.credential.upsert({
      where: { id: d.id },
      update: { branchCode, ...credentialData(d) },
      create: { id: d.id, branchCode, ...credentialData(d) },
    })),
    ...body.trackingRecords.map(d => prisma.trackingRecord.upsert({
      where: { id: d.id },
      update: { ...d, branchCode, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) },
      create: { ...d, branchCode, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) },
    })),
  ]);

  await writeAudit(req, 'IMPORT', 'DATA', branchCode, `Şube ${branchCode}`, null, {
    tasks: body.tasks.length,
    credentials: body.credentials.length,
    trackingRecords: body.trackingRecords.length,
  });

  res.json({
    branchCode,
    imported: { tasks: body.tasks.length, credentials: body.credentials.length, trackingRecords: body.trackingRecords.length },
  });
});


if (process.env.NODE_ENV === 'production') {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(currentDir, '../public');

  app.use(express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html') || filePath.endsWith('manifest.json') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.sendFile(path.join(publicDir, 'index.html'));
      return;
    }
    next();
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? 'Geçersiz veri.' }); return; }
  const message = error instanceof Error ? error.message : 'Sunucu hatası.';
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 500;
  res.status(status).json({ error: status < 500 || process.env.NODE_ENV !== 'production' ? message : 'Sunucu hatası.' });
});

async function ensureBrandingQuickLinksColumn() {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AppSettings" ADD COLUMN "quickLinksJson" TEXT NOT NULL DEFAULT ''`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name|already exists/i.test(message)) throw error;
  }
}

void (async () => {
  await ensureBrandingQuickLinksColumn();
  await ensureBranchFoundation();
    await ensureHelpDeskFoundation();
  await ensureAssetIdentifierUniqueIndexes();
  startNetworkMonitorScheduler();
  startDomainSyncScheduler();
  startTblDemirmasHourlyScheduler();
  startTblDemSatisHourlyScheduler();
  try {
    await syncRemoteAccessFirewall(await currentRemoteAccessMode());
  } catch (error) {
    console.error('[REMOTE ACCESS FIREWALL]', error);
  }
  app.listen(port, bindHost, () => {
    console.log(`Operis Enterprise v6.3.63 http://${bindHost}:${port}`);
    startReminderScheduler();
  });
})();
