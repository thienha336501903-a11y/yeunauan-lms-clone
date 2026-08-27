import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('V5 content is isolated behind v5 tables and existing LMS admin function', () => {
  const handler = read('utils/lms-handlers/admin-v5-content.js');
  const admin = read('api/lms/admin.js');
  assert.match(handler, /v5_course_configs/);
  assert.match(handler, /v5_lessons/);
  assert.match(handler, /v5_posts/);
  assert.match(handler, /v5_media_assets/);
  assert.match(admin, /endpoint === "v5-content"/);
  assert.doesNotMatch(handler, /from\("lessons"\)/);
  assert.doesNotMatch(handler, /from\("lms_v4_media_tickets"\)/);
});

test('V5 composer requires existing LMS admin session and course scoping', () => {
  const handler = read('utils/lms-handlers/admin-v5-content.js');
  assert.match(handler, /getAdminFromRequest/);
  assert.match(handler, /eq\("course_id", course\.id\)/);
  assert.match(handler, /Danh sách sắp xếp chứa dữ liệu ngoài khóa học/);
});

test('V5 student feed keeps enrollment gate and publish gate', () => {
  const feed = read('utils/lms-handlers/v5-feed.js');
  assert.match(feed, /requireV4CourseAccess/);
  assert.match(feed, /config\.status !== "published"/);
  assert.match(feed, /\.eq\("status", "published"\)/);
  assert.match(feed, /\.eq\("status", "ready"\)/);
});

test('Telegram-like UI is a channel composer rather than a technical upload dashboard', () => {
  const admin = read('v5-admin.html');
  assert.match(admin, /Nhập nội dung như Telegram/);
  assert.match(admin, /attachBtn/);
  assert.match(admin, /folderBtn/);
  assert.match(admin, /sendBtn/);
  assert.match(admin, /newLessonBtn/);
  assert.match(admin, /post-menu/);
  assert.doesNotMatch(admin, /Video URL:/);
  assert.doesNotMatch(admin, /Thumbnail URL:/);
});

test('V5 internal sync accepts dedicated and legacy secrets during transition', () => {
  const sync = read('api/v5-sync.js');
  assert.match(sync, /req\.headers\["x-sync-secret"\].*\.trim\(\)/s);
  assert.match(sync, /process\.env\.V5_SYNC_SECRET/);
  assert.match(sync, /process\.env\.INTERNAL_SYNC_SECRET/);
  assert.match(sync, /\.filter\(Boolean\)/);
  assert.match(sync, /secrets\.some\(secret => safeEqual\(supplied, secret\)\)/);
});

test('temporary V5 sync bypass is pinned to one isolated test order and revalidated in DB', () => {
  const sync = read('api/v5-sync.js');
  assert.match(sync, /1336cb4f-649c-40e4-9513-9b718f338308/);
  assert.match(sync, /__clone_factory_test_v5_prod_detect2@example\.com/);
  assert.match(sync, /__clone_factory_test_v5_prod_detect2/);
  assert.match(sync, /from\("orders"\)/);
  assert.match(sync, /delivery_mode/);
  assert.match(sync, /authorizedByTestFixture/);
  assert.match(sync, /syncEnrollment.*revokeEnrollment/s);
});
