import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { prisma } from './db.js';
import { decryptText, encryptText } from './crypto.js';

export type MailConfigInput = {
  mailProvider: 'smtp' | 'graph';
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword?: string;
  smtpFrom: string;
  reminderEmailEnabled: boolean;
  reminderLeadMinutes: number;
};

export async function getMailSettings() {
  const row = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return {
    mailProvider: row.mailProvider === 'graph' ? 'graph' as const : 'smtp' as const,
    smtpEnabled: row.smtpEnabled,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    smtpUser: row.smtpUser,
    smtpPasswordSet: Boolean(row.smtpPasswordEncrypted),
    smtpFrom: row.smtpFrom,
    reminderEmailEnabled: row.reminderEmailEnabled,
    reminderLeadMinutes: row.reminderLeadMinutes,
  };
}

export async function updateMailSettings(input: MailConfigInput) {
  const current = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const encrypted = input.smtpPassword
    ? encryptText(input.smtpPassword)
    : current.smtpPasswordEncrypted;
  await prisma.appSettings.update({
    where: { id: 1 },
    data: {
      mailProvider: input.mailProvider,
      smtpEnabled: input.smtpEnabled,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      smtpUser: input.smtpUser,
      smtpPasswordEncrypted: encrypted,
      smtpFrom: input.smtpFrom,
      reminderEmailEnabled: input.reminderEmailEnabled,
      reminderLeadMinutes: input.reminderLeadMinutes,
    },
  });
  return getMailSettings();
}

async function transporter() {
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!row?.smtpEnabled) throw new Error('E-posta gönderimi etkin değil.');
  if (!row.smtpHost) throw new Error('SMTP sunucusu zorunludur.');
  if (!row.smtpFrom) throw new Error('Gönderen e-posta adresi zorunludur.');
  if (!row.smtpUser) throw new Error('SMTP kullanıcı adı zorunludur.');

  const password = row.smtpPasswordEncrypted ? decryptText(row.smtpPasswordEncrypted) : '';
  if (!password) throw new Error('SMTP şifresi / Gmail uygulama şifresi kayıtlı değil.');

  const host = row.smtpHost.trim().toLocaleLowerCase('en-US');
  const isGmail = host === 'smtp.gmail.com';
  const secure = row.smtpPort === 465 ? true : row.smtpSecure;

  return nodemailer.createTransport({
    host: row.smtpHost.trim(),
    port: row.smtpPort,
    secure,
    requireTLS: isGmail && row.smtpPort === 587,
    auth: { user: row.smtpUser.trim(), pass: password.replace(/\s+/g, '') },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: {
      servername: row.smtpHost.trim(),
      minVersion: 'TLSv1.2',
    },
  });
}

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

function readableMailError(error: unknown): { message: string; code: string; stage: MailTestResult['stage'] } {
  const e = error as {
    message?: string;
    code?: string;
    response?: string;
    responseCode?: number;
    command?: string;
  };

  const raw = String(e?.message ?? 'Bilinmeyen SMTP hatası.');
  const code = String(e?.code ?? e?.responseCode ?? '');
  const command = String(e?.command ?? '').toUpperCase();

  if (/535|534|EAUTH|Username and Password not accepted|Invalid login/i.test(`${raw} ${code} ${e?.response ?? ''}`)) {
    return {
      stage: 'authentication',
      code: code || 'EAUTH',
      message: 'Gmail kimlik doğrulaması başarısız. Normal Gmail parolası yerine 2 Adımlı Doğrulama ile oluşturulmuş 16 haneli Uygulama Şifresini kullanın.',
    };
  }

  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESOCKET|EAI_AGAIN/i.test(`${raw} ${code}`)) {
    return {
      stage: 'connection',
      code,
      message: `SMTP sunucusuna bağlantı kurulamadı: ${raw}`,
    };
  }

  if (command === 'AUTH') {
    return { stage: 'authentication', code, message: `SMTP kimlik doğrulama hatası: ${raw}` };
  }

  return { stage: 'send', code, message: raw };
}

export async function verifyMailConnection(): Promise<MailTestResult> {
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const base = {
    host: row?.smtpHost ?? '',
    port: row?.smtpPort ?? 0,
    secure: row?.smtpPort === 465 ? true : Boolean(row?.smtpSecure),
    user: row?.smtpUser ?? '',
    from: row?.smtpFrom ?? '',
    accepted: [] as string[],
    rejected: [] as string[],
    response: '',
    code: '',
  };

  try {
    const client = await transporter();
    await client.verify();
    client.close();
    return {
      ...base,
      ok: true,
      stage: 'connection',
      message: 'SMTP bağlantısı ve kimlik doğrulaması başarılı.',
    };
  } catch (error) {
    const detail = readableMailError(error);
    return {
      ...base,
      ok: false,
      stage: detail.stage,
      message: detail.message,
      code: detail.code,
    };
  }
}

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  attachments?: MailAttachment[],
  fromName?: string,
) {
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const client = await transporter();
  const configuredFrom = row!.smtpFrom.trim();
  const from = fromName?.trim()
    ? { name: fromName.trim(), address: configuredFrom }
    : configuredFrom;
  await client.sendMail({ from, to, subject, text, html, attachments });
}

export async function sendTestMail(to: string): Promise<MailTestResult> {
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const base = {
    host: row?.smtpHost ?? '',
    port: row?.smtpPort ?? 0,
    secure: row?.smtpPort === 465 ? true : Boolean(row?.smtpSecure),
    user: row?.smtpUser ?? '',
    from: row?.smtpFrom ?? '',
    accepted: [] as string[],
    rejected: [] as string[],
    response: '',
    code: '',
  };

  try {
    const client = await transporter();
    await client.verify();
    const info = await client.sendMail({
      from: row!.smtpFrom,
      to,
      subject: 'OPERİS Gmail / SMTP test e-postası',
      text: 'OPERİS e-posta ayarları başarıyla çalışıyor.',
      html: '<p><strong>OPERİS</strong> e-posta ayarları başarıyla çalışıyor.</p>',
    });
    client.close();

    return {
      ...base,
      ok: true,
      stage: 'send',
      message: 'Bağlantı, kimlik doğrulama ve test e-postası gönderimi başarılı.',
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
      response: String(info.response ?? ''),
    };
  } catch (error) {
    const detail = readableMailError(error);
    const e = error as { response?: string };
    return {
      ...base,
      ok: false,
      stage: detail.stage,
      message: detail.message,
      code: detail.code,
      response: String(e?.response ?? ''),
    };
  }
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
