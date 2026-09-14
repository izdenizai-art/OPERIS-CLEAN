const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const crypto = require('node:crypto');
const requireServer = createRequire(path.resolve(__dirname, '../server/package.json'));
const AdmZip = requireServer('adm-zip');
const archiver = requireServer('archiver');

async function run() {
  // Match the application's archiver producer and AdmZip restore consumer.
  for (const store of [true, false]) {
    const payload = Buffer.from('SQLite format 3\0synthetic archive compatibility fixture');
    const attachment = Buffer.from('Help Desk UTF-8 ek dosyası');
    const metadata = { product: 'OPERIS', version: '6.3.63', databaseSha256: crypto.createHash('sha256').update(payload).digest('hex') };
    const output = new PassThrough();
    const chunks = [];
    output.on('data', chunk => chunks.push(chunk));
    const completed = new Promise((resolve, reject) => { output.on('end', resolve); output.on('error', reject); });
    const archive = archiver('zip', { store });
    archive.on('error', error => output.destroy(error));
    archive.pipe(output);
    archive.append(payload, { name: 'database/yaklasan-isler.db' });
    archive.append(JSON.stringify(metadata), { name: 'metadata.json' });
    archive.append(attachment, { name: 'helpdesk-attachments/ek.txt' });
    await archive.finalize();
    await completed;
    const restored = new AdmZip(Buffer.concat(chunks));
    assert.deepEqual(restored.getEntry('database/yaklasan-isler.db').getData(), payload);
    assert.deepEqual(JSON.parse(restored.getEntry('metadata.json').getData()), metadata);
    assert.deepEqual(restored.getEntry('helpdesk-attachments/ek.txt').getData(), attachment);
  }
  console.log('ZIP_ARCHIVER_RESTORE_COMPATIBILITY_PASS');
  // GHSA-vwc7-r8mq-g2x9: a destination symlink must never overwrite its target.
  if (process.platform !== 'win32') {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operis-zip-link-'));
    try {
      const destination = path.join(root, 'destination');
      const outside = path.join(root, 'outside');
      fs.mkdirSync(destination); fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'preserved');
      fs.symlinkSync(outside, path.join(destination, 'link'));
      const zip = new AdmZip();
      zip.addFile('link/sentinel.txt', Buffer.from('must not overwrite'));
      try { zip.extractAllTo(destination, true); } catch (_) { /* Safe rejection is expected. */ }
      assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'preserved');
      console.log('ZIP_DESTINATION_SYMLINK_SAFETY_PASS');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }

  // Intercept large eager allocations so the old version can be tested without OOM.
  for (const method of [0, 8]) {
    const original = new AdmZip();
    original.addFile('probe.txt', Buffer.from('small payload'));
    const crafted = original.toBuffer();
    const local = crafted.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const central = crafted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(local >= 0 && central > local);
    crafted.writeUInt16LE(method, local + 8);
    crafted.writeUInt16LE(method, central + 10);
    crafted.writeUInt32LE(0xc0000000, local + 22);
    crafted.writeUInt32LE(0xc0000000, central + 24);
    const zip = new AdmZip(crafted);
    const allocate = Buffer.alloc;
    let unsafeAllocation = false;
    Buffer.alloc = function(size, ...args) {
      if (size > 16 * 1024 * 1024) { unsafeAllocation = true; throw new Error('Intercepted excessive allocation'); }
      return allocate(size, ...args);
    };
    try { zip.getEntry('probe.txt').getData(); } catch (_) { /* Malformed input may be rejected. */ }
    finally { Buffer.alloc = allocate; }
    assert.equal(unsafeAllocation, false, `ZIP method ${method} trusts attacker-declared allocation size`);
  }
  console.log('ZIP_DECLARED_SIZE_ALLOCATION_SAFETY_PASS');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
