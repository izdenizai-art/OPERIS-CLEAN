import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import exec from 'k6/execution';

const baseUrl = (__ENV.OPERIS_BASE_URL || '').replace(/\/+$/, '');
const branchCode = __ENV.OPERIS_BRANCH_CODE || '100';
const password = __ENV.OPERIS_CAPACITY_PASSWORD || '';
const maxUsers = Math.min(750, Math.max(1, Number(__ENV.OPERIS_CAPACITY_MAX_USERS || 750)));
const mode = (__ENV.OPERIS_LOAD_MODE || 'normal').toLowerCase();
const allLevels = [75, 100, 150, 300, 500, 750];
const levels = allLevels.filter(level => level <= maxUsers);
if (!levels.includes(maxUsers)) levels.push(maxUsers);
levels.sort((a, b) => a - b);
if (!baseUrl) fail('OPERIS_BASE_URL is required.');
if (password.length < 12) fail('OPERIS_CAPACITY_PASSWORD is required.');
if (!['normal', 'helpdesk', 'mixed'].includes(mode)) fail('Invalid OPERIS_LOAD_MODE.');

const plan = levels.map(level => ({
  target: level,
  ramp: level <= 150 ? 15 : level <= 300 ? 20 : level <= 500 ? 25 : 30,
  hold: level < maxUsers ? 30 : 60,
}));
const stages = [];
const phases = [];
let cursor = 0;
for (const phase of plan) {
  const start = cursor;
  stages.push({ duration: phase.ramp + 's', target: phase.target });
  cursor += phase.ramp;
  stages.push({ duration: phase.hold + 's', target: phase.target });
  cursor += phase.hold;
  phases.push({ start, end: cursor, target: phase.target });
}
stages.push({ duration: '20s', target: 0 });

const apiDuration = new Trend('operis_api_duration', true);
const loginDuration = new Trend('operis_login_duration', true);
const functionalFailures = new Rate('operis_functional_failures');
const serverFailures = new Rate('operis_server_failures');
const thresholds = {};
for (const level of levels) {
  const tag = '{capacity:' + level + '}';
  thresholds['http_req_failed' + tag] = ['rate<0.01'];
  thresholds['operis_functional_failures' + tag] = ['rate<0.01'];
  thresholds['operis_server_failures' + tag] = ['rate<0.01'];
  thresholds['operis_api_duration' + tag] = ['p(95)<1500', 'p(99)<3000'];
}

export const options = {
  scenarios: { capacity_ramp: { executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: '10s', gracefulStop: '10s' } },
  thresholds,
  noCookiesReset: true,
};

let loggedIn = false;
let iteration = 0;
let mixedTaskId = '';

function capacity() {
  const seconds = exec.instance.currentTestRunDuration / 1000;
  return String(phases.find(item => seconds >= item.start && seconds < item.end)?.target || maxUsers);
}
function headers(endpoint) {
  return { headers: { 'Content-Type': 'application/json', 'X-Operis-Branch-Code': branchCode }, tags: { capacity: capacity(), endpoint } };
}
function record(response, name, expected = 200) {
  const cap = capacity();
  const ok = check(response, { [name + ' status ' + expected]: item => item.status === expected });
  functionalFailures.add(!ok, { capacity: cap });
  serverFailures.add(response.status >= 500, { capacity: cap });
  apiDuration.add(response.timings.duration, { capacity: cap, endpoint: name });
  return ok;
}
function ensureLogin() {
  if (loggedIn) return;
  const userIndex = ((__VU - 1) % maxUsers) + 1;
  const username = 'operiscap_' + String(userIndex).padStart(4, '0');
  const cap = capacity();
  const response = http.post(baseUrl + '/api/auth/login', JSON.stringify({ username, password }), {
    headers: { 'Content-Type': 'application/json' }, tags: { capacity: cap, endpoint: 'login' },
  });
  loginDuration.add(response.timings.duration, { capacity: cap });
  const ok = check(response, { 'login status 200': item => item.status === 200 });
  functionalFailures.add(!ok, { capacity: cap });
  serverFailures.add(response.status >= 500, { capacity: cap });
  if (!ok) fail('login failed status=' + response.status + ' vu=' + __VU);
  loggedIn = true;
}
function normalCycle() {
  record(http.get(baseUrl + '/api/auth/me', headers('auth_me')), 'auth/me');
  record(http.get(baseUrl + '/api/branches/context', headers('branch_context')), 'branches/context');
  if (iteration % 3 === 0) record(http.get(baseUrl + '/api/bootstrap', headers('bootstrap')), 'bootstrap');
}
function helpDeskCycle() {
  normalCycle();
  record(http.get(baseUrl + '/api/helpdesk/recent?branchCode=' + encodeURIComponent(branchCode), headers('helpdesk_recent')), 'helpdesk/recent');
  record(http.get(baseUrl + '/api/helpdesk/tickets?branchCode=' + encodeURIComponent(branchCode) + '&scope=mine&state=open&queueFilter=all', headers('helpdesk_tickets')), 'helpdesk/tickets');
}
function mixedCycle() {
  normalCycle();
  if (iteration % 5 !== 0) return;
  if (!mixedTaskId) mixedTaskId = 'cap-' + Date.now() + '-vu-' + __VU;
  const payload = {
    id: mixedTaskId, title: 'Capacity VU ' + __VU, description: 'OPERIS controlled capacity test',
    date: new Date().toISOString().slice(0, 10), time: '12:00', priority: 'orta',
    completed: false, createdAt: Date.now(),
  };
  const created = http.post(baseUrl + '/api/tasks', JSON.stringify(payload), headers('task_create'));
  if (created.status === 201) record(created, 'tasks/create', 201);
  else if (created.status !== 409) record(created, 'tasks/create', 201);
}
export function setup() {
  const health = http.get(baseUrl + '/api/health');
  if (health.status !== 200) fail('Health failed: ' + health.status);
  const body = health.json();
  if (body?.database?.provider !== 'postgresql' || body?.database?.connected !== true) fail('PostgreSQL health contract failed.');
}
export default function () {
  ensureLogin();
  iteration += 1;
  if (mode === 'helpdesk') helpDeskCycle();
  else if (mode === 'mixed') mixedCycle();
  else normalCycle();
  sleep(1);
}
export function handleSummary(data) {
  const summary = { generatedAt: new Date().toISOString(), mode, maxUsers, levels, plan, metrics: {} };
  for (const [name, metric] of Object.entries(data.metrics || {})) {
    if (name.includes('capacity:') || ['http_req_failed','operis_api_duration','operis_login_duration','operis_functional_failures','operis_server_failures','iterations','vus','vus_max'].includes(name)) {
      summary.metrics[name] = metric.values || {};
    }
  }
  return { stdout: 'OPERIS_CAPACITY_SUMMARY ' + JSON.stringify(summary) + '\n', 'operis-capacity-summary.json': JSON.stringify(summary, null, 2) };
}
