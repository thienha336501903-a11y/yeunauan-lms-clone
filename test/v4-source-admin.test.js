// Regression scope: V4 source eligibility is independent from mirror MASTER; Admin supports safe source registration plus searchable/sortable health rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-source.js', import.meta.url), 'utf8');
const courses = fs.readFileSync(new URL('../utils/lms-handlers/admin-courses.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../v4-admin.html', import.meta.url), 'utf8');
const adminPage = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const ingestMigration = fs.readFileSync(new URL('../supabase/migrations/20260819_add_v4_source_ingest_activity.sql', import.meta.url), 'utf8');

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
  assert.match(handler, /v4Eligible: true/);
  assert.match(handler, /mirrorActive: Boolean\(source\.active\)/);
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

test('V4 source counts use exact live message totals instead of stale cached counters', () => {
  assert.match(handler, /async function exactSourceMessageCounts/);
  assert.match(handler, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(handler, /const counts = await exactSourceMessageCounts/);
  assert.match(handler, /indexedMessageCount: Number\(counts\.get\(source\.id\) \|\| 0\)/);
  assert.match(handler, /const exactCounts = await exactSourceMessageCounts\(sourceIds\)/);
  assert.match(handler, /indexedMessageCount = Number\(source \? exactCounts\.get\(source\.id\) \|\| 0 : 0\)/);
  assert.match(handler, /indexedMessageCount: actualMessageCount/);
});

test('published V4 courses cannot change or disable their live source', () => {
  assert.match(handler, /checked\.isPublished && \(sourceChanged \|\| sourceDisabled\)/);
  assert.match(handler, /Hãy Tạm ẩn khóa học trước khi đổi hoặc tắt nguồn Telegram V4/);
});

test('advanced V4 admin page still manages creation, source and release', () => {
  assert.match(page, /Quản trị V4 nâng cao/);
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

test('main admin exposes the V4 launch Wizard as the primary shortcut', () => {
  assert.match(adminPage, /href="\/v4-course-wizard\.html"/);
  assert.match(adminPage, /Mở khóa V4/);
});

test('V4 health dashboard remains read-only and admin-scoped', () => {
  assert.match(handler, /mode \|\| ""\) === "health"/);
  assert.match(handler, /listV4Health/);
  assert.match(handler, /sourceHealthy/);
  assert.match(handler, /indexed_message_count/);
  assert.match(handler, /last_ingested_at/);
  assert.match(handler, /last_source_date/);
  assert.match(page, /Tổng quan sức khỏe V4/);
  assert.match(page, /Hệ thống ghi nhận/);
  assert.match(page, /Bài Telegram gần nhất/);
  assert.match(page, /Kênh lâu không đăng bài không bị coi là lỗi/);
  assert.match(page, /endpoint=v4-source&mode=health/);
  assert.match(page, /healthAttention/);
  assert.match(page, /healthRefreshBtn/);
});

test('V4 health dashboard can search, filter and prioritise attention rows', () => {
  assert.match(page, /id="healthSearch"/);
  assert.match(page, /id="healthFilter"/);
  assert.match(page, /id="healthCount"/);
  assert.match(page, /function healthPriority/);
  assert.match(page, /function healthMatches/);
  assert.match(page, /function renderHealthRows/);
  assert.match(page, /Cần chú ý trước/);
  assert.match(page, /\['broken','setup'\]\.includes/);
  assert.match(page, /localeCompare/);
});

test('V4 admin links to safe Cloner source registration and can reload sources', () => {
  assert.match(page, /id="registerSourceLink"/);
  assert.match(page, /telegram-channel-cloner\.vercel\.app\/\?mode=v4-source/);
  assert.match(page, /id="reloadSourcesBtn"/);
  assert.match(page, /Đăng ký nguồn V4 không thay đổi MASTER mirror/);
  assert.match(page, /await loadSources\(\);await loadHealth\(\)/);
});

test('V4 ingest activity is maintained by an idempotent database trigger', () => {
  assert.match(ingestMigration, /add column if not exists last_ingested_at timestamptz/);
  assert.match(ingestMigration, /add column if not exists last_source_date timestamptz/);
  assert.match(ingestMigration, /max\(updated_at\) as last_ingested_at/);
  assert.match(ingestMigration, /max\(source_date\) as last_source_date/);
  assert.match(ingestMigration, /create or replace function public\.tgcloner_update_source_ingest_activity/);
  assert.match(ingestMigration, /after insert or update of updated_at, source_date/);
  assert.match(ingestMigration, /greatest\(last_ingested_at, new\.updated_at\)/);
  assert.match(ingestMigration, /greatest\(last_source_date, new\.source_date\)/);
});

test('publishing a V4 course requires a registered non-empty source', () => {
  assert.match(courses, /published\)[\s\S]*lms_v4_telegram_course_sources/);
  assert.match(courses, /tgcloner_sources/);
  assert.match(courses, /tgcloner_source_messages/);
  assert.match(courses, /Chưa có bài Telegram nào/);
  assert.doesNotMatch(courses, /!source\.active/);
});

test('V4 multi-source eligibility is independent from clone mirror MASTER', () => {
  assert.match(handler, /const sourceHealthy = Boolean\(mapping\?\.enabled && source && indexedMessageCount > 0\)/);
  assert.match(handler, /readyEligible: Boolean\(Number\(source\.actualMessageCount \|\| 0\) > 0\)/);
  assert.doesNotMatch(handler, /Nguồn Telegram đang inactive/);
  assert.doesNotMatch(handler, /Nguồn Telegram inactive/);
  assert.match(page, /v4Eligible/);
  assert.match(page, /MASTER mirror/);
  assert.match(page, /nguồn Telegram đã đăng ký/);
  assert.doesNotMatch(page, /nguồn Telegram còn active/);
});
