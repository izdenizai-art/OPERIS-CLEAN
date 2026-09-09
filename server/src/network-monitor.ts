import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { promises as dns } from 'node:dns';
import { z } from 'zod';
import { prisma } from './db.js';
import { requireAuth, requirePermission, type AuthRequest } from './auth.js';
import { sendMail } from './mailer.js';
import { assertBranchPermission, readAccessibleBranchCodesForPermission, readBranchCodesForPermission, writeBranchCode } from './branch-access.js';
import { getGraphMailSettings, sendGraphMail } from './graph-mailer.js';
import { decryptText, encryptText } from './crypto.js';
import * as snmp from 'net-snmp';

const execFileAsync = promisify(execFile);
export const networkMonitorRouter = Router();

const hostSchema = z.string().trim().min(1).max(253).regex(
  /^(?=.{1,253}$)(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?|(?:\d{1,3}\.){3}\d{1,3})$/,
  'Geçerli bir IP adresi veya hostname girin.',
);

const monitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  host: hostSchema,
  description: z.string().trim().max(1000).default(''),
  deviceType: z.enum(['UNKNOWN', 'ROUTER', 'SWITCH', 'SERVER', 'COMPUTER', 'PRINTER', 'ACCESS_POINT', 'FIREWALL', 'OTHER']).default('UNKNOWN'),
  vendor: z.string().trim().max(160).default(''),
  location: z.string().trim().max(240).default(''),
  operatingSystem: z.enum(['UNKNOWN', 'WINDOWS', 'LINUX', 'NETWORK', 'OTHER']).default('UNKNOWN'),
  snmpEnabled: z.boolean().default(false),
  snmpVersion: z.enum(['2c', '3']).default('2c'),
  snmpPort: z.number().int().min(1).max(65535).default(161),
  snmpCommunity: z.string().max(240).optional(),
  snmpUsername: z.string().trim().max(120).default(''),
  snmpAuthProtocol: z.enum(['SHA', 'MD5']).default('SHA'),
  snmpAuthKey: z.string().max(240).optional(),
  snmpPrivProtocol: z.enum(['AES', 'DES']).default('AES'),
  snmpPrivKey: z.string().max(240).optional(),
  intervalSeconds: z.number().int().min(10).max(86400),
  failureThreshold: z.number().int().min(1).max(100),
  timeoutMs: z.number().int().min(500).max(10000),
  emailTo: z.string().trim().max(1000).default(''),
  downSubject: z.string().trim().min(1).max(300),
  downBody: z.string().trim().min(1).max(5000),
  upSubject: z.string().trim().min(1).max(300),
  upBody: z.string().trim().min(1).max(5000),
  active: z.boolean(),
  positionX: z.number().int().min(0).max(100),
  positionY: z.number().int().min(0).max(100),
});

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  protocol: z.enum(['TCP', 'HTTP', 'HTTPS', 'SSH', 'FTP', 'DNS', 'SMTP']).default('TCP'),
  port: z.number().int().min(1).max(65535),
  path: z.string().trim().max(500).default(''),
  expectedStatus: z.number().int().min(100).max(599).nullable().optional(),
  timeoutMs: z.number().int().min(500).max(30000).default(3000),
  active: z.boolean().default(true),
});

const discoverySchema = z.object({
  cidr: z.string().trim().regex(/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/, 'CIDR biçimi geçersiz. Örnek: 10.20.128.0/24'),
  timeoutMs: z.number().int().min(300).max(5000).default(1000),
});

const topologyWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  layout: z.object({
    nodes: z.array(z.object({
      id: z.string().min(1).max(120),
      kind: z.enum(['DEVICE','ROUTER','SWITCH','SERVER','FIREWALL','INTERNET','LOCATION','NOTE','CLOUD','AP','PRINTER']),
      monitorId: z.string().max(120).nullable().optional(),
      label: z.string().max(160),
      subtitle: z.string().max(240).default(''),
      x: z.number().min(0).max(5000),
      y: z.number().min(0).max(5000),
      width: z.number().min(70).max(500).default(150),
      height: z.number().min(50).max(300).default(80),
    })).max(1000),
    links: z.array(z.object({
      id: z.string().min(1).max(120),
      from: z.string().min(1).max(120),
      to: z.string().min(1).max(120),
      label: z.string().max(120).default(''),
      style: z.enum(['SOLID','DASHED']).default('SOLID'),
    })).max(3000),
    settings: z.object({
      width: z.number().min(800).max(5000).default(1800),
      height: z.number().min(600).max(5000).default(1100),
      grid: z.boolean().default(true),
      snap: z.boolean().default(true),
      zoom: z.number().min(0.4).max(2).default(1),
    }).default({ width: 1800, height: 1100, grid: true, snap: true, zoom: 1 }),
  }),
});

const requireAnyNetworkPermission = (selector:(permissions:any)=>boolean) => async (req:AuthRequest,res:any,next:any) => {
  if(req.authUser?.isAdmin){next();return;}
  const codes=await readAccessibleBranchCodesForPermission(req,selector);
  if(codes.length){next();return;}
  res.status(403).json({error:'Bu işlem için yetkili olduğunuz aktif bir şube bulunmuyor.'});
};
const viewPermission = requireAnyNetworkPermission(p => p.network.canView);
const createPermission = requireAnyNetworkPermission(p => p.network.canCreate);
const editPermission = requireAnyNetworkPermission(p => p.network.canEdit);
const deletePermission = requireAnyNetworkPermission(p => p.network.canDelete);
const testPermission = requireAnyNetworkPermission(p => p.network.canExcel);

function serializeMonitor(row: any) {
  const {
    snmpCommunityEncrypted,
    snmpAuthKeyEncrypted,
    snmpPrivKeyEncrypted,
    ...safe
  } = row;
  return {
    ...safe,
    snmpCommunitySet: Boolean(snmpCommunityEncrypted),
    snmpAuthKeySet: Boolean(snmpAuthKeyEncrypted),
    snmpPrivKeySet: Boolean(snmpPrivKeyEncrypted),
    lastCheckedAt: row.lastCheckedAt?.getTime() ?? null,
    lastSuccessAt: row.lastSuccessAt?.getTime() ?? null,
    lastFailureAt: row.lastFailureAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function monitorWriteData(input: z.infer<typeof monitorSchema>, existing?: any) {
  const {
    snmpCommunity,
    snmpAuthKey,
    snmpPrivKey,
    ...plain
  } = input;
  return {
    ...plain,
    snmpCommunityEncrypted: snmpCommunity
      ? encryptText(snmpCommunity.trim())
      : existing?.snmpCommunityEncrypted ?? '',
    snmpAuthKeyEncrypted: snmpAuthKey
      ? encryptText(snmpAuthKey)
      : existing?.snmpAuthKeyEncrypted ?? '',
    snmpPrivKeyEncrypted: snmpPrivKey
      ? encryptText(snmpPrivKey)
      : existing?.snmpPrivKeyEncrypted ?? '',
  };
}

function serializeService(row: any) {
  return {
    ...row,
    lastCheckedAt: row.lastCheckedAt?.getTime() ?? null,
    lastSuccessAt: row.lastSuccessAt?.getTime() ?? null,
    lastFailureAt: row.lastFailureAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

async function pingHost(host: string, timeoutMs: number): Promise<{ success: boolean; latencyMs: number | null; message: string }> {
  const started = Date.now();
  const isWindows = process.platform === 'win32';
  const args = isWindows
    ? ['-n', '1', '-w', String(timeoutMs), host]
    : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];

  try {
    const { stdout = '', stderr = '' } = await execFileAsync('ping', args, {
      windowsHide: true,
      timeout: timeoutMs + 1500,
      maxBuffer: 1024 * 64,
      encoding: 'utf8',
    });

    const output = `${stdout}\n${stderr}`;
    const lower = output.toLocaleLowerCase('en-US');
    const hasReply =
      /ttl[=\s:]\s*\d+/i.test(output) ||
      /time[=<]\s*\d+\s*ms/i.test(output) ||
      /bytes[=\s:]\s*\d+.*ttl/i.test(output);
    const explicitFailure =
      /destination\s+(?:host|net|network|port)\s+unreachable|request\s+timed\s+out|general\s+failure|transmit\s+failed|could\s+not\s+find\s+host|unknown\s+host|hedef\s+ana\s+bilgisayarına\s+ulaşılamıyor|hedef\s+ağa\s+ulaşılamıyor|istek\s+zaman\s+aşımına\s+uğradı|genel\s+hata|ana\s+bilgisayar\s+bulunamadı/i.test(lower);
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetReply = new RegExp(`(?:reply from|yanıt|cevap).*${escapedHost}.*(?:ttl|time|süre)`, 'i').test(output);

    if (!hasReply || !targetReply || explicitFailure) {
      return {
        success: false,
        latencyMs: null,
        message: `ICMP Echo Reply alınamadı.${explicitFailure ? ' Ping çıktısı erişilemez/zaman aşımı bildiriyor.' : ''}`,
      };
    }

    const latencyMatch = output.match(/time[=<]\s*(\d+)\s*ms/i);
    const measured = latencyMatch ? Number(latencyMatch[1]) : Math.max(1, Date.now() - started);
    return { success: true, latencyMs: Math.max(1, measured), message: 'ICMP Echo Reply alındı.' };
  } catch (error) {
    const e = error as { killed?: boolean; stdout?: string; stderr?: string };
    const detail = `${e.stdout ?? ''} ${e.stderr ?? ''}`.trim();
    return {
      success: false,
      latencyMs: null,
      message: e.killed
        ? 'Ping zaman aşımına uğradı; ICMP Echo Reply alınamadı.'
        : `Ping başarısız; ICMP Echo Reply alınamadı.${detail ? ` ${detail.slice(0, 300)}` : ''}`,
    };
  }
}

function recipients(value: string): string[] {
  return [...new Set(value.split(/[;,]/).map(item => item.trim()).filter(Boolean))];
}

function renderTemplate(template: string, monitor: any, failures: number, latencyMs: number | null): string {
  const replacements: Record<string, string> = {
    '{name}': monitor.name,
    '{host}': monitor.host,
    '{time}': new Date().toLocaleString('tr-TR'),
    '{failures}': String(failures),
    '{latency}': latencyMs == null ? '-' : String(latencyMs),
    '{description}': monitor.description || '',
  };
  return Object.entries(replacements).reduce((text, [token, value]) => text.split(token).join(value), template);
}

async function sendAnyMail(to: string, subject: string, body: string) {
  const graph = await getGraphMailSettings();
  if (graph.mailProvider === 'graph' && graph.graphEnabled) {
    await sendGraphMail({ to, subject, body });
  } else {
    await sendMail(to, subject, body, `<p>${body.replace(/[<>&]/g, '').replace(/\n/g, '<br>')}</p>`);
  }
}

async function sendStatusMail(monitor: any, status: 'ONLINE' | 'OFFLINE', failures: number, latencyMs: number | null) {
  const toList = recipients(monitor.emailTo);
  if (!toList.length) return;
  const subject = renderTemplate(status === 'ONLINE' ? monitor.upSubject : monitor.downSubject, monitor, failures, latencyMs);
  const body = renderTemplate(status === 'ONLINE' ? monitor.upBody : monitor.downBody, monitor, failures, latencyMs);
  for (const to of toList) await sendAnyMail(to, subject, body);
}

async function sendServiceStatusMail(monitor: any, service: any, status: 'ONLINE' | 'OFFLINE', message: string) {
  const toList = recipients(monitor.emailTo);
  if (!toList.length) return;
  const subject = `[Operis] ${monitor.name} - ${service.name} ${status === 'ONLINE' ? 'SERVİS VAR' : 'SERVİS YOK'}`;
  const body = [
    `Cihaz: ${monitor.name}`,
    `IP/Host: ${monitor.host}`,
    `Servis: ${service.name}`,
    `Protokol: ${service.protocol}`,
    `Port: ${service.port}`,
    `Durum: ${status === 'ONLINE' ? 'ERİŞİM VAR' : 'ERİŞİM YOK'}`,
    `Açıklama: ${message}`,
    `Zaman: ${new Date().toLocaleString('tr-TR')}`,
  ].join('\n');
  for (const to of toList) await sendAnyMail(to, subject, body);
}

async function tcpProbe(host: string, port: number, timeoutMs: number): Promise<{ success: boolean; latencyMs: number | null; message: string }> {
  const started = Date.now();
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (success: boolean, message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ success, latencyMs: success ? Math.max(1, Date.now() - started) : null, message });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, `TCP ${port} portu açık.`));
    socket.once('timeout', () => finish(false, `TCP ${port} zaman aşımı.`));
    socket.once('error', error => finish(false, `TCP ${port} bağlantı hatası: ${error.message}`));
  });
}

async function httpProbe(
  host: string,
  port: number,
  path: string,
  protocol: 'HTTP' | 'HTTPS',
  timeoutMs: number,
  expectedStatus: number | null,
): Promise<{ success: boolean; latencyMs: number | null; message: string; responseCode: number | null }> {
  const started = Date.now();
  return new Promise(resolve => {
    const client = protocol === 'HTTPS' ? https : http;
    const request = client.request({
      host,
      port,
      path: path || '/',
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'Operis-Network-Monitor/6.3.62' },
    } as any, response => {
      response.resume();
      const code = response.statusCode ?? 0;
      const success = expectedStatus ? code === expectedStatus : code >= 200 && code < 500;
      resolve({
        success,
        latencyMs: Math.max(1, Date.now() - started),
        responseCode: code,
        message: `${protocol} ${code}${success ? ' yanıtı alındı.' : ' beklenen yanıt değil.'}`,
      });
    });
    request.on('timeout', () => {
      request.destroy();
      resolve({ success: false, latencyMs: null, responseCode: null, message: `${protocol} zaman aşımı.` });
    });
    request.on('error', error => {
      resolve({ success: false, latencyMs: null, responseCode: null, message: `${protocol} bağlantı hatası: ${error.message}` });
    });
    request.end();
  });
}

function snmpValueText(value: unknown): string {
  if (value == null) return '';
  if (Buffer.isBuffer(value)) return value.toString().replace(/\0+$/g, '').trim();
  return String(value).trim();
}

function snmpValueBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
  if (Buffer.isBuffer(value)) {
    let result = 0n;
    for (const byte of value.values()) result = (result << 8n) + BigInt(byte);
    return result;
  }
  const parsed = String(value ?? '').trim();
  if (/^\d+$/.test(parsed)) {
    try { return BigInt(parsed); } catch { return null; }
  }
  return null;
}

function snmpValueNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const big = snmpValueBigInt(value);
  if (big != null && big <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(big);
  const parsed = Number(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function oidIndex(oid: string): number {
  const part = oid.split('.').filter(Boolean).at(-1);
  return Number(part ?? 0);
}

function snmpSessionFor(monitor: any): any {
  const options = {
    port: monitor.snmpPort || 161,
    retries: 1,
    timeout: Math.max(1000, monitor.timeoutMs || 3000),
    transport: 'udp4',
  };

  if (monitor.snmpVersion === '3') {
    const authKey = monitor.snmpAuthKeyEncrypted ? decryptText(monitor.snmpAuthKeyEncrypted) : '';
    const privKey = monitor.snmpPrivKeyEncrypted ? decryptText(monitor.snmpPrivKeyEncrypted) : '';
    const authProtocol = monitor.snmpAuthProtocol === 'MD5'
      ? (snmp as any).AuthProtocols.md5
      : (snmp as any).AuthProtocols.sha;
    const privProtocol = monitor.snmpPrivProtocol === 'DES'
      ? (snmp as any).PrivProtocols.des
      : (snmp as any).PrivProtocols.aes;
    const level = privKey
      ? (snmp as any).SecurityLevel.authPriv
      : authKey
        ? (snmp as any).SecurityLevel.authNoPriv
        : (snmp as any).SecurityLevel.noAuthNoPriv;

    if (!monitor.snmpUsername) throw new Error('SNMP v3 kullanıcı adı tanımlı değil.');
    return (snmp as any).createV3Session(monitor.host, {
      name: monitor.snmpUsername,
      level,
      authProtocol,
      authKey: authKey || undefined,
      privProtocol: privKey ? privProtocol : undefined,
      privKey: privKey || undefined,
    }, options);
  }

  const community = monitor.snmpCommunityEncrypted ? decryptText(monitor.snmpCommunityEncrypted) : '';
  if (!community) throw new Error('SNMP v2c community tanımlı değil.');
  return (snmp as any).createSession(monitor.host, community, {
    ...options,
    version: (snmp as any).Version2c,
  });
}

function snmpGet(session: any, oids: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (error: Error | null, varbinds: any[]) => {
      if (error) { reject(error); return; }
      resolve(varbinds ?? []);
    });
  });
}

function snmpWalk(session: any, baseOid: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const rows: any[] = [];
    const feed = (varbinds: any[]) => {
      for (const varbind of varbinds ?? []) {
        if (!(snmp as any).isVarbindError?.(varbind)) rows.push(varbind);
      }
    };
    session.subtree(baseOid, 20, feed, (error: Error | null) => {
      if (error) { reject(error); return; }
      resolve(rows);
    });
  });
}

function rowsByIndex(rows: any[]): Map<number, any> {
  return new Map(rows.map(row => [oidIndex(String(row.oid ?? '')), row.value]));
}

async function collectSnmpMetrics(monitor: any) {
  const session = snmpSessionFor(monitor);
  try {
    const systemOids = [
      '1.3.6.1.2.1.1.1.0',
      '1.3.6.1.2.1.1.3.0',
      '1.3.6.1.2.1.1.4.0',
      '1.3.6.1.2.1.1.5.0',
      '1.3.6.1.2.1.1.6.0',
    ];
    const [system, cpuRows, storageDescRows, storageAllocRows, storageSizeRows, storageUsedRows,
      ifDescrRows, ifSpeedRows, ifAdminRows, ifOperRows, ifInRows, ifOutRows] = await Promise.all([
      snmpGet(session, systemOids),
      snmpWalk(session, '1.3.6.1.2.1.25.3.3.1.2').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.25.2.3.1.3').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.25.2.3.1.4').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.25.2.3.1.5').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.25.2.3.1.6').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.2.2.1.2').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.2.2.1.5').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.2.2.1.7').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.2.2.1.8').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.2.2.1.10').catch(() => []),
      snmpWalk(session, '1.3.6.1.2.1.2.2.1.16').catch(() => []),
    ]);

    const sysDescr = snmpValueText(system[0]?.value);
    const sysUptimeTicks = snmpValueBigInt(system[1]?.value);
    const sysContact = snmpValueText(system[2]?.value);
    const sysName = snmpValueText(system[3]?.value);
    const sysLocation = snmpValueText(system[4]?.value);

    const cpuValues = cpuRows
      .map(row => snmpValueNumber(row.value))
      .filter((value): value is number => value != null && value >= 0 && value <= 100);
    const cpuPercent = cpuValues.length
      ? Number((cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length).toFixed(2))
      : null;

    const desc = rowsByIndex(storageDescRows);
    const alloc = rowsByIndex(storageAllocRows);
    const sizes = rowsByIndex(storageSizeRows);
    const used = rowsByIndex(storageUsedRows);

    let memoryPercent: number | null = null;
    let diskPercent: number | null = null;
    for (const [index, descriptionValue] of desc) {
      const description = snmpValueText(descriptionValue);
      const allocation = snmpValueNumber(alloc.get(index)) ?? 1;
      const size = snmpValueNumber(sizes.get(index)) ?? 0;
      const usedValue = snmpValueNumber(used.get(index)) ?? 0;
      if (allocation <= 0 || size <= 0) continue;
      const percent = Math.max(0, Math.min(100, Number(((usedValue / size) * 100).toFixed(2))));
      if (/physical memory|ram|memory/i.test(description) && !/virtual/i.test(description)) {
        memoryPercent = memoryPercent == null ? percent : Math.max(memoryPercent, percent);
      } else if (!/virtual memory|ram/i.test(description)) {
        diskPercent = diskPercent == null ? percent : Math.max(diskPercent, percent);
      }
    }

    const ifDescr = rowsByIndex(ifDescrRows);
    const ifSpeed = rowsByIndex(ifSpeedRows);
    const ifAdmin = rowsByIndex(ifAdminRows);
    const ifOper = rowsByIndex(ifOperRows);
    const ifIn = rowsByIndex(ifInRows);
    const ifOut = rowsByIndex(ifOutRows);
    const now = new Date();

    const interfaceSamples = [];
    for (const [index, nameValue] of ifDescr) {
      const inOctets = snmpValueBigInt(ifIn.get(index));
      const outOctets = snmpValueBigInt(ifOut.get(index));
      const previous = await prisma.networkInterfaceSample.findFirst({
        where: { monitorId: monitor.id, interfaceIndex: index },
        orderBy: { createdAt: 'desc' },
      });
      const elapsed = previous ? Math.max(1, (now.getTime() - previous.createdAt.getTime()) / 1000) : 0;
      const wrap = 4294967296n;
      const delta = (current: bigint | null, old: bigint | null) => {
        if (current == null || old == null || elapsed <= 0) return null;
        const raw = current >= old ? current - old : current + wrap - old;
        return Number(raw) * 8 / elapsed;
      };
      const row = {
        branchCode: monitor.branchCode,
        monitorId: monitor.id,
        interfaceIndex: index,
        interfaceName: snmpValueText(nameValue) || `if${index}`,
        adminStatus: snmpValueNumber(ifAdmin.get(index)),
        operStatus: snmpValueNumber(ifOper.get(index)),
        speedBps: snmpValueBigInt(ifSpeed.get(index)),
        inOctets,
        outOctets,
        inBps: delta(inOctets, previous?.inOctets ?? null),
        outBps: delta(outOctets, previous?.outOctets ?? null),
        createdAt: now,
      };
      interfaceSamples.push(row);
    }

    const inferredOperatingSystem =
      /windows/i.test(sysDescr) ? 'WINDOWS' :
      /linux|ubuntu|debian|centos|red hat|freebsd/i.test(sysDescr) ? 'LINUX' :
      /cisco|juniper|forti|router|switch|aruba|huawei|mikrotik|procurve|ios xe|nx-os/i.test(sysDescr) ? 'NETWORK' :
      monitor.operatingSystem;

    const inferredVendor =
      monitor.vendor ||
      (/cisco/i.test(sysDescr) ? 'Cisco' :
       /forti/i.test(sysDescr) ? 'Fortinet' :
       /juniper/i.test(sysDescr) ? 'Juniper' :
       /aruba|procurve|hewlett|hp/i.test(sysDescr) ? 'HPE/Aruba' :
       /huawei/i.test(sysDescr) ? 'Huawei' :
       /mikrotik/i.test(sysDescr) ? 'MikroTik' : '');

    if (
      (monitor.operatingSystem === 'UNKNOWN' && inferredOperatingSystem !== 'UNKNOWN') ||
      (!monitor.vendor && inferredVendor) ||
      (!monitor.location && sysLocation)
    ) {
      await prisma.networkMonitor.update({
        where: { id: monitor.id },
        data: {
          operatingSystem: monitor.operatingSystem === 'UNKNOWN' ? inferredOperatingSystem : monitor.operatingSystem,
          vendor: inferredVendor,
          location: monitor.location || sysLocation,
        },
      });
    }

    const sample = await prisma.networkSnmpSample.create({
      data: {
        branchCode: monitor.branchCode,
        monitorId: monitor.id,
        sysName,
        sysDescr,
        sysLocation,
        sysContact,
        sysUptimeTicks,
        cpuPercent,
        memoryPercent,
        diskPercent,
        createdAt: now,
      },
    });

    if (interfaceSamples.length) {
      await prisma.networkInterfaceSample.createMany({ data: interfaceSamples });
    }

    return {
      ok: true,
      sysName,
      sysDescr,
      sysLocation,
      sysContact,
      sysUptimeTicks: sysUptimeTicks?.toString() ?? null,
      cpuPercent,
      memoryPercent,
      diskPercent,
      interfaces: interfaceSamples.map(row => ({
        interfaceIndex: row.interfaceIndex,
        interfaceName: row.interfaceName,
        adminStatus: row.adminStatus,
        operStatus: row.operStatus,
        speedBps: row.speedBps?.toString() ?? null,
        inBps: row.inBps,
        outBps: row.outBps,
      })),
      createdAt: sample.createdAt.getTime(),
    };
  } finally {
    try { session.close(); } catch {}
  }
}

const snmpRunning = new Set<string>();
async function pollSnmpMonitor(monitorId: string) {
  if (snmpRunning.has(monitorId)) return null;
  snmpRunning.add(monitorId);
  try {
    const monitor = await prisma.networkMonitor.findUnique({ where: { id: monitorId } });
    if (!monitor?.snmpEnabled) return null;
    try {
      return await collectSnmpMetrics(monitor);
    } catch (error) {
      await prisma.networkMonitorEvent.create({
        data: {
          branchCode: monitor.branchCode,
          monitorId,
          status: 'ALARM',
          success: false,
          latencyMs: null,
          message: `SNMP sorgusu başarısız: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000),
        },
      });
      throw error;
    }
  } finally {
    snmpRunning.delete(monitorId);
  }
}

async function probeService(monitor: any, service: any) {
  if (service.protocol === 'HTTP' || service.protocol === 'HTTPS') {
    return httpProbe(monitor.host, service.port, service.path, service.protocol, service.timeoutMs, service.expectedStatus ?? null);
  }
  const result = await tcpProbe(monitor.host, service.port, service.timeoutMs);
  return { ...result, responseCode: null as number | null };
}

const running = new Set<string>();
const serviceRunning = new Set<string>();

async function checkNetworkServices(monitorId: string, notify = true) {
  if (serviceRunning.has(monitorId)) return;
  serviceRunning.add(monitorId);
  try {
    const monitor = await prisma.networkMonitor.findUnique({ where: { id: monitorId } });
    if (!monitor) return;
    const services = await prisma.networkService.findMany({ where: { monitorId, active: true } });

    for (const service of services) {
      const result = await probeService(monitor, service);
      const previousStatus = service.status;
      const failures = result.success ? 0 : service.consecutiveFailures + 1;
      const status = result.success ? 'ONLINE' : failures >= monitor.failureThreshold ? 'OFFLINE' : previousStatus;
      const now = new Date();

      const updated = await prisma.networkService.update({
        where: { id: service.id },
        data: {
          status,
          consecutiveFailures: failures,
          lastLatencyMs: result.latencyMs,
          lastCheckedAt: now,
          lastSuccessAt: result.success ? now : service.lastSuccessAt,
          lastFailureAt: result.success ? service.lastFailureAt : now,
        },
      });

      await prisma.networkServiceSample.create({
        data: {
          branchCode: monitor.branchCode,
          serviceId: service.id,
          success: result.success,
          latencyMs: result.latencyMs,
          responseCode: result.responseCode,
          message: [
            `BAĞLANTI / SERVİS KONTROLÜ`,
            `Cihaz: ${monitor.name} (${monitor.host})`,
            `Servis: ${service.name}`,
            `Protokol/Port: ${service.protocol}/${service.port}`,
            `Sonuç: ${result.success ? 'ERİŞİM VAR' : 'ERİŞİM YOK'}`,
            `Gecikme: ${result.latencyMs == null ? 'ölçülemedi' : `${result.latencyMs} ms`}`,
            result.responseCode == null ? '' : `Yanıt Kodu: ${result.responseCode}`,
            `Detay: ${result.message}`,
          ].filter(Boolean).join(' · ').slice(0, 1000),
        },
      });

      if (notify && status === 'OFFLINE' && previousStatus !== 'OFFLINE') {
        try {
          await sendServiceStatusMail(monitor, updated, 'OFFLINE', result.message);
          await prisma.networkMonitorEvent.create({
            data: {
              branchCode: monitor.branchCode,
              monitorId,
              status: 'ALARM',
              success: false,
              latencyMs: result.latencyMs,
              message: `${service.name} (${service.protocol}/${service.port}) SERVİS YOK · ${result.message}`,
            },
          });
        } catch (error) {
          await prisma.networkMonitorEvent.create({
            data: {
              branchCode: monitor.branchCode,
              monitorId,
              status: 'ALARM',
              success: false,
              latencyMs: null,
              message: `Servis alarm e-postası gönderilemedi: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000),
            },
          });
        }
      }

      if (notify && result.success && previousStatus === 'OFFLINE') {
        try {
          await sendServiceStatusMail(monitor, updated, 'ONLINE', result.message);
        } catch (error) {
          console.error('[NETWORK SERVICE MAIL UP]', error);
        }
      }
    }
  } finally {
    serviceRunning.delete(monitorId);
  }
}

export async function checkNetworkMonitor(id: string, notify = true) {
  if (running.has(id)) return null;
  running.add(id);
  try {
    const monitor = await prisma.networkMonitor.findUnique({ where: { id } });
    if (!monitor) return null;

    const result = await pingHost(monitor.host, monitor.timeoutMs);
    const previousStatus = monitor.status;
    const failures = result.success ? 0 : monitor.consecutiveFailures + 1;
    const effectiveStatus = result.success ? 'ONLINE' : failures >= monitor.failureThreshold ? 'OFFLINE' : previousStatus;
    const now = new Date();

    const updated = await prisma.networkMonitor.update({
      where: { id },
      data: {
        status: effectiveStatus,
        consecutiveFailures: failures,
        lastLatencyMs: result.latencyMs,
        lastCheckedAt: now,
        lastSuccessAt: result.success ? now : monitor.lastSuccessAt,
        lastFailureAt: result.success ? monitor.lastFailureAt : now,
      },
    });

    await prisma.networkMonitorEvent.create({
      data: {
        branchCode: monitor.branchCode,
        monitorId: id,
        status: effectiveStatus,
        success: result.success,
        latencyMs: result.latencyMs,
        message: [
          `PING / ERİŞİM KONTROLÜ`,
          `Cihaz: ${monitor.name}`,
          `Hedef: ${monitor.host}`,
          `Sonuç: ${result.success ? 'ERİŞİM VAR' : 'ERİŞİM YOK'}`,
          `Durum: ${effectiveStatus}`,
          `Gecikme: ${result.latencyMs == null ? 'ölçülemedi' : `${result.latencyMs} ms`}`,
          `Ardışık Hata: ${failures}`,
          `Detay: ${result.message}`,
        ].join(' · ').slice(0, 1000),
      },
    });

    if (notify && effectiveStatus === 'OFFLINE' && monitor.lastNotifiedStatus !== 'OFFLINE') {
      try {
        await sendStatusMail(updated, 'OFFLINE', failures, result.latencyMs);
        await prisma.networkMonitor.update({ where: { id }, data: { lastNotifiedStatus: 'OFFLINE' } });
        await prisma.networkMonitorEvent.create({
          data: {
            branchCode: monitor.branchCode,
            monitorId: id,
            status: 'OFFLINE',
            success: false,
            latencyMs: null,
            message: recipients(updated.emailTo).length
              ? 'ERİŞİM YOK bildirim e-postası gönderildi.'
              : 'ERİŞİM YOK durumu oluştu; bildirim e-posta adresi tanımlı değil.',
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.networkMonitorEvent.create({
          data: {
            branchCode: monitor.branchCode,
            monitorId: id,
            status: 'OFFLINE',
            success: false,
            latencyMs: null,
            message: `ERİŞİM YOK e-postası gönderilemedi: ${message}`.slice(0, 1000),
          },
        });
      }
    }

    if (notify && result.success && previousStatus === 'OFFLINE' && monitor.lastNotifiedStatus === 'OFFLINE') {
      try {
        await sendStatusMail(updated, 'ONLINE', 0, result.latencyMs);
        await prisma.networkMonitor.update({ where: { id }, data: { lastNotifiedStatus: 'ONLINE' } });
      } catch (error) {
        console.error('[NETWORK MONITOR MAIL UP]', error);
      }
    }

    await checkNetworkServices(id, notify).catch(error => console.error('[NETWORK SERVICE CHECK]', error));
    if (result.success && monitor.snmpEnabled) {
      await pollSnmpMonitor(id).catch(error => console.error('[NETWORK SNMP CHECK]', error));
    }
    return serializeMonitor(updated);
  } finally {
    running.delete(id);
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error('Geçersiz IPv4 adresi.');
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function addressesFromCidr(cidr: string): string[] {
  const [ip, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 22 || prefix > 30) {
    throw new Error('MVP keşif güvenliği için CIDR /22 ile /30 arasında olmalıdır. Örnek: 10.20.128.0/24');
  }
  const ipInt = ipv4ToInt(ip);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipInt & mask;
  const count = 2 ** (32 - prefix);
  if (count > 1024) throw new Error('Tek keşifte en fazla 1024 IP taranabilir.');
  const result: string[] = [];
  for (let offset = 1; offset < count - 1; offset += 1) result.push(intToIpv4((network + offset) >>> 0));
  return result;
}

function guessDeviceType(hostname: string): string {
  const h = hostname.toLocaleLowerCase('en-US');
  if (/(router|gateway|gw\b)/.test(h)) return 'ROUTER';
  if (/(switch|sw[-_]?|core[-_]?sw)/.test(h)) return 'SWITCH';
  if (/(printer|print|yazici|yazıcı)/.test(h)) return 'PRINTER';
  if (/(access[-_ ]?point|ap[-_]?\d|wifi)/.test(h)) return 'ACCESS_POINT';
  if (/(firewall|fw[-_]?|forti|palo|asa)/.test(h)) return 'FIREWALL';
  if (/(server|srv[-_]?|sql|dc[-_]?\d)/.test(h)) return 'SERVER';
  if (/(pc[-_]?|desktop|laptop|notebook)/.test(h)) return 'COMPUTER';
  return 'UNKNOWN';
}

async function reverseHostname(ip: string): Promise<string> {
  try {
    const names = await dns.reverse(ip);
    return names[0] ?? '';
  } catch {
    return '';
  }
}

let schedulerStarted = false;
export function startNetworkMonitorScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    try {
      const now = Date.now();
      const monitors = await prisma.networkMonitor.findMany({ where: { active: true } });
      for (const monitor of monitors) {
        const last = monitor.lastCheckedAt?.getTime() ?? 0;
        if (now - last >= monitor.intervalSeconds * 1000) void checkNetworkMonitor(monitor.id, true);
      }

      const cutoff = new Date(Date.now() - 90 * 86400000);
      if (new Date().getHours() === 3 && new Date().getMinutes() < 1) {
        await prisma.networkMonitorEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
        await prisma.networkServiceSample.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
        await prisma.networkSnmpSample.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
        await prisma.networkInterfaceSample.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
      }
    } catch (error) {
      console.error('[NETWORK MONITOR SCHEDULER]', error);
    }
  };

  void tick();
  setInterval(() => void tick(), 5000).unref?.();
}

networkMonitorRouter.get('/topology-workspaces/list', requireAuth, viewPermission, async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.network.canView);
  const rows = await prisma.networkTopologyWorkspace.findMany({
    where: { branchCode: { in: branchCodes } },
    orderBy: [{ branchCode: 'asc' }, { name: 'asc' }],
  });
  res.json(rows.map(row => ({
    id: row.id,
    branchCode: row.branchCode,
    name: row.name,
    description: row.description,
    createdByName: row.createdByName,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  })));
});

networkMonitorRouter.get('/topology-workspaces/:workspaceId', requireAuth, viewPermission, async (req, res) => {
  const id = String(req.params.workspaceId);
  const row = await prisma.networkTopologyWorkspace.findUnique({ where: { id } });
  if (!row) { res.status(404).json({ error: 'Ağ mimarisi çalışma alanı bulunamadı.' }); return; }
  await assertBranchPermission(req, row.branchCode, permissions => permissions.network.canView);
  res.json({
    id: row.id,
    branchCode: row.branchCode,
    name: row.name,
    description: row.description,
    layout: JSON.parse(row.layoutJson),
    createdByName: row.createdByName,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  });
});

networkMonitorRouter.post('/topology-workspaces', requireAuth, createPermission, async (req: AuthRequest, res) => {
  const input = topologyWorkspaceSchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.network.canCreate,'Bu şubede Network çalışma alanı oluşturma yetkiniz yok.');
  const row = await prisma.networkTopologyWorkspace.create({
    data: {
      branchCode,
      name: input.name,
      description: input.description,
      layoutJson: JSON.stringify(input.layout),
      createdById: req.authUser!.id,
      createdByName: req.authUser!.displayName,
    },
  });
  await prisma.auditLog.create({
    data: {
      branchCode,
      userId: req.authUser!.id,
      username: req.authUser!.username,
      displayName: req.authUser!.displayName,
      action: 'CREATE',
      module: 'NETWORK_TOPOLOGY',
      recordId: row.id,
      recordLabel: row.name,
      description: `Network İzleme modülünde “${row.name}” ağ mimarisi çalışma alanı oluşturuldu.`,
      newData: row.layoutJson,
      ipAddress: String(req.ip ?? ''),
      userAgent: String(req.headers['user-agent'] ?? ''),
    },
  }).catch(() => undefined);
  res.status(201).json({ id: row.id, branchCode, name: row.name, description: row.description, layout: input.layout, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

networkMonitorRouter.put('/topology-workspaces/:workspaceId', requireAuth, editPermission, async (req: AuthRequest, res) => {
  const id = String(req.params.workspaceId);
  const before = await prisma.networkTopologyWorkspace.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Ağ mimarisi çalışma alanı bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.network.canEdit);
  const input = topologyWorkspaceSchema.parse(req.body);
  const row = await prisma.networkTopologyWorkspace.update({
    where: { id },
    data: { name: input.name, description: input.description, layoutJson: JSON.stringify(input.layout) },
  });
  await prisma.auditLog.create({
    data: {
      branchCode: row.branchCode,
      userId: req.authUser!.id,
      username: req.authUser!.username,
      displayName: req.authUser!.displayName,
      action: 'UPDATE',
      module: 'NETWORK_TOPOLOGY',
      recordId: row.id,
      recordLabel: row.name,
      description: `Network İzleme modülünde “${row.name}” ağ mimarisi düzenlendi. Düğüm: ${input.layout.nodes.length}, bağlantı: ${input.layout.links.length}.`,
      oldData: before.layoutJson,
      newData: row.layoutJson,
      ipAddress: String(req.ip ?? ''),
      userAgent: String(req.headers['user-agent'] ?? ''),
    },
  }).catch(() => undefined);
  res.json({ id: row.id, branchCode: row.branchCode, name: row.name, description: row.description, layout: input.layout, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
});

networkMonitorRouter.delete('/topology-workspaces/:workspaceId', requireAuth, deletePermission, async (req: AuthRequest, res) => {
  const id = String(req.params.workspaceId);
  const row = await prisma.networkTopologyWorkspace.findUnique({ where: { id } });
  if (!row) { res.status(404).json({ error: 'Ağ mimarisi çalışma alanı bulunamadı.' }); return; }
  await assertBranchPermission(req, row.branchCode, permissions => permissions.network.canDelete);
  await prisma.networkTopologyWorkspace.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      branchCode: row.branchCode,
      userId: req.authUser!.id,
      username: req.authUser!.username,
      displayName: req.authUser!.displayName,
      action: 'DELETE',
      module: 'NETWORK_TOPOLOGY',
      recordId: row.id,
      recordLabel: row.name,
      description: `Network İzleme modülünde “${row.name}” ağ mimarisi çalışma alanı silindi.`,
      oldData: row.layoutJson,
      ipAddress: String(req.ip ?? ''),
      userAgent: String(req.headers['user-agent'] ?? ''),
    },
  }).catch(() => undefined);
  res.status(204).end();
});

networkMonitorRouter.get('/summary', requireAuth, viewPermission, async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.network.canView);
  const since24h = new Date(Date.now() - 24 * 3600000);
  const since1h = new Date(Date.now() - 3600000);

  const [monitors, serviceRows, alarms, avgLatency] = await Promise.all([
    prisma.networkMonitor.findMany({ where: { branchCode: { in: branchCodes } } }),
    prisma.networkService.findMany({ where: { branchCode: { in: branchCodes }, active: true } }),
    prisma.networkMonitorEvent.findMany({
      where: {
        branchCode: { in: branchCodes },
        createdAt: { gte: since24h },
        OR: [{ status: 'ALARM' }, { status: 'OFFLINE' }],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.networkMonitorEvent.aggregate({
      where: { branchCode: { in: branchCodes }, success: true, createdAt: { gte: since1h }, latencyMs: { not: null } },
      _avg: { latencyMs: true },
    }),
  ]);

  res.json({
    total: monitors.length,
    online: monitors.filter(item => item.status === 'ONLINE').length,
    offline: monitors.filter(item => item.status === 'OFFLINE').length,
    unknown: monitors.filter(item => item.status === 'UNKNOWN').length,
    active: monitors.filter(item => item.active).length,
    servicesTotal: serviceRows.length,
    servicesOnline: serviceRows.filter(item => item.status === 'ONLINE').length,
    servicesOffline: serviceRows.filter(item => item.status === 'OFFLINE').length,
    averageLatencyMs: Math.round(avgLatency._avg.latencyMs ?? 0),
    alarms24h: alarms.length,
    recentAlarms: alarms.map(row => ({
      id: row.id,
      monitorId: row.monitorId,
      status: row.status,
      message: row.message,
      createdAt: row.createdAt.getTime(),
    })),
  });
});

networkMonitorRouter.post('/discover', requireAuth, createPermission, async (req: AuthRequest, res) => {
  const input = discoverySchema.parse(req.body);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.network.canCreate,'Bu şubede Network keşfi başlatma yetkiniz yok.');
  const addresses = addressesFromCidr(input.cidr);
  const existing = await prisma.networkMonitor.findMany({
    where: { branchCode },
    select: { host: true },
  });
  const existingHosts = new Set(existing.map(item => item.host));
  const results: Array<{
    ip: string;
    hostname: string;
    latencyMs: number | null;
    deviceType: string;
    alreadyMonitored: boolean;
  }> = [];

  const concurrency = 24;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, addresses.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= addresses.length) return;
      const ip = addresses[index];
      const ping = await pingHost(ip, input.timeoutMs);
      if (!ping.success) continue;
      const hostname = await reverseHostname(ip);
      results.push({
        ip,
        hostname,
        latencyMs: ping.latencyMs,
        deviceType: guessDeviceType(hostname),
        alreadyMonitored: existingHosts.has(ip) || (hostname ? existingHosts.has(hostname) : false),
      });
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => ipv4ToInt(a.ip) - ipv4ToInt(b.ip));
  res.json({ cidr: input.cidr, scanned: addresses.length, found: results.length, results });
});

networkMonitorRouter.get('/', requireAuth, viewPermission, async (req, res) => {
  const branchCodes = await readBranchCodesForPermission(req, permissions => permissions.network.canView);
  const rows = await prisma.networkMonitor.findMany({
    where: { branchCode: { in: branchCodes } },
    include: { services: { where: { active: true }, orderBy: { port: 'asc' } } },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
  res.json(rows.map(row => ({
    ...serializeMonitor(row),
    services: row.services.map(serializeService),
  })));
});

networkMonitorRouter.post('/', requireAuth, createPermission, async (req: AuthRequest, res) => {
  const input = monitorSchema.parse(req.body);
  const data = monitorWriteData(input);
  const branchCode = await writeBranchCode(req);
  await assertBranchPermission(req,branchCode,p=>p.network.canCreate,'Bu şubede Network izleme kaydı oluşturma yetkiniz yok.');
  const row = await prisma.networkMonitor.create({
    data: {
      ...data,
      branchCode,
      createdById: req.authUser!.id,
      createdByName: req.authUser!.displayName,
    },
  });
  res.status(201).json(serializeMonitor(row));
});

networkMonitorRouter.put('/:id', requireAuth, editPermission, async (req, res) => {
  const input = monitorSchema.parse(req.body);
  const id = String(req.params.id);
  const before = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.network.canEdit);
  const data = monitorWriteData(input, before);
  const row = await prisma.networkMonitor.update({ where: { id }, data });
  res.json(serializeMonitor(row));
});

networkMonitorRouter.delete('/:id', requireAuth, deletePermission, async (req, res) => {
  const id = String(req.params.id);
  const before = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.network.canDelete);
  await prisma.networkMonitor.delete({ where: { id } });
  res.status(204).end();
});

networkMonitorRouter.post('/:id/test', requireAuth, testPermission, async (req, res) => {
  const id = String(req.params.id);
  const before = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!before) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.network.canExcel);
  const row = await checkNetworkMonitor(id, false);
  if (!row) {
    res.status(404).json({ error: 'Network tanımı bulunamadı.' });
    return;
  }
  res.json(row);
});

networkMonitorRouter.get('/:id/events', requireAuth, viewPermission, async (req, res) => {
  const id = String(req.params.id);
  const monitor = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!monitor) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, monitor.branchCode, permissions => permissions.network.canView);
  const rows = await prisma.networkMonitorEvent.findMany({
    where: { monitorId: id, branchCode: monitor.branchCode },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json(rows.map(row => ({ ...row, createdAt: row.createdAt.getTime() })));
});

networkMonitorRouter.get('/:id/metrics', requireAuth, viewPermission, async (req, res) => {
  const id = String(req.params.id);
  const hours = Math.min(720, Math.max(1, Number(req.query.hours ?? 24) || 24));
  const monitor = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!monitor) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, monitor.branchCode, permissions => permissions.network.canView);

  const since = new Date(Date.now() - hours * 3600000);
  const rows = await prisma.networkMonitorEvent.findMany({
    where: { monitorId: id, createdAt: { gte: since }, message: { contains: 'ICMP' } },
    orderBy: { createdAt: 'asc' },
  });

  const total = rows.length;
  const successful = rows.filter(row => row.success).length;
  const failed = total - successful;
  const latencyValues = rows.map(row => row.latencyMs).filter((value): value is number => value != null);
  const avgLatency = latencyValues.length ? Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length) : 0;
  const maxLatency = latencyValues.length ? Math.max(...latencyValues) : 0;
  const packetLossPercent = total ? Number(((failed / total) * 100).toFixed(2)) : 0;
  const uptimePercent = total ? Number(((successful / total) * 100).toFixed(2)) : 0;
  const downtimeMinutes = Number(((failed * monitor.intervalSeconds) / 60).toFixed(1));

  const maxPoints = 360;
  const step = Math.max(1, Math.ceil(rows.length / maxPoints));
  const samples = rows.filter((_, index) => index % step === 0).map(row => ({
    at: row.createdAt.getTime(),
    success: row.success,
    latencyMs: row.latencyMs,
  }));

  res.json({
    hours,
    totalSamples: total,
    uptimePercent,
    packetLossPercent,
    downtimeMinutes,
    avgLatencyMs: avgLatency,
    maxLatencyMs: maxLatency,
    samples,
  });
});

networkMonitorRouter.post('/:id/snmp/test', requireAuth, testPermission, async (req, res) => {
  const id = String(req.params.id);
  const monitor = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!monitor) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, monitor.branchCode, permissions => permissions.network.canExcel);
  if (!monitor.snmpEnabled) { res.status(400).json({ error: 'Bu cihaz için SNMP etkin değil.' }); return; }
  try {
    res.json(await collectSnmpMetrics(monitor));
  } catch (error) {
    res.status(502).json({ error: `SNMP test başarısız: ${error instanceof Error ? error.message : String(error)}` });
  }
});

networkMonitorRouter.get('/:id/snmp', requireAuth, viewPermission, async (req, res) => {
  const id = String(req.params.id);
  const hours = Math.min(720, Math.max(1, Number(req.query.hours ?? 24) || 24));
  const monitor = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!monitor) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, monitor.branchCode, permissions => permissions.network.canView);
  const since = new Date(Date.now() - hours * 3600000);
  const [samples, latestInterfaces] = await Promise.all([
    prisma.networkSnmpSample.findMany({
      where: { monitorId: id, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    }),
    prisma.networkInterfaceSample.findMany({
      where: { monitorId: id },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
  ]);

  const latestByIndex = new Map<number, any>();
  for (const row of latestInterfaces) {
    if (!latestByIndex.has(row.interfaceIndex)) latestByIndex.set(row.interfaceIndex, row);
  }

  res.json({
    enabled: monitor.snmpEnabled,
    version: monitor.snmpVersion,
    latest: samples.length ? {
      ...samples[samples.length - 1],
      sysUptimeTicks: samples[samples.length - 1].sysUptimeTicks?.toString() ?? null,
      createdAt: samples[samples.length - 1].createdAt.getTime(),
    } : null,
    samples: samples.map(row => ({
      cpuPercent: row.cpuPercent,
      memoryPercent: row.memoryPercent,
      diskPercent: row.diskPercent,
      createdAt: row.createdAt.getTime(),
    })),
    interfaces: [...latestByIndex.values()].map(row => ({
      interfaceIndex: row.interfaceIndex,
      interfaceName: row.interfaceName,
      adminStatus: row.adminStatus,
      operStatus: row.operStatus,
      speedBps: row.speedBps?.toString() ?? null,
      inBps: row.inBps,
      outBps: row.outBps,
      createdAt: row.createdAt.getTime(),
    })).sort((a, b) => a.interfaceIndex - b.interfaceIndex),
  });
});

networkMonitorRouter.get('/:id/remote/rdp', requireAuth, viewPermission, async (req, res) => {
  const id = String(req.params.id);
  const monitor = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!monitor) { res.status(404).send('Network tanımı bulunamadı.'); return; }
  await assertBranchPermission(req, monitor.branchCode, permissions => permissions.network.canView);
  const safeName = monitor.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  res.setHeader('Content-Type', 'application/x-rdp');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.rdp"`);
  res.send([
    `full address:s:${monitor.host}`,
    'prompt for credentials:i:1',
    'administrative session:i:0',
    'screen mode id:i:2',
    'use multimon:i:0',
    'authentication level:i:2',
    'enablecredsspsupport:i:1',
  ].join('\\r\\n'));
});

networkMonitorRouter.get('/:id/services', requireAuth, viewPermission, async (req, res) => {
  const id = String(req.params.id);
  const monitor = await prisma.networkMonitor.findUnique({ where: { id } });
  if (!monitor) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, monitor.branchCode, permissions => permissions.network.canView);
  const rows = await prisma.networkService.findMany({ where: { monitorId: id }, orderBy: [{ active: 'desc' }, { port: 'asc' }] });
  res.json(rows.map(serializeService));
});

networkMonitorRouter.post('/:id/services', requireAuth, editPermission, async (req, res) => {
  const monitorId = String(req.params.id);
  const monitor = await prisma.networkMonitor.findUnique({ where: { id: monitorId } });
  if (!monitor) { res.status(404).json({ error: 'Network tanımı bulunamadı.' }); return; }
  await assertBranchPermission(req, monitor.branchCode, permissions => permissions.network.canEdit);
  const data = serviceSchema.parse(req.body);
  const row = await prisma.networkService.create({ data: { ...data, monitorId, branchCode: monitor.branchCode } });
  res.status(201).json(serializeService(row));
});

networkMonitorRouter.put('/services/:serviceId', requireAuth, editPermission, async (req, res) => {
  const serviceId = String(req.params.serviceId);
  const before = await prisma.networkService.findUnique({ where: { id: serviceId }, include: { monitor: true } });
  if (!before) { res.status(404).json({ error: 'Servis bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.network.canEdit);
  const data = serviceSchema.parse(req.body);
  const row = await prisma.networkService.update({ where: { id: serviceId }, data });
  res.json(serializeService(row));
});

networkMonitorRouter.delete('/services/:serviceId', requireAuth, editPermission, async (req, res) => {
  const serviceId = String(req.params.serviceId);
  const before = await prisma.networkService.findUnique({ where: { id: serviceId } });
  if (!before) { res.status(404).json({ error: 'Servis bulunamadı.' }); return; }
  await assertBranchPermission(req, before.branchCode, permissions => permissions.network.canEdit);
  await prisma.networkService.delete({ where: { id: serviceId } });
  res.status(204).end();
});

networkMonitorRouter.post('/services/:serviceId/test', requireAuth, testPermission, async (req, res) => {
  const serviceId = String(req.params.serviceId);
  const service = await prisma.networkService.findUnique({ where: { id: serviceId }, include: { monitor: true } });
  if (!service) { res.status(404).json({ error: 'Servis bulunamadı.' }); return; }
  await assertBranchPermission(req, service.branchCode, permissions => permissions.network.canExcel);
  const result = await probeService(service.monitor, service);
  res.json(result);
});
