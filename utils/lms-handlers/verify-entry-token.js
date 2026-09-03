import { supabase } from "../supabase.js";
import {
  ACCOUNT_SHARING_EVENT_TYPES,
  createLmsVerifiedSession,
  logStudentDeviceEvent,
  markLmsEntryTokenUsed,
  normalizeEmail,
  touchStudentSession,
  verifyLmsEntryToken
} from "../lms-session-guard.js";
import { isEnrollmentUsable } from "../lms-enrollment-status.js";

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

function isStale(timestamp, idleHours) {
  if (!timestamp) return true;
  const lastSeen = new Date(timestamp).getTime();
  if (!Number.isFinite(lastSeen)) return true;
  return Date.now() - lastSeen > idleHours * 60 * 60 * 1000;
}

function jsonError(res, status, error, code) {
  return res.status(status).json({ ok: false, error, code });
}

async function logDeviceEventSafe(payload) {
  try {
    await logStudentDeviceEvent(supabase, payload);
  } catch (error) {
    console.warn("[account-sharing] LMS event skipped:", error.message);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return jsonError(res, 405, "Phuong thuc khong duoc ho tro.", "method_not_allowed");
  }

  try {
    const entryToken = String(req.body?.entry_token || "").trim();
    const lmsDeviceId = String(req.body?.lms_device_id || "").trim();

    if (!entryToken) {
      return jsonError(res, 400, "Thieu ma vao lop.", "missing_entry_token");
    }

    if (!lmsDeviceId) {
      return jsonError(res, 400, "Thieu ma thiet bi hoc.", "missing_lms_device_id");
    }

    const tokenResult = await verifyLmsEntryToken(supabase, entryToken);
    if (!tokenResult.ok || !tokenResult.entryToken) {
      if (tokenResult.entryToken?.email) {
        await logDeviceEventSafe({
          email: tokenResult.entryToken.email,
          eventType: ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_REJECTED,
          courseSlug: tokenResult.entryToken.course_slug,
          postId: tokenResult.entryToken.post_id,
          lmsDeviceId,
          userAgent: req.headers["user-agent"] || null,
          ip: getClientIp(req),
          reason: tokenResult.reason || "invalid_entry_token",
          reasonCode: tokenResult.reason || "invalid_entry_token",
          result: "rejected",
          source: "lms",
          correlationId: tokenResult.entryToken.id,
          flowId: tokenResult.entryToken.id,
          idempotencyKey: `entry_token_rejected:${tokenResult.entryToken.id}:${tokenResult.reason || "invalid"}`,
          metadata: {
            tokenStatus: tokenResult.entryToken.status || null
          }
        });
      }
      return jsonError(
        res,
        401,
        "Lien ket lop hoc khong hop le hoac da het han. Vui long quay lai bai tra bai va bam lai nut Bai hoc goc phuc vu giang day.",
        tokenResult.reason || "invalid_entry_token"
      );
    }

    const entry = tokenResult.entryToken;
    const email = normalizeEmail(entry.email);
    const courseSlug = String(entry.course_slug || "").trim();
    const studentSessionId = String(entry.student_session_id || "").trim();

    if (!email || !courseSlug || !studentSessionId) {
      return jsonError(res, 401, "Lien ket lop hoc thieu thong tin can thiet.", "invalid_entry_payload");
    }

    const { data: studentSession, error: sessionError } = await supabase
      .from("student_active_sessions")
      .select("*")
      .eq("student_session_id", studentSessionId)
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!studentSession) {
      return jsonError(res, 401, "Phien dang nhap hoc vien khong con hieu luc. Vui long dang nhap lai tu cong hoc vien.", "student_session_inactive");
    }

    if (isStale(studentSession.last_seen_at, 24)) {
      await supabase
        .from("student_active_sessions")
        .update({
          status: "expired",
          updated_at: new Date().toISOString()
        })
        .eq("student_session_id", studentSessionId)
        .eq("status", "active");

      return jsonError(res, 401, "Phien dang nhap hoc vien da het han. Vui long dang nhap lai tu cong hoc vien.", "student_session_expired");
    }

    const { data: enrollments, error: enrollError } = await supabase
      .from("student_enrollments")
      .select("id, status, expired_at")
      .eq("email", email)
      .eq("course_slug", courseSlug)
      .limit(10);

    if (enrollError) throw enrollError;
    const activeEnrollment = (enrollments || []).find(enrollment => isEnrollmentUsable(enrollment));
    if (!activeEnrollment) {
      return jsonError(res, 403, "Gmail nay chua duoc cap quyen hoc khoa nay.", "enrollment_inactive");
    }

    const lmsSession = await createLmsVerifiedSession(supabase, {
      email,
      studentSessionId,
      lmsDeviceId,
      courseSlug,
      entryTokenId: entry.id,
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"] || null
    });

    await markLmsEntryTokenUsed(supabase, entry.id);
    await touchStudentSession(supabase, studentSessionId);
    await logDeviceEventSafe({
      email,
      eventType: ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_USED,
      courseSlug,
      postId: entry.post_id,
      newStudentSessionId: studentSessionId,
      lmsDeviceId,
      lmsSessionId: lmsSession.lms_session_id,
      userAgent: req.headers["user-agent"] || null,
      ip: getClientIp(req),
      source: "lms",
      result: "success",
      correlationId: entry.id,
      flowId: entry.id,
      idempotencyKey: `entry_token_used:${entry.id}`,
      metadata: {
        entryTokenStatus: "used"
      }
    });
    await logDeviceEventSafe({
      email,
      eventType: ACCOUNT_SHARING_EVENT_TYPES.LMS_SESSION_CREATED,
      courseSlug,
      postId: entry.post_id,
      newStudentSessionId: studentSessionId,
      lmsDeviceId,
      lmsSessionId: lmsSession.lms_session_id,
      userAgent: req.headers["user-agent"] || null,
      ip: getClientIp(req),
      source: "lms",
      result: "success",
      correlationId: entry.id,
      flowId: entry.id,
      idempotencyKey: `lms_session_created:${lmsSession.id || lmsSession.lms_session_id}`
    });

    return res.status(200).json({
      ok: true,
      course_slug: courseSlug,
      lms_session_id: lmsSession.lms_session_id
    });
  } catch (err) {
    console.error("[verify-entry-token] Unexpected error:", err.message);
    return jsonError(res, 500, "Khong xac thuc duoc lien ket vao lop. Vui long thu lai sau.", "server_error");
  }
}
