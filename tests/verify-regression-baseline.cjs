const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const baselinePath = path.join(__dirname, 'regression-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

let failed = false;

for (const [relativePath, expected] of Object.entries(baseline)) {
  const fullPath = path.join(repo, relativePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`MISSING: ${relativePath}`);
    failed = true;
    continue;
  }

  const actual = sha256(fullPath);
  if (actual !== expected) {
    console.error(`CHANGED: ${relativePath}`);
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${actual}`);
    failed = true;
  } else {
    console.log(`OK: ${relativePath}`);
  }
}

if (failed) {
  console.error('\nRegression baseline kontrolü BAŞARISIZ.');
  process.exit(1);
}

console.log('\nRegression baseline kontrolü BAŞARILI.');
