const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const VALID_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE']);

const STAGES = [
  { id: 'source', label: 'Repository source identity', inspect: 'repository metadata' },
  { id: 'typecheck', label: 'Frontend TypeScript typecheck', command: 'npm run typecheck' },
  { id: 'build', label: 'Production frontend + server build', command: 'npm run build' },
  { id: 'frontend-artifact', label: 'Compiled frontend CSS and asset contract', command: 'node tests/ci/verify-frontend-css-build.cjs' },
  { id: 'settings-static', label: 'Settings/bootstrap/static asset regression', command: 'node tests/ci/settings-and-static-asset-regression.cjs' },
  {
    id: 'domain-sync-contracts',
    label: 'Domain sync diagnostics, LDAP security and scheduler contracts',
    command: 'node tests/ci/domain-sync-error-diagnostic-contract.cjs && node tests/ci/domain-sync-ldaps-provider-contract.cjs && node tests/ci/domain-sync-secure-ldap-contract.cjs && node tests/ci/domain-sync-scheduler-contract.cjs'
  },
  {
    id: 'windows-contracts',
    label: 'Windows installer/runtime contracts',
    platform: 'win32',
    command: "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& './tests/windows/install-contract-smoke.ps1'; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; $env:GITHUB_ACTIONS='true'; if (-not $env:RUNNER_TEMP) { $env:RUNNER_TEMP=$env:TEMP }; & './tests/windows/installer-runtime-ownership.ps1'; exit $LASTEXITCODE\""
  },
  { id: 'security-root', label: 'Root production dependency audit', command: 'npm audit --omit=dev --audit-level=high' },
  { id: 'security-server', label: 'Server production dependency audit', command: 'npm --prefix server audit --omit=dev --audit-level=high' },
];

function tail(value, max = 20000) {
  const text = String(value || '');
  return text.length > max ? text.slice(-max) : text;
}

function isoNow() {
  return new Date().toISOString();
}

function executeShell(command, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
  const startedAt = isoNow();
  const startedMs = Date.now();
  const result = spawnSync(shell, args, {
    cwd: options.cwd || ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  const finishedAt = isoNow();
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  return {
    command,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    exitCode,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr || (result.error && (result.error.stack || result.error.message))),
  };
}

function inspectSource(sourceSha) {
  const node = executeShell('node --version');
  const npm = executeShell('npm --version');
  const git = sourceSha
    ? { exitCode: 0, stdout: sourceSha, stderr: '', command: 'GITHUB_SHA' }
    : executeShell('git rev-parse HEAD');
  const resolvedSha = String(git.stdout || '').trim();
  return {
    status: git.exitCode === 0 && resolvedSha ? 'PASS' : 'FAIL',
    reason: git.exitCode === 0 && resolvedSha ? 'source identity resolved' : 'source SHA could not be resolved',
    details: {
      sourceSha: resolvedSha || 'unknown',
      node: String(node.stdout || '').trim() || 'unknown',
      npm: String(npm.stdout || '').trim() || 'unknown',
      platform: process.platform,
    },
    command: git.command,
    exitCode: git.exitCode,
    stdout: git.stdout,
    stderr: git.stderr,
  };
}

function summarizeOverall(stages) {
  const statuses = stages.map(stage => stage.status);
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.includes('PASS')) return 'PASS';
  return 'NOT_APPLICABLE';
}

function buildDryRunEvidence(ctx = {}) {
  const sourceSha = ctx.sourceSha || process.env.GITHUB_SHA || 'unknown';
  const platform = ctx.platform || process.platform;
  const startedAt = ctx.startedAt || isoNow();
  const stages = STAGES.map(stage => ({
    id: stage.id,
    label: stage.label,
    status: 'NOT_APPLICABLE',
    reason: 'dry-run: command not executed',
    command: stage.command || null,
    inspect: stage.inspect || null,
    platform: stage.platform || 'any',
  }));
  return {
    schemaVersion: 1,
    agent: 'OPERIS Autonomous QA / Release Agent',
    mode: 'dry-run',
    sourceSha,
    platform,
    startedAt,
    finishedAt: isoNow(),
    overall: 'NOT_APPLICABLE',
    stages,
  };
}

function markdownFor(evidence) {
  const lines = [
    '# OPERIS Autonomous QA / Release Agent',
    '',
    '- Mode: ' + evidence.mode,
    '- Source SHA: ' + evidence.sourceSha,
    '- Platform: ' + evidence.platform,
    '- Overall: **' + evidence.overall + '**',
    '- Started: ' + evidence.startedAt,
    '- Finished: ' + evidence.finishedAt,
    '',
    '## Stages',
    '',
  ];
  for (const stage of evidence.stages) {
    lines.push('### ' + stage.id + ' — ' + stage.status);
    lines.push(stage.reason ? '- Reason: ' + stage.reason : '- Reason: n/a');
    if (stage.command) lines.push('- Command: ' + stage.command);
    if (Number.isInteger(stage.exitCode)) lines.push('- Exit: ' + stage.exitCode);
    if (stage.stdout) lines.push('', '~~~text', tail(stage.stdout, 4000), '~~~');
    if (stage.stderr) lines.push('', '~~~text', tail(stage.stderr, 4000), '~~~');
    lines.push('');
  }
  if (evidence.aiHandoff) {
    lines.push('## AI failure handoff', '', '- Path: ' + evidence.aiHandoff, '');
  }
  lines.push('## Safety rule', '', 'Missing or unexecuted real-environment evidence is never converted to PASS.');
  return lines.join('\n');
}

function writeEvidence(evidence, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'operis-qa-agent.json');
  const mdPath = path.join(outputDir, 'operis-qa-agent.md');
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, markdownFor(evidence) + '\n', 'utf8');
  return { jsonPath, mdPath };
}

function generateAiHandoff(outputDir, failedStage) {
  const diagnosticDir = path.join(outputDir, 'ai-handoff');
  fs.mkdirSync(diagnosticDir, { recursive: true });
  const result = executeShell('node tests/ci/generate-ai-handoff.cjs', {
    env: {
      OPERIS_DIAGNOSTIC_DIR: diagnosticDir,
      OPERIS_FAILED_STAGE: failedStage || '',
    },
  });
  const expected = path.join(diagnosticDir, 'AI_HANDOFF.md');
  return {
    path: fs.existsSync(expected) ? expected : null,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runAgent(options = {}) {
  const outputDir = options.outputDir || process.env.OPERIS_QA_EVIDENCE_DIR || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'operis-qa-agent');
  const dryRun = Boolean(options.dryRun);
  const startedAt = isoNow();
  const sourceSha = process.env.GITHUB_SHA || '';

  if (dryRun) {
    const evidence = buildDryRunEvidence({ sourceSha: sourceSha || 'unknown', startedAt });
    const paths = writeEvidence(evidence, outputDir);
    return { evidence, ...paths };
  }

  const results = [];
  let failedStage = null;
  let resolvedSha = sourceSha || 'unknown';

  for (const stage of STAGES) {
    if (failedStage) {
      results.push({
        id: stage.id,
        label: stage.label,
        status: 'NOT_APPLICABLE',
        reason: 'skipped after FAIL in ' + failedStage,
        command: stage.command || null,
        inspect: stage.inspect || null,
      });
      continue;
    }

    if (stage.platform && stage.platform !== process.platform) {
      results.push({
        id: stage.id,
        label: stage.label,
        status: 'BLOCKED',
        reason: 'requires platform ' + stage.platform + '; current platform is ' + process.platform,
        command: stage.command || null,
      });
      continue;
    }

    if (stage.inspect === 'repository metadata') {
      const inspected = inspectSource(sourceSha);
      resolvedSha = inspected.details.sourceSha || resolvedSha;
      results.push({ id: stage.id, label: stage.label, ...inspected });
      if (inspected.status === 'FAIL') failedStage = stage.id;
      continue;
    }

    const executed = executeShell(stage.command);
    const status = executed.exitCode === 0 ? 'PASS' : 'FAIL';
    results.push({
      id: stage.id,
      label: stage.label,
      status,
      reason: status === 'PASS' ? 'command completed successfully' : 'command returned non-zero exit',
      ...executed,
    });
    if (status === 'FAIL') failedStage = stage.id;
  }

  const evidence = {
    schemaVersion: 1,
    agent: 'OPERIS Autonomous QA / Release Agent',
    mode: 'execute',
    sourceSha: resolvedSha,
    platform: process.platform,
    startedAt,
    finishedAt: isoNow(),
    overall: summarizeOverall(results),
    failedStage,
    stages: results,
  };

  if (failedStage) {
    const handoff = generateAiHandoff(outputDir, failedStage);
    evidence.aiHandoff = handoff.path;
    evidence.aiHandoffExitCode = handoff.exitCode;
    evidence.aiHandoffStdout = handoff.stdout;
    evidence.aiHandoffStderr = handoff.stderr;
    evidence.finishedAt = isoNow();
  }

  const paths = writeEvidence(evidence, outputDir);
  return { evidence, ...paths };
}

module.exports = { ROOT, VALID_STATUSES, STAGES, summarizeOverall, buildDryRunEvidence, runAgent };

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const outputArg = process.argv.find(arg => arg.startsWith('--output='));
  const outputDir = outputArg ? path.resolve(outputArg.slice('--output='.length)) : undefined;
  const result = runAgent({ outputDir, dryRun });
  console.log(result.jsonPath);
  console.log(result.mdPath);
  process.exitCode = result.evidence.overall === 'FAIL' ? 1 : 0;
}
