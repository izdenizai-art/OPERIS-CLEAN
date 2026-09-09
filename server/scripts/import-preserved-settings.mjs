import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const sourceDb = process.env.OPERIS_SETTINGS_SOURCE_DB?.trim();
const targetDb = process.env.OPERIS_SETTINGS_TARGET_DB?.trim();

if (!sourceDb || !targetDb) {
  console.log('[SETTINGS IMPORT] Kaynak veya hedef DB yolu verilmedi; atlandı.');
  process.exit(0);
}
if (!fs.existsSync(sourceDb)) {
  console.log(`[SETTINGS IMPORT] Kaynak DB bulunamadı: ${sourceDb}`);
  process.exit(0);
}
if (!fs.existsSync(targetDb)) {
  throw new Error(`Hedef DB bulunamadı: ${targetDb}`);
}

const source = new DatabaseSync(sourceDb, { readOnly: true });
const target = new DatabaseSync(targetDb);

function tableExists(db, table) {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info("${table.replaceAll('"','""')}")`).all().map(row => String(row.name));
}

function copySingleton(table, keyColumn, keyValue) {
  if (!tableExists(source, table) || !tableExists(target, table)) {
    console.log(`[SETTINGS IMPORT] ${table}: kaynak/hedef tablo yok, atlandı.`);
    return 0;
  }
  const common = columns(source, table).filter(name => columns(target, table).includes(name));
  if (!common.length) return 0;

  const selectCols = common.map(c => `"${c.replaceAll('"','""')}"`).join(',');
  const row = source.prepare(`SELECT ${selectCols} FROM "${table}" WHERE "${keyColumn}"=? LIMIT 1`).get(keyValue);
  if (!row) {
    console.log(`[SETTINGS IMPORT] ${table}: aktarılacak kayıt yok.`);
    return 0;
  }

  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(',');
  const quoted = cols.map(c => `"${c.replaceAll('"','""')}"`).join(',');
  const updates = cols.filter(c => c !== keyColumn).map(c => `"${c.replaceAll('"','""')}"=excluded."${c.replaceAll('"','""')}"`).join(',');
  const sql = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})
               ON CONFLICT("${keyColumn}") DO UPDATE SET ${updates}`;
  target.prepare(sql).run(...cols.map(c => row[c]));
  console.log(`[SETTINGS IMPORT] ${table}: 1 kayıt aktarıldı.`);
  return 1;
}

function copyAll(table, conflictColumns = []) {
  if (!tableExists(source, table) || !tableExists(target, table)) {
    console.log(`[SETTINGS IMPORT] ${table}: kaynak/hedef tablo yok, atlandı.`);
    return 0;
  }

  const targetCols = columns(target, table);
  const common = columns(source, table).filter(name => targetCols.includes(name));
  if (!common.length) return 0;

  const selectCols = common.map(c => `"${c.replaceAll('"','""')}"`).join(',');
  const rows = source.prepare(`SELECT ${selectCols} FROM "${table}"`).all();
  if (!rows.length) {
    console.log(`[SETTINGS IMPORT] ${table}: aktarılacak kayıt yok.`);
    return 0;
  }

  let count = 0;
  for (const row of rows) {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(',');
    const quoted = cols.map(c => `"${c.replaceAll('"','""')}"`).join(',');
    let conflict = '';
    if (conflictColumns.length && conflictColumns.every(c => cols.includes(c))) {
      const conflictTarget = conflictColumns.map(c => `"${c.replaceAll('"','""')}"`).join(',');
      const updates = cols.filter(c => !conflictColumns.includes(c))
        .map(c => `"${c.replaceAll('"','""')}"=excluded."${c.replaceAll('"','""')}"`).join(',');
      conflict = updates
        ? ` ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updates}`
        : ` ON CONFLICT(${conflictTarget}) DO NOTHING`;
    }
    target.prepare(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})${conflict}`)
      .run(...cols.map(c => row[c]));
    count++;
  }
  console.log(`[SETTINGS IMPORT] ${table}: ${count} kayıt aktarıldı.`);
  return count;
}

try {
  target.exec('BEGIN IMMEDIATE');
  copySingleton('AppSettings', 'id', 1);
  copyAll('AssetExternalConnection', ['id']);
  target.exec('COMMIT');
  console.log('[SETTINGS IMPORT] Mail/Graph/yedekleme ve harici veritabanı bağlantıları başarıyla aktarıldı.');
} catch (error) {
  try { target.exec('ROLLBACK'); } catch {}
  throw error;
} finally {
  source.close();
  target.close();
}
