import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient, Prisma } from '@prisma/client';

const quote = name => `"${name.replaceAll('"', '""')}"`;
const hashFile = file => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(file).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
});
const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : Array.isArray(value) ? value.map(canonical) : value;

function normalize(value, field) {
  if (value === null) return null;
  if (field.type === 'DateTime') {
    const date = new Date(typeof value === 'bigint' ? Number(value) : value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid source timestamp');
    return date.toISOString();
  }
  if (field.type === 'Json') return canonical(typeof value === 'string' ? JSON.parse(value) : value);
  if (field.type === 'Boolean') {
    if (![0, 1, 0n, 1n, true, false].includes(value)) throw new Error('Invalid source boolean');
    return value === true || value === 1 || value === 1n;
  }
  if (field.type === 'BigInt') return BigInt(value).toString();
  if (field.type === 'Int') {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new Error('Unsafe integer conversion');
    return n;
  }
  if (field.type === 'String') {
    if (typeof value !== 'string') throw new Error('Invalid source string');
    return value;
  }
  if (field.type === 'Float') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('Invalid source number');
    return n;
  }
  throw new Error(`Unsupported migration field type ${field.type}`);
}

async function main() {
  if (process.env.OPERIS_CONFIRM_SQLITE_MIGRATION !== 'YES') throw new Error('Migration confirmation missing');
  const file = process.env.OPERIS_SQLITE_MIGRATION_SOURCE;
  if (!file || !fs.existsSync(file)) throw new Error('Consistent source backup required');
  const target = new URL(process.env.DATABASE_URL);
  if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
      target.pathname.slice(1) !== process.env.OPERIS_EXPECTED_TARGET_DATABASE) throw new Error('Target identity mismatch');
  const output = process.env.OPERIS_MIGRATION_EVIDENCE;
  if (!output) throw new Error('Migration evidence path required');
  const beforeHash = await hashFile(file);
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const pg = new PrismaClient();
  try {
    if (sqlite.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Source integrity failed');
    const models = Prisma.dmmf.datamodel.models;
    const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'").all().map(x => x.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(models.map(m => m.dbName || m.name).sort())) throw new Error('Source table set differs from the supported schema');
    const ordered = [];
    const pending = [...models];
    while (pending.length) {
      const index = pending.findIndex(m => m.fields.filter(f => f.kind === 'object' && f.relationFromFields?.length && f.type !== m.name).every(f => ordered.some(o => o.name === f.type)));
      if (index < 0) throw new Error('Cyclic foreign keys require a reviewed migration');
      ordered.push(pending.splice(index, 1)[0]);
    }
    const evidence = [];
    await pg.$transaction(async tx => {
      for (const model of models) {
        const rows = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${quote(model.dbName || model.name)}`);
        if (Number(rows[0].count) !== 0) throw new Error('Refusing migration into a populated target');
      }
      for (const model of ordered) {
        const table = model.dbName || model.name;
        const fields = model.fields.filter(f => f.kind === 'scalar' || f.kind === 'enum');
        const columns = fields.map(f => f.dbName || f.name);
        const sourceColumns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c => c.name).sort();
        if (JSON.stringify(sourceColumns) !== JSON.stringify([...columns].sort())) throw new Error('Source columns differ from the supported schema');
        const primary = fields.filter(f => f.isId);
        if (!primary.length) throw new Error('Primary key required');
        const order = primary.map(f => quote(f.dbName || f.name)).join(',');
        const statement = sqlite.prepare(`SELECT * FROM ${quote(table)} ORDER BY ${order}`);
        statement.setReadBigInts(true);
        const sourceRows = statement.all();
        const canonicalRows = sourceRows.map(row => fields.map(f => normalize(row[f.dbName || f.name], f)));
        const values = fields.map((f, i) => `$${i + 1}${f.type === 'Json' ? '::jsonb' : f.type === 'DateTime' ? '::timestamp' : f.type === 'BigInt' ? '::bigint' : ''}`).join(',');
        const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${values})`;
        for (const row of canonicalRows) {
          const parameters = row.map((v, i) => v !== null && fields[i].type === 'Json' ? JSON.stringify(v) : v);
          await tx.$executeRawUnsafe(sql, ...parameters);
        }
        const targetRows = await tx.$queryRawUnsafe(`SELECT * FROM ${quote(table)} ORDER BY ${order}`);
        const canonicalTarget = targetRows.map(row => fields.map(f => normalize(row[f.dbName || f.name], f)));
        const keyIndexes = primary.map(f => fields.indexOf(f));
        const rowKey = row => JSON.stringify(keyIndexes.map(i => row[i]));
        const digest = rows => crypto.createHash('sha256').update(JSON.stringify([...rows].sort((a,b) => rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0))).digest('hex');
        if (digest(canonicalRows) !== digest(canonicalTarget)) throw new Error('Full row verification failed');
        evidence.push({ table, rows: sourceRows.length, fullRowSha256: digest(canonicalRows) });
      }
      if (await hashFile(file) !== beforeHash) throw new Error('Source changed during migration');
    }, { timeout: 600000, maxWait: 30000, isolationLevel: 'Serializable' });
    fs.writeFileSync(output, JSON.stringify({ sourceSha256: beforeHash, tables: evidence, verification: 'FULL_ROWS_AND_PRIMARY_KEYS', result: 'PASS' }, null, 2));
    console.log('WINDOWS_SQLITE_POSTGRESQL_FULL_ROW_MIGRATION_PASS');
  } finally { sqlite.close(); await pg.$disconnect(); }
}

main().catch(error => {
  // Prisma errors can contain SQL values; do not print credentials or migrated data.
  console.error('SQLITE_POSTGRESQL_MIGRATION_FAILED', error.code || error.constructor.name);
  process.exitCode = 1;
});
