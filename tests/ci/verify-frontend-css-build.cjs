const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.resolve(__dirname, '../../server/public');
const assetsDir = path.join(publicDir, 'assets');
const cssFiles = fs.readdirSync(assetsDir).filter((name) => name.endsWith('.css'));
if (cssFiles.length === 0) throw new Error('No production CSS artifact found.');

const css = cssFiles.map((name) => fs.readFileSync(path.join(assetsDir, name), 'utf8')).join('\n');
if (/\@tailwind\s+(base|components|utilities)/.test(css)) throw new Error('Production CSS still contains raw @tailwind directives.');
if (/\@apply\s+/.test(css)) throw new Error('Production CSS still contains raw @apply directives.');
if (!/\.flex\{display:flex\}/.test(css)) throw new Error('Expected Tailwind flex utility is missing from production CSS.');

const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((ref) => ref.startsWith('/') || ref.startsWith('./'));
for (const ref of refs) {
  const rel = ref.replace(/^\.\//, '').replace(/^\//, '').split(/[?#]/)[0];
  if (!fs.existsSync(path.join(publicDir, rel))) throw new Error(`Missing referenced production asset: ${ref}`);
}
console.log('FRONTEND_CSS_AND_ASSET_BUILD_PASS');
