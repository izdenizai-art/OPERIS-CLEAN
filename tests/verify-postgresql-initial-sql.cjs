const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const sqlPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repo, 'migration', 'generated', '000000000000_postgresql_init.sql');

const schemaPath = path.join(repo, 'server', 'prisma', 'schema.postgresql.prisma');

if (!fs.existsSync(sqlPath)) {
  console.error(`Initial PostgreSQL SQL bulunamadı: ${sqlPath}`);
  process.exit(2);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const schema = fs.readFileSync(schemaPath, 'utf8');

const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(m => m[1]).sort();
const tables = [...sql.matchAll(/CREATE TABLE\s+"([^"]+)"/gi)].map(m => m[1]).sort();

const missing = models.filter(name => !tables.includes(name));
const extra = tables.filter(name => !models.includes(name));

const sqliteTokens = [
  'AUTOINCREMENT',
  'PRAGMA',
  'WITHOUT ROWID',
  'INSERT OR REPLACE',
  'COLLATE NOCASE',
  'sqlite_',
];

const checks = [
  ['Prisma model count equals CREATE TABLE count', models.length === tables.length],
  ['Every Prisma model has PostgreSQL table', missing.length === 0],
  ['No unexpected PostgreSQL table', extra.length === 0],
  ['No SQLite-only SQL token', sqliteTokens.every(token => !sql.toLowerCase().includes(token.toLowerCase()))],
  ['directoryGroups uses JSONB', /"directoryGroups"\s+JSONB/.test(sql)],
  ['permissions uses JSONB', /"permissions"\s+JSONB/.test(sql)],
  ['Asset serial partial unique index included', sql.includes('"Asset_active_serialNumber_unique"')],
  ['Asset barcode partial unique index included', sql.includes('"Asset_active_barcode_unique"')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
console.log(`Models=${models.length}, Tables=${tables.length}`);
if (missing.length) console.error(`Missing: ${missing.join(', ')}`);
if (extra.length) console.error(`Extra: ${extra.join(', ')}`);
if (failed) process.exit(1);
console.log(`WTD55 initial PostgreSQL SQL contract PASS ${checks.length}/${checks.length}`);
