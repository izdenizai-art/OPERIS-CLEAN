import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const databaseUrl = String(process.env.DATABASE_URL || '').trim();

if (!databaseUrl.startsWith('file:')) {
  throw new Error('SQLite backup yalnız file: DATABASE_URL ile çalışır.');
}

let rawPath = databaseUrl.slice(5);
const sourceDb = path.isAbsolute(rawPath)
  ? rawPath
  : path.resolve(serverRoot, 'prisma', rawPath.replace(/^\.\//, ''));

if (!fs.existsSync(sourceDb)) {
  throw new Error(`SQLite DB bulunamadı: ${sourceDb}`);
}

const outputRoot = process.env.OPERIS_SQLITE_BACKUP_DIR
  ? path.resolve(process.env.OPERIS_SQLITE_BACKUP_DIR)
  : path.resolve(serverRoot, '..', 'Backups', 'PrePostgreSQL');

fs.mkdirSync(outputRoot, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDb = path.join(outputRoot, `yaklasan-isler-${stamp}.db`);
const manifestPath = `${backupDb}.manifest.json`;

const quoteSql = value => `'${String(value).replaceAll("'", "''")}'`;
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const db = new DatabaseSync(sourceDb, { readOnly: true });
try {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (!integrity || integrity.integrity_check !== 'ok') {
    throw new Error(`SQLite integrity_check başarısız: ${JSON.stringify(integrity)}`);
  }

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(row => String(row.name));

  const counts = Object.fromEntries(
    tables.map(table => {
      const safe = table.replaceAll('"', '""');
      return [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM "${safe}"`).get().count)];
    })
  );

  db.exec(`VACUUM INTO ${quoteSql(backupDb)}`);

  const check = new DatabaseSync(backupDb, { readOnly: true });
  try {
    const backupIntegrity = check.prepare('PRAGMA integrity_check').get();
    if (!backupIntegrity || backupIntegrity.integrity_check !== 'ok') {
      throw new Error(`Backup integrity_check başarısız: ${JSON.stringify(backupIntegrity)}`);
    }
    const backupCounts = Object.fromEntries(
      tables.map(table => {
        const safe = table.replaceAll('"', '""');
        return [table, Number(check.prepare(`SELECT COUNT(*) AS count FROM "${safe}"`).get().count)];
      })
    );
    if (JSON.stringify(counts) !== JSON.stringify(backupCounts)) {
      throw new Error('Backup satır sayıları kaynak SQLite ile eşleşmiyor.');
    }
  } finally {
    check.close();
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    sourceDb,
    backupDb,
    sha256: sha256(backupDb),
    sourceSha256: sha256(sourceDb),
    tableCounts: counts,
    integrityCheck: 'ok',
    note: 'PostgreSQL geçişinden önce transaction-consistent SQLite VACUUM INTO yedeği.',
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  db.close();
}
