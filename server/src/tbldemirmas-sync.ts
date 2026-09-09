import crypto from 'node:crypto';
import sql from 'mssql';
import { prisma } from './db.js';
import { decryptText } from './crypto.js';

const TURKISH_MOJIBAKE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['Ã„Â°', 'İ'], ['Ã„Â±', 'ı'], ['Ã…Âž', 'Ş'], ['Ã…ÂŸ', 'ş'], ['Ã„Âž', 'Ğ'], ['Ã„ÂŸ', 'ğ'],
  ['ÃƒÂ‡', 'Ç'], ['ÃƒÂ§', 'ç'], ['ÃƒÂ–', 'Ö'], ['ÃƒÂ¶', 'ö'], ['ÃƒÂœ', 'Ü'], ['ÃƒÂ¼', 'ü'],
  ['Ä°', 'İ'], ['Ä±', 'ı'], ['Åž', 'Ş'], ['ÅŸ', 'ş'], ['Äž', 'Ğ'], ['ÄŸ', 'ğ'],
  ['Ã‡', 'Ç'], ['Ã§', 'ç'], ['Ã–', 'Ö'], ['Ã¶', 'ö'], ['Ãœ', 'Ü'], ['Ã¼', 'ü'],
  ['Ý', 'İ'], ['ý', 'ı'], ['Þ', 'Ş'], ['þ', 'ş'], ['Ð', 'Ğ'], ['ð', 'ğ'],
  ['â€“', '–'], ['â€”', '—'], ['â€™', '’'], ['â€œ', '“'], ['â€', '”'], ['Â ', ' '], ['Â', ''],
];

function repairTurkishText(value: string): string {
  let result = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const before = result;
    for (const [broken, correct] of TURKISH_MOJIBAKE_REPLACEMENTS) {
      result = result.split(broken).join(correct);
    }
    if (result === before) break;
  }
  return result.normalize('NFC');
}

type DemirbasRow = {
  SIRKET_KODU: unknown;
  DEMIR_KODU: unknown;
  DEMIR_ISMI: unknown;
  ALIS_TARIHI: unknown;
  BITIS_YILI: unknown;
  ALIS_BELGENO: unknown;
  SATICI: unknown;
  TOPLAM_MIKTAR: unknown;
  RES_BELGE_NO: unknown;
  GRUP_KODU: unknown;
  SATIS_TARIHI: unknown;
};

function asText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return repairTurkishText(String(value).trim());
}

function asDateText(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? asText(value) : parsed.toISOString().slice(0, 10);
}

function asQuantity(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function fingerprint(row: DemirbasRow): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    SIRKET_KODU: asText(row.SIRKET_KODU),
    DEMIR_KODU: asText(row.DEMIR_KODU),
    DEMIR_ISMI: asText(row.DEMIR_ISMI),
    ALIS_TARIHI: asDateText(row.ALIS_TARIHI),
    BITIS_YILI: asText(row.BITIS_YILI),
    ALIS_BELGENO: asText(row.ALIS_BELGENO),
    SATICI: asText(row.SATICI),
    TOPLAM_MIKTAR: asQuantity(row.TOPLAM_MIKTAR),
    RES_BELGE_NO: asText(row.RES_BELGE_NO),
    GRUP_KODU: asText(row.GRUP_KODU),
    SATIS_TARIHI: asDateText(row.SATIS_TARIHI),
  })).digest('hex');
}

async function openPool(connection: any): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool({
    user: connection.username,
    password: connection.passwordEncrypted ? decryptText(connection.passwordEncrypted) : '',
    server: connection.host,
    port: connection.port,
    database: connection.database,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 3, min: 0, idleTimeoutMillis: 15000 },
    connectionTimeout: 10000,
    requestTimeout: 180000,
  });
  await pool.connect();
  return pool;
}

export async function syncTblDemirmasConnection(connectionId: string, force = false) {
  const connection = await prisma.assetExternalConnection.findUnique({ where: { id: connectionId } });
  if (!connection || (!connection.enabled && !force) || connection.type.toUpperCase() !== 'MSSQL') {
    return { scanned: 0, fetched: 0, created: 0, updated: 0, unchanged: 0, protectedOperis: 0 };
  }

  const cachedRowsForRepair = await prisma.asset.findMany({
    where: {
      branchCode: connection.branchCode,
      externalSource: `MSSQL:${connection.id}:dbo.TBLDEMIRMAS`,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      sourceSirketKodu: true,
      sourceBitisYili: true,
      sourceAlisBelgeNo: true,
      sourceSatici: true,
      sourceResBelgeNo: true,
      sourceGrupKodu: true,
    },
  });

  for (const local of cachedRowsForRepair) {
    const repaired = {
      name: repairTurkishText(local.name),
      sourceSirketKodu: repairTurkishText(local.sourceSirketKodu),
      sourceBitisYili: repairTurkishText(local.sourceBitisYili),
      sourceAlisBelgeNo: repairTurkishText(local.sourceAlisBelgeNo),
      sourceSatici: repairTurkishText(local.sourceSatici),
      sourceResBelgeNo: repairTurkishText(local.sourceResBelgeNo),
      sourceGrupKodu: repairTurkishText(local.sourceGrupKodu),
    };
    if (
      repaired.name !== local.name ||
      repaired.sourceSirketKodu !== local.sourceSirketKodu ||
      repaired.sourceBitisYili !== local.sourceBitisYili ||
      repaired.sourceAlisBelgeNo !== local.sourceAlisBelgeNo ||
      repaired.sourceSatici !== local.sourceSatici ||
      repaired.sourceResBelgeNo !== local.sourceResBelgeNo ||
      repaired.sourceGrupKodu !== local.sourceGrupKodu
    ) {
      await prisma.asset.update({ where: { id: local.id }, data: repaired });
    }
  }

  const pool = await openPool(connection);
  try {
    const permission = await pool.request().query<{ allowed: number }>(`
      SELECT CASE WHEN HAS_PERMS_BY_NAME('dbo.TBLDEMIRMAS','OBJECT','SELECT') = 1 THEN 1 ELSE 0 END AS allowed
    `);
    if (Number(permission.recordset[0]?.allowed ?? 0) !== 1) {
      throw new Error('SQL kullanıcısının dbo.TBLDEMIRMAS tablosunda SELECT yetkisi yok.');
    }

    const sourceName = `MSSQL:${connection.id}:dbo.TBLDEMIRMAS`;
    const existingRows = await prisma.asset.findMany({
      where: {
        branchCode: connection.branchCode,
        externalSource: sourceName,
        deletedAt: null,
      },
      select: {
        id: true,
        externalId: true,
        sourceFingerprint: true,
        name: true,
        sourceSirketKodu: true,
        sourceBitisYili: true,
        sourceAlisBelgeNo: true,
        sourceSatici: true,
        sourceResBelgeNo: true,
        sourceGrupKodu: true,
      },
    });
    const existingByCode = new Map(existingRows.map(row => [row.externalId, row]));

    let legacyTurkishRepairCount = 0;
    for (const local of existingRows) {
      const repaired = {
        name: repairTurkishText(local.name),
        sourceSirketKodu: repairTurkishText(local.sourceSirketKodu),
        sourceBitisYili: repairTurkishText(local.sourceBitisYili),
        sourceAlisBelgeNo: repairTurkishText(local.sourceAlisBelgeNo),
        sourceSatici: repairTurkishText(local.sourceSatici),
        sourceResBelgeNo: repairTurkishText(local.sourceResBelgeNo),
        sourceGrupKodu: repairTurkishText(local.sourceGrupKodu),
      };
      if (
        repaired.name !== local.name ||
        repaired.sourceSirketKodu !== local.sourceSirketKodu ||
        repaired.sourceBitisYili !== local.sourceBitisYili ||
        repaired.sourceAlisBelgeNo !== local.sourceAlisBelgeNo ||
        repaired.sourceSatici !== local.sourceSatici ||
        repaired.sourceResBelgeNo !== local.sourceResBelgeNo ||
        repaired.sourceGrupKodu !== local.sourceGrupKodu
      ) {
        await prisma.asset.update({ where: { id: local.id }, data: repaired });
        legacyTurkishRepairCount += 1;
      }
    }

    // 1. aşama: SQL'den yalnız anahtar + fingerprint alınır.
    // Tam satırlar yalnız fingerprint değişmişse veya kayıt yeniyse çekilir.
    const sourceIndex = await pool.request().query<{ DEMIR_KODU: string; SOURCE_FP: string }>(`
      SELECT
        CONVERT(nvarchar(255), DEMIR_KODU) AS DEMIR_KODU,
        LOWER(CONVERT(varchar(64), HASHBYTES('SHA2_256',
          CONVERT(varbinary(max), CONCAT(
            ISNULL(CONVERT(nvarchar(max), SIRKET_KODU), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), DEMIR_KODU), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), DEMIR_ISMI), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(40), TRY_CONVERT(datetime2, ALIS_TARIHI), 126), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), BITIS_YILI), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), ALIS_BELGENO), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), SATICI), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), TOPLAM_MIKTAR), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), RES_BELGE_NO), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), GRUP_KODU), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(40), TRY_CONVERT(datetime2, SATIS_TARIHI), 126), N'')
          ))
        ), 2)) AS SOURCE_FP
      FROM dbo.TBLDEMIRMAS
      WHERE DEMIR_KODU IS NOT NULL
    `);

    const fingerprintByCode = new Map<string, string>();
    for (const item of sourceIndex.recordset) {
      const code = repairTurkishText(String(item.DEMIR_KODU ?? '').trim());
      if (code) fingerprintByCode.set(code, String(item.SOURCE_FP ?? '').toLowerCase());
    }

    const changedCodes = [...fingerprintByCode.entries()]
      .filter(([code, sourceFingerprint]) => existingByCode.get(code)?.sourceFingerprint !== sourceFingerprint)
      .map(([code]) => code);

    const changedRows: DemirbasRow[] = [];
    const BATCH_SIZE = 500;

    for (let offset = 0; offset < changedCodes.length; offset += BATCH_SIZE) {
      const batch = changedCodes.slice(offset, offset + BATCH_SIZE);
      const request = pool.request();
      const params = batch.map((code, index) => {
        const name = `code${index}`;
        request.input(name, sql.NVarChar(255), code);
        return `@${name}`;
      });

      const result = await request.query<DemirbasRow>(`
        SELECT
          SIRKET_KODU,
          DEMIR_KODU,
          DEMIR_ISMI,
          ALIS_TARIHI,
          BITIS_YILI,
          ALIS_BELGENO,
          SATICI,
          TOPLAM_MIKTAR,
          RES_BELGE_NO,
          GRUP_KODU,
          SATIS_TARIHI
        FROM dbo.TBLDEMIRMAS
        WHERE CONVERT(nvarchar(255), DEMIR_KODU) IN (${params.join(',')})
        ORDER BY TRY_CONVERT(bigint, DEMIR_KODU) DESC, DEMIR_KODU DESC
      `);
      changedRows.push(...result.recordset);
    }

    let created = 0;
    let updated = 0;
    let protectedOperis = 0;
    const unchanged = Math.max(0, fingerprintByCode.size - changedCodes.length);
    const now = new Date();

    for (const row of changedRows) {
      const demirKodu = asText(row.DEMIR_KODU);
      if (!demirKodu) continue;

      const sourceFingerprint = fingerprintByCode.get(demirKodu) ?? fingerprint(row);
      const existing = existingByCode.get(demirKodu) ?? null;

      if (!existing) {
        // Operis kullanıcısının MANUAL / başka kaynak kaydı hiçbir zaman ezilmez.
        const existingCodeOwner = await prisma.asset.findUnique({
          where: { assetCode: demirKodu },
        });
        if (existingCodeOwner) {
          protectedOperis += 1;
          continue;
        }
      }

      const sourceData = {
        assetCode: demirKodu,
        externalSource: sourceName,
        externalId: demirKodu,
        name: asText(row.DEMIR_ISMI) || demirKodu,
        purchaseDate: asDateText(row.ALIS_TARIHI),
        quantity: asQuantity(row.TOPLAM_MIKTAR),
        sourceSirketKodu: asText(row.SIRKET_KODU),
        sourceBitisYili: asText(row.BITIS_YILI),
        sourceAlisBelgeNo: asText(row.ALIS_BELGENO),
        sourceSatici: asText(row.SATICI),
        sourceResBelgeNo: asText(row.RES_BELGE_NO),
        sourceGrupKodu: asText(row.GRUP_KODU),
        sourceSatisTarihi: asDateText(row.SATIS_TARIHI),
        sourceFingerprint,
        sourceSyncedAt: now,
      };

      if (!existing) {
        await prisma.asset.create({
          data: {
            branchCode: connection.branchCode,
            ...sourceData,
            sourceChangedAt: now,
            status: 'ACTIVE',
            createdById: 'SYSTEM:TBLDEMIRMAS',
            createdByName: 'TBLDEMIRMAS Otomatik Senkron',
          },
        });
        created += 1;
        continue;
      }

      await prisma.asset.update({
        where: { id: existing.id },
        data: { ...sourceData, sourceChangedAt: now },
      });
      updated += 1;
    }

    await prisma.assetExternalConnection.update({
      where: { id: connection.id },
      data: {
        lastTestAt: now,
        lastTestResult:
          `TBLDEMIRMAS INCREMENTAL OK | kontrol:${fingerprintByCode.size} getirilen:${changedRows.length} ` +
          `yeni:${created} güncel:${updated} değişmeyen:${unchanged} korunan-operis:${protectedOperis} tr-duzeltme:${legacyTurkishRepairCount}`,
      },
    });

    return {
      scanned: fingerprintByCode.size,
      fetched: changedRows.length,
      created,
      updated,
      unchanged,
      protectedOperis,
    };
  } finally {
    await pool.close().catch(() => undefined);
  }
}

let tblDemirmasSchedulerStarted = false;

export function startTblDemirmasHourlyScheduler() {
  if (tblDemirmasSchedulerStarted) return;
  tblDemirmasSchedulerStarted = true;

  let lastHourKey = '';

  const tick = async () => {
    const now = new Date();
    const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;

    // Her saat başında ilk 5 dakika içinde yalnız bir kez çalışır.
    if (now.getMinutes() > 4 || hourKey === lastHourKey) return;
    lastHourKey = hourKey;

    const connections = await prisma.assetExternalConnection.findMany({
      where: { enabled: true, type: 'MSSQL' },
      orderBy: { createdAt: 'asc' },
    });

    for (const connection of connections) {
      try {
        await syncTblDemirmasConnection(connection.id);
      } catch (error) {
        console.error(`[TBLDEMIRMAS SYNC] ${connection.name}`, error);
      }
    }
  };

  void tick();
  setInterval(() => void tick(), 60_000).unref?.();
}
