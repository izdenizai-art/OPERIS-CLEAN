const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const repo = path.resolve(__dirname, '..', '..');
const outputDir = process.env.OPERIS_DIAGNOSTIC_DIR || path.join(os.tmpdir(), 'operis-ci-diagnostics');
fs.mkdirSync(outputDir, { recursive: true });

function readIfExists(file, max = 30000) {
  try {
    const value = fs.readFileSync(file, 'utf8');
    return value.length > max ? value.slice(-max) : value;
  } catch {
    return '';
  }
}

function command(command, args = []) {
  try {
    return execFileSync(command, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : '';
    const stderr = error.stderr ? String(error.stderr) : '';
    return `${stdout}\n${stderr}`.trim();
  }
}

const candidateFiles = fs.readdirSync(repo)
  .map(name => {
    const match = name.match(/^OPERIS_v6\.3\.63_WTD(\d+)_CANDIDATE_BASELINE\.json$/);
    return match ? { name, number: Number(match[1]) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.number - a.number);

const candidatePath = candidateFiles.length ? path.join(repo, candidateFiles[0].name) : '';
let candidate = {};
try {
  if (candidatePath) candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
} catch {}

const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
const windowsStdout = readIfExists(path.join(runnerTemp, 'operis.stdout.log'));
const windowsStderr = readIfExists(path.join(runnerTemp, 'operis.stderr.log'));
const dockerLog = readIfExists('/tmp/operis-docker-diagnostics/container.log');

const typecheck = command(process.platform === 'win32' ? 'cmd.exe' : 'npm',
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run typecheck']
    : ['run', 'typecheck']);

const serverBuild = command(process.platform === 'win32' ? 'cmd.exe' : 'npm',
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm --prefix server run build']
    : ['--prefix', 'server', 'run', 'build']);

const report = `# OPERIS CI AI Handoff

## Safety / ground truth
Bu dosya otomatik tanı paketidir. Bir AI agent bu raporu kullanırken yalnız mevcut log ve kaynak kanıtına dayanmalı; başarısızlığı tahmin ederek düzeltmemelidir.
Önce başarısız kontrolü tekrar üretmeli, sonra en küçük düzeltmeyi yapmalı, ardından aynı testi PASS etmeden başka soruna geçmemelidir.

## Candidate
- Version: ${candidate.version || 'unknown'}
- Status: ${candidate.status || 'unknown'}
- Git SHA: ${process.env.GITHUB_SHA || command('git', ['rev-parse', 'HEAD']) || 'unknown'}
- Runner OS: ${process.env.RUNNER_OS || process.platform}
- Node: ${command('node', ['--version'])}
- npm: ${command(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d','/s','/c','npm --version'] : ['--version'])}

## Required diagnosis order
1. İlk kesin FAIL mesajını belirle.
2. FAIL'in kaynak dosya/satırını bul.
3. Aynı davranışı doğrulayan hedef test oluştur veya mevcut testi tekrar çalıştır.
4. Tek problemi düzelt.
5. Hedef test PASS olmadan ikinci probleme geçme.
6. Şube bazlı yetki, Balamir koruması, Help Desk ve backup davranışlarında regresyon yaratma.
7. Doğrulanamayan noktayı açıkça "doğrulanamadı" olarak bırak.

## Frontend typecheck output
\`\`\`
${typecheck}
\`\`\`

## Server build output
\`\`\`
${serverBuild}
\`\`\`

## OPERIS Windows stdout
\`\`\`
${windowsStdout}
\`\`\`

## OPERIS Windows stderr
\`\`\`
${windowsStderr}
\`\`\`

## Docker log
\`\`\`
${dockerLog}
\`\`\`

## Relevant validation files
- .github/workflows/operis-wtd46-ci.yml
- .github/workflows/operis-load-test.yml
- tests/windows/install-contract-smoke.ps1
- tests/windows/backup-runtime-smoke.ps1
- tests/e2e/operis-smoke.spec.cjs
- tests/load/operis-100-vu.js
- En yüksek numaralı OPERIS_v6.3.63_WTD*_CANDIDATE_BASELINE.json

## Expected response from AI agent
- Kesin hata
- Kanıt/log
- Etkilenen dosya/satır
- Uygulanan minimal düzeltme
- Çalıştırılan hedef test
- PASS/FAIL
- Doğrulanamayanlar
`;

const output = path.join(outputDir, 'AI_HANDOFF.md');
fs.writeFileSync(output, report, 'utf8');
console.log(output);
