import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('V5 course creation is admin-only, draft, unpublished, and sale-disabled', () => {
  const handler = read('utils/lms-handlers/admin-v5-create-course.js');
  const router = read('api/lms/admin.js');

  assert.match(handler, /getAdminFromRequest/);
  assert.match(handler, /delivery_mode: "v5"/);
  assert.match(handler, /active: false/);
  assert.match(handler, /is_published: false/);
  assert.match(handler, /studentDisplayTitle: title/);
  assert.match(handler, /v5CreatedFrom: "course_channel"/);
  assert.match(handler, /source_mode: "direct"/);
  assert.match(handler, /status: "draft"/);
  assert.match(handler, /course_slug_exists/);
  assert.match(handler, /cleanup failed/);
  assert.match(router, /endpoint === "v5-create-course"/);
});

test('V5 course slug is normalized server-side and bounded', () => {
  const handler = read('utils/lms-handlers/admin-v5-create-course.js');
  assert.match(handler, /normalize\("NFD"\)/);
  assert.match(handler, /replace\(\/\[\\u0300-\\u036f\]\/g, ""\)/);
  assert.match(handler, /slice\(0, 80\)/);
  assert.match(handler, /\^\[a-z0-9\]\[a-z0-9-\]\{0,79\}\$/);
});

test('Course Channel can create and immediately open a new V5 draft', () => {
  const page = read('v5-admin.html');
  assert.match(page, /id="newCourseBtn"/);
  assert.match(page, /id="newCourseTopBtn"/);
  assert.match(page, /id="courseModal"/);
  assert.match(page, /endpoint=v5-create-course/);
  assert.match(page, /function openCourseCreate/);
  assert.match(page, /async function createCourse/);
  assert.match(page, /await loadCourses\(data\.course\.slug\)/);
  assert.match(page, /Khóa mới luôn bắt đầu ở Draft và Tắt bán/);
  assert.match(page, /slugify\(\$\('newCourseTitleInput'\)\.value\)/);
});
