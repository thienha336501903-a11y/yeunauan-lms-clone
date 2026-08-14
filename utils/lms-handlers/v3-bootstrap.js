import { supabase } from "../supabase.js";
import {
  verifyGoogleIdToken,
  verifyStudentSession,
  createStudentSession,
  parseCookies,
  cookieOptions
} from "../lms.js";
import { verifyLmsVerifiedSessionAccess } from "../lms-session-guard.js";

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
  return String(status || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
async function verifyGoogleAccessToken(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) return "";
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      method: "GET",
      headers: { "Authorization": "Bearer " + token }
    });
    if (!response.ok) return "";
    const profile = await response.json();
    if (!profile?.email || profile?.email_verified === false) return "";
    return String(profile.email).trim().toLowerCase();
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const { credential, accessToken, sessionToken } = req.body || {};
    const cookies = parseCookies(req);
    const token = String(sessionToken || cookies[SESSION_COOKIE] || "").trim();
    const lmsHeaders = getLmsSessionHeaders(req);
    let email = "";

    // Explicit account choice must override stale browser/session identity.
    if (credential) {
      email = String(await verifyGoogleIdToken(credential) || "").trim().toLowerCase();
    } else if (accessToken) {
      email = await verifyGoogleAccessToken(accessToken);
    }

    if (!email && lmsHeaders.lmsSessionId && lmsHeaders.lmsDeviceId) {
      const access = await verifyLmsVerifiedSessionAccess(supabase, { ...lmsHeaders, courseSlug: null });
      if (access?.ok && access.email) email = String(access.email).trim().toLowerCase();
    }
    if (!email && token) {
      const decoded = verifyStudentSession(token);
      if (decoded?.email) email = String(decoded.email).trim().toLowerCase();
    }
    if (!email) {
      return res.status(401).json({ success: false, authError: "missing_login_session", error: "Missing or expired login session" });
    }

    const { data: enrollments, error: enrollError } = await supabase
      .from("student_enrollments")
      .select("course_slug,status")
      .eq("email", email);
    if (enrollError) throw enrollError;

    const slugs = [...new Set((enrollments || [])
      .filter(row => isActiveEnrollment(row.status))
      .map(row => String(row.course_slug || "").trim())
      .filter(Boolean))];

    if (!slugs.length) {
      return res.status(403).json({
        success: false,
        authError: "no_active_enrollments",
        email,
        error: "Student has no active course enrollments"
      });
    }

    const { data: courseRows, error: courseError } = await supabase
      .from("courses")
      .select("slug,title,raw_data")
      .in("slug", slugs);
    if (courseError) throw courseError;

    const bySlug = new Map((courseRows || []).map(row => [String(row.slug || "").trim(), row]));
    const allowedCourses = slugs.map(slug => {
      const row = bySlug.get(slug) || {};
      const raw = row.raw_data || {};
      const title = String(raw.studentDisplayTitle || row.title || slug).trim() || slug;
      return { slug, title };
    });

    const newSession = createStudentSession(email);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(newSession.token)}; ${cookieOptions(newSession.expiresAt - Date.now())}`);
    return res.status(200).json({ success: true, email, allowedCourses, sessionToken: newSession.token, sessionExpiresAt: newSession.expiresAt });
  } catch (error) {
    console.error("[v3-bootstrap]", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
