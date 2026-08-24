import { supabase } from "./supabase.js";
import { parseCookies, verifyStudentSession } from "./lms.js";
import { verifyLmsVerifiedSessionAccess } from "./lms-session-guard.js";
import { isActiveEnrollmentStatus, isEnrollmentExpired } from "./lms-enrollment-status.js";

const SESSION_COOKIE = "course_session_token";

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
    .select("status,expired_at")
    .eq("email", email)
    .eq("course_slug", slug)
    .maybeSingle();

  if (enrollmentError) throw enrollmentError;
  if (!enrollment || !isActiveEnrollmentStatus(enrollment.status)) {
    return {
      ok: false,
      status: 403,
      code: "course_not_enrolled",
      error: `Tài khoản ${email} chưa có quyền vào khóa học này.`
    };
  }
  if (isEnrollmentExpired(enrollment.expired_at)) {
    return {
      ok: false,
      status: 403,
      code: "course_not_enrolled",
      error: `Quyền học khóa này của tài khoản ${email} đã hết hạn.`
    };
  }

  // V4 follows the same release gate as the legacy course manager:
  // approving an enrollment is not enough; course content must also be marked ready.
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("title,raw_data,is_published")
    .eq("slug", slug)
    .maybeSingle();

  if (courseError) throw courseError;
  if (!course?.is_published) {
    return {
      ok: false,
      status: 403,
      code: "course_not_ready",
      error: "Khóa học chưa ở trạng thái Sẵn sàng. Vui lòng quay lại Quản lý khóa học và thử lại sau."
    };
  }

  const rawData = course.raw_data && typeof course.raw_data === "object" ? course.raw_data : {};
  const courseTitle = String(rawData.studentDisplayTitle || course.title || slug).trim() || slug;
  return { ok: true, email, courseSlug: slug, courseTitle };
}
