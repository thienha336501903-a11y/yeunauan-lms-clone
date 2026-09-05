import { cloneConfig } from '../utils/clone-config.js';

const config = cloneConfig({});

const TARGETS = [
  { name: 'lms-static', url: `${config.lmsPublicUrl}/my-courses.html`, expect: [200] },
  { name: 'lms-public-config', url: `${config.lmsPublicUrl}/api/lms/portal?endpoint=public-config`, expect: [200] },
  { name: 'lms-db-health', url: `${config.lmsPublicUrl}/api/lms/portal?endpoint=health`, expect: [200] },
  { name: 'cloner-db-health', url: config.telegramClonerHealthUrl, expect: [200] },
  { name: 'v5-worker-health', url: 'https://yeubep-v5-media.daubepnho116.workers.dev/health', expect: [200] }
];

const WAVES = [25, 50, 100, 200, 300];
const REQUEST_TIMEOUT_MS = 12_000;
const WAVE_PAUSE_MS = 4_000;
const MAX_ERROR_RATE = 0.01;
const MAX_P95_MS = 8_000;
const USER_AGENT = 'SystemB-Capacity-QA/2026-09-05';

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function oneRequest(target, wave, vu) {
  const started = performance.now();
  try {
    const response = await fetch(target.url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': target.name.includes('static') ? 'text/html,*/*;q=0.8' : 'application/json,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    await response.arrayBuffer();
    const elapsedMs = Math.round(performance.now() - started);
    const expected = target.expect.includes(response.status);
    return {
      target: target.name,
      wave,
      vu,
      ok: expected,
      status: response.status,
      elapsedMs,
      error: expected ? null : `unexpected_status_${response.status}`
    };
  } catch (error) {
    return {
      target: target.name,
      wave,
      vu,
      ok: false,
      status: 0,
      elapsedMs: Math.round(performance.now() - started),
      error: String(error?.name || error?.message || 'request_failed')
    };
  }
}

async function virtualUser(wave, vu) {
  const rows = [];
  for (const target of TARGETS) {
    rows.push(await oneRequest(target, wave, vu));
  }
  return rows;
}

function summarize(rows) {
  const summary = {};
  for (const target of TARGETS) {
    const group = rows.filter(row => row.target === target.name);
    const latencies = group.map(row => row.elapsedMs);
    const errors = group.filter(row => !row.ok);
    const statusCounts = {};
    for (const row of group) statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    summary[target.name] = {
      requests: group.length,
      errors: errors.length,
      errorRate: group.length ? errors.length / group.length : 1,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      maxMs: latencies.length ? Math.max(...latencies) : null,
      statuses: statusCounts,
      samples: errors.slice(0, 5).map(row => ({ status: row.status, error: row.error, elapsedMs: row.elapsedMs }))
    };
  }
  return summary;
}

function wavePass(summary) {
  return Object.values(summary).every(item =>
    item.errorRate <= MAX_ERROR_RATE &&
    item.p95Ms !== null &&
    item.p95Ms <= MAX_P95_MS
  );
}

async function main() {
  console.log('SYSTEM B 300-STUDENT CAPACITY QA');
  console.log(`userAgent=${USER_AGENT}`);
  console.log(`targets=${TARGETS.map(t => t.name).join(',')}`);
  console.log(`waves=${WAVES.join(',')}`);
  console.log(`guard: errorRate<=${MAX_ERROR_RATE * 100}% and p95<=${MAX_P95_MS}ms; abort on failed wave`);

  const report = [];
  let allPass = true;

  for (const wave of WAVES) {
    console.log(`\n--- wave ${wave} concurrent virtual students ---`);
    const started = performance.now();
    const nested = await Promise.all(Array.from({ length: wave }, (_, index) => virtualUser(wave, index + 1)));
    const rows = nested.flat();
    const elapsedMs = Math.round(performance.now() - started);
    const summary = summarize(rows);
    const pass = wavePass(summary);
    report.push({ wave, elapsedMs, pass, summary });

    console.log(JSON.stringify({ wave, elapsedMs, pass, summary }, null, 2));

    if (!pass) {
      allPass = false;
      console.error(`ABORT: wave ${wave} crossed the safety/acceptance threshold; larger waves will not run.`);
      break;
    }

    if (wave !== WAVES[WAVES.length - 1]) await sleep(WAVE_PAUSE_MS);
  }

  console.log('\n=== FINAL REPORT ===');
  console.log(JSON.stringify({ allPass, report }, null, 2));

  if (!allPass || report.at(-1)?.wave !== 300 || report.at(-1)?.pass !== true) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
