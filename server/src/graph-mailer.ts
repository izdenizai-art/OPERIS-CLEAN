import { prisma } from './db.js';
import { decryptText, encryptText } from './crypto.js';

export type GraphMailConfigInput = {
  mailProvider: 'smtp' | 'graph';
  graphEnabled: boolean;
  graphTenantId: string;
  graphClientId: string;
  graphClientSecret?: string;
  graphSenderUser: string;
};

export type GraphAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export async function getGraphMailSettings() {
  const row = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  return {
    mailProvider: row.mailProvider === 'graph' ? 'graph' as const : 'smtp' as const,
    graphEnabled: row.graphEnabled,
    graphTenantId: row.graphTenantId,
    graphClientId: row.graphClientId,
    graphClientSecretSet: Boolean(row.graphClientSecretEncrypted),
    graphSenderUser: row.graphSenderUser,
  };
}

export async function updateGraphMailSettings(input: GraphMailConfigInput) {
  const current = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  await prisma.appSettings.update({
    where: { id: 1 },
    data: {
      mailProvider: input.mailProvider,
      graphEnabled: input.graphEnabled,
      graphTenantId: input.graphTenantId.trim(),
      graphClientId: input.graphClientId.trim(),
      graphClientSecretEncrypted: input.graphClientSecret
        ? encryptText(input.graphClientSecret)
        : current.graphClientSecretEncrypted,
      graphSenderUser: input.graphSenderUser.trim().toLowerCase(),
    },
  });

  return getGraphMailSettings();
}

async function getAccessToken(): Promise<string> {
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });

  if (!row?.graphEnabled) throw new Error('Microsoft Graph e-posta gönderimi etkin değil.');
  if (!row.graphTenantId || !row.graphClientId || !row.graphSenderUser) {
    throw new Error('Tenant ID, Client ID ve gönderen kullanıcı zorunludur.');
  }
  if (!row.graphClientSecretEncrypted) throw new Error('Microsoft Graph Client Secret tanımlanmamış.');

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(row.graphTenantId)}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: row.graphClientId,
      client_secret: decryptText(row.graphClientSecretEncrypted),
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Microsoft OAuth2 başarısız (${response.status}).`);
  }

  return payload.access_token;
}

export async function sendGraphMail(input: {
  to: string;
  subject: string;
  body: string;
  attachments?: GraphAttachment[];
}) {
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!row) throw new Error('Microsoft Graph ayarları bulunamadı.');

  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(row.graphSenderUser)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: {
            contentType: 'HTML',
            content: `<p>${escapeHtml(input.body).replace(/\n/g, '<br>')}</p>`,
          },
          toRecipients: [{ emailAddress: { address: input.to } }],
          attachments: (input.attachments ?? []).map(item => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: item.filename,
            contentType: item.contentType || 'application/octet-stream',
            contentBytes: item.content.toString('base64'),
          })),
        },
        saveToSentItems: true,
      }),
    },
  );

  if (response.status !== 202) {
    const payload = await response.json().catch(() => ({})) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      payload.error?.message ||
      payload.error?.code ||
      `Microsoft Graph e-posta gönderimi başarısız (${response.status}).`,
    );
  }

  return { ok: true };
}

export function testGraphMail(to: string) {
  return sendGraphMail({
    to,
    subject: 'Operis Microsoft Graph OAuth2 testi',
    body: 'Microsoft Graph API üzerinden e-posta gönderimi başarıyla çalışıyor.',
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
