import os from 'node:os';
import type { NextFunction, Request, Response } from 'express';

type CpuTimes = { idle: number; total: number };
type RequestSample = { at: number; latencyMs: number; statusCode: number };

const requestSamples: RequestSample[] = [];
let requestSampleHead = 0;
let previousCpuTimes = readCpuTimes();
let previousProcessCpu = process.cpuUsage();
let previousProcessSampleAt = process.hrtime.bigint();

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function pruneRequestSamples(now = Date.now()): void {
  const cutoff = now - 60_000;
  while (requestSampleHead < requestSamples.length && requestSamples[requestSampleHead].at < cutoff) {
    requestSampleHead += 1;
  }
  if (requestSampleHead >= 4096 && requestSampleHead >= Math.floor(requestSamples.length / 2)) {
    requestSamples.splice(0, requestSampleHead);
    requestSampleHead = 0;
  }
}

function activeRequestSamples(): RequestSample[] {
  return requestSampleHead === 0 ? requestSamples : requestSamples.slice(requestSampleHead);
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

export function systemPerformanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/api') || req.path === '/api/admin/system-performance') {
    next();
    return;
  }
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    requestSamples.push({ at: Date.now(), latencyMs: elapsedMs, statusCode: res.statusCode });
    pruneRequestSamples();
  });
  next();
}

export function buildRuntimePerformanceSnapshot() {
  const now = Date.now();
  pruneRequestSamples(now);

  const currentCpuTimes = readCpuTimes();
  const deltaTotal = currentCpuTimes.total - previousCpuTimes.total;
  const deltaIdle = currentCpuTimes.idle - previousCpuTimes.idle;
  const systemCpuPercent = deltaTotal > 0 ? clampPercent(((deltaTotal - deltaIdle) / deltaTotal) * 100) : 0;
  previousCpuTimes = currentCpuTimes;

  const sampleAt = process.hrtime.bigint();
  const elapsedMicros = Number(sampleAt - previousProcessSampleAt) / 1_000;
  const processDelta = process.cpuUsage(previousProcessCpu);
  const logicalProcessors = Math.max(1, os.cpus().length);
  const processCpuPercent = elapsedMicros > 0
    ? clampPercent(((processDelta.user + processDelta.system) / elapsedMicros / logicalProcessors) * 100)
    : 0;
  previousProcessCpu = process.cpuUsage();
  previousProcessSampleAt = sampleAt;

  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
  const memory = process.memoryUsage();
  const samples = activeRequestSamples();
  const recent10Seconds = samples.filter(sample => sample.at >= now - 10_000);
  const requestCount60s = samples.length;
  const httpErrors = samples.filter(sample => sample.statusCode >= 400).length;
  const serverErrors = samples.filter(sample => sample.statusCode >= 500).length;

  return {
    sampledAt: now,
    system: {
      hostName: os.hostname(), platform: os.platform(), release: os.release(), architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? '', logicalProcessors, systemCpuPercent: round(systemCpuPercent),
      totalMemoryBytes, usedMemoryBytes, freeMemoryBytes,
      memoryUsedPercent: totalMemoryBytes > 0 ? round((usedMemoryBytes / totalMemoryBytes) * 100) : 0,
      uptimeSeconds: Math.round(os.uptime()),
    },
    operis: {
      processId: process.pid, processCpuPercent: round(processCpuPercent), processMemoryBytes: memory.rss,
      heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal, uptimeSeconds: Math.round(process.uptime()),
    },
    traffic: {
      requestsPerSecond: round(recent10Seconds.length / 10), requestCount60s,
      p95LatencyMs: round(percentile95(samples.map(sample => sample.latencyMs))),
      httpErrorRatePercent: requestCount60s ? round((httpErrors / requestCount60s) * 100) : 0,
      serverErrorRatePercent: requestCount60s ? round((serverErrors / requestCount60s) * 100) : 0,
    },
  };
}