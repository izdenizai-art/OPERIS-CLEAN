const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { jsPDF } = require('jspdf');
const repo = path.resolve(__dirname, '..');
const source = ts.createSourceFile('PrintMailToolbar.tsx', fs.readFileSync(path.join(repo, 'src/components/PrintMailToolbar.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pieces = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['safeFileName', 'chunks'].includes(node.name?.text)) pieces.push(node.getText(source));
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'makePdf') pieces.push(`const ${node.getText(source)};`);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(pieces.length, 3, 'Test must execute the actual export function and helpers');
const code = ts.transpileModule(pieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const exportPdf = new Function('jsPDF', 'normalized', 'columns', 'companyName', 'title', 'logoDataUrl', `${code}\nreturn makePdf();`);
// GHSA-95fx-jjr5-f39c: reject oversized BMP headers before allocating image data.
const bmp = Buffer.alloc(54);
bmp.write('BM'); bmp.writeUInt32LE(54, 2); bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(100000, 18); bmp.writeInt32LE(100000, 22);
bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
assert.throws(() => new jsPDF().addImage(new Uint8Array(bmp), 'BMP', 0, 0, 10, 10), /dimensions exceed/i);
console.log('PDF_OVERSIZED_BMP_REJECTED_PASS');
(async () => {
  for (const scenario of ['empty', 'multipage', 'logo']) {
    const rows = scenario === 'empty' ? [] : Array.from({ length: 1001 }, (_, i) => ({ Name: `ROW_${String(i).padStart(4, '0')}`, Notes: 'line wrapping '.repeat(8) }));
    const logo = scenario === 'logo' ? `data:image/png;base64,${fs.readFileSync(path.join(repo, 'src/assets/operis-login-ocean.png')).toString('base64')}` : '';
    const file = exportPdf(jsPDF, rows, ['Name', 'Notes'], 'OPERIS', 'Export Report', logo);
    assert.equal(file.name, 'export-report.pdf');
    assert.equal(file.type, 'application/pdf');
    const body = Buffer.from(await file.arrayBuffer()).toString('latin1');
    assert.ok(body.startsWith('%PDF-'));
    assert.match(body, /%%EOF/);
    const pages = (body.match(/\/Type \/Page\b/g) || []).length;
    if (scenario === 'empty') assert.equal(pages, 1);
    else {
      assert.ok(pages > 10, 'Long reports must paginate');
      assert.ok(body.includes('ROW_0000') && body.includes('ROW_0999'));
      assert.ok(!body.includes('ROW_1000'), 'Existing 1000-row limit must remain');
    }
    if (logo) assert.match(body, /\/Subtype \/Image/, 'Logo must remain embedded');
    console.log(`PDF_EXPORT_${scenario.toUpperCase()}_PASS pages=${pages}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
