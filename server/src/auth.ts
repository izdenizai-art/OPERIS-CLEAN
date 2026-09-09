import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from './db.js';
import { getLicenseStatus, isLicenseOwner } from './license.js';
import { ADMIN_PERMISSIONS, normalizePermissions, type UserPermissions } from './permissions.js';
import { getBranchContextForUser, getBranchPermissionsForUser } from './branch-access.js';

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  department: string;
  title: string;
  directoryGroups: string[];
  directoryUserPrincipalName: string;
  theme: 'dark' | 'light' | 'spring' | 'gray' | 'black' | 'ocean-blue' | 'pastel-glass' | 'corporate-2d';
  permissions: UserPermissions;
  active: boolean;
  isAdmin: boolean;
  mustChangePassword: boolean;
  directorySource: string;
  directoryEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AuthRequest = Request & { authUser?: PublicUser; authSessionId?: string };

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET en az 32 karakter olmalı.');
  return value;
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    department: user.department,
    title: user.title,
    directoryGroups: Array.isArray(user.directoryGroups) ? user.directoryGroups.map(String) : [],
    directoryUserPrincipalName: user.directoryUserPrincipalName,
    theme: (user.theme === 'turquoise' ? 'light' : (['dark', 'light', 'spring', 'gray', 'black', 'ocean-blue', 'pastel-glass', 'corporate-2d'].includes(user.theme) ? user.theme : 'dark')) as 'dark' | 'light' | 'spring' | 'gray' | 'black' | 'ocean-blue' | 'pastel-glass' | 'corporate-2d',
    permissions: user.isAdmin ? ADMIN_PERMISSIONS : normalizePermissions(user.permissions),
    active: user.active,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword,
    directorySource: user.directorySource,
    directoryEnabled: user.directoryEnabled,
    createdAt: user.createdAt.getTime(),
    updatedAt: user.updatedAt.getTime(),
  };
}

function parseClient(userAgent: string): { browser: string; operatingSystem: string; deviceType: string } {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes('edg/') ? 'Microsoft Edge'
    : ua.includes('crios/') || ua.includes('chrome/') ? 'Google Chrome'
    : ua.includes('safari/') ? 'Safari'
    : ua.includes('firefox/') ? 'Mozilla Firefox'
    : 'Bilinmeyen tarayıcı';

  const operatingSystem = ua.includes('ipad') || ua.includes('iphone') ? 'iPadOS / iOS'
    : ua.includes('windows') ? 'Windows'
    : ua.includes('android') ? 'Android'
    : ua.includes('mac os') ? 'macOS'
    : ua.includes('linux') ? 'Linux'
    : 'Bilinmeyen işletim sistemi';

  const deviceType = ua.includes('ipad') || ua.includes('tablet') ? 'Tablet'
    : ua.includes('mobile') || ua.includes('iphone') || ua.includes('android') ? 'Telefon'
    : 'Bilgisayar';

  return { browser, operatingSystem, deviceType };
}

export async function setSession(req: Request, res: Response, userId: string): Promise<void> {
  const tokenId = crypto.randomUUID();
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 1000);
  const parsed = parseClient(userAgent);
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  const ipAddress = (forwarded || req.socket.remoteAddress || req.ip || '').replace(/^::ffff:/, '').slice(0, 100);
  const requestedDeviceName = String(req.headers['x-operis-device-name'] ?? '').trim().slice(0, 120);
  const deviceName = requestedDeviceName || `${parsed.deviceType} · ${parsed.operatingSystem}`;

  await prisma.userSession.create({
    data: {
      userId,
      tokenId,
      deviceName,
      deviceType: parsed.deviceType,
      browser: parsed.browser,
      operatingSystem: parsed.operatingSystem,
      ipAddress,
      userAgent,
    },
  });

  const token = jwt.sign({ sub: userId, sid: tokenId }, secret(), { expiresIn: '12h' });
  res.cookie('yi_session', token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie('yi_session', { path: '/' });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.yi_session;
    if (!token) { res.status(401).json({ error: 'Oturum gerekli.' }); return; }
    const payload = jwt.verify(token, secret()) as { sub: string; sid?: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    const session = payload.sid
      ? await prisma.userSession.findUnique({ where: { tokenId: payload.sid } })
      : null;
    if (!user || !user.active || !session || session.revokedAt) {
      clearSession(res);
      res.status(401).json({ error: 'Oturum sonlandırıldı veya geçersiz.' });
      return;
    }

    const now = new Date();
    const idleTimeoutMs = 15 * 60 * 1000;
    const idleForMs = now.getTime() - session.lastSeenAt.getTime();

    if (idleForMs >= idleTimeoutMs) {
      await prisma.userSession.update({
        where: { id: session.id },
        data: {
          revokedAt: now,
          revokeReason: '15 dakika hareketsizlik nedeniyle oturum otomatik kapatıldı.',
        },
      });
      clearSession(res);
      res.status(401).json({
        error: '15 dakika hareketsizlik nedeniyle oturumunuz kapatıldı. Lütfen tekrar giriş yapın.',
        code: 'SESSION_IDLE_TIMEOUT',
      });
      return;
    }

    if (idleForMs > 30_000) {
      await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    req.authUser = publicUser(user);
    req.authSessionId = session.id;

    if (user.mustChangePassword) {
      const requestPath = String(req.originalUrl || req.url || '').split('?')[0];
      const allowedFirstLoginPaths = new Set([
        '/api/auth/me',
        '/api/auth/logout',
        '/api/auth/complete-first-login',
      ]);
      if (!allowedFirstLoginPaths.has(requestPath)) {
        res.status(428).json({
          error: 'İlk giriş bilgileri tamamlanmadan OPERİS modüllerine erişilemez.',
          code: 'FIRST_LOGIN_PROFILE_REQUIRED',
        });
        return;
      }
    }

    const license = await getLicenseStatus();
    if (license.expired && !isLicenseOwner(user.username)) {
      res.status(423).json({
        error: 'Erişim reddedildi. Lisans süresi sona ermiştir. Lisans tarihi güncellenene kadar uygulamaya erişemezsiniz.',
        code: 'LICENSE_EXPIRED',
        expiresAt: license.expiresAt,
      });
      return;
    }
    next();
  } catch {
    clearSession(res);
    res.status(401).json({ error: 'Oturum geçersiz.' });
  }
}

export function requirePermission(check: (permissions: UserPermissions, user: PublicUser) => boolean) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.authUser;
    if (!user) {
      res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
      return;
    }

    try {
      const requestedBranch = String(req.headers['x-operis-branch-code'] ?? '').trim().toUpperCase();

      if (requestedBranch === 'ALL') {
        const context = await getBranchContextForUser(user.id, 'ALL');
        const permittedInAnyBranch = context.branches.some(branch => check(branch.permissions, user));
        if (!permittedInAnyBranch) {
          res.status(403).json({ error: 'Yetkili şubelerinizde bu işlem için yetkiniz yok.' });
          return;
        }
        next();
        return;
      }

      const effectivePermissions =
        requestedBranch && /^\d{3}$/.test(requestedBranch)
          ? await getBranchPermissionsForUser(user.id, requestedBranch)
          : user.permissions;

      if (!check(effectivePermissions, user)) {
        res.status(403).json({ error: 'Bu şubede bu işlem için yetkiniz yok.' });
        return;
      }
      next();
    } catch (error) {
      const status = Number((error as { status?: number }).status ?? 403);
      res.status(status).json({
        error: error instanceof Error ? error.message : 'Bu şubede bu işlem için yetkiniz yok.',
      });
    }
  };
}
