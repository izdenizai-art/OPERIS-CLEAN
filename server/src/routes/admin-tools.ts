import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requirePermission, type AuthRequest } from '../auth.js';
import { getNetworkDiagnostics, queryDomainDevice, queryDomainUser } from '../services/windows-query.js';

export const adminToolsRouter = Router();

async function writeQueryAudit(
  req: AuthRequest,
  module: 'DOMAIN_USER' | 'DOMAIN_DEVICE',
  label: string,
  errorMessage = '',
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.authUser?.id ?? '',
        username: req.authUser?.username ?? '',
        displayName: req.authUser?.displayName ?? '',
        action: errorMessage ? 'QUERY_ERROR' : 'QUERY',
        module,
        recordId: '',
        recordLabel: label,
        description: errorMessage
          ? `Yönetim Araçları modülünde “${label}” sorgusu başarısız oldu. Hata: ${errorMessage}`.slice(0, 1000)
          : `Yönetim Araçları modülünde “${label}” sorgusu başarıyla çalıştırıldı.`,
        oldData: '',
        newData: '',
        ipAddress: req.ip ?? '',
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 1000),
      },
    });
  } catch (error) {
    console.error('Domain sorgu denetim kaydı oluşturulamadı:', error);
  }
}

adminToolsRouter.post(
  '/domain/user-query',
  requireAuth,
  requirePermission((_permissions, user) => user.isAdmin || user.permissions.canManageUsers),
  async (req: AuthRequest, res) => {
    const parsed = z.object({ query: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Arama değeri geçersiz.' });
      return;
    }

    try {
      const result = await queryDomainUser(parsed.data.query);
      await writeQueryAudit(req, 'DOMAIN_USER', parsed.data.query);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Domain sorgusu başarısız.';
      await writeQueryAudit(req, 'DOMAIN_USER', parsed.data.query, message);
      res.status(400).json({ error: message });
    }
  },
);

adminToolsRouter.post(
  '/domain/device-query',
  requireAuth,
  requirePermission((_permissions, user) => user.isAdmin || user.permissions.canManageUsers),
  async (req: AuthRequest, res) => {
    const parsed = z.object({ computerName: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bilgisayar adı geçersiz.' });
      return;
    }

    try {
      const result = await queryDomainDevice(parsed.data.computerName);
      await writeQueryAudit(req, 'DOMAIN_DEVICE', parsed.data.computerName);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cihaz sorgusu başarısız.';
      await writeQueryAudit(req, 'DOMAIN_DEVICE', parsed.data.computerName, message);
      res.status(400).json({ error: message });
    }
  },
);

adminToolsRouter.get(
  '/network-diagnostics',
  requireAuth,
  requirePermission((_permissions, user) => user.isAdmin),
  async (_req: AuthRequest, res) => {
    try {
      res.json(await getNetworkDiagnostics(3001));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Ağ tanılama başarısız.',
      });
    }
  },
);
