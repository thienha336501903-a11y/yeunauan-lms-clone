import { randomUUID } from 'node:crypto';
import { cloneConfig } from '../utils/clone-config.js';

const config = cloneConfig({});
const TARGET = { name: 'v4-media-ticket-gate', url: config.telegramMediaGatewayUrl, expect: [403] };
const WAVES = [100, 150, 200, 250, 300];
const REQUEST_TIMEOUT_MS = 12_000;
const WAVE_PAUSE_MS = 5_000;
const MAX_ERROR_RATE = 0.01;
const MAX_P95_MS = 8_000;
const USER_AGENT = 'SystemB-Capacity-QA-V4-Media-Gate/2026-09-05';

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function oneRequest(wave, vu) {
  const started = performance.now();
  const ticket = randomUUID(); // syntactically valid but guaranteed test-only/non-issued
  try {
    const response = await fetch(`${TARGET.url}?ticket=${encodeURIComponent(ticket)}`, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    await response.arrayBuffer();
    const elapsedMs = Math.round(performance.now() - started);
    const ok = TARGET.expect.includes(response.status);
    return { wave, vu, ok, status: response.status, elapsedMs, error: ok ? null : `unexpected_status_${response.status}` };
  } catch (error) {
    return {
      wave,
      vu,
      ok: false,
      status: 0,
      elapsedMs: Math.round(performance.now() - started),
      error: String(error?.name || error?.message || 'request_failed')
    };
  }
}

function summarize(rows) {
  const latencies = rows.map(row => row.elapsedMs);
  const errors = rows.filter(row => !row.ok);
  const statuses = {};
  for (const row of rows) statuses[row.status] = (statuses[row.status] || 0) + 1;
  return {
    requests: rows.length,
    errors: errors.length,
    errorRate: rows.length ? errors.length / rows.length : 1,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.length ? Math.max(...latencies) : null,
    statuses,
    samples: errors.slice(0, 5).map(row => ({ status: row.status, error: row.error, elapsedMs: row.elapsedMs }))
  };
}

async function main() {
  console.log('SYSTEM B V4 MEDIA TICKET-GATE CAPACITY');
  console.log(`userAgent=${USER_AGENT}`);
  console.log(`target=${TARGET.name}; expected_status=403 for non-issued UUID tickets`);
  console.log(`waves=${WAVES.join(',')}`);
  console.log(`guard: errorRate<=${MAX_ERROR_RATE * 100}% and p95<=${MAX_P95_MS}ms; abort on failed wave`);

  const report = [];
  let allPass = true;
  for (const wave of WAVES) {
    console.log(`\n--- wave ${wave} concurrent ticket-gate requests ---`);
    const started = performance.now();
    const rows = await Promise.all(Array.from({ length: wave }, (_, index) => oneRequest(wave, index + 1)));
    const elapsedMs = Math.round(performance.now() - started);
    const summary = summarize(rows);
    const pass = summary.errorRate <= MAX_ERROR_RATE && summary.p95Ms !== null && summary.p95Ms <= MAX_P95_MS;
    report.push({ wave, elapsedMs, pass, summary });
    console.log(JSON.stringify({ wave, elapsedMs, pass, summary }, null, 2));
    if (!pass) {
      allPass = false;
      console.error(`ABORT: wave ${wave} crossed threshold; larger waves will not run.`);
      break;
    }
    if (wave !== WAVES[WAVES.length - 1]) await sleep(WAVE_PAUSE_MS);
  }

  console.log('\n=== FINAL REPORT ===');
  console.log(JSON.stringify({ allPass, report }, null, 2));
  if (!allPass || report.at(-1)?.wave !== 300 || report.at(-1)?.pass !== true) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
