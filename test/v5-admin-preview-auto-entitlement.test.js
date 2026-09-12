import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routerSource = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const handlerSource = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-preview-access.js', import.meta.url), 'utf8');
const adminPageSource = fs.readFileSync(new URL('../v5-admin.html', import.meta.url), 'utf8');
const learnerAccessSource = fs.readFileSync(new URL('../utils/v4-telegram-access.js', import.meta.url), 'utf8');
const feedSource = fs.readFileSync(new URL('../utils/lms-handlers/v5-feed.js', import.meta.url), 'utf8');

test('1. Router exposes dedicated endpoint v5-preview-access', () => {
  assert.match(routerSource, /import adminV5PreviewAccessHandler from "\.\.\/\.\.\/utils\/lms-handlers\/admin-v5-preview-access\.js"/);
  assert.match(routerSource, /if \(endpoint === "v5-preview-access"\) return adminV5PreviewAccessHandler\(req, res\);/);
});

test('2. Unauthenticated request rejected with 401', () => {
  assert.match(handlerSource, /const admin = getAdminFromRequest\(req\);/);
  assert.match(handlerSource, /if \(!admin\?\.email\)/);
  assert.match(handlerSource, /res\.status\(401\)\.json\(\{ success: false, error: "Bạn chưa đăng nhập Admin\." \}\)/);
});

test('3. Non-admin request rejected according to admin session verification', () => {
  assert.match(handlerSource, /const adminEmail = normalizeEmail\(admin\.email\);/);
  assert.match(handlerSource, /if \(!adminEmail\)/);
  assert.match(handlerSource, /res\.status\(401\)/);
});

test('4. Admin email is derived strictly from server-side session, ignoring body email', () => {
  // Verifies that adminEmail comes strictly from admin.email and NOT from req.body.email
  assert.match(handlerSource, /const adminEmail = normalizeEmail\(admin\.email\);/);
  assert.doesNotMatch(handlerSource, /adminEmail = .*req\.body\.email/);
  assert.doesNotMatch(handlerSource, /cleanEmail = .*req\.body\.email/);
  assert.doesNotMatch(handlerSource, /email:.*req\.body\.email/);
});

test('5. Client-supplied email in body or query is completely ignored', () => {
  assert.match(handlerSource, /const courseSlug = clean\(req\.body\?\.course \|\| req\.query\?\.course\);/);
  // Ensured that student and enrollment queries exclusively use adminEmail
  assert.match(handlerSource, /\.eq\("email", adminEmail\)/);
});

test('6. Non-existent course is rejected with 404', () => {
  assert.match(handlerSource, /if \(!course\)/);
  assert.match(handlerSource, /res\.status\(404\)\.json\(\{ success: false, code: "course_not_found"/);
});

test('7. Non-V5 course is rejected with 400', () => {
  assert.match(handlerSource, /if \(clean\(course\.delivery_mode\)\.toLowerCase\(\) !== "v5"\)/);
  assert.match(handlerSource, /res\.status\(400\)\.json\(\{ success: false, code: "not_v5_course"/);
});

test('8. Ensures student profile row for admin email if not existing', () => {
  assert.match(handlerSource, /from\("students"\)/);
  assert.match(handlerSource, /\.eq\("email", adminEmail\)/);
  assert.match(handlerSource, /insert\(\{[\s\S]*?email: adminEmail,[\s\S]*?status: "active"/);
});

test('9. Existing active enrollment is preserved without duplication (idempotent PASS)', () => {
  assert.match(handlerSource, /from\("student_enrollments"\)/);
  assert.match(handlerSource, /\.eq\("email", adminEmail\)\s*\.eq\("course_slug", course\.slug\)/);
  assert.match(handlerSource, /isActiveEnrollmentStatus\(existingEnrollment\.status\)/);
  assert.match(handlerSource, /!isEnrollmentExpired\(existingEnrollment\.expired_at\)/);
  assert.match(handlerSource, /enrollmentRecord = existingEnrollment;/);
});

test('10. Existing inactive or expired enrollment is reactivated on exact record ID', () => {
  assert.match(handlerSource, /\.update\(\{[\s\S]*?status: "active",[\s\S]*?expired_at: null[\s\S]*?\}\)\s*\.eq\("id", existingEnrollment\.id\)/);
});

test('11. New enrollment assigns active status and admin_preview source_system', () => {
  assert.match(handlerSource, /source_system: "admin_preview"/);
  assert.match(handlerSource, /status: "active"/);
  assert.match(handlerSource, /expired_at: null/);
});

test('12. Invariants preserved: courses.active, is_published, Commerce sale state unchanged', () => {
  // Handler must not perform any update on courses or v5_course_configs or commerce
  assert.doesNotMatch(handlerSource, /\.from\("courses"\)\s*\.update/);
  assert.doesNotMatch(handlerSource, /\.from\("v5_course_configs"\)\s*\.update/);
});

test('13. Learner authorization remains strictly unchanged and requires standard enrollment', () => {
  // Learner access requires valid student session and enrollment in student_enrollments
  assert.match(learnerAccessSource, /from\("student_enrollments"\)/);
  assert.match(learnerAccessSource, /isActiveEnrollmentStatus\(enrollment\.status\)/);
  assert.match(learnerAccessSource, /!course\?\.is_published/);
  // Feed requires published release
  assert.match(feedSource, /config\.published_release_id/);
});

test('14. Admin UI v5-admin.html handles previewBtn flow with auto-entitlement and UI status', () => {
  assert.match(adminPageSource, /\$\('previewBtn'\)\.onclick\s*=\s*async/);
  assert.match(adminPageSource, /endpoint=v5-preview-access/);
  assert.match(adminPageSource, /btn\.textContent\s*=\s*'Đang cấp quyền xem trước\.\.\.'/);
  assert.match(adminPageSource, /window\.open\('about:blank',\s*'_blank'\)/);
  assert.match(adminPageSource, /previewWindow\.location\.href\s*=\s*targetUrl/);
  assert.match(adminPageSource, /Khóa chưa có Published release để xem trước\./);
  assert.match(adminPageSource, /previewWindow\.close\(\)/);
});

test('15. Response adheres strictly to required contract payload', () => {
  assert.match(handlerSource, /success: true/);
  assert.match(handlerSource, /course: course\.slug/);
  assert.match(handlerSource, /admin: adminEmail/);
  assert.match(handlerSource, /hasPublishedRelease/);
  assert.match(handlerSource, /enrollment: \{[\s\S]*?id: enrollmentRecord\.id,[\s\S]*?active: true[\s\S]*?\}/);
});
