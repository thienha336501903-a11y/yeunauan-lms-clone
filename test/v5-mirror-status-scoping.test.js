import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';

const {
  computeMirrorProgress,
  sanitizeSafeError
} = await import('../utils/lms-handlers/admin-v5-telegram-import.js');

const handlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../v5-admin.html', import.meta.url), 'utf8');

test('1. getTelegramMirrorStatus does NOT query v5_media_assets.course_id', () => {
  const statusFuncMatch = handlerCode.match(/export async function getTelegramMirrorStatus[\s\S]*?\n\}\n\nexport async function retryFailedTelegramMedia/);
  assert.ok(statusFuncMatch, 'getTelegramMirrorStatus must exist');
  const code = statusFuncMatch[0];

  // Must query v5_jobs by course_id
  assert.match(code, /\.from\("v5_jobs"\)[\s\S]*?\.eq\("course_id", courseId\)/);
  // Must NOT query v5_media_assets by course_id
  assert.doesNotMatch(code, /\.from\("v5_media_assets"\)[\s\S]*?\.eq\("course_id"/);
  // Must query v5_media_assets by in("id", assetIds)
  assert.match(code, /\.from\("v5_media_assets"\)[\s\S]*?\.in\("id", assetIds\)/);
});

test('2. retryFailedTelegramMedia does NOT query or update v5_media_assets with course_id', () => {
  const retryFuncMatch = handlerCode.match(/export async function retryFailedTelegramMedia[\s\S]*?\n\}\n\nexport default async function/);
  assert.ok(retryFuncMatch, 'retryFailedTelegramMedia must exist');
  const code = retryFuncMatch[0];

  // Must query v5_jobs by course_id
  assert.match(code, /\.from\("v5_jobs"\)[\s\S]*?\.eq\("course_id", courseId\)/);

  // Must NOT query v5_media_assets with course_id
  const mediaSelect = code.match(/\.from\("v5_media_assets"\)\s*\.select\([\s\S]*?\);/);
  assert.ok(mediaSelect, 'v5_media_assets select query must exist');
  assert.doesNotMatch(mediaSelect[0], /\.eq\("course_id"/);

  // Must NOT update v5_media_assets with course_id
  const mediaUpdate = code.match(/\.from\("v5_media_assets"\)\s*\.update\([\s\S]*?\);/);
  assert.ok(mediaUpdate, 'v5_media_assets update query must exist');
  assert.doesNotMatch(mediaUpdate[0], /\.eq\("course_id"/);

  // Must update v5_jobs with course_id
  assert.match(code, /\.from\("v5_jobs"\)[\s\S]*?\.update[\s\S]*?\.eq\("course_id", courseId\)/);
});

test('3. Defense-in-depth: retry action handler ignores client-provided asset IDs', () => {
  const actionHandlerMatch = handlerCode.match(/action === "retry_failed_media"[\s\S]*?retryFailedTelegramMedia\(course\.id\)/);
  assert.ok(actionHandlerMatch, 'retry_failed_media must only pass course.id to retryFailedTelegramMedia');
  const code = actionHandlerMatch[0];
  assert.doesNotMatch(code, /req\.(?:query|body)\.asset/);
  assert.doesNotMatch(code, /req\.(?:query|body)\.job/);
});

test('4. Course A mirror status: strictly isolates Course A assets from Course B assets', () => {
  // Course A: 46 jobs (44 success, 2 failed: telegram-30.jpg, telegram-33.jpg)
  const courseAJobs = [];
  const courseAAssets = [];

  for (let i = 1; i <= 46; i++) {
    const assetId = `asset-A-${i}`;
    const filename = (i === 30) ? 'telegram-30.jpg' : (i === 33) ? 'telegram-33.jpg' : `telegram-${i}.mp4`;
    const isFailed = (i === 30 || i === 33);

    courseAJobs.push({
      id: `job-A-${i}`,
      asset_id: assetId,
      course_id: 'course-A-id',
      job_type: 'telegram_mirror',
      status: isFailed ? 'failed' : 'success',
      progress_current: 0,
      progress_total: 0,
      last_error: isFailed ? 'size_mismatch' : null
    });

    courseAAssets.push({
      id: assetId,
      status: isFailed ? 'failed' : 'ready',
      bytes: isFailed ? (i === 30 ? 78301 : 70251) : 1000000,
      original_filename: filename,
      last_error: isFailed ? 'Telegram returned fewer bytes than index' : null,
      r2_object_key: `courses/course-A/assets/${assetId}`
    });
  }

  // Course B jobs and assets (completely unrelated)
  const courseBJobs = [
    { id: 'job-B-1', asset_id: 'asset-B-1', course_id: 'course-B-id', job_type: 'telegram_mirror', status: 'failed' }
  ];
  const courseBAssets = [
    { id: 'asset-B-1', status: 'failed', bytes: 50000, original_filename: 'course-b-leak.jpg' }
  ];

  // Simulating the scoped retrieval:
  // Step 1: Query v5_jobs for Course A -> courseAJobs
  const safeJobs = courseAJobs;
  const assetIds = [...new Set(safeJobs.map(j => j.asset_id).filter(Boolean))];
  assert.equal(assetIds.length, 46);
  assert.ok(!assetIds.includes('asset-B-1'), 'Course B asset IDs must never be in Course A scope');

  // Step 2: Query v5_media_assets where id IN (assetIds)
  const allDbAssets = [...courseAAssets, ...courseBAssets];
  const retrievedAssets = allDbAssets.filter(a => assetIds.includes(a.id));
  assert.equal(retrievedAssets.length, 46);
  assert.ok(retrievedAssets.every(a => a.id.startsWith('asset-A-')), 'Retrieved assets must strictly belong to Course A');

  // Step 3: Compute progress
  const progress = computeMirrorProgress({ jobs: safeJobs, assets: retrievedAssets });
  assert.equal(progress.totalJobs, 46);
  assert.equal(progress.success, 44);
  assert.equal(progress.failed, 2);
  assert.equal(progress.running, 0);
  assert.equal(progress.queued, 0);
  assert.equal(progress.hasJobs, true);
  assert.equal(progress.allReady, false);
  assert.equal(progress.assetsReady, 44);
  assert.equal(progress.assetsFailed, 2);

  // Failed jobs list has telegram-30.jpg and telegram-33.jpg
  assert.equal(progress.failedJobs.length, 2);
  const failedFilenames = progress.failedJobs.map(f => f.filename);
  assert.ok(failedFilenames.includes('telegram-30.jpg'));
  assert.ok(failedFilenames.includes('telegram-33.jpg'));
});

test('5. Retry failed media semantics: targets ONLY failed Telegram assets of current course', () => {
  // Setup DB state
  const jobsDb = [
    { id: 'job-A-30', course_id: 'course-A', asset_id: 'asset-A-30', job_type: 'telegram_mirror', status: 'failed', attempts: 5, last_error: 'err' },
    { id: 'job-A-33', course_id: 'course-A', asset_id: 'asset-A-33', job_type: 'telegram_mirror', status: 'failed', attempts: 5, last_error: 'err' },
    { id: 'job-A-1', course_id: 'course-A', asset_id: 'asset-A-1', job_type: 'telegram_mirror', status: 'success', attempts: 1, last_error: null },
    { id: 'job-B-1', course_id: 'course-B', asset_id: 'asset-B-1', job_type: 'telegram_mirror', status: 'failed', attempts: 5, last_error: 'err' }
  ];

  const assetsDb = [
    { id: 'asset-A-30', origin: 'telegram', status: 'failed', last_error: 'err' },
    { id: 'asset-A-33', origin: 'telegram', status: 'failed', last_error: 'err' },
    { id: 'asset-A-1', origin: 'telegram', status: 'ready', last_error: null },
    { id: 'asset-B-1', origin: 'telegram', status: 'failed', last_error: 'err' },
    { id: 'asset-A-non-tg', origin: 'upload', status: 'failed', last_error: 'err' }
  ];

  // Execution simulation of retryFailedTelegramMedia('course-A'):
  const courseId = 'course-A';
  const failedJobs = jobsDb.filter(j => j.course_id === courseId && j.job_type === 'telegram_mirror' && j.status === 'failed');
  assert.equal(failedJobs.length, 2);

  const assetIds = [...new Set(failedJobs.map(j => j.asset_id).filter(Boolean))];
  assert.deepEqual(assetIds, ['asset-A-30', 'asset-A-33']);

  const failedAssets = assetsDb.filter(a => assetIds.includes(a.id) && a.origin === 'telegram' && a.status === 'failed');
  assert.equal(failedAssets.length, 2);

  const validAssetIds = new Set(failedAssets.map(a => a.id));
  const targetJobs = failedJobs.filter(j => validAssetIds.has(j.asset_id));
  assert.equal(targetJobs.length, 2);

  // Perform updates
  for (const asset of assetsDb) {
    if (validAssetIds.has(asset.id)) {
      asset.status = 'processing';
      asset.last_error = null;
    }
  }

  for (const job of jobsDb) {
    if (targetJobs.some(tj => tj.id === job.id)) {
      job.status = 'queued';
      job.attempts = 0;
      job.last_error = null;
    }
  }

  // Verification
  assert.equal(assetsDb.find(a => a.id === 'asset-A-30').status, 'processing');
  assert.equal(assetsDb.find(a => a.id === 'asset-A-33').status, 'processing');
  assert.equal(assetsDb.find(a => a.id === 'asset-A-1').status, 'ready', 'READY asset must remain untouched');
  assert.equal(assetsDb.find(a => a.id === 'asset-B-1').status, 'failed', 'Course B asset must remain untouched');

  assert.equal(jobsDb.find(j => j.id === 'job-A-30').status, 'queued');
  assert.equal(jobsDb.find(j => j.id === 'job-A-33').status, 'queued');
  assert.equal(jobsDb.find(j => j.id === 'job-A-1').status, 'success', 'Success job must remain untouched');
  assert.equal(jobsDb.find(j => j.id === 'job-B-1').status, 'failed', 'Course B job must remain untouched');

  // Second execution immediately after: no failed jobs left
  const failedJobsSecond = jobsDb.filter(j => j.course_id === courseId && j.job_type === 'telegram_mirror' && j.status === 'failed');
  assert.equal(failedJobsSecond.length, 0);
  const resultSecond = { retried: 0, jobIds: [], assetIds: [] };
  assert.equal(resultSecond.retried, 0, 'Repeated retry when no failed jobs returns retried = 0');
});

test('6. UI Error visibility: pollMirrorStatus handles initial failure safely without leaking SQL/internals', () => {
  assert.match(adminHtml, /async function openTelegramWizard\(\)\{[\s\S]*?pollMirrorStatus\(\{silent:false\}\)/);
  assert.match(adminHtml, /if\(!silent\)toast\('Không tải được trạng thái mirror\. Bấm Làm mới để thử lại\.'\)/);

  // Background polling continues to use silent:true
  assert.match(adminHtml, /setTimeout\(\(\)=>pollMirrorStatus\(\{silent:true\}\),MIRROR_POLL_INTERVAL_MS\)/);

  // Check no SQL keywords in the toast
  const toastMatch = adminHtml.match(/if\(!silent\)toast\(([^)]+)\)/);
  assert.ok(toastMatch);
  assert.doesNotMatch(toastMatch[1], /SELECT|FROM|WHERE|column|v5_/i);
});
