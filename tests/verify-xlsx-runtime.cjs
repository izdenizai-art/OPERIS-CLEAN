const assert = require('node:assert/strict');
const XLSX = require('xlsx');
assert.equal(XLSX.version, '0.20.3');
const rows = [
  { 'Kayıt': 'İzmir', 'Tarih': '2026-09-14', 'Sayı': 42, 'Etkin': true },
  { 'Kayıt': '__proto__', 'Tarih': '2026-09-15', 'Sayı': 9007199254740991, 'Etkin': false },
];
const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(rows);
XLSX.utils.book_append_sheet(workbook, sheet, 'Rapor');
const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
assert.ok(bytes.length > 1000);
const parsed = XLSX.read(bytes, { type: 'buffer', cellDates: false });
const restored = XLSX.utils.sheet_to_json(parsed.Sheets.Rapor, { defval: '' });
assert.deepEqual(restored, rows);
assert.equal({}.polluted, undefined);
console.log(`XLSX_IMPORT_EXPORT_RUNTIME_PASS bytes=${bytes.length}`);
