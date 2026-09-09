import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2];
const theme = process.argv[3];
const allowed = new Set(['dark','light','spring','gray','black','ocean-blue','pastel-glass','corporate-2d']);
if (!dbPath || !theme || !allowed.has(theme)) {
  console.error('Kullanım: node apply-install-theme.mjs <dbPath> <theme>');
  process.exit(2);
}
const db = new DatabaseSync(dbPath);
try {
  const userColumns = db.prepare(`PRAGMA table_info(User)`).all().map(row => String(row.name));
  if (!userColumns.includes('theme')) throw new Error('User.theme kolonu bulunamadı.');
  db.prepare(`UPDATE User SET theme = ?`).run(theme);
  const settingsColumns = db.prepare(`PRAGMA table_info(AppSettings)`).all().map(row => String(row.name));
  if (settingsColumns.includes('theme')) {
    const row = db.prepare(`SELECT id FROM AppSettings WHERE id = 1`).get();
    if (row) db.prepare(`UPDATE AppSettings SET theme = ? WHERE id = 1`).run(theme);
  }
  console.log(`INSTALL_THEME_APPLIED=${theme}`);
} finally { db.close(); }
