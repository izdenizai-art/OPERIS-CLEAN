import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './db.js';

const OWNER_USERNAME = 'balamir';
const TRUSTED_TIME_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const stateFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Data/license-clock.json');

type ClockState = {
  trustedAt: number;
  observedSystemAt: number;
  signature: string;
};

export type LicenseStatus = {
  ownerUsername: string;
  expiresAt: number | null;
  effectiveNow: number;
  expired: boolean;
  clockRollbackDetected: boolean;
  timeSource: 'https' | 'system' | 'stored';
};

function signingKey(): string {
  const value = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('Lisans zaman doğrulaması için güvenli anahtar bulunamadı.');
  return value;
}

function signState(input: Omit<ClockState, 'signature'>): string {
  return crypto.createHmac('sha256', signingKey())
    .update(`${input.trustedAt}|${input.observedSystemAt}`)
    .digest('hex');
}

function readClockState(): ClockState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as ClockState;
    const expected = signState({ trustedAt: parsed.trustedAt, observedSystemAt: parsed.observedSystemAt });
    if (!crypto.timingSafeEqual(Buffer.from(parsed.signature), Buffer.from(expected))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeClockState(trustedAt: number, observedSystemAt: number): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const unsigned = { trustedAt, observedSystemAt };
  const state: ClockState = { ...unsigned, signature: signState(unsigned) };
  const temp = `${stateFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temp, stateFile);
}

async function fetchTrustedTime(): Promise<number | null> {
  const urls = [
    'https://www.microsoft.com/',
    'https://nodejs.org/',
    'https://www.cloudflare.com/',
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, {
        method: 'HEAD',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const date = response.headers.get('date');
      const parsed = date ? Date.parse(date) : Number.NaN;
      if (Number.isFinite(parsed)) return parsed;
    } catch {
      // Sonraki güvenilir zaman kaynağı denenir.
    }
  }

  return null;
}

let cached: { status: LicenseStatus; checkedAt: number } | null = null;

export async function getLicenseStatus(force = false): Promise<LicenseStatus> {
  if (!force && cached && Date.now() - cached.checkedAt < 60_000) return cached.status;

  const settings = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const systemNow = Date.now();
  const stored = readClockState();
  const trustedRemote = await fetchTrustedTime();

  let effectiveNow = systemNow;
  let timeSource: LicenseStatus['timeSource'] = 'system';
  let clockRollbackDetected = false;

  if (trustedRemote) {
    effectiveNow = trustedRemote;
    timeSource = 'https';
  } else if (stored) {
    const elapsed = Math.max(0, systemNow - stored.observedSystemAt);
    effectiveNow = stored.trustedAt + elapsed;
    timeSource = 'stored';

    if (systemNow + CLOCK_ROLLBACK_TOLERANCE_MS < stored.observedSystemAt) {
      clockRollbackDetected = true;
      effectiveNow = Math.max(effectiveNow, stored.trustedAt);
    }
  }

  if (stored && effectiveNow + CLOCK_ROLLBACK_TOLERANCE_MS < stored.trustedAt) {
    clockRollbackDetected = true;
    effectiveNow = stored.trustedAt;
  }

  if (!stored || trustedRemote || effectiveNow - stored.trustedAt > TRUSTED_TIME_MAX_AGE_MS) {
    writeClockState(Math.max(effectiveNow, stored?.trustedAt ?? 0), systemNow);
  }

  const expiresAt = settings.licenseExpiresAt?.getTime() ?? null;
  const expired = clockRollbackDetected || (expiresAt !== null && effectiveNow > expiresAt);

  const status: LicenseStatus = {
    ownerUsername: OWNER_USERNAME,
    expiresAt,
    effectiveNow,
    expired,
    clockRollbackDetected,
    timeSource,
  };

  cached = { status, checkedAt: Date.now() };
  return status;
}

export async function updateLicenseExpiry(expiresAt: Date | null): Promise<LicenseStatus> {
  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: { licenseExpiresAt: expiresAt },
    create: { id: 1, licenseExpiresAt: expiresAt },
  });
  cached = null;
  return getLicenseStatus(true);
}

export function isLicenseOwner(username: string): boolean {
  return username === OWNER_USERNAME;
}
