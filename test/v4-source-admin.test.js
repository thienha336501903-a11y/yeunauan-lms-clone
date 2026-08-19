import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-source.js', import.meta.url), 'utf8');
const courses = fs.readFileSync(new URL('../utils/lms-handlers/admin-courses.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../v4-admin.html', import.meta.url), 'utf8');
const adminPage = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

test('admin router exposes V4 Telegram source endpoint', () => {
  assert.match(router, /admin-v4-source\.js/);
  assert.match(router, /endpoint === "v4-source"/);
});

test('V4 source endpoint is admin-only and course-scoped', () => {
  assert.match(handler, /getAdminFromRequest\(req\)/);
  assert.match(handler, /delivery_mode/);
  assert.match(handler, /!== "v4"/);
  assert.match(handler, /lms_v4_telegram_course_sources/);
  assert.match(handler, /tgcloner_sources/);
  assert.match(handler, /tgcloner_source_messages/);
  assert.match(handler, /onConflict: "course_slug"/);
  assert.match(handler, /Nguồn Telegram đang inactive/);
});

test('admin can create a hidden V4 course with a registered Telegram source', () => {
  assert.match(handler, /action \|\| ""\)\.trim\(\) === "createCourse"/);
  assert.match(handler, /NEW_SLUG_RE/);
  assert.match(handler, /delivery_mode: "v4"/);
  assert.match(handler, /is_published: false/);
  assert.match(handler, /course_slug: slug/);
  assert.match(handler, /enabled: true/);
  assert.match(handler, /media_mode: "telegram_bot_poc"/);
  assert.match(handler, /Best-effort rollback/);
  assert.match(handler, /readyEligible/);
});

test('V4 source list can load before a course exists', () => {
  assert.match(handler, /mode \|\| ""\) === "sources"/);
  assert.match(handler, /sources: await listSources\(\)/);
});

test('published V4 courses cannot change or disable their live source', () => {
  assert.match(handler, /checked\.isPublished && \(sourceChanged \|\| sourceDisabled\)/);
  assert.match(handler, /Hãy Tạm ẩn khóa học trước khi đổi hoặc tắt nguồn Telegram V4/);
});

test('dedicated V4 admin page manages creation, source and release', () => {
  assert.match(page, /Quản trị khóa học V4/);
  assert.match(page, /id="newCourseTitle"/);
  assert.match(page, /id="newCourseSlug"/);
  assert.match(page, /id="newCourseSource"/);
  assert.match(page, /action:'createCourse'/);
  assert.match(page, /endpoint=v4-source&mode=sources/);
  assert.match(page, /saveSource/);
  assert.match(page, /setPublished/);
  assert.match(page, /actualMessageCount/);
  assert.match(page, /\/learning\?course=/);
  assert.match(page, /is_published=false/);
});

test('main admin exposes a direct V4 admin shortcut', () => {
  assert.match(adminPage, /href="\/v4-admin\.html"/);
  assert.match(adminPage, /V4 Admin/);
});

test('publishing a V4 course requires a live non-empty source', () => {
  assert.match(courses, /published\)[\s\S]*lms_v4_telegram_course_sources/);
  assert.match(courses, /tgcloner_sources/);
  assert.match(courses, /tgcloner_source_messages/);
  assert.match(courses, /Chưa có bài Telegram nào/);
});
