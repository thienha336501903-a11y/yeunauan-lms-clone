import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const adminHtml = fs.readFileSync(new URL('../v5-admin.html', import.meta.url), 'utf8');
const handlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');

test('1. v5-admin.html contains retry button for failed media in mirror progress', () => {
  assert.match(adminHtml, /retryFailedMediaBtn/);
  assert.match(adminHtml, /Thử lại \$\{status\.failed\} media lỗi/);
  assert.match(adminHtml, /action:'retry_failed_media'/);
  assert.match(adminHtml, /⚠ \$\{status\.assetsReady\|\|0\}\/\$\{status\.assetsTotal\|\|0\} READY — \$\{status\.failed\} media lỗi/);
});

test('2. admin-v5-telegram-import handler exports retryFailedTelegramMedia and handles retry_failed_media action', () => {
  assert.match(handlerCode, /export async function retryFailedTelegramMedia\(courseId\)/);
  assert.match(handlerCode, /action === "retry_failed_media" \|\| action === "retry_failed"/);
});

test('3. retryFailedTelegramMedia strictly scopes to current course and telegram_mirror failed jobs', () => {
  assert.match(handlerCode, /\.eq\("course_id", courseId\)/);
  assert.match(handlerCode, /\.eq\("job_type", "telegram_mirror"\)/);
  assert.match(handlerCode, /\.eq\("status", "failed"\)/);
  assert.match(handlerCode, /\.eq\("origin", "telegram"\)/);
});

test('4. retryFailedTelegramMedia updates asset status from failed to processing', () => {
  assert.match(handlerCode, /\.from\("v5_media_assets"\)[\s\S]*status: "processing"[\s\S]*last_error: null/);
});

test('5. retryFailedTelegramMedia resets job status to queued and clears lock/error/attempt fields', () => {
  assert.match(handlerCode, /\.from\("v5_jobs"\)[\s\S]*status: "queued"[\s\S]*attempts: 0[\s\S]*last_error: null[\s\S]*locked_at: null[\s\S]*locked_by: null/);
});

test('6. Invariants preserved: no new posts or lessons created during retry', () => {
  // Ensure retry function does NOT insert into lessons or v5_posts
  const retryFuncMatch = handlerCode.match(/export async function retryFailedTelegramMedia[\s\S]*?return \{/);
  assert.ok(retryFuncMatch);
  assert.doesNotMatch(retryFuncMatch[0], /\.from\("lessons"\)\.insert/);
  assert.doesNotMatch(retryFuncMatch[0], /\.from\("v5_posts"\)\.insert/);
  assert.doesNotMatch(retryFuncMatch[0], /\.from\("v5_media_assets"\)\.insert/);
});

test('7. Invariants preserved: #172 direct play, #176 outline per post, #177 search navigation', () => {
  const appJs = fs.readFileSync(new URL('../v5/app.js', import.meta.url), 'utf8');
  assert.match(appJs, /scrollToPost/);
  assert.match(appJs, /activeSearchResultIndex/);
  assert.match(appJs, /updateSearchNavigatorUI/);
  assert.match(appJs, /navigateSearchResult/);
  assert.match(appJs, /v5_timeline_progress_/);
});
