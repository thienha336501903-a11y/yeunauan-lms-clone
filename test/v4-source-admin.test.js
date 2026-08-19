import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-source.js', import.meta.url), 'utf8');
const courses = fs.readFileSync(new URL('../utils/lms-handlers/admin-courses.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../v4-admin.html', import.meta.url), 'utf8');

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

test('dedicated V4 admin page manages source and release', () => {
  assert.match(page, /Quản trị khóa học V4/);
  assert.match(page, /endpoint=v4-source/);
  assert.match(page, /saveSource/);
  assert.match(page, /setPublished/);
  assert.match(page, /actualMessageCount/);
  assert.match(page, /\/learning\?course=/);
});

test('publishing a V4 course requires a live non-empty source', () => {
  assert.match(courses, /published\)[\s\S]*lms_v4_telegram_course_sources/);
  assert.match(courses, /tgcloner_sources/);
  assert.match(courses, /tgcloner_source_messages/);
  assert.match(courses, /Chưa có bài Telegram nào/);
});
