import { supabase } from "./supabase.js";
import { parseCookies, verifyStudentSession } from "./lms.js";
import { verifyLmsVerifiedSessionAccess } from "./lms-session-guard.js";

const SESSION_COOKIE = "course_session_token";
const ACTIVE_ENROLLMENT_STATUSES = new Set([
  "active",
  "approved",
  "approved_ready",
  "approved_waiting_content",
  "completed",
  "da duyet"
]);

function normalizeEnrollmentStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isActiveEnrollment(status) {
  return ACTIVE_ENROLLMENT_STATUSES.has(normalizeEnrollmentStatus(status));
}

function getLmsSessionHeaders(req) {
  return {
    lmsSessionId: String(req.headers["x-lms-session-id"] || "").trim(),
    lmsDeviceId: String(req.headers["x-lms-device-id"] || "").trim()
  };
}

export async function requireV4CourseAccess(req, courseSlug) {
  const slug = String(courseSlug || "").trim();
  if (!slug) return { ok: false, status: 400, code: "missing_course", error: "Thiếu khóa học" };

  let email = "";
  const lmsHeaders = getLmsSessionHeaders(req);
  if (lmsHeaders.lmsSessionId && lmsHeaders.lmsDeviceId) {
    const access = await verifyLmsVerifiedSessionAccess(supabase, {
      ...lmsHeaders,
      courseSlug: slug
    });
    if (access?.ok && access.email) email = String(access.email).trim().toLowerCase();
  }

  if (!email) {
    const cookies = parseCookies(req);
    const token = String(cookies[SESSION_COOKIE] || "").trim();
    if (token) {
      const decoded = verifyStudentSession(token);
      if (decoded?.email) email = String(decoded.email).trim().toLowerCase();
    }
  }

  if (!email) {
    return {
      ok: false,
      status: 401,
      code: "missing_login_session",
      error: "Phiên học đã hết hạn hoặc chưa đăng nhập"
    };
  }

  const { data: enrollment, error: enrollmentError } = await supabase
    .from("student_enrollments")
    .select("status")
    .eq("email", email)
    .eq("course_slug", slug)
    .maybeSingle();

  if (enrollmentError) throw enrollmentError;
  if (!enrollment || !isActiveEnrollment(enrollment.status)) {
    return {
      ok: false,
      status: 403,
      code: "course_not_enrolled",
      error: `Tài khoản ${email} chưa có quyền vào khóa học này.`
    };
  }

  return { ok: true, email, courseSlug: slug };
}
