// Regression scope: all LMS course-selection and V4 access paths share one status/expiry contract. Preview retry marker: 2026-08-20.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeEnrollmentStatus,
  isActiveEnrollmentStatus,
  isEnrollmentExpired,
  isEnrollmentUsable
} from '../utils/lms-enrollment-status.js';

const courseData = fs.readFileSync(new URL('../utils/lms-handlers/course-data.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../utils/lms-handlers/v3-bootstrap.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../utils/lms-handlers/student-dashboard.js', import.meta.url), 'utf8');
const v4Access = fs.readFileSync(new URL('../utils/v4-telegram-access.js', import.meta.url), 'utf8');
const v4Admin = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-enrollments.js', import.meta.url), 'utf8');
const lesson = fs.readFileSync(new URL('../utils/lms-handlers/lesson.js', import.meta.url), 'utf8');
const publicLesson = fs.readFileSync(new URL('../utils/lms-handlers/public-lesson.js', import.meta.url), 'utf8');
const legacyEntryToken = fs.readFileSync(new URL('../utils/lms-handlers/legacy-entry-token.js', import.meta.url), 'utf8');
const verifyEntryToken = fs.readFileSync(new URL('../utils/lms-handlers/verify-entry-token.js', import.meta.url), 'utf8');
const exchangeCode = fs.readFileSync(new URL('../utils/lms-handlers/exchange-code.js', import.meta.url), 'utf8');
const sessionGuard = fs.readFileSync(new URL('../utils/lms-session-guard.js', import.meta.url), 'utf8');

test('shared enrollment normalization handles Vietnamese đ correctly', () => {
  assert.equal(normalizeEnrollmentStatus('Đã duyệt'), 'da duyet');
  assert.equal(normalizeEnrollmentStatus('  ĐÃ DUYỆT  '), 'da duyet');
  assert.equal(isActiveEnrollmentStatus('Đã duyệt'), true);
  assert.equal(isActiveEnrollmentStatus('revoked'), false);
});

test('shared expiry rules distinguish future, past and unlimited enrollment', () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  assert.equal(isEnrollmentExpired(null, now), false);
  assert.equal(isEnrollmentExpired('2026-08-21T00:00:00Z', now), false);
  assert.equal(isEnrollmentExpired('2026-08-19T23:59:59Z', now), true);
  assert.equal(isEnrollmentUsable({ status: 'active', expired_at: null }, now), true);
  assert.equal(isEnrollmentUsable({ status: 'Đã duyệt', expired_at: '2026-08-21T00:00:00Z' }, now), true);
  assert.equal(isEnrollmentUsable({ status: 'active', expired_at: '2026-08-19T23:59:59Z' }, now), false);
  assert.equal(isEnrollmentUsable({ status: 'revoked', expired_at: null }, now), false);
});

test('course-data excludes expired enrollments before resolving allowed courses', () => {
  assert.match(courseData, /lms-enrollment-status\.js/);
  assert.match(courseData, /course_slug, status, expired_at/);
  assert.match(courseData, /filter\(e => isEnrollmentUsable\(e\)\)/);
});

test('V3 bootstrap course picker excludes expired enrollments', () => {
  assert.match(bootstrap, /lms-enrollment-status\.js/);
  assert.match(bootstrap, /course_slug,status,expired_at/);
  assert.match(bootstrap, /filter\(row => isEnrollmentUsable\(row\)\)/);
});

test('student dashboard marks expired enrollments inactive and exposes expiry', () => {
  assert.match(dashboard, /isEnrollmentExpired, isEnrollmentUsable/);
  assert.match(dashboard, /course_slug,status,expired_at,drive_permission_status/);
  assert.match(dashboard, /enrollmentExpired=Boolean\(enrollment&&isEnrollmentExpired\(enrollment\.expired_at\)\)/);
  assert.match(dashboard, /if\(enrollmentExpired\)state="inactive"/);
  assert.match(dashboard, /expiredAt:enrollment\?\.expired_at\|\|null/);
  assert.match(dashboard, /replace\(\/đ\/g,"d"\)/);
});

test('V4 access and V4 Admin share the same status and expiry contract', () => {
  assert.match(v4Access, /isActiveEnrollmentStatus, isEnrollmentExpired/);
  assert.match(v4Access, /isEnrollmentExpired\(enrollment\.expired_at\)/);
  assert.match(v4Access, /Quyền học khóa này.*đã hết hạn/);
  assert.match(v4Admin, /isActiveEnrollmentStatus, isEnrollmentExpired, normalizeEnrollmentStatus/);
});

test('every legacy lesson and entry path rejects expired enrollments', () => {
  for (const source of [lesson, publicLesson, legacyEntryToken, verifyEntryToken, exchangeCode, sessionGuard]) {
    assert.match(source, /expired_at/);
    assert.match(source, /isEnrollmentUsable/);
  }
});

test('photo lesson endpoint requires a session and course enrollment', () => {
  assert.match(publicLesson, /verifyStudentSession/);
  assert.match(publicLesson, /verifyLmsVerifiedSessionAccess/);
  assert.match(publicLesson, /missing_login_session/);
  assert.match(publicLesson, /enrollment_inactive/);
  assert.match(publicLesson, /Cache-Control", "no-store/);
});
