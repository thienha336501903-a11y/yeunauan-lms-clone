import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(from, to);
}

// course-data: expired enrollments must not count as allowed courses.
{
  const path='utils/lms-handlers/course-data.js';
  let text=fs.readFileSync(path,'utf8');
  text=replaceOnce(text,
    'import { resolveMainMediaInfo } from "../lms-media.js";\n\nconst SESSION_COOKIE = "course_session_token";\nconst API_VERSION = "premium-bunny-stream-v1";\nconst ACTIVE_ENROLLMENT_STATUSES = new Set([\n  "active",\n  "approved",\n  "approved_ready",\n  "approved_waiting_content",\n  "completed",\n  "da duyet"\n]);\n\nfunction normalizeEnrollmentStatus(status) {\n  return String(status || "")\n    .trim()\n    .toLowerCase()\n    .normalize("NFD")\n    .replace(/[\\u0300-\\u036f]/g, "");\n}\n\nfunction isActiveEnrollment(status) {\n  return ACTIVE_ENROLLMENT_STATUSES.has(normalizeEnrollmentStatus(status));\n}\n',
    'import { resolveMainMediaInfo } from "../lms-media.js";\nimport { isEnrollmentUsable } from "../lms-enrollment-status.js";\n\nconst SESSION_COOKIE = "course_session_token";\nconst API_VERSION = "premium-bunny-stream-v1";\n',
    'course-data status helper');
  text=replaceOnce(text,'.select("course_slug, status")','.select("course_slug, status, expired_at")','course-data enrollment select');
  text=replaceOnce(text,'.filter(e => isActiveEnrollment(e.status))','.filter(e => isEnrollmentUsable(e))','course-data usable filter');
  fs.writeFileSync(path,text);
}

// v3-bootstrap: the course picker must omit expired enrollment rows.
{
  const path='utils/lms-handlers/v3-bootstrap.js';
  let text=fs.readFileSync(path,'utf8');
  text=replaceOnce(text,
    'import { verifyLmsVerifiedSessionAccess } from "../lms-session-guard.js";\n\nconst SESSION_COOKIE = "course_session_token";\nconst ACTIVE_ENROLLMENT_STATUSES = new Set([\n  "active",\n  "approved",\n  "approved_ready",\n  "approved_waiting_content",\n  "completed",\n  "da duyet"\n]);\n\nfunction normalizeEnrollmentStatus(status) {\n  return String(status || "").trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");\n}\nfunction isActiveEnrollment(status) {\n  return ACTIVE_ENROLLMENT_STATUSES.has(normalizeEnrollmentStatus(status));\n}\n',
    'import { verifyLmsVerifiedSessionAccess } from "../lms-session-guard.js";\nimport { isEnrollmentUsable } from "../lms-enrollment-status.js";\n\nconst SESSION_COOKIE = "course_session_token";\n',
    'bootstrap status helper');
  text=replaceOnce(text,'.select("course_slug,status")','.select("course_slug,status,expired_at")','bootstrap enrollment select');
  text=replaceOnce(text,'.filter(row => isActiveEnrollment(row.status))','.filter(row => isEnrollmentUsable(row))','bootstrap usable filter');
  fs.writeFileSync(path,text);
}

// student-dashboard: reflect expired enrollment as inactive rather than ready/waiting.
{
  const path='utils/lms-handlers/student-dashboard.js';
  let text=fs.readFileSync(path,'utf8');
  text=replaceOnce(text,
    'import { verifyLmsVerifiedSessionAccess } from "../lms-session-guard.js";\n\nconst SESSION_COOKIE = "course_session_token";\nconst ACTIVE_ENROLLMENT_STATUSES = new Set([\n  "active", "approved", "approved_ready", "approved_waiting_content", "completed", "da duyet"\n]);\nfunction norm(value){return String(value||"").trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"")}\nfunction isActiveEnrollment(status){return ACTIVE_ENROLLMENT_STATUSES.has(norm(status))}\n',
    'import { verifyLmsVerifiedSessionAccess } from "../lms-session-guard.js";\nimport { isEnrollmentExpired, isEnrollmentUsable } from "../lms-enrollment-status.js";\n\nconst SESSION_COOKIE = "course_session_token";\nfunction norm(value){return String(value||"").trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/đ/g,"d")}\n',
    'dashboard status helper');
  text=replaceOnce(text,
    'supabase.from("student_enrollments").select("course_slug,status,drive_permission_status,created_at,updated_at").eq("email",email)',
    'supabase.from("student_enrollments").select("course_slug,status,expired_at,drive_permission_status,created_at,updated_at").eq("email",email)',
    'dashboard enrollment select');
  text=replaceOnce(text,
    'enrollmentActive=Boolean(enrollment&&isActiveEnrollment(enrollment.status)),orderApproved=Boolean(order&&isApprovedOrder(order.status)),orderRejected=Boolean(order&&isRejectedOrder(order.status)),ready=enrollmentActive&&course.active!==false&&course.is_published===true;let state="pending_approval";if(ready)state="ready";else if(enrollmentActive||orderApproved)state="approved_waiting_content";else if(orderRejected)state="rejected";else if(!order&&enrollment)state=enrollmentActive?"approved_waiting_content":"inactive";',
    'enrollmentActive=Boolean(enrollment&&isEnrollmentUsable(enrollment)),enrollmentExpired=Boolean(enrollment&&isEnrollmentExpired(enrollment.expired_at)),orderApproved=Boolean(order&&isApprovedOrder(order.status)),orderRejected=Boolean(order&&isRejectedOrder(order.status)),ready=enrollmentActive&&course.active!==false&&course.is_published===true;let state="pending_approval";if(enrollmentExpired)state="inactive";else if(ready)state="ready";else if(enrollmentActive||orderApproved)state="approved_waiting_content";else if(orderRejected)state="rejected";else if(!order&&enrollment)state=enrollmentActive?"approved_waiting_content":"inactive";',
    'dashboard expiry state');
  text=replaceOnce(text,
    'enrollmentStatus:enrollment?.status||null,driveStatus:',
    'enrollmentStatus:enrollment?.status||null,expiredAt:enrollment?.expired_at||null,driveStatus:',
    'dashboard expiry response');
  fs.writeFileSync(path,text);
}

// V4 direct gate: share the same normalization/expiry semantics, preserving the
// dedicated error message for an expired enrollment.
{
  const path='utils/v4-telegram-access.js';
  let text=fs.readFileSync(path,'utf8');
  text=replaceOnce(text,
    'import { verifyLmsVerifiedSessionAccess } from "./lms-session-guard.js";\n\nconst SESSION_COOKIE = "course_session_token";\nconst ACTIVE_ENROLLMENT_STATUSES = new Set([\n  "active",\n  "approved",\n  "approved_ready",\n  "approved_waiting_content",\n  "completed",\n  "da duyet"\n]);\n\nfunction normalizeEnrollmentStatus(status) {\n  return String(status || "")\n    .trim()\n    .toLowerCase()\n    .normalize("NFD")\n    .replace(/[\\u0300-\\u036f]/g, "");\n}\n\nfunction isActiveEnrollment(status) {\n  return ACTIVE_ENROLLMENT_STATUSES.has(normalizeEnrollmentStatus(status));\n}\n\nfunction isEnrollmentExpired(expiredAt, now = Date.now()) {\n  if (!expiredAt) return false;\n  const time = Date.parse(expiredAt);\n  return Number.isFinite(time) && time <= now;\n}\n',
    'import { verifyLmsVerifiedSessionAccess } from "./lms-session-guard.js";\nimport { isActiveEnrollmentStatus, isEnrollmentExpired } from "./lms-enrollment-status.js";\n\nconst SESSION_COOKIE = "course_session_token";\n',
    'V4 access shared helper');
  text=replaceOnce(text,'!isActiveEnrollment(enrollment.status)','!isActiveEnrollmentStatus(enrollment.status)','V4 access status check');
  fs.writeFileSync(path,text);
}

// V4 Admin: use shared status/expiry rules when calculating badges.
{
  const path='utils/lms-handlers/admin-v4-enrollments.js';
  let text=fs.readFileSync(path,'utf8');
  text=replaceOnce(text,
    'import { getAdminFromRequest, normalizeEmail } from "../lms.js";\n\nconst ACTIVE_STATUSES = new Set([\n  "active",\n  "approved",\n  "approved_ready",\n  "approved_waiting_content",\n  "completed",\n  "da duyet"\n]);\n\nfunction normalizedStatus(value) {\n  return String(value || "")\n    .trim()\n    .toLowerCase()\n    .normalize("NFD")\n    .replace(/[\\u0300-\\u036f]/g, "");\n}\n\nfunction isActiveStatus(value) {\n  return ACTIVE_STATUSES.has(normalizedStatus(value));\n}\n\nfunction isExpired(expiredAt, now = Date.now()) {\n  if (!expiredAt) return false;\n  const time = Date.parse(expiredAt);\n  return Number.isFinite(time) && time <= now;\n}\n',
    'import { getAdminFromRequest, normalizeEmail } from "../lms.js";\nimport { isActiveEnrollmentStatus, isEnrollmentExpired, normalizeEnrollmentStatus } from "../lms-enrollment-status.js";\n',
    'V4 admin shared helper');
  text=text.replace(/isExpired\(/g,'isEnrollmentExpired(').replace(/isActiveStatus\(/g,'isActiveEnrollmentStatus(').replace(/normalizedStatus\(/g,'normalizeEnrollmentStatus(');
  fs.writeFileSync(path,text);
}

console.log('Enrollment expiry consistency patch applied.');
