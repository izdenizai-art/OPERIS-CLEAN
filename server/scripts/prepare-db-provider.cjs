const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const serverRoot = path.resolve(__dirname, '..');
const prismaRoot = path.join(serverRoot, 'prisma');
const provider = String(process.argv[2] || process.env.OPERIS_DB_PROVIDER || 'sqlite').trim().toLowerCase();

if (!['sqlite', 'postgresql'].includes(provider)) {
  console.error(`Desteklenmeyen provider: ${provider}`);
  process.exit(2);
}

if (provider === 'postgresql' && process.env.OPERIS_CONFIRM_POSTGRESQL !== 'YES') {
  console.error('PostgreSQL şema aktivasyonu için OPERIS_CONFIRM_POSTGRESQL=YES zorunludur.');
  process.exit(3);
}

const source = path.join(prismaRoot, `schema.${provider}.prisma`);
const target = path.join(prismaRoot, 'schema.prisma');

if (!fs.existsSync(source)) {
  console.error(`Provider şeması bulunamadı: ${source}`);
  process.exit(4);
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const content = fs.readFileSync(source);
fs.writeFileSync(target, content);

console.log(`OPERIS DB provider hazırlandı: ${provider}`);
console.log(`schema.prisma SHA256: ${sha256(content)}`);
