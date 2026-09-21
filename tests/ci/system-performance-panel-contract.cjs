const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const metricsPath = 'server/src/system-performance.ts';

assert.ok(fs.existsSync(metricsPath), 'system-performance backend module is missing');

const metrics = read(metricsPath);
const server = read('server/src/index.ts');
const api = read('src/lib/api.ts');
const settings = read('src/components/SettingsPanel.tsx');

assert.match(metrics, /systemCpuPercent/, 'system CPU metric is missing');
assert.match(metrics, /processCpuPercent/, 'OPERIS process CPU metric is missing');
assert.match(metrics, /totalMemoryBytes/, 'total RAM metric is missing');
assert.match(metrics, /processMemoryBytes/, 'OPERIS RAM metric is missing');
assert.match(metrics, /requestsPerSecond/, 'request-rate metric is missing');
assert.match(metrics, /p95LatencyMs/, 'API p95 latency metric is missing');

assert.match(server, /\/api\/admin\/system-performance/, 'admin performance endpoint is missing');
assert.match(server, /pg_stat_activity/, 'PostgreSQL connection metric is missing');
assert.match(server, /userSession\.count/, 'active session metric is missing');

assert.match(api, /export type SystemPerformanceMetrics/, 'frontend metrics type is missing');
assert.match(api, /getSystemPerformance/, 'frontend metrics API method is missing');

assert.match(settings, /'performance'/, 'settings performance section key is missing');
assert.match(settings, /Sistem Performansı/, 'performance accordion is missing');
assert.match(settings, /setInterval/, 'live polling is missing');
assert.match(settings, /CPU/, 'CPU display is missing');
assert.match(settings, /RAM/, 'RAM display is missing');
assert.match(settings, /Aktif Oturum/, 'active session display is missing');

console.log('SYSTEM_PERFORMANCE_PANEL_CONTRACT_PASS');