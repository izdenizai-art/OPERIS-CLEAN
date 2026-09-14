const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migration', 'postgresql-custom.sql'), 'utf8');

if (!/INSERT\s+INTO\s+"AppSettings"\s*\(\s*"id"\s*,\s*"updatedAt"\s*\)/i.test(sql)) {
  throw new Error('PostgreSQL bootstrap does not create AppSettings singleton before server startup.');
}
if (!/ON\s+CONFLICT\s*\(\s*"id"\s*\)\s+DO\s+NOTHING/i.test(sql)) {
  throw new Error('AppSettings singleton bootstrap is not idempotent.');
}
console.log('APPSETTINGS_SINGLETON_BOOTSTRAP_CONTRACT_PASS');
