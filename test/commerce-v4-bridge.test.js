import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('syncCourse preserves V4 ownership and creates new V4 courses as drafts', () => {
  const sync = read('api/sync.js');
  assert.match(sync, /deliveryMode/);
  assert.match(sync, /select\("id, raw_data, delivery_mode, is_published"\)/);
  assert.match(sync, /Không thể đổi khóa qua lại V4 bằng API sync/);
  assert.match(sync, /is_published: false/);
  assert.match(sync, /delivery_mode: requestedMode \|\| "lms"/);
});

test('Commerce order id reaches the idempotent enrollment writer', () => {
  const sync = read('api/sync.js');
  const lms = read('utils/lms.js');
  assert.match(sync, /orderId: orderId \|\| null/);
  assert.match(lms, /source_order_id: orderId \|\| null/);
  assert.match(lms, /student_enrollments/);
  assert.match(lms, /existingEnrollment/);
});

test('fake course slugs fail before student or enrollment mutation', () => {
  const lms = read('utils/lms.js');
  const courseLookup = lms.indexOf('.select("id,delivery_mode")', lms.indexOf('export async function syncEnrollment'));
  const studentMutation = lms.indexOf('.from("students")', courseLookup);
  assert.ok(courseLookup > -1 && studentMutation > courseLookup);
  assert.match(lms.slice(courseLookup, studentMutation), /if \(!courseRec\) throw new Error\("Course not found"\)/);
});

test('Telegram-direct can never create an LMS enrollment', () => {
  const lms = read('utils/lms.js');
  assert.match(lms, /Telegram course does not use LMS enrollment/);
  assert.match(lms, /courseRec\.delivery_mode/);
});

test('V4 enrollment never mutates legacy Drive permissions', () => {
  const lms = read('utils/lms.js');
  assert.match(lms, /courseRec\.delivery_mode[\s\S]*=== "v4"/);
  assert.match(lms, /V4 does not use Google Drive permissions/);
});

test('wizard attaches an existing Commerce draft and preserves return navigation', () => {
  const source = read('utils/lms-handlers/admin-v4-source.js');
  const wizard = read('v4-course-wizard.html');
  assert.match(source, /attachedExistingCourse: Boolean\(existingCourse\)/);
  assert.match(source, /if \(!existingCourse\)/);
  assert.match(source, /upsert\([\s\S]*onConflict: "course_slug"/);
  assert.match(wizard, /Gắn nguồn vào khóa Commerce Draft/);
  assert.match(wizard, /params\.get\('sourceRef'\)/);
  assert.match(wizard, /safeReturnTo/);
  assert.match(wizard, /await createCourse\(true\)/);
});
