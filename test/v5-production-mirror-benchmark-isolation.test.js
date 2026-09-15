import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';

const {
  isBenchmarkMirrorJob,
  productionMirrorJobs
} = await import('../utils/lms-handlers/admin-v5-telegram-import-scoped.js');

const scopedHandlerCode = fs.readFileSync(
  new URL('../utils/lms-handlers/admin-v5-telegram-import-scoped.js', import.meta.url),
  'utf8'
);
const routerCode = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');

test('1. benchmark marker is fail-closed to payload.benchmark === true', () => {
  assert.equal(isBenchmarkMirrorJob({ payload: { benchmark: true } }), true);
  assert.equal(isBenchmarkMirrorJob({ payload: { benchmark: false } }), false);
  assert.equal(isBenchmarkMirrorJob({ payload: { source_id: 'source-1' } }), false);
  assert.equal(isBenchmarkMirrorJob({ payload: null }), false);
  assert.equal(isBenchmarkMirrorJob({ payload: ['benchmark'] }), false);
});

test('2. production mirror status excludes benchmark history before computing progress', () => {
  const jobs = [
    { id: 'prod-success', job_type: 'telegram_mirror', status: 'success', payload: { source_id: 'source-1' } },
    { id: 'prod-failed', job_type: 'telegram_mirror', status: 'failed', payload: { source_id: 'source-1' } },
    { id: 'old-benchmark-failed', job_type: 'telegram_mirror', status: 'failed', payload: { benchmark: true } }
  ];
  const production = productionMirrorJobs(jobs);
  assert.deepEqual(production.map(job => job.id), ['prod-success', 'prod-failed']);

  assert.match(scopedHandlerCode, /\.select\("id,asset_id,job_type,status,payload,progress_current/);
  assert.match(scopedHandlerCode, /const safeJobs = productionMirrorJobs\(jobs \|\| \[\]\)/);
  assert.match(scopedHandlerCode, /computeMirrorProgress\(\{ jobs: safeJobs, assets:/);
});

test('3. retry failed media excludes benchmark jobs before selecting assets or mutating state', () => {
  assert.match(scopedHandlerCode, /\.select\("id,asset_id,status,job_type,attempts,max_attempts,payload"\)/);
  assert.match(scopedHandlerCode, /const failedJobs = productionMirrorJobs\(failedJobRows \|\| \[\]\)/);
  assert.match(scopedHandlerCode, /const assetIds = \[\.\.\.new Set\(failedJobs\.map/);
  assert.match(scopedHandlerCode, /const targetJobs = failedJobs\.filter/);
  assert.doesNotMatch(scopedHandlerCode, /\.delete\(/);
});

test('4. LMS admin routes v5 Telegram status/retry through production-scoped wrapper', () => {
  assert.match(
    routerCode,
    /adminV5TelegramImportHandler from "\.\.\/\.\.\/utils\/lms-handlers\/admin-v5-telegram-import-scoped\.js"/
  );
  assert.match(routerCode, /endpoint === "v5-telegram-import"/);
});

test('5. import, preview and source listing still delegate to the existing V5 Telegram handler', () => {
  assert.match(scopedHandlerCode, /if \(!isMirrorStatus && !isRetryFailed\) \{/);
  assert.match(scopedHandlerCode, /return adminV5TelegramImportHandler\(req, res\)/);
  assert.match(scopedHandlerCode, /action === "mirror_status"/);
  assert.match(scopedHandlerCode, /action === "retry_failed_media"/);
});
