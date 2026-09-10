const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repo, relativePath), 'utf8');
}

const server = read('server/src/helpdesk.ts');
const schema = read('server/prisma/schema.prisma');
const app = read('src/App.tsx');
const ui = read('src/components/HelpDeskPanel.tsx');

const checks = [
  ['Help Desk route', server.includes("helpDeskRouter.get('/recent'")],
  ['Son 10 kayıt', server.includes('take: 10')],
  ['Kendi ticket scope', server.includes("scope === 'mine'")],
  ['Ticket kilit endpoint', server.includes("'/tickets/:id/lock'")],
  ['Kilit guard', server.includes('assertUnlocked(ticket)')],
  ['Merkez yönetim guard', server.includes('assertCentral(req)')],
  ['Şube destek konusu yetkisi', schema.includes('canTopics')],
  ['Şube hazır cevap yetkisi', schema.includes('canCannedReplies')],
  ['Şube bilgi bankası yetkisi', schema.includes('canKnowledge')],
  ['Help Desk ana navigasyon', app.includes("id: 'helpdesk'")],
  ['Son 10 şube/tüm şube UI', ui.includes('recentScope') && ui.includes('Tüm Şubeler')],
  ['Kendi ticket şube/tüm şube UI', ui.includes('mineScope')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}

if (failed) {
  process.exit(1);
}

console.log('\nHelp Desk yapısal güvenlik kontrolleri BAŞARILI.');
