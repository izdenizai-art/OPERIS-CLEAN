const fs = require('node:fs');
const path = require('node:path');

const VALID_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'PENDING', 'NOT_APPLICABLE']);

const ITEM_DEFINITIONS = [
  ['autonomousQaAgent', 'Autonomous QA agent'],
  ['finalCi', 'Final CI'],
  ['windowsPostgresqlRehearsal', 'Windows PostgreSQL rehearsal safety'],
  ['postgresqlBackupRestore', 'PostgreSQL backup/restore validation'],
  ['postgresqlCandidate', 'PostgreSQL candidate validation'],
  ['wtd46Cloud', 'WTD46 cloud validation'],
  ['releaseFinalization', 'Release finalization'],
  ['realInstallerRepair', 'Real Windows installer repair'],
  ['scheduledPostgresqlBackup', 'Scheduled PostgreSQL backup integrity'],
  ['rebootStartup', 'Real post-install reboot/startup'],
  ['sqliteToPostgresqlStaging', 'Legacy SQLite to PostgreSQL staging migration'],
  ['concurrentCapacity', 'Concurrent active-user capacity validation'],
  ['adDc', 'AD/DC integration'],
  ['smtp', 'SMTP integration'],
  ['graph', 'Microsoft Graph integration'],
  ['mssql', 'MSSQL integration'],
  ['snmp', 'SNMP integration'],
  ['finalSecurity', 'Final security recheck'],
  ['diffClassification', 'Full diff classification'],
  ['productionCutover', 'Production cutover'],
];

function validateStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error('Invalid release gate status: ' + status);
  }
}

function defaultItem(id, label) {
  if (id === 'productionCutover' || id === 'sqliteToPostgresqlStaging') {
    return {
      id,
      label,
      status: 'NOT_APPLICABLE',
      reason: id === 'sqliteToPostgresqlStaging'
        ? 'Legacy SQLite migration is outside the PostgreSQL-only release model.'
        : 'Production cutover is outside the current requested scope.',
      evidence: null,
    };
  }
  return {
    id,
    label,
    status: 'PENDING',
    reason: 'No verified evidence supplied.',
    evidence: null,
  };
}

function normalizeEvidenceItem(id, label, supplied) {
  if (!supplied) return defaultItem(id, label);
  validateStatus(supplied.status);
  return {
    id,
    label,
    status: supplied.status,
    reason: supplied.reason || null,
    evidence: supplied.evidence || null,
    sourceSha: supplied.sourceSha || null,
  };
}

function mapAgentStatus(overall) {
  if (overall === 'PASS') return 'PASS';
  if (overall === 'FAIL') return 'FAIL';
  if (overall === 'BLOCKED') return 'BLOCKED';
  return 'PENDING';
}

function summarizeOverall(items) {
  const statuses = Object.values(items)
    .filter(item => item.status !== 'NOT_APPLICABLE')
    .map(item => item.status);
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.includes('PENDING')) return 'PENDING';
  return statuses.length ? 'PASS' : 'PENDING';
}

function buildGate(options = {}) {
  const sourceSha = options.sourceSha || 'unknown';
  const supplied = { ...(options.evidence || {}) };

  if (!supplied.concurrentCapacity && supplied.load100Users) {
    supplied.concurrentCapacity = supplied.load100Users;
  }

  if (options.agentEvidence) {
    supplied.autonomousQaAgent = {
      status: mapAgentStatus(options.agentEvidence.overall),
      reason: 'Derived from autonomous QA agent overall result.',
      evidence: options.agentEvidence.jsonPath || options.agentEvidence.evidence || null,
      sourceSha,
    };
  }

  const items = {};
  for (const [id, label] of ITEM_DEFINITIONS) {
    items[id] = normalizeEvidenceItem(id, label, supplied[id]);
  }

  return {
    schemaVersion: 1,
    gate: 'FINAL_RELEASE_GATE',
    sourceSha,
    generatedAt: new Date().toISOString(),
    overall: summarizeOverall(items),
    items,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith('--agent-evidence=')) out.agentEvidence = arg.slice('--agent-evidence='.length);
    else if (arg.startsWith('--real-evidence=')) out.realEvidence = arg.slice('--real-evidence='.length);
    else if (arg.startsWith('--output=')) out.output = arg.slice('--output='.length);
    else if (arg.startsWith('--source-sha=')) out.sourceSha = arg.slice('--source-sha='.length);
  }
  return out;
}

module.exports = { VALID_STATUSES, ITEM_DEFINITIONS, buildGate, summarizeOverall };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const agentEvidencePath = args.agentEvidence || process.env.OPERIS_QA_AGENT_EVIDENCE || '';
  const realEvidencePath = args.realEvidence || process.env.OPERIS_REAL_RELEASE_EVIDENCE || '';
  const outputPath = path.resolve(args.output || process.env.OPERIS_FINAL_RELEASE_GATE || 'FINAL_RELEASE_GATE.json');
  const agentEvidence = agentEvidencePath && fs.existsSync(agentEvidencePath) ? readJson(agentEvidencePath) : null;
  const realEvidence = realEvidencePath && fs.existsSync(realEvidencePath) ? readJson(realEvidencePath) : {};
  const sourceSha = args.sourceSha || process.env.GITHUB_SHA || (agentEvidence && agentEvidence.sourceSha) || 'unknown';
  const gate = buildGate({
    sourceSha,
    agentEvidence: agentEvidence ? { ...agentEvidence, jsonPath: agentEvidencePath } : null,
    evidence: realEvidence.evidence || realEvidence.items || realEvidence,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(gate, null, 2) + '\n', 'utf8');
  console.log(outputPath);
  console.log('FINAL_RELEASE_GATE=' + gate.overall);
  process.exitCode = gate.overall === 'FAIL' ? 1 : 0;
}
