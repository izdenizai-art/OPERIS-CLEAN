const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'scripts', 'migrate-sqlite-windows.mjs'), 'utf8');

const hasParameterizedInsert = source.includes("`$${i + 1}${f.type === 'Json' ? '::jsonb' : f.type === 'DateTime' ? '::timestamp' : f.type === 'BigInt' ? '::bigint' : ''}`");
const hasBrokenLiteralInsert = source.includes("`${i + 1}${f.type === 'Json' ? '::jsonb' : f.type === 'DateTime' ? '::timestamp' : f.type === 'BigInt' ? '::bigint' : ''}`");

if (!hasParameterizedInsert) {
  console.error('FAIL: migration INSERT must use PostgreSQL $1..$N placeholders');
  process.exit(1);
}
if (hasBrokenLiteralInsert) {
  console.error('FAIL: migration INSERT still emits numeric SQL literals instead of parameters');
  process.exit(1);
}

console.log('SQLITE_MIGRATION_PARAMETER_PLACEHOLDER_CONTRACT_PASS');
