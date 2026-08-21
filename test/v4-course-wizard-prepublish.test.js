import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const prepublish = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-prepublish.js', import.meta.url), 'utf8');
const wizard = fs.readFileSync(new URL('../v4-course-wizard.html', import.meta.url), 'utf8');
const legacyAdmin = fs.readFileSync(new URL('../v4-admin.html', import.meta.url), 'utf8');

test('admin router exposes isolated V4 prepublish endpoint', () => {
  assert.match(router, /admin-v4-prepublish\.js/);
  assert.match(router, /endpoint === "v4-prepublish"/);
});

test('V4 prepublish endpoint is admin-only, GET-only and read-only', () => {
  assert.match(prepublish, /getAdminFromRequest\(req\)/);
  assert.match(prepublish, /req\.method !== "GET"/);
  assert.match(prepublish, /lms_v4_telegram_course_sources/);
  assert.match(prepublish, /tgcloner_sources/);
  assert.match(prepublish, /tgcloner_source_messages/);
  assert.match(prepublish, /student_enrollments/);
  assert.doesNotMatch(prepublish, /\.insert\(/);
  assert.doesNotMatch(prepublish, /\.update\(/);
  assert.doesNotMatch(prepublish, /\.upsert\(/);
  assert.doesNotMatch(prepublish, /\.delete\(/);
});

test('prepublish uses exact source counts and bounded paginated media scanning', () => {
  assert.match(prepublish, /count: "exact", head: true/);
  assert.match(prepublish, /MEDIA_SCAN_PAGE_SIZE = 500/);
  assert.match(prepublish, /MAX_MEDIA_SCAN_ROWS = 10000/);
  assert.match(prepublish, /\.range\(from, to\)/);
  assert.match(prepublish, /"media-scan"[\s\S]*"block"/);
});

test('prepublish blocks broken source/content and missing metadata for any Telegram media', () => {
  assert.match(prepublish, /"mapping"[\s\S]*"block"/);
  assert.match(prepublish, /"source"[\s\S]*"block"/);
  assert.match(prepublish, /"messages"[\s\S]*"block"/);
  assert.match(prepublish, /function mediaState/);
  assert.match(prepublish, /raw\.from_reader/);
  assert.match(prepublish, /missingFileIds/);
  assert.match(prepublish, /"media-metadata"[\s\S]*"block"/);
  assert.match(prepublish, /media thiếu file_id/);
  assert.match(prepublish, /ready: blockers === 0/);
});

test('prepublish tracks historical reader media and video thumbnails separately', () => {
  assert.match(prepublish, /historicalMedia/);
  assert.match(prepublish, /"historical-media"/);
  assert.match(prepublish, /missingThumbnails/);
  assert.match(prepublish, /"video-thumbnail"[\s\S]*"warn"/);
});

test('prepublish understands current Cloner health shape', () => {
  assert.match(prepublish, /payload\?\.checks\?\.database !== false/);
  assert.match(prepublish, /payload\?\.configured\?\.telegramBot !== false/);
  assert.match(prepublish, /payload\?\.configured\?\.telegramWebhook !== false/);
});

test('prepublish warns instead of hard-blocking transient gateway or no-enrollment state', () => {
  assert.match(prepublish, /"enrollments"[\s\S]*"warn"/);
  assert.match(prepublish, /"gateway"[\s\S]*"warn"/);
  assert.match(prepublish, /không tự chặn Publish/);
  assert.match(prepublish, /GATEWAY_TIMEOUT_MS = 2500/);
});

test('wizard reuses stable V4 APIs rather than duplicating runtime behavior', () => {
  assert.match(wizard, /endpoint=v4-source&mode=sources/);
  assert.match(wizard, /action:'createCourse'/);
  assert.match(wizard, /endpoint=v4-enrollments/);
  assert.match(wizard, /endpoint=v4-prepublish/);
  assert.match(wizard, /action:'setPublished'/);
  assert.match(wizard, /published:true/);
  assert.match(wizard, /V4 Admin đầy đủ/);
});

test('wizard requires preflight readiness and explicit acknowledgement before publish', () => {
  assert.match(wizard, /id="publishAck"/);
  assert.match(wizard, /state\.preflight\?\.ready/);
  assert.match(wizard, /!\$\('publishAck'\)\.checked/);
  assert.match(wizard, /Blocker phải bằng 0/);
  assert.match(wizard, /Đã duyệt – Chờ lên bài/);
});

test('existing V4 admin remains present as the unchanged fallback surface', () => {
  assert.match(legacyAdmin, /Quản trị khóa học V4/);
  assert.match(legacyAdmin, /id="readyBtn"/);
  assert.match(legacyAdmin, /id="saveSourceBtn"/);
  assert.match(legacyAdmin, /endpoint=v4-source&mode=health/);
  assert.match(wizard, /href="\/v4-admin\.html"/);
});
