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

type SaleRow = {
  SIRKET_KODU: unknown; DEMIR_KODU: unknown; TARIH: unknown; BELGE_NO: unknown;
  ALICI: unknown; SATIS_MIKTARI: unknown; ACIKLAMA: unknown;
};

const text = (v: unknown) => v == null ? '' : v instanceof Date ? v.toISOString().slice(0,10) : repairTurkishText(String(v).trim());
const amount = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
function saleStableKey(values: {
  sirketKodu: string;
  demirKodu: string;
  tarih: string;
  belgeNo: string;
}): string {
  return crypto.createHash('sha256')
    .update([values.sirketKodu, values.demirKodu, values.tarih, values.belgeNo].join('|'))
    .digest('hex');
}

const fp = (r: SaleRow) => crypto.createHash('sha256').update(JSON.stringify({
  SIRKET_KODU:text(r.SIRKET_KODU), DEMIR_KODU:text(r.DEMIR_KODU), TARIH:text(r.TARIH),
  BELGE_NO:text(r.BELGE_NO), ALICI:text(r.ALICI), SATIS_MIKTARI:amount(r.SATIS_MIKTARI), ACIKLAMA:text(r.ACIKLAMA)
})).digest('hex');

function normalizeAssetCode(value: string): string {
  const text = repairTurkishText(String(value ?? '').trim())
    .replace(/\s+/g, '')
    .toLocaleUpperCase('tr-TR');

  if (/^\d+$/.test(text)) {
    try {
      return BigInt(text).toString();
    } catch {
      return text.replace(/^0+(?=\d)/, '');
    }
  }

  return text;
}

async function markAssetsAsSoldFromCodes(branchCode: string, assetCodes: string[]): Promise<number> {
  const sourceCodes = [...new Set(assetCodes.map(code => String(code ?? '').trim()).filter(Boolean))];
  if (sourceCodes.length === 0) return 0;

  const saleCodeKeys = new Set(sourceCodes.map(normalizeAssetCode).filter(Boolean));

  // Satış kaydındaki DEMIR_KODU ile Operis assetCode birebir aynı formatta gelmeyebilir.
  // Örn. SQL 000123, Operis 123 tutuyorsa sayısal anahtarla güvenli eşleştirme yapılır.
  const branchAssets = await prisma.asset.findMany({
    where: {
      branchCode,
      deletedAt: null,
      status: { not: 'SALE' },
    },
    select: {
      id: true,
      branchCode: true,
      assetCode: true,
      status: true,
    },
  });

  const matchingAssets = branchAssets.filter(asset =>
    saleCodeKeys.has(normalizeAssetCode(asset.assetCode))
  );

  let marked = 0;
  for (const asset of matchingAssets) {
    await prisma.$transaction([
      prisma.asset.update({
        where: { id: asset.id },
        data: { status: 'SALE' },
      }),
      prisma.assetMovement.create({
        data: {
          branchCode: asset.branchCode,
          assetId: asset.id,
          action: 'STATUS_CHANGE',
          fromName: asset.status,
          toName: 'SALE',
          userId: 'SYSTEM:TBLDEMSATIS',
          userName: 'TBLDEMSATIS Otomatik Senkron',
          note: `dbo.TBLDEMSATIS satış kaydı ile otomatik Satış durumuna alındı. Demirbaş Kodu: ${asset.assetCode}`,
        },
      }),
    ]);
    marked += 1;
  }

  return marked;
}

export async function syncTblDemSatisConnection(connectionId: string, force = false) {
  const c = await prisma.assetExternalConnection.findUnique({ where:{ id:connectionId } });
  if (!c || (!c.enabled && !force) || c.type.toUpperCase() !== 'MSSQL') {
    return { scanned:0, fetched:0, created:0, updated:0, unchanged:0, autoMarkedSales:0 };
  }

  const cachedSalesForRepair=await prisma.assetSaleExternal.findMany({
    where:{connectionId:c.id},
    select:{id:true,sirketKodu:true,demirKodu:true,alici:true,aciklama:true},
  });
  for(const row of cachedSalesForRepair){
    const sirketKodu=repairTurkishText(row.sirketKodu);
    const alici=repairTurkishText(row.alici);
    const aciklama=repairTurkishText(row.aciklama);
    if(sirketKodu!==row.sirketKodu || alici!==row.alici || aciklama!==row.aciklama){
      await prisma.assetSaleExternal.update({
        where:{id:row.id},
        data:{sirketKodu,alici,aciklama},
      });
    }
  }

  // Son başarılı satış senkronu Operis veritabanında kalıcıdır.
  // MSSQL geçici olarak erişilemese bile bu satış kodları kartlara uygulanır.
  let autoMarkedSales = await markAssetsAsSoldFromCodes(
    c.branchCode,
    cachedSalesForRepair.map(row => row.demirKodu),
  );

  const pool = new sql.ConnectionPool({
    user:c.username,
    password:c.passwordEncrypted ? decryptText(c.passwordEncrypted) : '',
    server:c.host,
    port:c.port,
    database:c.database,
    options:{ encrypt:false, trustServerCertificate:true, enableArithAbort:true },
    connectionTimeout:10000,
    requestTimeout:180000,
  });
  await pool.connect();

  try {
    const perm=await pool.request().query<{allowed:number}>(
      `SELECT CASE WHEN HAS_PERMS_BY_NAME('dbo.TBLDEMSATIS','OBJECT','SELECT')=1 THEN 1 ELSE 0 END allowed`
    );
    if (Number(perm.recordset[0]?.allowed ?? 0)!==1) {
      throw new Error('SQL kullanıcısının dbo.TBLDEMSATIS tablosunda SELECT yetkisi yok.');
    }

    // Operis yerel veritabanındaki son başarılı satış verileri kalıcıdır.
    // Eski sürümde tam satırdan üretilen sourceKey varsa, bir defaya mahsus
    // sabit iş anahtarına (şirket + demirbaş + tarih + belge) dönüştürülür.
    const localRows = await prisma.assetSaleExternal.findMany({
      where:{ connectionId:c.id },
      select:{
        id:true,
        sourceKey:true,
        sourceFingerprint:true,
        sirketKodu:true,
        demirKodu:true,
        tarih:true,
        belgeNo:true,
        alici:true,
        aciklama:true,
      },
    });

    const localByStableKey = new Map<string, {
      id:string;
      sourceKey:string;
      sourceFingerprint:string;
    }>();

    let legacyTurkishRepairCount=0;

    for (const row of localRows) {
      const repairedAlici=repairTurkishText(row.alici);
      const repairedAciklama=repairTurkishText(row.aciklama);
      const repairedSirket=repairTurkishText(row.sirketKodu);
      if(repairedAlici!==row.alici || repairedAciklama!==row.aciklama || repairedSirket!==row.sirketKodu){
        await prisma.assetSaleExternal.update({
          where:{id:row.id},
          data:{alici:repairedAlici,aciklama:repairedAciklama,sirketKodu:repairedSirket},
        });
        row.alici=repairedAlici;
        row.aciklama=repairedAciklama;
        row.sirketKodu=repairedSirket;
        legacyTurkishRepairCount++;
      }

      const stableKey = saleStableKey({
        sirketKodu: row.sirketKodu,
        demirKodu: row.demirKodu,
        tarih: row.tarih,
        belgeNo: row.belgeNo,
      });

      if (!localByStableKey.has(stableKey)) {
        localByStableKey.set(stableKey, {
          id: row.id,
          sourceKey: stableKey,
          sourceFingerprint: row.sourceFingerprint,
        });
      }

      if (row.sourceKey !== stableKey) {
        await prisma.assetSaleExternal.update({
          where:{ id:row.id },
          data:{ sourceKey:stableKey },
        }).catch(() => undefined);
      }
    }

    // 1. aşama: tüm satış satırlarının TAM verisini çekmek yerine yalnız
    // sabit anahtar alanları + SQL fingerprint okunur.
    const sourceIndex = await pool.request().query<{
      SIRKET_KODU:string;
      DEMIR_KODU:string;
      TARIH:string;
      BELGE_NO:string;
      SOURCE_FP:string;
    }>(`
      SELECT
        ISNULL(CONVERT(nvarchar(max), SIRKET_KODU), N'') AS SIRKET_KODU,
        ISNULL(CONVERT(nvarchar(max), DEMIR_KODU), N'') AS DEMIR_KODU,
        ISNULL(CONVERT(nvarchar(10), TRY_CONVERT(date, TARIH), 23), N'') AS TARIH,
        ISNULL(CONVERT(nvarchar(max), BELGE_NO), N'') AS BELGE_NO,
        LOWER(CONVERT(varchar(64), HASHBYTES('SHA2_256',
          CONVERT(varbinary(max), CONCAT(
            ISNULL(CONVERT(nvarchar(max), SIRKET_KODU), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), DEMIR_KODU), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(10), TRY_CONVERT(date, TARIH), 23), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), BELGE_NO), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), ALICI), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), SATIS_MIKTARI), N''), NCHAR(31),
            ISNULL(CONVERT(nvarchar(max), ACIKLAMA), N'')
          ))
        ), 2)) AS SOURCE_FP
      FROM dbo.TBLDEMSATIS
      WHERE DEMIR_KODU IS NOT NULL
    `);

    const sourceMeta = new Map<string, {
      stableKey:string;
      sirketKodu:string;
      demirKodu:string;
      tarih:string;
      belgeNo:string;
      fingerprint:string;
    }>();

    for (const row of sourceIndex.recordset) {
      const meta = {
        sirketKodu:text(row.SIRKET_KODU),
        demirKodu:text(row.DEMIR_KODU),
        tarih:text(row.TARIH),
        belgeNo:text(row.BELGE_NO),
      };
      if (!meta.demirKodu) continue;

      const stableKey=saleStableKey(meta);
      sourceMeta.set(stableKey,{
        stableKey,
        ...meta,
        fingerprint:String(row.SOURCE_FP ?? '').toLowerCase(),
      });
    }

    const changedMeta=[...sourceMeta.values()].filter(meta =>
      localByStableKey.get(meta.stableKey)?.sourceFingerprint !== meta.fingerprint
    );

    // Güncel SQL satış kayıtlarını da kart durumuna uygula.
    const freshSaleCodes = [...new Set(
      [...sourceMeta.values()].map(meta => meta.demirKodu).filter(Boolean),
    )];
    autoMarkedSales += await markAssetsAsSoldFromCodes(c.branchCode, freshSaleCodes);

    // 2. aşama: yalnız yeni/değişen iş anahtarlarının TAM satırları çekilir.
    const changedRows:SaleRow[]=[];
    const BATCH_SIZE=100;

    for(let offset=0; offset<changedMeta.length; offset+=BATCH_SIZE){
      const batch=changedMeta.slice(offset,offset+BATCH_SIZE);
      const request=pool.request();

      const conditions=batch.map((meta,index)=>{
        request.input(`s${index}`,sql.NVarChar(sql.MAX),meta.sirketKodu);
        request.input(`d${index}`,sql.NVarChar(sql.MAX),meta.demirKodu);
        request.input(`t${index}`,sql.NVarChar(10),meta.tarih);
        request.input(`b${index}`,sql.NVarChar(sql.MAX),meta.belgeNo);
        return `(
          ISNULL(CONVERT(nvarchar(max), SIRKET_KODU), N'')=@s${index}
          AND ISNULL(CONVERT(nvarchar(max), DEMIR_KODU), N'')=@d${index}
          AND ISNULL(CONVERT(nvarchar(10), TRY_CONVERT(date, TARIH), 23), N'')=@t${index}
          AND ISNULL(CONVERT(nvarchar(max), BELGE_NO), N'')=@b${index}
        )`;
      });

      const result=await request.query<SaleRow>(`
        SELECT SIRKET_KODU, DEMIR_KODU, TARIH, BELGE_NO, ALICI, SATIS_MIKTARI, ACIKLAMA
        FROM dbo.TBLDEMSATIS
        WHERE ${conditions.join(' OR ')}
        ORDER BY TRY_CONVERT(bigint, DEMIR_KODU) DESC, DEMIR_KODU DESC, TARIH DESC, BELGE_NO DESC
      `);
      changedRows.push(...result.recordset);
    }

    let created=0;
    let updated=0;
    const unchanged=Math.max(0,sourceMeta.size-changedMeta.length);
    const now=new Date();

    for(const r of changedRows){
      const values={
        sirketKodu:text(r.SIRKET_KODU),
        demirKodu:text(r.DEMIR_KODU),
        tarih:text(r.TARIH),
        belgeNo:text(r.BELGE_NO),
      };
      if(!values.demirKodu) continue;

      const stableKey=saleStableKey(values);
      const sourceFingerprint=sourceMeta.get(stableKey)?.fingerprint ?? fp(r);
      const existing=localByStableKey.get(stableKey);

      const data={
        branchCode:c.branchCode,
        sourceFingerprint,
        sourceSyncedAt:now,
        sirketKodu:values.sirketKodu,
        demirKodu:values.demirKodu,
        tarih:values.tarih,
        belgeNo:values.belgeNo,
        alici:text(r.ALICI),
        satisMiktari:amount(r.SATIS_MIKTARI),
        aciklama:text(r.ACIKLAMA),
      };

      if(!existing){
        const createdRow=await prisma.assetSaleExternal.create({
          data:{
            ...data,
            connectionId:c.id,
            sourceKey:stableKey,
            sourceChangedAt:now,
          },
        });
        localByStableKey.set(stableKey,{
          id:createdRow.id,
          sourceKey:stableKey,
          sourceFingerprint,
        });
        created++;
      }else{
        await prisma.assetSaleExternal.update({
          where:{id:existing.id},
          data:{...data,sourceChangedAt:now},
        });
        updated++;
      }
    }

    await prisma.assetExternalConnection.update({
      where:{id:c.id},
      data:{
        lastTestAt:now,
        lastTestResult:
          `TBLDEMSATIS INCREMENTAL OK | kontrol:${sourceMeta.size} getirilen:${changedRows.length} ` +
          `yeni:${created} güncel:${updated} değişmeyen:${unchanged} otomatik-satis-karti:${autoMarkedSales} tr-duzeltme:${legacyTurkishRepairCount}`,
      },
    });

    return {
      scanned:sourceMeta.size,
      fetched:changedRows.length,
      created,
      updated,
      unchanged,
      autoMarkedSales,
    };
  } finally {
    await pool.close().catch(()=>undefined);
  }
}

let started=false;
export function startTblDemSatisHourlyScheduler(){
  if(started)return; started=true; let last='';
  const tick=async()=>{ const n=new Date(); const key=`${n.getFullYear()}-${n.getMonth()}-${n.getDate()}-${n.getHours()}`;
    if(n.getMinutes()>4||key===last)return; last=key;
    const cs=await prisma.assetExternalConnection.findMany({where:{enabled:true,type:'MSSQL'}});
    for(const c of cs) try{await syncTblDemSatisConnection(c.id)}catch(e){console.error(`[TBLDEMSATIS SYNC] ${c.name}`,e)}
  };
  void tick(); setInterval(()=>void tick(),60000).unref?.();
}
