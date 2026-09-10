const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const evidenceRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!evidenceRoot || !fs.existsSync(evidenceRoot)) {
  console.error('Usage: node tests/verify-postgresql-candidate-evidence.cjs <extracted-evidence-root>');
  process.exit(2);
}

function findFile(name) {
  const stack = [evidenceRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return null;
}

const healthPath = findFile('postgresql-health.json');
const sqliteHealthPath = findFile('sqlite-health.json');
const loginPath = findFile('login.json');
const sqlPath = findFile('000000000000_postgresql_init.sql');

for (const [label, p] of [
  ['PostgreSQL health', healthPath],
  ['SQLite health', sqliteHealthPath],
  ['login', loginPath],
  ['initial SQL', sqlPath],
]) {
  if (!p) {
    console.error(`Missing evidence: ${label}`);
    process.exit(3);
  }
}

const pgHealth = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
const sqliteHealth = JSON.parse(fs.readFileSync(sqliteHealthPath, 'utf8'));
const login = JSON.parse(fs.readFileSync(loginPath, 'utf8'));
const sql = fs.readFileSync(sqlPath, 'utf8');

const checks = [
  ['PostgreSQL health ok', pgHealth.ok === true],
  ['PostgreSQL provider', pgHealth.database?.provider === 'postgresql'],
  ['PostgreSQL connected', pgHealth.database?.connected === true],
  ['SQLite rollback health ok', sqliteHealth.ok === true],
  ['SQLite rollback provider', sqliteHealth.database?.provider === 'sqlite'],
  ['SQLite rollback connected', sqliteHealth.database?.connected === true],
  ['Balamir login', login.user?.username === 'balamir'],
  ['Balamir admin', login.user?.isAdmin === true],
  ['50 CREATE TABLE', (sql.match(/\bCREATE TABLE\b/gi) || []).length === 50],
  ['15 FOREIGN KEY', (sql.match(/\bFOREIGN KEY\b/gi) || []).length === 15],
  ['JSONB present', (sql.match(/\bJSONB\b/gi) || []).length >= 3],
  ['Serial partial unique index present', sql.includes('Asset_active_serialNumber_unique')],
  ['Barcode partial unique index present', sql.includes('Asset_active_barcode_unique')],
  ['No SQLite-only AUTOINCREMENT', !/\bAUTOINCREMENT\b/i.test(sql)],
  ['No SQLite PRAGMA', !/\bPRAGMA\b/i.test(sql)],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}

console.log(`SQL SHA256: ${crypto.createHash('sha256').update(fs.readFileSync(sqlPath)).digest('hex')}`);
if (failed) process.exit(1);
console.log(`WTD58 candidate evidence contract PASS ${checks.length}/${checks.length}`);
