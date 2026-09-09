import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from './db.js';
import { requireAuth, type AuthRequest } from './auth.js';
import { branchContextFromRequest } from './branch-access.js';
import { sendMail } from './mailer.js';
import { sendGraphMail } from './graph-mailer.js';

export const helpDeskRouter = Router();

const attachmentDir = path.resolve(process.env.OPERIS_DATA_DIR || './data', 'helpdesk-attachments');
fs.mkdirSync(attachmentDir, { recursive: true });

const upload = multer({
  dest: attachmentDir,
  limits: { fileSize: 25 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    const blocked = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js)$/i.test(file.originalname);
    if (blocked) {
      callback(new Error('Bu dosya türüne Help Desk eki olarak izin verilmiyor.'));
      return;
    }
    callback(null, true);
  },
});

const emailListSchema = z.string().trim().max(2000).default('').refine((value) => {
  if (!value) return true;
  const items = value.split(';').map(item => item.trim()).filter(Boolean);
  return items.length <= 20 && items.every(item => z.string().email().safeParse(item).success);
}, 'E-posta adreslerini ; ile ayırarak geçerli biçimde girin.');

const ticketSchema = z.object({
  branchCode: z.string().regex(/^\d{3}$/),
  categoryId: z.string().uuid(),
  priorityId: z.string().uuid(),
  subject: z.string().trim().min(3).max(240),
  body: z.string().trim().min(50, 'Destek içeriği en az 50 karakter olmalıdır.').max(20000),
  ccEmails: emailListSchema.optional().default(''),
});
const replySchema = z.object({
  body: z.string().trim().min(1).max(20000),
  internalNote: z.boolean().default(false),
});
const accessSchema = z.object({
  userId: z.string().uuid(),
  branchCode: z.string().regex(/^\d{3}$/),
  active: z.boolean().default(true),
  canOpen: z.boolean().default(false),
  canStaff: z.boolean().default(false),
  canCoordinate: z.boolean().default(false),
  canRespond: z.boolean().default(false),
  canChangeStatus: z.boolean().default(false),
  canReopen: z.boolean().default(false),
  canViewAll: z.boolean().default(false),
  canAssign: z.boolean().default(false),
  canClose: z.boolean().default(false),
  canReport: z.boolean().default(false),
  canTopics: z.boolean().default(false),
  canCannedReplies: z.boolean().default(false),
  canKnowledge: z.boolean().default(false),
  mutedEmail: z.boolean().default(false),
});
const settingsSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().max(160),
  welcomeText: z.string().trim().max(3000),
  emailSubjectPrefix: z.string().trim().max(120),
  allowAttachments: z.boolean(),
  maxAttachmentMb: z.number().int().min(1).max(25),
  knowledgeEnabled: z.boolean(),
  showRecentTickets: z.boolean(),
});
const categorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
const prioritySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  level: z.number().int().min(1).max(10),
  active: z.boolean().default(true),
  firstResponseMinutes: z.number().int().min(0).max(525600),
  resolutionMinutes: z.number().int().min(0).max(525600),
});
const statusSchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  closed: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean().default(true),
});
const knowledgeCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
const articleSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().trim().min(3).max(240),
  body: z.string().trim().min(3).max(50000),
  active: z.boolean().default(true),
});
const cannedSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20000),
  active: z.boolean().default(true),
});

function htmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function makeTicketCodeCandidate() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let value = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i += 1) value += alphabet[bytes[i] % alphabet.length];
  return value;
}
async function makeUniqueTicketNo() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = makeTicketCodeCandidate();
    const exists = await prisma.helpDeskTicket.findUnique({ where: { ticketNo: value }, select: { id: true } });
    if (!exists) return value;
  }
  throw new Error('Benzersiz ticket kodu üretilemedi. Lütfen tekrar deneyin.');
}
function makeTrackingId() { return crypto.randomBytes(8).toString('hex').toUpperCase(); }
function parseEmailList(value: string | null | undefined) {
  return [...new Set(String(value ?? '').split(';').map(item => item.trim().toLocaleLowerCase('tr-TR')).filter(Boolean))];
}
function normalizeIp(value: string | null | undefined) {
  const raw = String(value ?? '').split(',')[0].trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}
async function observedMacForIp(ip: string) {
  if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || process.platform !== 'win32') return '';
  try {
    const { execFile } = await import('node:child_process');
    const output = await new Promise<string>((resolve) => {
      execFile('arp.exe', ['-a', ip], { windowsHide: true, timeout: 2500, encoding: 'utf8' }, (_err, stdout) => resolve(stdout || ''));
    });
    const match = output.match(/(?:[0-9a-f]{2}[-:]){5}[0-9a-f]{2}/i);
    return match?.[0]?.replaceAll('-', ':').toUpperCase() ?? '';
  } catch { return ''; }
}

function timestamp(value: Date | null | undefined) {
  return value ? value.getTime() : null;
}

async function accessFor(userId: string, branchCode: string) {
  return prisma.helpDeskAccess.findUnique({
    where: { userId_branchCode: { userId, branchCode } },
  });
}

async function isCentralManager(req: AuthRequest) {
  return Boolean(req.authUser!.isAdmin);
}

async function assertCentral(req: AuthRequest) {
  if (!(await isCentralManager(req))) {
    const error = new Error('Help Desk genel şube tanımlarını yalnız OPERİS admin kullanıcıları yönetebilir.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

async function assertOpen(req: AuthRequest, branchCode: string) {
  if (req.authUser!.isAdmin) return;
  const access = await accessFor(req.authUser!.id, branchCode);
  if (!access?.active || !access.canOpen) {
    const error = new Error('Bu şubeye destek talebi açma yetkiniz yok.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

async function assertCoordinator(req: AuthRequest, branchCode: string) {
  if (req.authUser!.isAdmin) return;
  const access = await accessFor(req.authUser!.id, branchCode);
  if (!access?.active || !access.canCoordinate) {
    const error = new Error('Bu Help Desk şubesinde ticket açma/takip koordinatörü yetkiniz yok.') as Error & { status?: number };
    error.status = 403; throw error;
  }
}
async function assertResponder(req: AuthRequest, branchCode: string) {
  if (req.authUser!.isAdmin) return;
  const access = await accessFor(req.authUser!.id, branchCode);
  if (!access?.active || !access.canRespond) {
    const error = new Error('Bu Help Desk şubesinde cevaplayan kullanıcı yetkiniz yok.') as Error & { status?: number };
    error.status = 403; throw error;
  }
}
async function canViewBranchPool(req: AuthRequest, branchCode: string) {
  if (req.authUser!.isAdmin) return true;
  const access = await accessFor(req.authUser!.id, branchCode);
  return Boolean(access?.active && access.canViewAll && (access.canCoordinate || access.canReport));
}

async function assertTopics(req: AuthRequest, branchCode: string) {
  if (await isCentralManager(req)) return;
  const access = await accessFor(req.authUser!.id, branchCode);
  if (!access?.active || !access.canTopics) {
    const error = new Error('Bu şubenin destek konularını yönetme yetkiniz yok.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

async function assertKnowledge(req: AuthRequest, branchCode: string) {
  if (req.authUser!.isAdmin) return;
  const access = await accessFor(req.authUser!.id, branchCode);
  if (!access?.active || !access.canKnowledge) {
    const error = new Error('Bu şubenin bilgi bankasını yönetme yetkiniz yok.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

async function assertCanned(req: AuthRequest, branchCode: string) {
  if (req.authUser!.isAdmin) return;
  const access = await accessFor(req.authUser!.id, branchCode);
  if (!access?.active || !access.canCannedReplies) {
    const error = new Error('Bu şubenin hazır yanıtlarını yönetme yetkiniz yok.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

function assertUnlocked(ticket: { locked: boolean }) {
  if (ticket.locked) {
    const error = new Error('Bu ticket kilitli. Kilit açılmadan cevap, durum, görevli, takipçi veya ek değişikliği yapılamaz.') as Error & { status?: number };
    error.status = 409;
    throw error;
  }
}

async function getSetting(branchCode: string) {
  return prisma.helpDeskBranchSetting.findUnique({ where: { branchCode } });
}

async function getGlobalHelpDeskSetting() {
  return prisma.helpDeskGlobalSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
async function categoryStaffEmails(branchCode: string, categoryId: string): Promise<string[]> {
  const rows = await prisma.helpDeskCategoryAssignee.findMany({ where: { branchCode, categoryId }, select: { userId: true } });
  if (!rows.length) return staffEmails(branchCode);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map(row => row.userId) }, active: true }, select: { email: true } });
  return [...new Set(users.map(user => String(user.email ?? '').trim()).filter(Boolean))];
}
async function helpDeskMailSubject(ticket: { branchCode: string; ticketNo: string; subject: string; categoryId: string }) {
  const [branch, category] = await Promise.all([
    branchName(ticket.branchCode),
    prisma.helpDeskCategory.findUnique({ where: { id: ticket.categoryId }, select: { name: true } }),
  ]);
  return `[${branch}] [${category?.name || 'Genel'}] [${ticket.ticketNo}] ${ticket.subject}`;
}
type TicketMailActor = {
  id: string;
  username: string;
  displayName: string;
  email: string;
};

function ticketMailActor(req: AuthRequest): TicketMailActor {
  return {
    id: req.authUser!.id,
    username: req.authUser!.username,
    displayName: req.authUser!.displayName || req.authUser!.username,
    email: req.authUser!.email || '',
  };
}

async function fullTicketMailBody(ticketId: string, eventTitle: string, actor: TicketMailActor) {
  const detail = await detailedTicket(ticketId);
  if (!detail) return eventTitle;
  const replies = (detail.replies ?? []).filter((reply: any) => !reply.internalNote);
  const attachments = detail.attachments ?? [];
  const lines = [
    eventTitle,'',
    `İşlemi Yapan: ${actor.displayName}`,
    `Kullanıcı Adı: ${actor.username}`,
    `Kullanıcı E-posta: ${actor.email || '-'}`,
    `Kullanıcı ID: ${actor.id}`,
    '',
    `Ticket Kodu: ${detail.ticketNo}`,`Şube: ${detail.branch?.name || detail.branchCode}`,
    `Destek Konusu: ${detail.category?.name || '-'}`,`Kullanıcı Konu Başlığı: ${detail.subject}`,
    `Talep Sahibi: ${detail.requesterName}`,`E-posta: ${detail.requesterEmail || '-'}`,
    `Öncelik: ${detail.priority?.name || '-'}`,`Durum: ${detail.status?.name || '-'}`,
    `Kaynak IP: ${detail.requesterIp || '-'}`,`Kaynak MAC: ${detail.requesterMac || 'Gözlemlenemedi'}`,
    '','İLK TALEP','----------------------------------------',detail.body,
  ];
  if (replies.length) {
    lines.push('','YAZIŞMALAR','----------------------------------------');
    for (const reply of replies) lines.push(`${new Date(reply.createdAt).toLocaleString('tr-TR')} — ${reply.authorName}${reply.isStaff ? ' (Yetkili)' : ' (Talep Sahibi)'}`,reply.body,'');
  }
  if (attachments.length) {
    lines.push('EKLER','----------------------------------------');
    for (const file of attachments) lines.push(`- ${file.originalName} (${Math.ceil(file.sizeBytes / 1024)} KB)`);
  }
  return lines.join('\n');
}
type HelpDeskMailAttachment = { filename: string; content: Buffer; contentType?: string };
async function sendTicketEventMail(ticketId: string, recipients: string[], eventTitle: string, actor: TicketMailActor) {
  const ticket = await prisma.helpDeskTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) return;
  const subject = await helpDeskMailSubject(ticket);
  const body = await fullTicketMailBody(ticketId, eventTitle, actor);
  const all = [...new Set([...recipients, ...parseEmailList(ticket.ccEmails)])].filter(Boolean);
  const attachmentRows = await prisma.helpDeskAttachment.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
  const attachments: HelpDeskMailAttachment[] = [];
  for (const row of attachmentRows) {
    const fullPath = path.join(attachmentDir, row.storedName);
    if (!fs.existsSync(fullPath)) continue;
    attachments.push({ filename: row.originalName, content: fs.readFileSync(fullPath), contentType: row.mimeType });
  }
  const senderName = await branchName(ticket.branchCode);
  for (const email of all) await sendHelpDeskMail(email, subject, body, attachments, senderName);
}

async function branchName(branchCode: string) {
  return (await prisma.branch.findUnique({ where: { code: branchCode } }))?.name || branchCode;
}

async function subjectPrefix(branchCode: string) {
  const row = await getSetting(branchCode);
  return row?.emailSubjectPrefix?.trim() || await branchName(branchCode);
}

async function sendHelpDeskMail(to: string, subject: string, body: string, attachments: HelpDeskMailAttachment[] = [], senderName = '') {
  if (!to.trim()) return;
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  try {
    if (settings?.mailProvider === 'graph' && settings.graphEnabled) {
      await sendGraphMail({ to, subject, body, attachments }); return;
    }
    if (settings?.smtpEnabled) {
      await sendMail(to, subject, body, `<div style="font-family:Segoe UI,Arial,sans-serif"><p>${htmlEscape(body).replace(/\n/g, '<br>')}</p></div>`, attachments, senderName);
    }
  } catch (error) { console.error('[HELPDESK MAIL]', error); }
}

async function staffEmails(branchCode: string): Promise<string[]> {
  const accesses = await prisma.helpDeskAccess.findMany({
    where: { branchCode, active: true, canRespond: true, mutedEmail: false },
  });
  if (!accesses.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: accesses.map(item => item.userId) }, active: true },
    select: { email: true },
  });
  return [...new Set(users.map(item => String(item.email ?? '').trim()).filter(Boolean))];
}

async function addActivity(ticketId: string, branchCode: string, req: AuthRequest, action: string, description: string) {
  await prisma.helpDeskActivity.create({
    data: {
      ticketId,
      branchCode,
      actorId: req.authUser!.id,
      actorName: req.authUser!.displayName || req.authUser!.username,
      action,
      description,
    },
  });
}

async function enrichTickets(rows: any[]) {
  if (!rows.length) return [];
  const branchCodes = [...new Set(rows.map(row => row.branchCode))];
  const categoryIds = [...new Set(rows.map(row => row.categoryId))];
  const priorityIds = [...new Set(rows.map(row => row.priorityId))];
  const statusIds = [...new Set(rows.map(row => row.statusId))];
  const ticketIds = rows.map(row => row.id);
  const requesterIds = [...new Set(rows.map(row => row.requesterId).filter(Boolean))];
  const [branches, categories, priorities, statuses, processedActivities, requesters] = await Promise.all([
    prisma.branch.findMany({ where: { code: { in: branchCodes } }, select: { code: true, name: true } }),
    prisma.helpDeskCategory.findMany({ where: { id: { in: categoryIds } } }),
    prisma.helpDeskPriority.findMany({ where: { id: { in: priorityIds } } }),
    prisma.helpDeskStatus.findMany({ where: { id: { in: statusIds } } }),
    prisma.helpDeskActivity.findMany({
      where: {
        ticketId: { in: ticketIds },
        action: { in: ['ASSIGN','STATUS','LOCK','UNLOCK','INTERNAL_NOTE'] },
      },
      select: { ticketId: true },
      distinct: ['ticketId'],
    }),
    prisma.user.findMany({
      where: { id: { in: requesterIds } },
      select: {
        id: true,
        directoryGroups: true,
        branchMemberships: {
          select: {
            branchCode: true,
            isPrimary: true,
            branch: { select: { code: true, name: true } },
          },
          orderBy: [{ isPrimary: 'desc' }, { branchCode: 'asc' }],
        },
      },
    }),
  ]);
  const branchMap = new Map(branches.map(row => [row.code, row]));
  const categoryMap = new Map(categories.map(row => [row.id, row]));
  const priorityMap = new Map(priorities.map(row => [row.id, row]));
  const statusMap = new Map(statuses.map(row => [row.id, row]));
  const processedTicketIds = new Set(processedActivities.map(row => row.ticketId));
  const requesterMap = new Map(requesters.map(row => [row.id, row]));
  return rows.map(row => {
    const requester = requesterMap.get(row.requesterId);
    const requesterBranches = requester?.branchMemberships.map(membership => ({
      code: membership.branch.code,
      name: membership.branch.name,
      isPrimary: membership.isPrimary,
    })) ?? [];
    const requesterPrimaryBranch = requesterBranches.find(branch => branch.isPrimary) ?? requesterBranches[0] ?? null;
    const requesterDirectoryGroups = Array.isArray(requester?.directoryGroups)
      ? requester.directoryGroups.filter((group): group is string => typeof group === 'string')
      : [];

    return {
    ...row,
    requesterDirectoryGroups,
    requesterBranches,
    requesterPrimaryBranch,
    branch: branchMap.get(row.branchCode) ?? { code: row.branchCode, name: row.branchCode },
    category: categoryMap.get(row.categoryId) ?? null,
    priority: priorityMap.get(row.priorityId) ?? null,
    status: statusMap.get(row.statusId) ?? null,
    isUnprocessed: !row.firstReplyAt && !processedTicketIds.has(row.id),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
    lastActivityAt: timestamp(row.lastActivityAt),
    firstReplyAt: timestamp(row.firstReplyAt),
    resolvedAt: timestamp(row.resolvedAt),
    closedAt: timestamp(row.closedAt),
    dueResponseAt: timestamp(row.dueResponseAt),
    dueResolutionAt: timestamp(row.dueResolutionAt),
    lockedAt: timestamp(row.lockedAt),
    };
  });
}

async function detailedTicket(id: string) {
  const ticket = await prisma.helpDeskTicket.findUnique({ where: { id } });
  if (!ticket) return null;
  const [enriched] = await enrichTickets([ticket]);
  const [replies, attachments, activities] = await Promise.all([
    prisma.helpDeskReply.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.helpDeskAttachment.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.helpDeskActivity.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    ...enriched,
    replies: replies.map(row => ({ ...row, createdAt: row.createdAt.getTime() })),
    attachments: attachments.map(row => ({ ...row, createdAt: row.createdAt.getTime() })),
    activities: activities.map(row => ({ ...row, createdAt: row.createdAt.getTime() })),
  };
}

const DEFAULT_HELPDESK_PRIORITIES = [
  {name:'Düşük',color:'#64748b',level:1,firstResponseMinutes:480,resolutionMinutes:2880},
  {name:'Normal',color:'#38bdf8',level:3,firstResponseMinutes:240,resolutionMinutes:1440},
  {name:'Yüksek',color:'#f59e0b',level:5,firstResponseMinutes:60,resolutionMinutes:480},
  {name:'Kritik',color:'#ef4444',level:8,firstResponseMinutes:15,resolutionMinutes:120},
] as const;

const DEFAULT_HELPDESK_STATUSES = [
  {code:'NEW',name:'Yeni',color:'#0ea5e9',closed:false,sortOrder:10},
  {code:'OPEN',name:'Açık',color:'#38bdf8',closed:false,sortOrder:20},
  {code:'IN_PROGRESS',name:'İşlemde',color:'#8b5cf6',closed:false,sortOrder:30},
  {code:'WAITING_REQUESTER',name:'Talep Sahibi Bekleniyor',color:'#f59e0b',closed:false,sortOrder:40},
  {code:'WAITING_STAFF',name:'Yetkili Yanıtı Bekleniyor',color:'#eab308',closed:false,sortOrder:50},
  {code:'RESOLVED',name:'Çözüldü',color:'#22c55e',closed:true,sortOrder:90},
  {code:'CLOSED',name:'Kapatıldı',color:'#64748b',closed:true,sortOrder:100},
] as const;

function defaultHelpDeskIdentity(branchName:string){
  return {
    title:`${branchName} Help Desk`,
    welcomeText:`${branchName} destek taleplerinizi buradan oluşturabilir ve takip edebilirsiniz.`,
    emailSubjectPrefix:branchName,
    knowledgeDescription:`${branchName} bilgi bankası`,
  };
}

export async function syncHelpDeskBranchIdentity(branchCode:string,previousName:string,nextName:string){
  if(previousName===nextName)return;
  const setting=await prisma.helpDeskBranchSetting.findUnique({where:{branchCode}});
  const previous=defaultHelpDeskIdentity(previousName);
  const next=defaultHelpDeskIdentity(nextName);
  if(setting){
    const data:Record<string,string>={};
    if(setting.title===previous.title)data.title=next.title;
    if(setting.welcomeText===previous.welcomeText)data.welcomeText=next.welcomeText;
    if(setting.emailSubjectPrefix===previous.emailSubjectPrefix)data.emailSubjectPrefix=next.emailSubjectPrefix;
    if(Object.keys(data).length)await prisma.helpDeskBranchSetting.update({where:{branchCode},data});
  }
  const knowledge=await prisma.helpDeskKnowledgeCategory.findUnique({
    where:{branchCode_name:{branchCode,name:'Genel Bilgi Bankası'}},
  });
  if(knowledge?.description===previous.knowledgeDescription){
    await prisma.helpDeskKnowledgeCategory.update({
      where:{id:knowledge.id},
      data:{description:next.knowledgeDescription},
    });
  }
}

export async function inspectHelpDeskBranchUserData(branchCode:string,branchName:string){
  const [
    setting,categories,priorities,statuses,knowledgeCategories,
    ticketCount,articleCount,cannedReplyCount,categoryAssigneeCount,accesses,
  ]=await Promise.all([
    prisma.helpDeskBranchSetting.findUnique({where:{branchCode}}),
    prisma.helpDeskCategory.findMany({where:{branchCode}}),
    prisma.helpDeskPriority.findMany({where:{branchCode}}),
    prisma.helpDeskStatus.findMany({where:{branchCode}}),
    prisma.helpDeskKnowledgeCategory.findMany({where:{branchCode}}),
    prisma.helpDeskTicket.count({where:{branchCode}}),
    prisma.helpDeskKnowledgeArticle.count({where:{branchCode}}),
    prisma.helpDeskCannedReply.count({where:{branchCode}}),
    prisma.helpDeskCategoryAssignee.count({where:{branchCode}}),
    prisma.helpDeskAccess.findMany({where:{branchCode},select:{userId:true,active:true,canOpen:true,canStaff:true,canCoordinate:true,canRespond:true,canChangeStatus:true,canReopen:true,canViewAll:true,canAssign:true,canClose:true,canReport:true,canTopics:true,canCannedReplies:true,canKnowledge:true}}),
  ]);

  const identity=defaultHelpDeskIdentity(branchName);
  const settingCustomized=Boolean(setting&&(
    setting.enabled!==true||
    setting.title!==identity.title||
    setting.welcomeText!==identity.welcomeText||
    setting.emailSubjectPrefix!==identity.emailSubjectPrefix||
    setting.allowAttachments!==true||
    setting.maxAttachmentMb!==10||
    setting.knowledgeEnabled!==true||
    setting.showRecentTickets!==true
  ));
  const categoriesCustomized=categories.length!==1||!categories.some(item=>
    item.name==='Genel'&&item.description==='Genel destek talepleri'&&item.active===true&&item.sortOrder===10
  );
  const prioritiesCustomized=priorities.length!==DEFAULT_HELPDESK_PRIORITIES.length||DEFAULT_HELPDESK_PRIORITIES.some(expected=>
    !priorities.some(item=>item.name===expected.name&&item.color===expected.color&&item.level===expected.level&&item.active===true&&item.firstResponseMinutes===expected.firstResponseMinutes&&item.resolutionMinutes===expected.resolutionMinutes)
  );
  const statusesCustomized=statuses.length!==DEFAULT_HELPDESK_STATUSES.length||DEFAULT_HELPDESK_STATUSES.some(expected=>
    !statuses.some(item=>item.code===expected.code&&item.name===expected.name&&item.color===expected.color&&item.closed===expected.closed&&item.sortOrder===expected.sortOrder&&item.active===true)
  );
  const knowledgeCustomized=knowledgeCategories.length!==1||!knowledgeCategories.some(item=>
    item.name==='Genel Bilgi Bankası'&&item.description===identity.knowledgeDescription&&item.active===true&&item.sortOrder===10
  );

  const accessUserIds=[...new Set(accesses.map(item=>item.userId))];
  const accessUsers=accessUserIds.length?await prisma.user.findMany({
    where:{id:{in:accessUserIds}},
    select:{id:true,isAdmin:true},
  }):[];
  const adminIds=new Set(accessUsers.filter(item=>item.isAdmin).map(item=>item.id));
  const membershipUserIds=new Set((await prisma.userBranch.findMany({
    where:{branchCode},
    select:{userId:true},
  })).map(item=>item.userId));
  const customAccessCount=accesses.filter(item=>!adminIds.has(item.userId)&&!membershipUserIds.has(item.userId)).length;

  return {
    hasUserData:Boolean(
      ticketCount||articleCount||cannedReplyCount||categoryAssigneeCount||customAccessCount||
      settingCustomized||categoriesCustomized||prioritiesCustomized||statusesCustomized||knowledgeCustomized
    ),
    details:{
      tickets:ticketCount,
      knowledgeArticles:articleCount,
      cannedReplies:cannedReplyCount,
      categoryAssignees:categoryAssigneeCount,
      customAccesses:customAccessCount,
      customizedFoundation:Boolean(settingCustomized||categoriesCustomized||prioritiesCustomized||statusesCustomized||knowledgeCustomized),
    },
  };
}

export async function removeHelpDeskBranchFoundation(branchCode:string){
  await prisma.$transaction([
    prisma.helpDeskCategoryAssignee.deleteMany({where:{branchCode}}),
    prisma.helpDeskKnowledgeArticle.deleteMany({where:{branchCode}}),
    prisma.helpDeskCannedReply.deleteMany({where:{branchCode}}),
    prisma.helpDeskAccess.deleteMany({where:{branchCode}}),
    prisma.helpDeskKnowledgeCategory.deleteMany({where:{branchCode}}),
    prisma.helpDeskCategory.deleteMany({where:{branchCode}}),
    prisma.helpDeskPriority.deleteMany({where:{branchCode}}),
    prisma.helpDeskStatus.deleteMany({where:{branchCode}}),
    prisma.helpDeskBranchSetting.deleteMany({where:{branchCode}}),
  ]);
}

export async function assertActiveHelpDeskBranch(branchCode:string){
  const branch=await prisma.branch.findUnique({where:{code:branchCode},select:{active:true}});
  if(!branch?.active){
    const error=new Error('Seçilen şube pasif veya bulunamadı. Pasif şubede yeni Help Desk işlemi başlatılamaz.') as Error&{status?:number};
    error.status=400;
    throw error;
  }
}

export async function ensureHelpDeskBranchFoundation(branchCode:string){
  const branch=await prisma.branch.findUnique({where:{code:branchCode}});
  if(!branch||!branch.active)throw new Error('Help Desk altyapısı yalnız aktif bir şube için hazırlanabilir.');

  await prisma.helpDeskGlobalSetting.upsert({
    where:{id:1},update:{},
    create:{id:1,maxAttachments:5,maxAttachmentMb:10,allowedExtensions:'pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,jpg,jpeg,png,gif,zip,rar,7z'},
  });
  await prisma.helpDeskBranchSetting.upsert({
    where:{branchCode:branch.code},update:{},
    create:{
      branchCode:branch.code,enabled:true,title:`${branch.name} Help Desk`,
      welcomeText:`${branch.name} destek taleplerinizi buradan oluşturabilir ve takip edebilirsiniz.`,
      emailSubjectPrefix:branch.name,
    },
  });

  for(const priority of DEFAULT_HELPDESK_PRIORITIES){
    await prisma.helpDeskPriority.upsert({
      where:{branchCode_name:{branchCode:branch.code,name:priority.name}},
      update:{},create:{branchCode:branch.code,...priority},
    });
  }

  for(const status of DEFAULT_HELPDESK_STATUSES){
    await prisma.helpDeskStatus.upsert({
      where:{branchCode_code:{branchCode:branch.code,code:status.code}},
      update:{},create:{branchCode:branch.code,...status},
    });
  }

  await prisma.helpDeskCategory.upsert({
    where:{branchCode_name:{branchCode:branch.code,name:'Genel'}},update:{},
    create:{branchCode:branch.code,name:'Genel',description:'Genel destek talepleri',sortOrder:10},
  });
  await prisma.helpDeskKnowledgeCategory.upsert({
    where:{branchCode_name:{branchCode:branch.code,name:'Genel Bilgi Bankası'}},update:{},
    create:{branchCode:branch.code,name:'Genel Bilgi Bankası',description:`${branch.name} bilgi bankası`,sortOrder:10},
  });

  const users=await prisma.user.findMany({where:{active:true},select:{id:true,isAdmin:true}});
  const memberships=await prisma.userBranch.findMany({
    where:{branchCode:branch.code,userId:{in:users.map(user=>user.id)}},
    select:{userId:true},
  });
  const memberIds=new Set(memberships.map(item=>item.userId));

  for(const user of users){
    if(user.isAdmin){
      await prisma.helpDeskAccess.upsert({
        where:{userId_branchCode:{userId:user.id,branchCode:branch.code}},
        update:{
          active:true,canOpen:true,canStaff:true,canCoordinate:true,canRespond:true,canChangeStatus:true,
          canReopen:true,canViewAll:true,canAssign:true,canClose:true,canReport:true,canTopics:true,
          canCannedReplies:true,canKnowledge:true,
        },
        create:{
          userId:user.id,branchCode:branch.code,active:true,canOpen:true,canStaff:true,canCoordinate:true,
          canRespond:true,canChangeStatus:true,canReopen:true,canViewAll:true,canAssign:true,canClose:true,
          canReport:true,canTopics:true,canCannedReplies:true,canKnowledge:true,assignedById:user.id,
        },
      });
    }else if(memberIds.has(user.id)){
      await prisma.helpDeskAccess.upsert({
        where:{userId_branchCode:{userId:user.id,branchCode:branch.code}},
        update:{},
        create:{userId:user.id,branchCode:branch.code,active:true,canOpen:true,assignedById:''},
      });
    }
  }
}

export async function ensureHelpDeskFoundation() {
  const legacyAccesses = await prisma.helpDeskAccess.findMany({
    where: { active: true, canStaff: true, canCoordinate: false, canRespond: false },
  });
  for (const access of legacyAccesses) {
    await prisma.helpDeskAccess.update({
      where: { id: access.id },
      data: access.canAssign
        ? { canCoordinate: true, canViewAll: true, canChangeStatus: true, canReopen: true, canClose: true }
        : { canRespond: true, canChangeStatus: false, canReopen: false, canClose: false },
    });
  }

  await prisma.helpDeskGlobalSetting.upsert({
    where: { id: 1 }, update: {},
    create: { id: 1, maxAttachments: 5, maxAttachmentMb: 10, allowedExtensions: 'pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,jpg,jpeg,png,gif,zip,rar,7z' },
  });

  const branches = await prisma.branch.findMany({ where: { active: true } });

  for (const branch of branches) {
    await prisma.helpDeskBranchSetting.upsert({
      where: { branchCode: branch.code },
      update: {},
      create: {
        branchCode: branch.code,
        enabled: true,
        title: `${branch.name} Help Desk`,
        welcomeText: `${branch.name} destek taleplerinizi buradan oluşturabilir ve takip edebilirsiniz.`,
        emailSubjectPrefix: branch.name,
      },
    });

    for (const priority of [
      { name: 'Düşük', color: '#64748b', level: 1, firstResponseMinutes: 480, resolutionMinutes: 2880 },
      { name: 'Normal', color: '#38bdf8', level: 3, firstResponseMinutes: 240, resolutionMinutes: 1440 },
      { name: 'Yüksek', color: '#f59e0b', level: 5, firstResponseMinutes: 60, resolutionMinutes: 480 },
      { name: 'Kritik', color: '#ef4444', level: 8, firstResponseMinutes: 15, resolutionMinutes: 120 },
    ]) {
      await prisma.helpDeskPriority.upsert({
        where: { branchCode_name: { branchCode: branch.code, name: priority.name } },
        update: {},
        create: { branchCode: branch.code, ...priority },
      });
    }

    for (const status of [
      { code: 'NEW', name: 'Yeni', color: '#0ea5e9', closed: false, sortOrder: 10 },
      { code: 'OPEN', name: 'Açık', color: '#38bdf8', closed: false, sortOrder: 20 },
      { code: 'IN_PROGRESS', name: 'İşlemde', color: '#8b5cf6', closed: false, sortOrder: 30 },
      { code: 'WAITING_REQUESTER', name: 'Talep Sahibi Bekleniyor', color: '#f59e0b', closed: false, sortOrder: 40 },
      { code: 'WAITING_STAFF', name: 'Yetkili Yanıtı Bekleniyor', color: '#eab308', closed: false, sortOrder: 50 },
      { code: 'RESOLVED', name: 'Çözüldü', color: '#22c55e', closed: true, sortOrder: 90 },
      { code: 'CLOSED', name: 'Kapatıldı', color: '#64748b', closed: true, sortOrder: 100 },
    ]) {
      await prisma.helpDeskStatus.upsert({
        where: { branchCode_code: { branchCode: branch.code, code: status.code } },
        update: {},
        create: { branchCode: branch.code, ...status },
      });
    }

    await prisma.helpDeskCategory.upsert({
      where: { branchCode_name: { branchCode: branch.code, name: 'Genel' } },
      update: {},
      create: { branchCode: branch.code, name: 'Genel', description: 'Genel destek talepleri', sortOrder: 10 },
    });

    await prisma.helpDeskKnowledgeCategory.upsert({
      where: { branchCode_name: { branchCode: branch.code, name: 'Genel Bilgi Bankası' } },
      update: {},
      create: { branchCode: branch.code, name: 'Genel Bilgi Bankası', description: `${branch.name} bilgi bankası`, sortOrder: 10 },
    });
  }

  const users = await prisma.user.findMany({ where: { active: true } });
  const memberships = await prisma.userBranch.findMany({
    where: { userId: { in: users.map(user => user.id) } },
  });

  for (const user of users) {
    if (user.isAdmin) {
      for (const branch of branches) {
        await prisma.helpDeskAccess.upsert({
          where: { userId_branchCode: { userId: user.id, branchCode: branch.code } },
          update: {
            active: true,
            canOpen: true,
            canStaff: true,
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
          },
          create: {
            userId: user.id,
            branchCode: branch.code,
            active: true,
            canOpen: true,
            canStaff: true,
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
            assignedById: user.id,
          },
        });
      }
      continue;
    }

    for (const membership of memberships.filter(item => item.userId === user.id)) {
      await prisma.helpDeskAccess.upsert({
        where: { userId_branchCode: { userId: user.id, branchCode: membership.branchCode } },
        update: {},
        create: {
          userId: user.id,
          branchCode: membership.branchCode,
          active: true,
          canOpen: true,
          assignedById: '',
        },
      });
    }
  }
}

helpDeskRouter.use(requireAuth);

helpDeskRouter.get('/context', async (req: AuthRequest, res) => {
  const central = await isCentralManager(req);
  const [settings, branches, accesses, users] = await Promise.all([
    prisma.helpDeskBranchSetting.findMany({ where: central ? {} : { enabled: true }, orderBy: { branchCode: 'asc' } }),
    prisma.branch.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
    prisma.helpDeskAccess.findMany({ where: { userId: req.authUser!.id, active: true } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, username: true, displayName: true, email: true }, orderBy: { displayName: 'asc' } }),
  ]);
  const branchMap = new Map(branches.map(item => [item.code, item]));
  const accessMap = new Map(accesses.map(item => [item.branchCode, item]));

  res.json({
    branches: settings
      .filter(item => branchMap.has(item.branchCode))
      .map(item => ({
        branchCode: item.branchCode,
        branchName: branchMap.get(item.branchCode)!.name,
        title: item.title || `${branchMap.get(item.branchCode)!.name} Help Desk`,
        welcomeText: item.welcomeText,
        knowledgeEnabled: item.knowledgeEnabled,
        showRecentTickets: item.showRecentTickets,
        access: req.authUser!.isAdmin ? {
          active: true,
          canOpen: true,
          canStaff: true,
          canViewAll: true,
          canAssign: true,
          canClose: true,
          canReport: true,
          canTopics: true,
          canCannedReplies: true,
          canKnowledge: true,
          mutedEmail: false,
        } : accessMap.get(item.branchCode) ?? null,
      })),
    users,
    canCentralManage: central,
  });
});

helpDeskRouter.get('/my-summary', async (req: AuthRequest, res) => {
  const requesterId=req.authUser!.id;
  const tickets=await prisma.helpDeskTicket.findMany({where:{requesterId},select:{id:true,statusId:true}});
  const ids=[...new Set(tickets.map(i=>i.statusId))];
  const statuses=ids.length?await prisma.helpDeskStatus.findMany({where:{id:{in:ids}},select:{id:true,closed:true}}):[];
  const closedIds=new Set(statuses.filter(i=>i.closed).map(i=>i.id));
  const ticketIds=tickets.map(i=>i.id);
  const answered=ticketIds.length?await prisma.helpDeskReply.findMany({where:{ticketId:{in:ticketIds},isStaff:true,internalNote:false},select:{ticketId:true},distinct:['ticketId']}):[];
  res.json({opened:tickets.length,answered:answered.length,closed:tickets.filter(i=>closedIds.has(i.statusId)).length});
});

helpDeskRouter.get('/recent', async (req: AuthRequest, res) => {
  const branchCode = String(req.query.branchCode ?? '').trim();
  const rows = await prisma.helpDeskTicket.findMany({
    where: {
      requesterId: req.authUser!.id,
      ...(branchCode ? { branchCode } : {}),
    },
    orderBy: { lastActivityAt: 'desc' },
    take: 10,
  });
  res.json(await enrichTickets(rows));
});

helpDeskRouter.get('/my-tickets', async (req: AuthRequest, res) => {
  const filter=String(req.query.filter??'opened');
  const mine=await prisma.helpDeskTicket.findMany({where:{requesterId:req.authUser!.id},orderBy:{lastActivityAt:'desc'},take:1000});
  let rows=mine;
  if(filter==='closed'){
    const ids=[...new Set(mine.map(i=>i.statusId))];
    const statuses=ids.length?await prisma.helpDeskStatus.findMany({where:{id:{in:ids},closed:true},select:{id:true}}):[];
    const closedIds=new Set(statuses.map(i=>i.id));rows=mine.filter(i=>closedIds.has(i.statusId));
  } else if(filter==='answered'){
    const ticketIds=mine.map(i=>i.id);
    const replies=ticketIds.length?await prisma.helpDeskReply.findMany({where:{ticketId:{in:ticketIds},isStaff:true,internalNote:false},select:{ticketId:true},distinct:['ticketId']}):[];
    const answeredIds=new Set(replies.map(i=>i.ticketId));rows=mine.filter(i=>answeredIds.has(i.id));
  }
  res.json(await enrichTickets(rows));
});

helpDeskRouter.get('/user-tickets', async (req: AuthRequest, res) => {
  const userId=String(req.query.userId??'').trim();
  const branchCode=String(req.query.branchCode??'ALL').trim()||'ALL';
  const state=String(req.query.state??'all').trim();

  if(!userId){res.status(400).json({error:'Kullanıcı seçilmelidir.'});return;}
  if(!['all','open','closed'].includes(state)){res.status(400).json({error:'Geçersiz ticket durum filtresi.'});return;}

  const target=await prisma.user.findUnique({where:{id:userId},select:{id:true,active:true}});
  if(!target){res.status(404).json({error:'Kullanıcı bulunamadı.'});return;}

  const isSelf=userId===req.authUser!.id;
  const central=await isCentralManager(req);
  const where:any={requesterId:userId};

  if(branchCode!=='ALL'){
    where.branchCode=branchCode;
    if(!isSelf && !req.authUser!.isAdmin && !central){
      const access=await accessFor(req.authUser!.id,branchCode);
      const canSeeBranch=Boolean(access?.active&&access.canCoordinate&&access.canViewAll);
      const canSeeAssigned=Boolean(access?.active&&access.canRespond);
      if(canSeeBranch){
        // Koordinatör, yetkili olduğu şubede seçilen kullanıcının kayıtlarını görebilir.
      }else if(canSeeAssigned){
        // Responder kullanıcı seçimi yetkisini genişletmez; yalnız kendisine atanmış kayıtları görür.
        where.assignedUserId=req.authUser!.id;
      }else{
        res.status(403).json({error:'Bu şubede seçilen kullanıcının taleplerini görüntüleme yetkiniz yok.'});
        return;
      }
    }
  }else if(!isSelf && !req.authUser!.isAdmin && !central){
    const accesses=await prisma.helpDeskAccess.findMany({
      where:{
        userId:req.authUser!.id,
        active:true,
        OR:[
          {canCoordinate:true,canViewAll:true},
          {canRespond:true},
        ],
      },
      select:{branchCode:true,canCoordinate:true,canViewAll:true,canRespond:true},
    });
    const coordinatorCodes=accesses.filter(item=>item.canCoordinate&&item.canViewAll).map(item=>item.branchCode);
    const responderCodes=accesses.filter(item=>item.canRespond&&!(item.canCoordinate&&item.canViewAll)).map(item=>item.branchCode);
    const visibility:any[]=[];
    if(coordinatorCodes.length)visibility.push({branchCode:{in:coordinatorCodes}});
    if(responderCodes.length)visibility.push({branchCode:{in:responderCodes},assignedUserId:req.authUser!.id});
    if(!visibility.length){
      res.status(403).json({error:'Seçilen kullanıcının taleplerini görüntüleme yetkiniz yok.'});
      return;
    }
    where.OR=visibility;
  }

  if(state!=='all'){
    const statuses=await prisma.helpDeskStatus.findMany({
      where:{closed:state==='closed'},
      select:{id:true},
    });
    where.statusId={in:statuses.map(item=>item.id)};
  }

  const rows=await prisma.helpDeskTicket.findMany({
    where,
    orderBy:{lastActivityAt:'desc'},
    take:1000,
  });
  res.json(await enrichTickets(rows));
});

helpDeskRouter.get('/tickets', async (req: AuthRequest, res) => {
  const branchCode = String(req.query.branchCode ?? '').trim();
  const scope = String(req.query.scope ?? 'mine');
  const state = String(req.query.state ?? 'open').trim();
  const queueFilter = String(req.query.queueFilter ?? 'all').trim();
  if (!['open','closed','all'].includes(state)) {
    res.status(400).json({ error: 'Geçersiz ticket durum filtresi.' });
    return;
  }
  if (!['all','new','inProgress','unassigned'].includes(queueFilter)) {
    res.status(400).json({ error: 'Geçersiz ticket kuyruk filtresi.' });
    return;
  }
  const where: any = {};

  if (scope === 'mine') {
    where.requesterId = req.authUser!.id;
    if (branchCode) where.branchCode = branchCode;
  } else if (scope === 'assigned') {
    where.assignedUserId = req.authUser!.id;
    if (branchCode) {
      await assertResponder(req, branchCode);
      where.branchCode = branchCode;
    } else if (!req.authUser!.isAdmin) {
      const codes=(await prisma.helpDeskAccess.findMany({
        where:{userId:req.authUser!.id,active:true,canRespond:true},select:{branchCode:true},
      })).map(item=>item.branchCode);
      where.branchCode={in:codes};
    }
  } else {
    if (branchCode) {
      if (!(await canViewBranchPool(req, branchCode))) {
        res.status(403).json({ error: 'Bu şubenin tüm ticket havuzunu görüntüleme yetkiniz yok.' });
        return;
      }
      where.branchCode = branchCode;
    } else {
      const central = await isCentralManager(req);
      const codes=(req.authUser!.isAdmin||central)
        ? (await prisma.helpDeskBranchSetting.findMany({where:{enabled:true},select:{branchCode:true}})).map(item=>item.branchCode)
        : (await prisma.helpDeskAccess.findMany({
            where:{userId:req.authUser!.id,active:true,canViewAll:true,OR:[{canCoordinate:true},{canReport:true}]},
            select:{branchCode:true},
          })).map(item=>item.branchCode);
      where.branchCode={in:codes};
    }
  }

  if (state !== 'all') {
    const statuses = await prisma.helpDeskStatus.findMany({
      where: { closed: state === 'closed' },
      select: { id: true },
    });
    where.statusId = { in: statuses.map(item => item.id) };
  }

  if (queueFilter === 'new' || queueFilter === 'inProgress') {
    const codes = queueFilter === 'new'
      ? ['NEW']
      : ['OPEN','IN_PROGRESS','WAITING_REQUESTER','WAITING_STAFF'];
    const statuses = await prisma.helpDeskStatus.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    const queueIds=statuses.map(item=>item.id);
    if (where.statusId?.in) {
      const allowed=new Set(where.statusId.in);
      where.statusId={in:queueIds.filter(id=>allowed.has(id))};
    } else {
      where.statusId={in:queueIds};
    }
  } else if (queueFilter === 'unassigned') {
    where.assignedUserId = null;
  }

  const rows = await prisma.helpDeskTicket.findMany({
    where,
    orderBy: { lastActivityAt: 'desc' },
    take: 1000,
  });
  res.json(await enrichTickets(rows));
});

helpDeskRouter.post('/tickets', async (req: AuthRequest, res) => {
  const input=ticketSchema.parse(req.body);
  await assertActiveHelpDeskBranch(input.branchCode);
  const branchSetting=await getSetting(input.branchCode);
  if(!branchSetting?.enabled){res.status(400).json({error:'Seçilen şubenin Help Desk sistemi aktif değil.'});return;}
  await assertOpen(req,input.branchCode);
  const [category,priority,status]=await Promise.all([
    prisma.helpDeskCategory.findFirst({where:{id:input.categoryId,branchCode:input.branchCode,active:true}}),
    prisma.helpDeskPriority.findFirst({where:{id:input.priorityId,branchCode:input.branchCode,active:true}}),
    prisma.helpDeskStatus.findFirst({where:{branchCode:input.branchCode,code:'NEW',active:true}}),
  ]);
  if(!category||!priority||!status){res.status(400).json({error:'Destek konusu, öncelik veya başlangıç durumu geçersiz.'});return;}
  const now=new Date(), ticketNo=await makeUniqueTicketNo();
  const requesterIp=normalizeIp(req.headers['x-forwarded-for'] as string|undefined)||normalizeIp(req.socket.remoteAddress);
  const requesterMac=await observedMacForIp(requesterIp);
  const ticket=await prisma.helpDeskTicket.create({data:{
    branchCode:input.branchCode,ticketNo,trackingId:makeTrackingId(),subject:input.subject,body:input.body,requesterId:req.authUser!.id,
    requesterName:req.authUser!.displayName||req.authUser!.username,requesterEmail:req.authUser!.email??'',ccEmails:parseEmailList(input.ccEmails).join(';'),
    requesterIp,requesterMac,categoryId:category.id,priorityId:priority.id,statusId:status.id,
    dueResponseAt:priority.firstResponseMinutes?new Date(now.getTime()+priority.firstResponseMinutes*60000):null,
    dueResolutionAt:priority.resolutionMinutes?new Date(now.getTime()+priority.resolutionMinutes*60000):null,lastActivityAt:now,
  }});
  await addActivity(ticket.id,ticket.branchCode,req,'CREATE',
    `Ticket oluşturuldu. Kod: ${ticket.ticketNo} | Destek konusu: ${category.name} | IP: ${requesterIp||'-'} | MAC: ${requesterMac||'-'}`);
  await sendTicketEventMail(ticket.id,await categoryStaffEmails(ticket.branchCode,category.id),'Yeni destek talebi oluşturuldu.',ticketMailActor(req));
  await sendTicketEventMail(ticket.id,[ticket.requesterEmail,...parseEmailList(ticket.ccEmails)].filter(Boolean),`Merhaba ${ticket.requesterName}, talebiniz alındı.`,ticketMailActor(req));
  res.status(201).json(await detailedTicket(ticket.id));
});

helpDeskRouter.get('/tickets/:id', async (req: AuthRequest, res) => {
  const ticket = await prisma.helpDeskTicket.findUnique({ where: { id: String(req.params.id) } });
  if (!ticket) {
    res.status(404).json({ error: 'Talep bulunamadı.' });
    return;
  }

  if (ticket.requesterId !== req.authUser!.id && !req.authUser!.isAdmin) {
    const central=await isCentralManager(req);
    const access=await accessFor(req.authUser!.id,ticket.branchCode);
    const canSeeAsCoordinator=Boolean(access?.active&&access.canCoordinate&&access.canViewAll);
    const canSeeAsAssignedResponder=Boolean(access?.active&&access.canRespond&&ticket.assignedUserId===req.authUser!.id);
    if(!central&&!canSeeAsCoordinator&&!canSeeAsAssignedResponder){res.status(403).json({error:'Bu ticketı görüntüleme yetkiniz yok.'});return;}
  }

  res.json(await detailedTicket(ticket.id));
});

helpDeskRouter.post('/tickets/:id/replies', async (req: AuthRequest, res) => {
  const input = replySchema.parse(req.body);
  const ticket = await prisma.helpDeskTicket.findUnique({ where: { id: String(req.params.id) } });
  if (!ticket) {
    res.status(404).json({ error: 'Talep bulunamadı.' });
    return;
  }

  assertUnlocked(ticket);
  const access=await accessFor(req.authUser!.id,ticket.branchCode);
  const isRequester=ticket.requesterId===req.authUser!.id;
  const isAssignedResponder=req.authUser!.isAdmin||Boolean(access?.active&&access.canRespond&&ticket.assignedUserId===req.authUser!.id);
  const isCoordinator=req.authUser!.isAdmin||Boolean(access?.active&&access.canCoordinate&&access.canViewAll);
  const canWriteStaffReply=Boolean(isCoordinator||isAssignedResponder);
  if(!isRequester&&!canWriteStaffReply){
    res.status(403).json({error:ticket.assignedUserId?'Bu ticket size atanmadığı için görevli cevabı yazamazsınız.':'Bu ticket henüz bir cevaplayan kullanıcıya atanmadı. Yalnız şube koordinatörü cevap yazabilir veya ticketı cevaplayana atayabilir.'});return;
  }
  if(input.internalNote&&!canWriteStaffReply){res.status(403).json({error:'İç not yalnız şube koordinatörü veya kendisine atanmış cevaplayan kullanıcı tarafından eklenebilir.'});return;}
  const isStaff=canWriteStaffReply&&!isRequester;

  const reply = await prisma.helpDeskReply.create({
    data: {
      ticketId: ticket.id,
      branchCode: ticket.branchCode,
      authorId: req.authUser!.id,
      authorName: req.authUser!.displayName || req.authUser!.username,
      body: input.body,
      isStaff,
      internalNote: input.internalNote,
    },
  });

  let nextStatusId = ticket.statusId;
  const currentStatus = await prisma.helpDeskStatus.findUnique({ where: { id: ticket.statusId } });
  if (!input.internalNote && !currentStatus?.closed) {
    const nextStatus = await prisma.helpDeskStatus.findFirst({
      where: {
        branchCode: ticket.branchCode,
        code: isStaff ? 'WAITING_REQUESTER' : 'WAITING_STAFF',
        active: true,
      },
    });
    if (nextStatus) nextStatusId = nextStatus.id;
  }

  const now = new Date();
  await prisma.helpDeskTicket.update({
    where: { id: ticket.id },
    data: {
      statusId: nextStatusId,
      lastActivityAt: now,
      firstReplyAt: isStaff && !ticket.firstReplyAt ? now : ticket.firstReplyAt,
    },
  });
  await addActivity(
    ticket.id,
    ticket.branchCode,
    req,
    input.internalNote ? 'INTERNAL_NOTE' : 'REPLY',
    input.internalNote ? 'İç not eklendi.' : `${isStaff ? 'Yetkili' : 'Talep sahibi'} yanıtı eklendi.`,
  );

  if (!input.internalNote) {
    if (isStaff) {
      await sendTicketEventMail(ticket.id,[ticket.requesterEmail,...parseEmailList(ticket.ccEmails)].filter(Boolean),`${reply.authorName} ticketınıza yanıt verdi.`,ticketMailActor(req));
    } else {
      await sendTicketEventMail(ticket.id,await categoryStaffEmails(ticket.branchCode,ticket.categoryId),`${ticket.requesterName} ticketına yeni yanıt ekledi.`,ticketMailActor(req));
    }
  }

  res.status(201).json({ ...reply, createdAt: reply.createdAt.getTime() });
});

helpDeskRouter.put('/tickets/:id/assign', async (req: AuthRequest, res) => {
  const input=z.object({userId:z.string().uuid().nullable()}).parse(req.body);
  const ticket=await prisma.helpDeskTicket.findUnique({where:{id:String(req.params.id)}});
  if(!ticket){res.status(404).json({error:'Ticket bulunamadı.'});return;}
  assertUnlocked(ticket);
  const currentStatus=await prisma.helpDeskStatus.findUnique({where:{id:ticket.statusId},select:{closed:true}});
  const ownAccess=req.authUser!.isAdmin?null:await accessFor(req.authUser!.id,ticket.branchCode);
  const isCoordinator=req.authUser!.isAdmin||Boolean(ownAccess?.active&&ownAccess.canCoordinate&&ownAccess.canAssign);
  const isResponderSelfClaim=Boolean(!req.authUser!.isAdmin&&ownAccess?.active&&ownAccess.canRespond&&!ticket.assignedUserId&&input.userId===req.authUser!.id);

  if(isResponderSelfClaim){
    if(currentStatus?.closed){res.status(400).json({error:'Kapalı ticket cevaplayan kullanıcı tarafından üzerine alınamaz.'});return;}
    const self=await prisma.user.findUnique({where:{id:req.authUser!.id},select:{id:true,displayName:true,email:true,active:true}});
    if(!self?.active){res.status(400).json({error:'Aktif kullanıcı bulunamadı.'});return;}
    await prisma.helpDeskTicket.update({where:{id:ticket.id},data:{assignedUserId:self.id,assignedUserName:self.displayName,lastActivityAt:new Date()}});
    await addActivity(ticket.id,ticket.branchCode,req,'ASSIGN',`${self.displayName} boşta olan ticketı kendi üzerine aldı.`);
    if(self.email)await sendTicketEventMail(ticket.id,[self.email],'Boşta olan ticketı kendi üzerinize aldınız.',ticketMailActor(req));
    res.json(await detailedTicket(ticket.id));return;
  }

  if(!isCoordinator){
    res.status(403).json({error:ticket.assignedUserId?'Cevaplayan kullanıcı mevcut ticket atamasını değiştiremez.':'Cevaplayan kullanıcı yalnız boşta olan ticketı kendi üzerine alabilir.'});return;
  }

  let assignedUser:{id:string;displayName:string;email:string|null}|null=null;
  if(input.userId){
    const responderAccess=await prisma.helpDeskAccess.findUnique({where:{userId_branchCode:{userId:input.userId,branchCode:ticket.branchCode}}});
    const user=await prisma.user.findUnique({where:{id:input.userId},select:{id:true,displayName:true,email:true,active:true}});
    if(!responderAccess?.active||!responderAccess.canRespond||!user?.active){res.status(400).json({error:'Seçilen kullanıcı bu şubede cevaplayan kullanıcı olarak yetkili değil.'});return;}
    assignedUser=user;
  }
  const previous=ticket.assignedUserName||'Atanmamış';
  await prisma.helpDeskTicket.update({where:{id:ticket.id},data:{assignedUserId:assignedUser?.id??null,assignedUserName:assignedUser?.displayName??'',lastActivityAt:new Date()}});
  await addActivity(ticket.id,ticket.branchCode,req,'ASSIGN',assignedUser?`Atama değiştirildi: ${previous} → ${assignedUser.displayName}.`:`Ticket boşa çıkarıldı. Önceki cevaplayan: ${previous}.`);
  if(assignedUser?.email)await sendTicketEventMail(ticket.id,[assignedUser.email],'Bu ticket size cevaplamak üzere atandı.',ticketMailActor(req));
  res.json(await detailedTicket(ticket.id));
});


async function ticketNotificationRecipients(ticket: {
  branchCode: string; requesterEmail: string; ccEmails: string; assignedUserId: string | null;
}) {
  const recipientSet=new Set<string>();
  for(const email of [ticket.requesterEmail,...parseEmailList(ticket.ccEmails)]){
    const normalized=String(email||'').trim().toLowerCase();if(normalized)recipientSet.add(normalized);
  }
  const branchAccesses=await prisma.helpDeskAccess.findMany({
    where:{branchCode:ticket.branchCode,active:true,mutedEmail:false,OR:[{canCoordinate:true,canViewAll:true},{canReport:true,canViewAll:true}]},
    select:{userId:true},
  });
  const userIds=new Set(branchAccesses.map(row=>row.userId));
  if(ticket.assignedUserId)userIds.add(ticket.assignedUserId);
  if(userIds.size){
    const users=await prisma.user.findMany({where:{id:{in:[...userIds]},active:true},select:{email:true}});
    for(const user of users){const normalized=String(user.email||'').trim().toLowerCase();if(normalized)recipientSet.add(normalized);}
  }
  return [...recipientSet];
}

helpDeskRouter.post('/tickets/:id/resend-notification', async (req: AuthRequest, res) => {
  const ticket=await prisma.helpDeskTicket.findUnique({where:{id:String(req.params.id)}});
  if(!ticket){res.status(404).json({error:'Ticket bulunamadı.'});return;}
  const access=req.authUser!.isAdmin?null:await accessFor(req.authUser!.id,ticket.branchCode);
  const isCoordinator=req.authUser!.isAdmin||Boolean(access?.active&&access.canCoordinate&&access.canViewAll);
  const isAssignedResponder=req.authUser!.isAdmin||Boolean(access?.active&&access.canRespond&&ticket.assignedUserId===req.authUser!.id);
  const branchWide=req.authUser!.isAdmin||Boolean(access?.active&&access.canViewAll&&(access.canCoordinate||access.canReport));
  if(!isCoordinator&&!isAssignedResponder&&!branchWide){res.status(403).json({error:'Bu ticketın bildirim mailini tekrar gönderme yetkiniz yok.'});return;}
  const recipients=await ticketNotificationRecipients(ticket);
  if(!recipients.length){res.status(400).json({error:'Bildirim gönderilecek aktif e-posta adresi bulunamadı.'});return;}
  await sendTicketEventMail(ticket.id,recipients,`${req.authUser!.displayName||req.authUser!.username} tarafından ticket bildirim maili tekrar gönderildi.`,ticketMailActor(req));
  await addActivity(ticket.id,ticket.branchCode,req,'MAIL_RESEND',`Ticket bildirim maili ${recipients.length} alıcıya yeniden gönderildi. Tam dış yazışma geçmişi ve ticket ekleri bildirime dahil edildi.`);
  res.json({ok:true,recipientCount:recipients.length,message:`Bildirim maili ${recipients.length} alıcıya yeniden gönderildi.`});
});

helpDeskRouter.put('/tickets/:id/status', async (req: AuthRequest, res) => {
  const input=z.object({statusId:z.string().uuid()}).parse(req.body);
  const ticket=await prisma.helpDeskTicket.findUnique({where:{id:String(req.params.id)}});
  if(!ticket){res.status(404).json({error:'Ticket bulunamadı.'});return;}
  assertUnlocked(ticket);
  const access=req.authUser!.isAdmin?null:await accessFor(req.authUser!.id,ticket.branchCode);
  const coordinatorAllowed=req.authUser!.isAdmin||Boolean(access?.active&&access.canCoordinate&&access.canChangeStatus);
  const responderAllowed=req.authUser!.isAdmin||Boolean(access?.active&&access.canRespond&&access.canChangeStatus&&ticket.assignedUserId===req.authUser!.id);
  if(!coordinatorAllowed&&!responderAllowed){res.status(403).json({error:'Bu ticketın durumunu değiştirme yetkiniz yok.'});return;}
  const currentStatus=await prisma.helpDeskStatus.findUnique({where:{id:ticket.statusId}});
  const nextStatus=await prisma.helpDeskStatus.findFirst({where:{id:input.statusId,branchCode:ticket.branchCode,active:true}});
  if(!nextStatus){res.status(400).json({error:'Geçersiz durum.'});return;}
  const reopening=Boolean(currentStatus?.closed&&!nextStatus.closed);
  if(reopening&&!req.authUser!.isAdmin&&!access?.canReopen){res.status(403).json({error:'Kapanmış ticketı yeniden açma yetkiniz yok.'});return;}
  if(nextStatus.closed&&!req.authUser!.isAdmin&&!access?.canClose){res.status(403).json({error:'Ticketı çözme/kapatma yetkiniz yok.'});return;}
  const now=new Date();
  await prisma.helpDeskTicket.update({where:{id:ticket.id},data:{
    statusId:nextStatus.id,lastActivityAt:now,resolvedAt:nextStatus.code==='RESOLVED'?now:(reopening?null:ticket.resolvedAt),
    closedAt:nextStatus.code==='CLOSED'?now:nextStatus.closed?ticket.closedAt:null,
  }});
  await addActivity(ticket.id,ticket.branchCode,req,'STATUS',`Durum “${currentStatus?.name??'-'}” → “${nextStatus.name}” olarak değiştirildi.`);
  await sendTicketEventMail(ticket.id,[ticket.requesterEmail,...parseEmailList(ticket.ccEmails)].filter(Boolean),`Ticket durumu “${nextStatus.name}” olarak güncellendi.`,ticketMailActor(req));
  res.json(await detailedTicket(ticket.id));
});

helpDeskRouter.put('/tickets/:id/lock', async (req: AuthRequest, res) => {
  const input = z.object({ locked: z.boolean() }).parse(req.body);
  const ticket = await prisma.helpDeskTicket.findUnique({ where: { id: String(req.params.id) } });
  if (!ticket) {
    res.status(404).json({ error: 'Talep bulunamadı.' });
    return;
  }

  await assertCoordinator(req, ticket.branchCode);

  await prisma.helpDeskTicket.update({
    where: { id: ticket.id },
    data: input.locked ? {
      locked: true,
      lockedAt: new Date(),
      lockedById: req.authUser!.id,
      lockedByName: req.authUser!.displayName || req.authUser!.username,
      lastActivityAt: new Date(),
    } : {
      locked: false,
      lockedAt: null,
      lockedById: '',
      lockedByName: '',
      lastActivityAt: new Date(),
    },
  });
  await addActivity(ticket.id, ticket.branchCode, req, input.locked ? 'LOCK' : 'UNLOCK', input.locked ? 'Ticket kilitlendi.' : 'Ticket kilidi açıldı.');

  if (ticket.requesterEmail) {
    await sendTicketEventMail(
      ticket.id,
      [ticket.requesterEmail, ...parseEmailList(ticket.ccEmails)].filter(Boolean),
      input.locked
        ? 'Ticket kilitlendi. Kilit açılmadan cevap ve değişiklik yapılamaz.'
        : 'Ticket kilidi açıldı.',
      ticketMailActor(req),
    );
  }

  res.json(await detailedTicket(ticket.id));
});

helpDeskRouter.post('/tickets/:id/attachments', upload.array('files', 5), async (req: AuthRequest, res) => {
  const ticket=await prisma.helpDeskTicket.findUnique({where:{id:String(req.params.id)}});
  if(!ticket){res.status(404).json({error:'Talep bulunamadı.'});return;}
  assertUnlocked(ticket);
  const access=await accessFor(req.authUser!.id,ticket.branchCode);
  const isRequester=ticket.requesterId===req.authUser!.id;
  const isCoordinator=Boolean(access?.active&&access.canCoordinate);
  const isAssignedResponder=Boolean(access?.active&&access.canRespond&&ticket.assignedUserId===req.authUser!.id);
  if(!isRequester&&!req.authUser!.isAdmin&&!isCoordinator&&!isAssignedResponder){res.status(403).json({error:'Dosya ekleme yetkiniz yok.'});return;}
  const [branchSetting,globalSetting,currentCount]=await Promise.all([
    getSetting(ticket.branchCode),getGlobalHelpDeskSetting(),prisma.helpDeskAttachment.count({where:{ticketId:ticket.id}}),
  ]);
  if(!branchSetting?.allowAttachments){res.status(400).json({error:'Bu şubede dosya eki kapalı.'});return;}
  const files=(req.files as Express.Multer.File[]|undefined)??[];
  const maxFiles=Math.max(1,Math.min(5,globalSetting.maxAttachments||5));
  if(currentCount+files.length>maxFiles){for(const file of files)fs.rmSync(file.path,{force:true});res.status(400).json({error:`Bir ticket için en fazla ${maxFiles} dosya eklenebilir.`});return;}
  const allowed=new Set(globalSetting.allowedExtensions.split(',').map(i=>i.trim().replace(/^\./,'').toLocaleLowerCase('tr-TR')).filter(Boolean));
  const maxMb=Math.min(branchSetting.maxAttachmentMb||10,globalSetting.maxAttachmentMb||10), maxBytes=maxMb*1024*1024;
  const rows=[];
  for(const file of files){
    const ext=path.extname(file.originalname).replace('.','').toLocaleLowerCase('tr-TR');
    if(!allowed.has(ext)||file.size>maxBytes){fs.rmSync(file.path,{force:true});continue;}
    const row=await prisma.helpDeskAttachment.create({data:{ticketId:ticket.id,originalName:file.originalname.slice(0,240),storedName:path.basename(file.path),mimeType:file.mimetype,sizeBytes:file.size}});
    rows.push({...row,createdAt:row.createdAt.getTime()});
  }
  await addActivity(ticket.id,ticket.branchCode,req,'ATTACHMENT',`${rows.length} dosya eklendi. Merkezi politika: en fazla ${maxFiles} dosya, ${maxMb} MB, izinli uzantılar: ${[...allowed].join(', ')}`);
  if(rows.length){
    const recipients=isRequester?await categoryStaffEmails(ticket.branchCode,ticket.categoryId):[ticket.requesterEmail,...parseEmailList(ticket.ccEmails)].filter(Boolean);
    await sendTicketEventMail(ticket.id,recipients,`${rows.length} yeni ek dosya yüklendi.`,ticketMailActor(req));
  }
  res.status(201).json(rows);
});

helpDeskRouter.delete('/attachments/:id', async (req: AuthRequest, res) => {
  const attachment = await prisma.helpDeskAttachment.findUnique({ where: { id: String(req.params.id) } });
  if (!attachment) {
    res.status(404).json({ error: 'Ek bulunamadı.' });
    return;
  }
  const ticket = await prisma.helpDeskTicket.findUnique({ where: { id: attachment.ticketId } });
  if (!ticket) {
    res.status(404).json({ error: 'Talep bulunamadı.' });
    return;
  }
  assertUnlocked(ticket);
  const access = await accessFor(req.authUser!.id, ticket.branchCode);
  const isRequester = ticket.requesterId === req.authUser!.id;
  const isCoordinator = Boolean(access?.active && access.canCoordinate);
  const isAssignedResponder = Boolean(access?.active && access.canRespond && ticket.assignedUserId === req.authUser!.id);
  if (!isRequester && !req.authUser!.isAdmin && !isCoordinator && !isAssignedResponder) {
    res.status(403).json({ error: 'Dosya silme yetkiniz yok.' });
    return;
  }
  await prisma.helpDeskAttachment.delete({ where: { id: attachment.id } });
  const fullPath = path.join(attachmentDir, attachment.storedName);
  try {
    if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { force: true });
  } catch (error) {
    console.error('[HELPDESK ATTACHMENT DELETE] Dosya temizlenemedi:', fullPath, error);
  }
  await addActivity(ticket.id, ticket.branchCode, req, 'ATTACHMENT_DELETE', `Ek dosya silindi: ${attachment.originalName}`);
  const recipients = isRequester
    ? await categoryStaffEmails(ticket.branchCode, ticket.categoryId)
    : [ticket.requesterEmail, ...parseEmailList(ticket.ccEmails)].filter(Boolean);
  if (recipients.length) {
    await sendTicketEventMail(ticket.id, recipients, `Ek dosya silindi: ${attachment.originalName}`, ticketMailActor(req));
  }
  res.status(204).end();
});

helpDeskRouter.get('/attachments/:id', async (req: AuthRequest, res) => {
  const attachment = await prisma.helpDeskAttachment.findUnique({ where: { id: String(req.params.id) } });
  if (!attachment) {
    res.status(404).json({ error: 'Ek bulunamadı.' });
    return;
  }
  const ticket = await prisma.helpDeskTicket.findUnique({ where: { id: attachment.ticketId } });
  if (!ticket) {
    res.status(404).json({ error: 'Talep bulunamadı.' });
    return;
  }
  const access=await accessFor(req.authUser!.id,ticket.branchCode);
  const canDownloadAsCoordinator=Boolean(access?.active&&access.canCoordinate&&access.canViewAll);
  const canDownloadAsResponder=Boolean(access?.active&&access.canRespond&&ticket.assignedUserId===req.authUser!.id);
  if(ticket.requesterId!==req.authUser!.id&&!req.authUser!.isAdmin&&!canDownloadAsCoordinator&&!canDownloadAsResponder){
    res.status(403).json({error:'Bu eki indirme yetkiniz yok.'});return;
  }
  const fullPath = path.join(attachmentDir, attachment.storedName);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Ek dosyası bulunamadı.' });
    return;
  }
  res.download(fullPath, attachment.originalName);
});

helpDeskRouter.get('/branch/:branchCode/setup', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  const branchSetting = await getSetting(branchCode);
  if (!branchSetting) {
    res.status(404).json({ error: 'Help Desk şubesi bulunamadı.' });
    return;
  }

  const access = await accessFor(req.authUser!.id, branchCode);
  const centralManager = await isCentralManager(req);
  const isStaff = req.authUser!.isAdmin || centralManager || Boolean(access?.active && (access.canCoordinate || access.canRespond));

  const [categories, priorities, statuses, knowledgeCategories, articles, cannedReplies, staffAccesses, categoryAssignees, globalSetting] = await Promise.all([
    prisma.helpDeskCategory.findMany({ where: { branchCode, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.helpDeskPriority.findMany({ where: { branchCode, active: true }, orderBy: [{ level: 'asc' }, { name: 'asc' }] }),
    prisma.helpDeskStatus.findMany({ where: { branchCode, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.helpDeskKnowledgeCategory.findMany({ where: { branchCode, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.helpDeskKnowledgeArticle.findMany({ where: { branchCode, active: true }, orderBy: { updatedAt: 'desc' }, take: 500 }),
    (isStaff || access?.canCannedReplies)
      ? prisma.helpDeskCannedReply.findMany({ where: { branchCode, active: true }, orderBy: { title: 'asc' } })
      : Promise.resolve([]),
    isStaff
      ? prisma.helpDeskAccess.findMany({ where: { branchCode, active: true, canRespond: true } })
      : Promise.resolve([]),
    prisma.helpDeskCategoryAssignee.findMany({ where: { branchCode }, orderBy: { userName: 'asc' } }),
    getGlobalHelpDeskSetting(),
  ]);

  const staffUsers = staffAccesses.length
    ? await prisma.user.findMany({
        where: { id: { in: staffAccesses.map(item => item.userId) }, active: true },
        select: { id: true, username: true, displayName: true, email: true },
        orderBy: { displayName: 'asc' },
      })
    : [];

  res.json({
    setting: branchSetting,
    categories,
    priorities,
    statuses,
    knowledgeCategories,
    articles: articles.map(row => ({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() })),
    cannedReplies,
    staff: staffUsers.map(user => ({ userId: user.id, displayName: user.displayName, username: user.username, email: user.email })),
    categoryAssignees,
    globalSetting,
  });
});

helpDeskRouter.get('/manager-dashboard', async (req: AuthRequest, res) => {
  const branchRows=req.authUser!.isAdmin
    ? await prisma.branch.findMany({where:{active:true},select:{code:true,name:true},orderBy:{code:'asc'}})
    : await prisma.helpDeskAccess.findMany({
        where:{userId:req.authUser!.id,active:true,OR:[{canCoordinate:true,canViewAll:true},{canReport:true},{canRespond:true}]},
        select:{branchCode:true},orderBy:{branchCode:'asc'},
      }).then(async accesses=>{
        const codes=[...new Set(accesses.map(item=>item.branchCode))];
        return prisma.branch.findMany({where:{code:{in:codes},active:true},select:{code:true,name:true},orderBy:{code:'asc'}});
      });

  const result=[];
  for(const branch of branchRows){
    const access=req.authUser!.isAdmin?null:await accessFor(req.authUser!.id,branch.code);
    const canSeeAll=req.authUser!.isAdmin||Boolean(access?.active&&((access.canCoordinate&&access.canViewAll)||access.canReport));
    const ticketWhere=canSeeAll?{branchCode:branch.code}:{branchCode:branch.code,assignedUserId:req.authUser!.id};
    const tickets=await prisma.helpDeskTicket.findMany({where:ticketWhere,select:{id:true,statusId:true,assignedUserId:true,assignedUserName:true,createdAt:true}});
    const statusIds=[...new Set(tickets.map(item=>item.statusId))];
    const statuses=statusIds.length?await prisma.helpDeskStatus.findMany({where:{id:{in:statusIds}},select:{id:true,code:true,closed:true}}):[];
    const byId=new Map(statuses.map(item=>[item.id,item]));
    const responderAccesses=await prisma.helpDeskAccess.findMany({where:{branchCode:branch.code,active:true,canRespond:true},select:{userId:true}});
    const responderUsers=responderAccesses.length?await prisma.user.findMany({
      where:{id:{in:responderAccesses.map(item=>item.userId)},active:true},select:{id:true,displayName:true,username:true},orderBy:{displayName:'asc'},
    }):[];
    const responderBreakdown=canSeeAll?responderUsers.map(user=>{
      const mine=tickets.filter(ticket=>ticket.assignedUserId===user.id);
      return {userId:user.id,displayName:user.displayName||user.username,assigned:mine.length,
        open:mine.filter(ticket=>!byId.get(ticket.statusId)?.closed).length,closed:mine.filter(ticket=>Boolean(byId.get(ticket.statusId)?.closed)).length};
    }):[{userId:req.authUser!.id,displayName:req.authUser!.displayName||req.authUser!.username,assigned:tickets.length,
      open:tickets.filter(ticket=>!byId.get(ticket.statusId)?.closed).length,closed:tickets.filter(ticket=>Boolean(byId.get(ticket.statusId)?.closed)).length}];

    result.push({branchCode:branch.code,branchName:branch.name,scope:canSeeAll?'branch':'assigned',total:tickets.length,
      open:tickets.filter(i=>!byId.get(i.statusId)?.closed).length,closed:tickets.filter(i=>Boolean(byId.get(i.statusId)?.closed)).length,
      new:tickets.filter(i=>byId.get(i.statusId)?.code==='NEW').length,
      inProgress:tickets.filter(i=>['OPEN','IN_PROGRESS','WAITING_REQUESTER','WAITING_STAFF'].includes(byId.get(i.statusId)?.code||'')).length,
      unassigned:canSeeAll?tickets.filter(i=>!i.assignedUserId).length:0,responders:responderBreakdown});
  }
  res.json({branches:result,totals:{
    total:result.reduce((s,r)=>s+r.total,0),open:result.reduce((s,r)=>s+r.open,0),closed:result.reduce((s,r)=>s+r.closed,0),
    new:result.reduce((s,r)=>s+r.new,0),inProgress:result.reduce((s,r)=>s+r.inProgress,0),unassigned:result.reduce((s,r)=>s+r.unassigned,0),
  }});
});

async function reportPayload(rows: any[]) {
  const enriched = await enrichTickets(rows);
  const group = (selector: (row: any) => string) =>
    Object.entries(enriched.reduce<Record<string, number>>((acc, row) => {
      const key = selector(row) || 'Belirsiz';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).map(([name, count]) => ({ name, count }));

  const closed = enriched.filter(row => row.status?.closed && (row.closedAt || row.resolvedAt));
  const avgResolutionMinutes = closed.length
    ? Math.round(closed.reduce((sum, row) => {
        const end = row.closedAt || row.resolvedAt;
        return sum + ((end - row.createdAt) / 60000);
      }, 0) / closed.length)
    : 0;

  return {
    total: enriched.length,
    open: enriched.filter(row => !row.status?.closed).length,
    closed: enriched.filter(row => row.status?.closed).length,
    slaResponseBreached: enriched.filter(row => row.dueResponseAt && !row.firstReplyAt && row.dueResponseAt < Date.now()).length,
    slaResolutionBreached: enriched.filter(row => row.dueResolutionAt && !row.status?.closed && row.dueResolutionAt < Date.now()).length,
    avgResolutionMinutes,
    byCategory: group(row => row.category?.name),
    byPriority: group(row => row.priority?.name),
    byStatus: group(row => row.status?.name),
    byAssignee: group(row => row.assignedUserName || 'Atanmamış'),
  };
}

helpDeskRouter.get('/branch/:branchCode/report', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  if (!req.authUser!.isAdmin) {
    const access = await accessFor(req.authUser!.id, branchCode);
    if (!access?.active || !access.canReport) {
      res.status(403).json({ error: 'Rapor yetkiniz yok.' });
      return;
    }
  }
  res.json(await reportPayload(await prisma.helpDeskTicket.findMany({ where: { branchCode } })));
});

helpDeskRouter.get('/report/all', async (req: AuthRequest, res) => {
  if (!(await isCentralManager(req))) {
    res.status(403).json({ error: 'Tüm şube raporunu yalnız Merkez görüntüleyebilir.' });
    return;
  }
  const payload = await reportPayload(await prisma.helpDeskTicket.findMany());
  res.json(payload);
});

helpDeskRouter.get('/admin/global-settings', async (req: AuthRequest, res) => {
  await assertCentral(req); res.json(await getGlobalHelpDeskSetting());
});
helpDeskRouter.put('/admin/global-settings', async (req: AuthRequest, res) => {
  await assertCentral(req);
  const input=z.object({maxAttachments:z.number().int().min(1).max(5),maxAttachmentMb:z.number().int().min(1).max(25),allowedExtensions:z.string().trim().min(1).max(2000)}).parse(req.body);
  const cleaned=[...new Set(input.allowedExtensions.split(',').map(i=>i.trim().replace(/^\./,'').toLocaleLowerCase('tr-TR')).filter(i=>/^[a-z0-9]{1,10}$/.test(i)))];
  if(!cleaned.length){res.status(400).json({error:'En az bir geçerli dosya uzantısı tanımlanmalıdır.'});return;}
  const row=await prisma.helpDeskGlobalSetting.upsert({
    where:{id:1},
    update:{maxAttachments:input.maxAttachments,maxAttachmentMb:input.maxAttachmentMb,allowedExtensions:cleaned.join(',')},
    create:{id:1,maxAttachments:input.maxAttachments,maxAttachmentMb:input.maxAttachmentMb,allowedExtensions:cleaned.join(',')},
  });
  res.json(row);
});

helpDeskRouter.get('/admin/accesses', async (req: AuthRequest, res) => {
  if (!(await isCentralManager(req))) {
    res.status(403).json({ error: 'Help Desk kullanıcı yetkilerini yalnız Merkez yönetebilir.' });
    return;
  }
  const [users, branches, accesses] = await Promise.all([
    prisma.user.findMany({ orderBy: { displayName: 'asc' }, select: { id: true, username: true, displayName: true, email: true, active: true } }),
    prisma.branch.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
    prisma.helpDeskAccess.findMany(),
  ]);
  res.json({ users, branches, accesses });
});

helpDeskRouter.put('/admin/accesses', async (req: AuthRequest, res) => {
  if (!(await isCentralManager(req))) {
    res.status(403).json({ error: 'Help Desk kullanıcı yetkilerini yalnız Merkez yönetebilir.' });
    return;
  }
  const input=accessSchema.parse(req.body);
  const normalized={
    ...input,
    canStaff:Boolean(input.canCoordinate||input.canRespond),
    canAssign:Boolean(input.canCoordinate&&input.canAssign),
    canViewAll:Boolean((input.canCoordinate||input.canReport)&&input.canViewAll),
  };
  const row=await prisma.helpDeskAccess.upsert({
    where:{userId_branchCode:{userId:normalized.userId,branchCode:normalized.branchCode}},
    update:{...normalized,assignedById:req.authUser!.id},
    create:{...normalized,assignedById:req.authUser!.id},
  });
  res.json(row);
});

helpDeskRouter.put('/admin/branch/:branchCode/settings', async (req: AuthRequest, res) => {
  await assertCentral(req);
  const branchCode = String(req.params.branchCode);
  const input = settingsSchema.parse(req.body);
  res.json(await prisma.helpDeskBranchSetting.upsert({
    where: { branchCode },
    update: input,
    create: { branchCode, ...input },
  }));
});

helpDeskRouter.post('/branch/:branchCode/categories', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertTopics(req, branchCode);
  res.status(201).json(await prisma.helpDeskCategory.create({ data: { branchCode, ...categorySchema.parse(req.body) } }));
});

helpDeskRouter.put('/branch/:branchCode/categories/:id', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertTopics(req, branchCode);
  const row = await prisma.helpDeskCategory.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Kategori bulunamadı.' });
    return;
  }
  res.json(await prisma.helpDeskCategory.update({ where: { id: row.id }, data: categorySchema.parse(req.body) }));
});

helpDeskRouter.delete('/branch/:branchCode/categories/:id', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertTopics(req, branchCode);
  const row = await prisma.helpDeskCategory.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Kategori bulunamadı.' });
    return;
  }
  const count = await prisma.helpDeskTicket.count({ where: { categoryId: row.id } });
  if (count) {
    await prisma.helpDeskCategory.update({ where: { id: row.id }, data: { active: false } });
    res.json({ deactivated: true, ticketCount: count });
    return;
  }
  await prisma.helpDeskCategory.delete({ where: { id: row.id } });
  res.status(204).end();
});

helpDeskRouter.put('/branch/:branchCode/categories/:categoryId/assignees', async (req: AuthRequest, res) => {
  const branchCode=String(req.params.branchCode), categoryId=String(req.params.categoryId);
  await assertTopics(req,branchCode);
  const input=z.object({userIds:z.array(z.string().uuid()).max(100)}).parse(req.body);
  const category=await prisma.helpDeskCategory.findFirst({where:{id:categoryId,branchCode}});
  if(!category){res.status(404).json({error:'Destek konusu bulunamadı.'});return;}
  const uniqueIds=[...new Set(input.userIds)];
  const accesses=uniqueIds.length?await prisma.helpDeskAccess.findMany({where:{branchCode,userId:{in:uniqueIds},active:true,canRespond:true},select:{userId:true}}):[];
  const allowedIds=new Set(accesses.map(i=>i.userId));
  if(uniqueIds.some(id=>!allowedIds.has(id))){res.status(400).json({error:'Seçilen kullanıcılardan biri bu şubede cevaplayan kullanıcı olarak yetkili değil.'});return;}
  const users=uniqueIds.length?await prisma.user.findMany({where:{id:{in:uniqueIds},active:true},select:{id:true,displayName:true,username:true}}):[];
  await prisma.$transaction(async tx=>{
    await tx.helpDeskCategoryAssignee.deleteMany({where:{branchCode,categoryId}});
    for(const user of users)await tx.helpDeskCategoryAssignee.create({data:{branchCode,categoryId,userId:user.id,userName:user.displayName||user.username}});
  });
  res.json(await prisma.helpDeskCategoryAssignee.findMany({where:{branchCode,categoryId},orderBy:{userName:'asc'}}));
});

helpDeskRouter.post('/branch/:branchCode/priorities', async (req: AuthRequest, res) => {
  await assertCentral(req);
  const branchCode = String(req.params.branchCode);
  res.status(201).json(await prisma.helpDeskPriority.create({ data: { branchCode, ...prioritySchema.parse(req.body) } }));
});

helpDeskRouter.put('/branch/:branchCode/priorities/:id', async (req: AuthRequest, res) => {
  await assertCentral(req);
  const branchCode = String(req.params.branchCode);
  const row = await prisma.helpDeskPriority.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Öncelik bulunamadı.' });
    return;
  }
  res.json(await prisma.helpDeskPriority.update({ where: { id: row.id }, data: prioritySchema.parse(req.body) }));
});

helpDeskRouter.post('/branch/:branchCode/statuses', async (req: AuthRequest, res) => {
  await assertCentral(req);
  const branchCode = String(req.params.branchCode);
  res.status(201).json(await prisma.helpDeskStatus.create({ data: { branchCode, ...statusSchema.parse(req.body) } }));
});

helpDeskRouter.put('/branch/:branchCode/statuses/:id', async (req: AuthRequest, res) => {
  await assertCentral(req);
  const branchCode = String(req.params.branchCode);
  const row = await prisma.helpDeskStatus.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Durum bulunamadı.' });
    return;
  }
  res.json(await prisma.helpDeskStatus.update({ where: { id: row.id }, data: statusSchema.parse(req.body) }));
});

helpDeskRouter.post('/branch/:branchCode/knowledge-categories', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertKnowledge(req, branchCode);
  res.status(201).json(await prisma.helpDeskKnowledgeCategory.create({
    data: { branchCode, ...knowledgeCategorySchema.parse(req.body) },
  }));
});

helpDeskRouter.put('/branch/:branchCode/knowledge-categories/:id', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertKnowledge(req, branchCode);
  const row = await prisma.helpDeskKnowledgeCategory.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Bilgi bankası kategorisi bulunamadı.' });
    return;
  }
  res.json(await prisma.helpDeskKnowledgeCategory.update({
    where: { id: row.id },
    data: knowledgeCategorySchema.parse(req.body),
  }));
});

helpDeskRouter.post('/branch/:branchCode/articles', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertKnowledge(req, branchCode);
  const input = articleSchema.parse(req.body);
  const category = await prisma.helpDeskKnowledgeCategory.findFirst({ where: { id: input.categoryId, branchCode } });
  if (!category) {
    res.status(400).json({ error: 'Bilgi bankası kategorisi geçersiz.' });
    return;
  }
  const row = await prisma.helpDeskKnowledgeArticle.create({
    data: {
      branchCode,
      ...input,
      createdById: req.authUser!.id,
      createdByName: req.authUser!.displayName || req.authUser!.username,
    },
  });
  res.status(201).json({ ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

helpDeskRouter.put('/branch/:branchCode/articles/:id', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertKnowledge(req, branchCode);
  const row = await prisma.helpDeskKnowledgeArticle.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Makale bulunamadı.' });
    return;
  }
  const updated = await prisma.helpDeskKnowledgeArticle.update({ where: { id: row.id }, data: articleSchema.parse(req.body) });
  res.json({ ...updated, createdAt: updated.createdAt.getTime(), updatedAt: updated.updatedAt.getTime() });
});

helpDeskRouter.delete('/branch/:branchCode/articles/:id', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertKnowledge(req, branchCode);
  const row = await prisma.helpDeskKnowledgeArticle.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Makale bulunamadı.' });
    return;
  }
  await prisma.helpDeskKnowledgeArticle.delete({ where: { id: row.id } });
  res.status(204).end();
});

helpDeskRouter.post('/branch/:branchCode/canned-replies', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertCanned(req, branchCode);
  res.status(201).json(await prisma.helpDeskCannedReply.create({
    data: { branchCode, ...cannedSchema.parse(req.body), createdById: req.authUser!.id },
  }));
});

helpDeskRouter.put('/branch/:branchCode/canned-replies/:id', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertCanned(req, branchCode);
  const row = await prisma.helpDeskCannedReply.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Hazır yanıt bulunamadı.' });
    return;
  }
  res.json(await prisma.helpDeskCannedReply.update({ where: { id: row.id }, data: cannedSchema.parse(req.body) }));
});

helpDeskRouter.delete('/branch/:branchCode/canned-replies/:id', async (req: AuthRequest, res) => {
  const branchCode = String(req.params.branchCode);
  await assertCanned(req, branchCode);
  const row = await prisma.helpDeskCannedReply.findFirst({ where: { id: String(req.params.id), branchCode } });
  if (!row) {
    res.status(404).json({ error: 'Hazır yanıt bulunamadı.' });
    return;
  }
  await prisma.helpDeskCannedReply.delete({ where: { id: row.id } });
  res.status(204).end();
});
