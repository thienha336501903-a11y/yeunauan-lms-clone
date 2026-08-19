// Regression scope: V4 enrollment admin is course-scoped, Drive-free, and the access gate enforces expiry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-enrollments.js', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../utils/v4-telegram-access.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../v4-admin.html', import.meta.url), 'utf8');

test('admin router exposes a dedicated V4 enrollment endpoint', () => {
  assert.match(router, /admin-v4-enrollments\.js/);
  assert.match(router, /endpoint === "v4-enrollments"/);
});

test('V4 enrollment admin is admin-only and never invokes Drive sync', () => {
  assert.match(handler, /getAdminFromRequest\(req\)/);
  assert.match(handler, /requireV4Course/);
  assert.match(handler, /delivery_mode/);
  assert.match(handler, /student_enrollments/);
  assert.match(handler, /students/);
  assert.match(handler, /source_system: "lms_v4_admin"/);
  assert.match(handler, /onConflict: "email,course_slug"/);
  assert.doesNotMatch(handler, /syncEnrollment/);
  assert.doesNotMatch(handler, /Google Drive/i);
  assert.doesNotMatch(handler, /drive_permission/);
});

test('V4 enrollment admin grants, revokes and reactivates without deleting history', () => {
  assert.match(handler, /status: "active"/);
  assert.match(handler, /normalizedAction === "revoke"/);
  assert.match(handler, /patch\.status = "revoked"/);
  assert.match(handler, /normalizedAction === "activate"/);
  assert.doesNotMatch(handler, /\.delete\(\)/);
});

test('V4 direct access rejects an active enrollment after its expiry', () => {
  assert.match(access, /function isEnrollmentExpired/);
  assert.match(access, /\.select\("status,expired_at"\)/);
  assert.match(access, /isEnrollmentExpired\(enrollment\.expired_at\)/);
  assert.match(access, /Quyền học khóa này.*đã hết hạn/);
});

test('V4 Admin manages course-scoped students from the same workspace', () => {
  assert.match(page, /id="enrollmentPanel"/);
  assert.match(page, /id="enrollEmail"/);
  assert.match(page, /id="enrollExpiry"/);
  assert.match(page, /id="grantEnrollmentBtn"/);
  assert.match(page, /id="enrollSearch"/);
  assert.match(page, /endpoint=v4-enrollments/);
  assert.match(page, /Promise\.all\(\[loadSource\(\),loadEnrollments\(\)\]\)/);
  assert.match(page, /Cấp \/ kích hoạt quyền V4/);
  assert.match(page, /không cấp quyền Drive/);
});
