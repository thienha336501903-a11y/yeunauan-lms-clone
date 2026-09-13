import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';

const {
  computeMirrorProgress,
  sanitizeSafeError,
  sanitizeFilename,
  formatBytes
} = await import('../utils/lms-handlers/admin-v5-telegram-import.js');

const adminHtml = fs.readFileSync(new URL('../v5-admin.html', import.meta.url), 'utf8');
const importHandlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');

test('1. computeMirrorProgress: 46 jobs (14 success, 1 running, 31 queued, 0 failed) yields jobPercent = 30', () => {
  const jobs = [];
  const assets = [];

  for (let i = 1; i <= 46; i++) {
    const assetId = `asset-${i}`;
    let jobStatus = 'queued';
    let assetStatus = 'processing';
    if (i <= 14) {
      jobStatus = 'success';
      assetStatus = 'ready';
    } else if (i === 15) {
      jobStatus = 'running';
      assetStatus = 'processing';
    }

    jobs.push({
      id: `job-${i}`,
      asset_id: assetId,
      job_type: 'telegram_mirror',
      status: jobStatus,
      progress_current: 0,
      progress_total: 0
    });

    assets.push({
      id: assetId,
      status: assetStatus,
      bytes: 1000000,
      original_filename: `file-${i}.mp4`
    });
  }

  const result = computeMirrorProgress({ jobs, assets });
  assert.equal(result.totalJobs, 46);
  assert.equal(result.success, 14);
  assert.equal(result.running, 1);
  assert.equal(result.queued, 31);
  assert.equal(result.failed, 0);
  assert.equal(result.completedJobs, 14);
  assert.equal(result.jobPercent, 30); // 14 / 46 = 30.43% -> 30%

  assert.equal(result.assetsTotal, 46);
  assert.equal(result.assetsReady, 14);
  assert.equal(result.assetsProcessing, 32);
  assert.equal(result.assetsFailed, 0);
  assert.equal(result.readyPercent, 30);
  assert.equal(result.allReady, false);
  assert.equal(result.hasJobs, true);
});

test('2. computeMirrorProgress: all 46 success + all 46 ready yields 100% and allReady = true', () => {
  const jobs = [];
  const assets = [];

  for (let i = 1; i <= 46; i++) {
    const assetId = `asset-${i}`;
    jobs.push({
      id: `job-${i}`,
      asset_id: assetId,
      job_type: 'telegram_mirror',
      status: 'success',
      progress_current: 0,
      progress_total: 0
    });
    assets.push({
      id: assetId,
      status: 'ready',
      bytes: 1000000,
      original_filename: `file-${i}.mp4`
    });
  }

  const result = computeMirrorProgress({ jobs, assets });
  assert.equal(result.totalJobs, 46);
  assert.equal(result.success, 46);
  assert.equal(result.queued, 0);
  assert.equal(result.running, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.jobPercent, 100);
  assert.equal(result.assetsReady, 46);
  assert.equal(result.readyPercent, 100);
  assert.equal(result.allReady, true);
});

test('3. computeMirrorProgress: failed job makes failed count visible and allReady = false', () => {
  const jobs = [];
  const assets = [];

  for (let i = 1; i <= 46; i++) {
    const assetId = `asset-${i}`;
    const isFailed = i === 46;
    jobs.push({
      id: `job-${i}`,
      asset_id: assetId,
      job_type: 'telegram_mirror',
      status: isFailed ? 'failed' : 'success',
      last_error: isFailed ? 'Telegram download timeout on https://api.telegram.org/bot12345/secret_token' : null,
      progress_current: 0,
      progress_total: 0
    });
    assets.push({
      id: assetId,
      status: isFailed ? 'failed' : 'ready',
      bytes: 1000000,
      original_filename: `file-${i}.mp4`
    });
  }

  const result = computeMirrorProgress({ jobs, assets });
  assert.equal(result.totalJobs, 46);
  assert.equal(result.success, 45);
  assert.equal(result.failed, 1);
  assert.equal(result.allReady, false);
  assert.equal(result.failedJobs.length, 1);
  assert.equal(result.failedJobs[0].status, 'failed');
  assert.equal(result.failedJobs[0].filename, 'file-46.mp4');
  // Error must NOT contain the sensitive URL
  assert.doesNotMatch(result.failedJobs[0].error, /api\.telegram\.org/);
  assert.match(result.failedJobs[0].error, /\[URL\]/);
});

test('4. computeMirrorProgress: running job with known byte progress computes subprogress correctly', () => {
  const jobs = [
    {
      id: 'job-1',
      asset_id: 'asset-1',
      job_type: 'telegram_mirror',
      status: 'running',
      progress_current: 35100000,
      progress_total: 40500000
    }
  ];
  const assets = [
    {
      id: 'asset-1',
      status: 'processing',
      bytes: 40500000,
      original_filename: '5.mp4'
    }
  ];

  const result = computeMirrorProgress({ jobs, assets });
  assert.equal(result.currentJobs.length, 1);
  assert.equal(result.currentJobs[0].filename, '5.mp4');
  assert.equal(result.currentJobs[0].progressPercent, 87); // 35100000 / 40500000 = 86.66% -> 87%
  assert.equal(result.currentJobs[0].detail, '33.5 MB / 38.6 MB');
  assert.equal(result.bytesCompleted, 35100000);
  assert.equal(result.bytesTotal, 40500000);
  assert.equal(result.bytePercent, 87);
});

test('5. computeMirrorProgress: running job with progress_total = 0 produces no fake percent and no NaN', () => {
  const jobs = [
    {
      id: 'job-1',
      asset_id: 'asset-1',
      job_type: 'telegram_mirror',
      status: 'running',
      progress_current: 0,
      progress_total: 0
    }
  ];
  const assets = [
    {
      id: 'asset-1',
      status: 'processing',
      bytes: 0,
      original_filename: 'video.mp4'
    }
  ];

  const result = computeMirrorProgress({ jobs, assets });
  assert.equal(result.currentJobs[0].progressPercent, null);
  assert.equal(result.currentJobs[0].detail, 'Đang tải Telegram / upload R2');
  assert.equal(result.bytePercent, null); // unknown, not fake 0 or NaN
});

test('6. sanitizeSafeError strips sensitive paths, URLs, and token hashes', () => {
  const raw1 = 'Error reading C:\\Users\\Administrator\\secret\\project\\file.mp4';
  assert.equal(sanitizeSafeError(raw1), 'Error reading [PATH]');

  const raw2 = 'Failed to fetch https://api.telegram.org/bot987654321:ABCDEF1234567890/getFile';
  assert.equal(sanitizeSafeError(raw2), 'Failed to fetch [URL]');

  const raw3 = 'Invalid token auth_secret_999999999999999999999999';
  assert.doesNotMatch(sanitizeSafeError(raw3), /999999999999999999999999/);
});

test('7. sanitizeFilename cleans paths and limits length safely', () => {
  assert.equal(sanitizeFilename('D:\\uploads\\videos\\lesson1.mp4'), 'lesson1.mp4');
  assert.equal(sanitizeFilename('/var/www/data/image.png'), 'image.png');
  assert.equal(sanitizeFilename(''), 'Tệp media');
});

test('8. Backend handler routes mirror_status action across GET and POST with strict course scoping', () => {
  assert.match(importHandlerCode, /action === "mirror_status" \|\| action === "status" \|\| action === "telegramMirrorStatus"/);
  assert.match(importHandlerCode, /getTelegramMirrorStatus\(course\.id\)/);
  assert.match(importHandlerCode, /\.eq\("course_id", courseId\)/);
  assert.match(importHandlerCode, /\.eq\("job_type", "telegram_mirror"\)/);
});

test('9. v5-admin.html contains complete mirror progress UI elements', () => {
  assert.match(adminHtml, /id="telegramMirrorProgressContainer"/);
  assert.match(adminHtml, /id="mirrorProgressTitle"/);
  assert.match(adminHtml, /id="mirrorProgressPercentTag"/);
  assert.match(adminHtml, /id="mirrorProgressBar"/);
  assert.match(adminHtml, /id="mirrorProgressStats"/);
  assert.match(adminHtml, /id="mirrorProgressCurrent"/);
  assert.match(adminHtml, /id="mirrorProgressErrors"/);
  assert.match(adminHtml, /id="mirrorProgressComplete"/);
  assert.match(adminHtml, /id="mirrorProgressNote"/);
  assert.match(adminHtml, /id="refreshMirrorStatusBtn"/);
  assert.match(adminHtml, /id="mirrorPollingIndicator"/);
});

test('10. v5-admin.html polling behavior conforms to safety invariants', () => {
  // Polling interval between 2s and 3s (2000 - 3000ms)
  const intervalMatch = adminHtml.match(/MIRROR_POLL_INTERVAL_MS\s*=\s*(\d+)/);
  assert.ok(intervalMatch, 'MIRROR_POLL_INTERVAL_MS must be defined');
  const interval = Number(intervalMatch[1]);
  assert.ok(interval >= 2000 && interval <= 3000, `Interval ${interval}ms must be between 2000ms and 3000ms`);

  // stopMirrorPolling on modal close and course switch
  assert.match(adminHtml, /if\(id==='telegramModal'\)stopMirrorPolling\(\)/);
  assert.match(adminHtml, /async function chooseCourse\(slug\)\{[\s\S]*?stopMirrorPolling\(\)/);

  // openTelegramWizard loads mirror status
  assert.match(adminHtml, /async function openTelegramWizard\(\)\{[\s\S]*?pollMirrorStatus\(\{silent:true\}\)/);

  // executeTelegramImport triggers pollMirrorStatus when jobs queued
  assert.match(adminHtml, /if\(res\.mirrorJobsQueued>0\)await pollMirrorStatus\(\)/);

  // Complete state text
  assert.match(adminHtml, /Media đã sẵn sàng — 100%/);
  assert.match(adminHtml, /Có thể chạy Preflight \/ Publish/);

  // Incomplete note
  assert.match(adminHtml, /Chưa sẵn sàng Publish: media đang xử lý/);
});
