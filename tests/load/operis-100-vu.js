import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const baseUrl = (__ENV.OPERIS_BASE_URL || '').replace(/\/+$/, '');
const branchCode = __ENV.OPERIS_BRANCH_CODE || '100';
const mode = (__ENV.OPERIS_LOAD_MODE || 'normal').toLowerCase();
const usersJson = __ENV.OPERIS_LOAD_USERS_JSON || '';
const fallbackUsername = __ENV.OPERIS_LOAD_USERNAME || '';
const fallbackPassword = __ENV.OPERIS_LOAD_PASSWORD || '';
const requireUniqueUsers = (__ENV.OPERIS_REQUIRE_UNIQUE_USERS || 'true').toLowerCase() === 'true';
const helpDeskScope = (__ENV.OPERIS_HELPDESK_SCOPE || 'mine').toLowerCase();
const expectedDatabaseProvider = (__ENV.OPERIS_EXPECTED_DATABASE_PROVIDER || 'postgresql').toLowerCase();

if (!baseUrl) fail('OPERIS_BASE_URL zorunludur.');

let users = [];
if (usersJson) {
  try {
    users = JSON.parse(usersJson);
  } catch (error) {
    fail(`OPERIS_LOAD_USERS_JSON geçersiz JSON: ${error}`);
  }
}
if (!Array.isArray(users) || users.length === 0) {
  if (!fallbackUsername || !fallbackPassword) {
    fail('OPERIS_LOAD_USERS_JSON veya OPERIS_LOAD_USERNAME + OPERIS_LOAD_PASSWORD verilmelidir.');
  }
  users = [{ username: fallbackUsername, password: fallbackPassword }];
}

users = users
  .filter(item => item && typeof item.username === 'string' && typeof item.password === 'string')
  .map(item => ({ username: item.username.trim(), password: item.password }))
  .filter(item => item.username && item.password);

if (users.length === 0) fail('Geçerli load-test kullanıcı bilgisi bulunamadı.');

if (requireUniqueUsers) {
  const uniqueUsernames = new Set(users.map(item => item.username.toLocaleLowerCase('tr-TR')));
  if (users.length < 100 || uniqueUsernames.size < 100) {
    fail(`100 gerçek online kullanıcı sertifikasyonu için en az 100 benzersiz kullanıcı gerekir. Sağlanan: ${uniqueUsernames.size}.`);
  }
}

if (!['mine', 'assigned', 'branch'].includes(helpDeskScope)) {
  fail(`OPERIS_HELPDESK_SCOPE geçersiz: ${helpDeskScope}`);
}

const loginDuration = new Trend('operis_login_duration', true);
const apiDuration = new Trend('operis_api_duration', true);
const functionalFailures = new Rate('operis_functional_failures');
const serverFailures = new Rate('operis_server_failures');
const sqliteBusyFailures = new Rate('operis_sqlite_busy_failures');

export const options = {
  scenarios: {
    online_users_100: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },
        { duration: '2m', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '10m', target: 100 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    operis_functional_failures: ['rate<0.01'],
    operis_api_duration: ['p(95)<1500', 'p(99)<3000'],
    operis_login_duration: ['p(95)<2500'],
    operis_server_failures: ['rate<0.01'],
    operis_sqlite_busy_failures: ['rate<0.001'],
  },
};

let loggedIn = false;
let activeCredential = null;
let identityVerified = false;
let branchVerified = false;
let iterationCount = 0;
let mixedTaskCreated = false;
let mixedTaskId = '';
let mixedTaskCreatedAt = 0;

function jsonHeaders(branch = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (branch) headers['X-Operis-Branch-Code'] = branch;
  return headers;
}

function assertOk(response, name, expected = 200) {
  const ok = check(response, {
    [`${name} status ${expected}`]: r => r.status === expected,
  });
  functionalFailures.add(!ok);
  const isServerFailure = response.status >= 500;
  serverFailures.add(isServerFailure);

  const body = String(response.body || '');
  const sqliteBusy = /SQLITE_BUSY|database is locked|database table is locked/i.test(body);
  sqliteBusyFailures.add(sqliteBusy);

  if (!ok && isServerFailure) {
    console.error(`${name} ${response.status}: ${body}`);
  }
  return ok;
}

function ensureLogin() {
  if (loggedIn) return;

  const credential = users[(__VU - 1) % users.length];
  activeCredential = credential;
  const response = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ username: credential.username, password: credential.password }),
    { headers: jsonHeaders(), tags: { endpoint: 'login' } },
  );
  loginDuration.add(response.timings.duration);
  if (!assertOk(response, 'login')) {
    fail(`VU ${__VU} giriş yapamadı: HTTP ${response.status}`);
  }
  loggedIn = true;
}

function normalUserCycle() {
  const me = http.get(`${baseUrl}/api/auth/me`, {
    headers: jsonHeaders(branchCode),
    tags: { endpoint: 'auth_me' },
  });
  apiDuration.add(me.timings.duration);
  if (assertOk(me, 'auth/me') && !identityVerified) {
    let meBody = null;
    try { meBody = me.json(); } catch (_) {}
    const expectedUsername = String(activeCredential?.username || '').toLocaleLowerCase('tr-TR');
    const actualUsername = String(meBody?.user?.username || meBody?.username || '').toLocaleLowerCase('tr-TR');
    const identityOk = Boolean(expectedUsername && actualUsername === expectedUsername);
    functionalFailures.add(!identityOk);
    if (!identityOk) fail(`VU ${__VU} kullanıcı kimliği uyuşmuyor. Beklenen=${expectedUsername} Gerçek=${actualUsername}`);
    identityVerified = true;
  }

  const context = http.get(`${baseUrl}/api/branches/context`, {
    headers: jsonHeaders(branchCode),
    tags: { endpoint: 'branch_context' },
  });
  apiDuration.add(context.timings.duration);
  if (assertOk(context, 'branches/context') && !branchVerified) {
    let contextBody = null;
    try { contextBody = context.json(); } catch (_) {}
    const accessible = Array.isArray(contextBody?.accessibleBranchCodes) ? contextBody.accessibleBranchCodes : [];
    const activeBranch = String(contextBody?.activeBranchCode || contextBody?.branchCode || '');
    const branchOk = accessible.includes(branchCode) && (!activeBranch || activeBranch === branchCode);
    functionalFailures.add(!branchOk);
    if (!branchOk) fail(`VU ${__VU} şube bağlamı uyuşmuyor. branch=${branchCode} active=${activeBranch}`);
    branchVerified = true;
  }

  if (iterationCount % 4 === 0) {
    const bootstrap = http.get(`${baseUrl}/api/bootstrap`, {
      headers: jsonHeaders(branchCode),
      tags: { endpoint: 'bootstrap' },
    });
    apiDuration.add(bootstrap.timings.duration);
    assertOk(bootstrap, 'bootstrap');
  }

  sleep(15);
}

function mixedCrudCycle() {
  normalUserCycle();

  if (iterationCount % 5 !== 0) return;

  const now = Date.now();
  const runId = __ENV.OPERIS_LOAD_RUN_ID || 'manual';
  if (!mixedTaskId) {
    mixedTaskId = `k6-${runId}-vu-${__VU}`;
    mixedTaskCreatedAt = now;
  }
  const today = new Date(mixedTaskCreatedAt).toISOString().slice(0, 10);
  const payload = {
    id: mixedTaskId,
    title: `K6 WTD48 VU ${__VU}`,
    description: `OPERIS kontrollü karma yük testi kaydı - ${now}`,
    date: today,
    time: '12:00',
    priority: 'orta',
    completed: false,
    createdAt: mixedTaskCreatedAt,
  };

  if (!mixedTaskCreated) {
    const created = http.post(
      `${baseUrl}/api/tasks`,
      JSON.stringify(payload),
      { headers: jsonHeaders(branchCode), tags: { endpoint: 'task_create' } },
    );
    apiDuration.add(created.timings.duration);
    const createOk = assertOk(created, 'tasks/create', 201);
    if (!createOk) return;
    mixedTaskCreated = true;
    return;
  }

  const lock = http.post(
    `${baseUrl}/api/record-locks/acquire`,
    JSON.stringify({ module: 'TASKS', recordId: mixedTaskId }),
    { headers: jsonHeaders(branchCode), tags: { endpoint: 'task_lock' } },
  );
  apiDuration.add(lock.timings.duration);
  if (!assertOk(lock, 'tasks/lock')) return;

  const updated = http.put(
    `${baseUrl}/api/tasks/${encodeURIComponent(mixedTaskId)}`,
    JSON.stringify(payload),
    { headers: jsonHeaders(branchCode), tags: { endpoint: 'task_update' } },
  );
  apiDuration.add(updated.timings.duration);
  assertOk(updated, 'tasks/update');
}

function helpDeskCycle() {
  const recent = http.get(
    `${baseUrl}/api/helpdesk/recent?branchCode=${encodeURIComponent(branchCode)}`,
    { headers: jsonHeaders(branchCode), tags: { endpoint: 'helpdesk_recent' } },
  );
  apiDuration.add(recent.timings.duration);
  assertOk(recent, 'helpdesk/recent');

  const scope = helpDeskScope === 'branch'
    ? 'all'
    : helpDeskScope === 'assigned'
      ? 'assigned'
      : 'mine';

  const tickets = http.get(
    `${baseUrl}/api/helpdesk/tickets?branchCode=${encodeURIComponent(branchCode)}&scope=${scope}&state=open&queueFilter=all`,
    { headers: jsonHeaders(branchCode), tags: { endpoint: `helpdesk_tickets_${helpDeskScope}` } },
  );
  apiDuration.add(tickets.timings.duration);
  assertOk(tickets, `helpdesk/tickets/${helpDeskScope}`);

  sleep(4);
}

export function setup() {
  const health = http.get(`${baseUrl}/api/health`, { tags: { endpoint: 'health' } });
  if (health.status !== 200) fail(`Health endpoint başarısız: ${health.status}`);
  const body = health.json();
  if (!body || body.version !== '6.3.63') fail(`Beklenmeyen OPERIS sürümü: ${body?.version}`);
  const provider = String(body?.database?.provider || '').toLowerCase();
  if (expectedDatabaseProvider && provider !== expectedDatabaseProvider) {
    fail(`Beklenmeyen veritabanı provider: ${provider}; beklenen=${expectedDatabaseProvider}`);
  }
  if (body?.database?.connected !== true) fail('OPERIS veritabanı bağlantısı connected=true değil.');
  return { version: body.version, databaseProvider: provider };
}

export default function () {
  ensureLogin();
  iterationCount += 1;
  if (mode === 'helpdesk') helpDeskCycle();
  else if (mode === 'mixed') mixedCrudCycle();
  else normalUserCycle();
}


export function handleSummary(data) {
  const metrics = data.metrics || {};
  const compact = {
    generatedAt: new Date().toISOString(),
    mode,
    branchCode,
    expectedDatabaseProvider,
    configuredUsers: users.length,
    uniqueUsers: new Set(users.map(item => item.username.toLocaleLowerCase('tr-TR'))).size,
    requireUniqueUsers,
    metrics: {
      http_req_failed: metrics.http_req_failed?.values || null,
      operis_functional_failures: metrics.operis_functional_failures?.values || null,
      operis_server_failures: metrics.operis_server_failures?.values || null,
      operis_api_duration: metrics.operis_api_duration?.values || null,
      operis_login_duration: metrics.operis_login_duration?.values || null,
    },
  };
  return {
    stdout: `OPERIS_LOAD_SUMMARY ${JSON.stringify(compact)}\n`,
    'operis-load-summary.json': JSON.stringify(compact, null, 2),
  };
}
