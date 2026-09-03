import crypto from "crypto";
import { isEnrollmentUsable } from "./lms-enrollment-status.js";

export const STUDENT_SESSION_STATUSES = Object.freeze({
  ACTIVE: "active",
  LOGGED_OUT: "logged_out",
  EXPIRED: "expired",
  ADMIN_RESET: "admin_reset",
  SUPERSEDED: "superseded"
});

export const LMS_ENTRY_TOKEN_STATUSES = Object.freeze({
  ACTIVE: "active",
  USED: "used",
  EXPIRED: "expired",
  REVOKED: "revoked"
});

export const LMS_SESSION_STATUSES = Object.freeze({
  ACTIVE: "active",
  LOGGED_OUT: "logged_out",
  EXPIRED: "expired",
  ADMIN_RESET: "admin_reset",
  SUPERSEDED: "superseded"
});

export const DEFAULT_LMS_ENTRY_TOKEN_TTL_MINUTES = 30;
export const DEFAULT_STUDENT_SESSION_IDLE_HOURS = 24;
export const DEFAULT_LMS_SESSION_IDLE_HOURS = 24;
export const ACCOUNT_SHARING_SCHEMA_VERSION = "v2";
export const ACCOUNT_SHARING_RISK_RULE_VERSION = "risk_v2_p0";

let missingAccountEventHashSecretWarned = false;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getLmsEntryTokenTtlMinutes() {
  return positiveNumber(
    process.env.LMS_ENTRY_TOKEN_TTL_MINUTES,
    DEFAULT_LMS_ENTRY_TOKEN_TTL_MINUTES
  );
}

export function getStudentSessionIdleHours() {
  return positiveNumber(
    process.env.STUDENT_SESSION_IDLE_HOURS,
    DEFAULT_STUDENT_SESSION_IDLE_HOURS
  );
}

export function getLmsSessionIdleHours() {
  return positiveNumber(
    process.env.LMS_SESSION_IDLE_HOURS,
    DEFAULT_LMS_SESSION_IDLE_HOURS
  );
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function generateSecureToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function generateSessionId(prefix = "sess") {
  return `${prefix}_${generateSecureToken(32)}`;
}

export function generateDeviceId(prefix = "dev") {
  return `${prefix}_${generateSecureToken(24)}`;
}

export function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("rawToken is required");
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function hashOptionalValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const secret = String(
    process.env.ACCOUNT_EVENT_HASH_SECRET ||
    process.env.SESSION_GUARD_HASH_SECRET ||
    ""
  ).trim();
  if (!secret) {
    warnMissingAccountEventHashSecret();
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }
  return crypto.createHmac("sha256", secret).update(normalized).digest("hex");
}

export function warnMissingAccountEventHashSecret() {
  if (missingAccountEventHashSecretWarned) return;
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    console.warn("[account-sharing] ACCOUNT_EVENT_HASH_SECRET is not configured; falling back to legacy SHA-256 event hashes.");
    missingAccountEventHashSecretWarned = true;
  }
}

export function getAccountEventHashVersion() {
  return String(
    process.env.ACCOUNT_EVENT_HASH_SECRET ||
    process.env.SESSION_GUARD_HASH_SECRET ||
    ""
  ).trim()
    ? "hmac_sha256_v2"
    : "sha256_v1";
}

export const ACCOUNT_SHARING_EVENT_TYPES = Object.freeze({
  PORTAL_SESSION_CREATED: "portal_session_created",
  PORTAL_SESSION_REUSED: "portal_session_reused",
  LOGIN_BLOCKED_OTHER_DEVICE: "login_blocked_other_device",
  ENTRY_TOKEN_CREATED: "entry_token_created",
  ENTRY_TOKEN_USED: "entry_token_used",
  ENTRY_TOKEN_REJECTED: "entry_token_rejected",
  LMS_SESSION_CREATED: "lms_session_created",
  LMS_SESSION_REJECTED: "lms_session_rejected",
  LOGOUT: "logout",
  ADMIN_RESET: "admin_reset",
  ADMIN_NOTE: "admin_note",
  ADMIN_MARK_REVIEWED: "admin_mark_reviewed",
  ADMIN_MARK_SUSPECTED: "admin_mark_suspected"
});

const ACCOUNT_SHARING_RISK_POINTS = Object.freeze({
  [ACCOUNT_SHARING_EVENT_TYPES.LOGIN_BLOCKED_OTHER_DEVICE]: 25,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_REJECTED]: 10,
  [ACCOUNT_SHARING_EVENT_TYPES.LMS_SESSION_REJECTED]: 10,
  [ACCOUNT_SHARING_EVENT_TYPES.PORTAL_SESSION_CREATED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.PORTAL_SESSION_REUSED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_CREATED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_USED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.LMS_SESSION_CREATED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.LOGOUT]: 4,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_RESET]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_NOTE]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_MARK_REVIEWED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_MARK_SUSPECTED]: 0
});

export function getAccountSharingRiskPoints(eventType) {
  return ACCOUNT_SHARING_RISK_POINTS[eventType] || 0;
}

export function getAccountSharingRiskLevel(score) {
  const value = Number(score) || 0;
  if (value >= 80) return "high";
  if (value >= 45) return "suspicious";
  if (value >= 20) return "watch";
  return "normal";
}

function sanitizeEventMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    const cleanKey = String(key || "").slice(0, 80);
    if (!cleanKey) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      output[cleanKey] = value;
    } else if (typeof value === "string") {
      output[cleanKey] = value.slice(0, 500);
    }
  }
  return output;
}

function isMissingTelemetryColumn(error) {
  return /column .* does not exist|relation .* does not exist|schema cache|PGRST204/i.test(String(error?.message || ""));
}

export async function logStudentDeviceEvent(supabase, {
  email,
  eventType,
  action = null,
  courseSlug = null,
  postId = null,
  oldDeviceHash = null,
  newDeviceHash = null,
  oldDeviceLabel = null,
  newDeviceLabel = null,
  oldStudentSessionId = null,
  newStudentSessionId = null,
  lmsDeviceId = null,
  lmsSessionId = null,
  userAgent = null,
  ip = null,
  ipHash = null,
  reason = null,
  source = "lms",
  riskPoints = null,
  metadata = {},
  adminEmail = null,
  idempotencyKey = null,
  correlationId = null,
  requestId = null,
  flowId = null,
  result = null,
  reasonCode = null
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedEventType = String(eventType || "").trim();
  if (!normalizedEmail || !normalizedEventType) {
    return { ok: false, reason: "missing_required_fields" };
  }

  const safeReason = reason || reasonCode || "unspecified";
  const safeReasonCode = reasonCode || reason || "unspecified";

  const insertPayload = {
    email: normalizedEmail,
    action: String(action || normalizedEventType),
    event_type: normalizedEventType,
    course_slug: courseSlug || null,
    post_id: postId || null,
    old_device_hash: oldDeviceHash || null,
    new_device_hash: newDeviceHash || hashOptionalValue(lmsDeviceId),
    old_device_label: oldDeviceLabel || null,
    new_device_label: newDeviceLabel || null,
    old_student_session_id: oldStudentSessionId || null,
    new_student_session_id: newStudentSessionId || null,
    lms_device_hash: hashOptionalValue(lmsDeviceId),
    lms_session_hash: hashOptionalValue(lmsSessionId),
    user_agent: userAgent || null,
    ip_hash: ipHash || hashOptionalValue(ip),
    reason: safeReason,
    event_source: source || "lms",
    risk_points: Number.isFinite(Number(riskPoints))
      ? Number(riskPoints)
      : getAccountSharingRiskPoints(normalizedEventType),
    metadata: sanitizeEventMetadata(metadata),
    admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
    event_idempotency_key: idempotencyKey || null,
    correlation_id: correlationId || null,
    request_id: requestId || null,
    flow_id: flowId || null,
    result: result || null,
    reason_code: safeReasonCode,
    schema_version: ACCOUNT_SHARING_SCHEMA_VERSION,
    hash_version: getAccountEventHashVersion()
  };

  let { error } = await supabase
    .from("student_device_change_logs")
    .insert(insertPayload);

  if (error && isMissingTelemetryColumn(error)) {
    const fallbackPayload = { ...insertPayload };
    delete fallbackPayload.correlation_id;
    delete fallbackPayload.request_id;
    delete fallbackPayload.flow_id;
    delete fallbackPayload.result;
    delete fallbackPayload.reason_code;
    delete fallbackPayload.schema_version;
    delete fallbackPayload.hash_version;
    ({ error } = await supabase
      .from("student_device_change_logs")
      .insert(fallbackPayload));
  }

  if (error) {
    if (error.code === "23505" && idempotencyKey) {
      return { ok: true, duplicate: true };
    }
    // Best-effort telemetry only. Never block student access because a warning log failed.
    console.warn("[account-sharing] Could not write device event:", error.message);
    return { ok: false, reason: "insert_failed" };
  }

  return { ok: true };
}

export async function writeAdminAuditLog(supabase, {
  adminEmail = null,
  action,
  targetEmail = null,
  metadata = {},
  ip = null,
  ipHash = null,
  userAgent = null
}) {
  const normalizedAction = String(action || "").trim();
  if (!normalizedAction) {
    return { ok: false, reason: "missing_action" };
  }

  const { error } = await supabase
    .from("admin_audit_logs")
    .insert({
      admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
      action: normalizedAction,
      target_email: targetEmail ? normalizeEmail(targetEmail) : null,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      ip_hash: ipHash || hashOptionalValue(ip),
      user_agent: userAgent || null
    });

  if (error) {
    console.warn("[account-sharing] Could not write admin audit:", error.message);
    return { ok: false, reason: "insert_failed" };
  }

  return { ok: true };
}

export async function getStudentSessionControl(supabase, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const { data, error } = await supabase
    .from("student_session_controls")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error && isMissingTelemetryColumn(error)) return null;
  if (error) throw error;
  return data || null;
}

function isRevokedBySessionControl(row, control) {
  if (!row || !control?.sessions_revoked_before) return false;
  const revokedBefore = new Date(control.sessions_revoked_before).getTime();
  const createdAt = new Date(row.created_at || 0).getTime();
  return Number.isFinite(revokedBefore) && Number.isFinite(createdAt) && createdAt <= revokedBefore;
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function cutoffIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isPast(timestamp) {
  return Boolean(timestamp) && new Date(timestamp).getTime() <= Date.now();
}

function isOlderThan(timestamp, hours) {
  if (!timestamp) return true;
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return true;
  return time < new Date(cutoffIso(hours)).getTime();
}

async function throwIfSupabaseError(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function createStudentActiveSession(supabase, {
  email,
  portalDeviceId,
  studentSessionId = generateSessionId("student"),
  status = STUDENT_SESSION_STATUSES.ACTIVE,
  ip = null,
  userAgent = null
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  if (!portalDeviceId) throw new Error("portalDeviceId is required");

  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .insert({
      email: normalizedEmail,
      student_session_id: studentSessionId,
      portal_device_id: portalDeviceId,
      status,
      ip,
      user_agent: userAgent
    })
    .select("*")
    .single());
}

export async function getActiveStudentSessionByEmail(supabase, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const data = await throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .select("*")
    .eq("email", normalizedEmail)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .order("last_seen_at", { ascending: false })
    .limit(1));

  return data?.[0] || null;
}

export async function touchStudentSession(supabase, studentSessionId) {
  if (!studentSessionId) throw new Error("studentSessionId is required");

  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      last_seen_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("student_session_id", studentSessionId)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function expireStaleStudentSessions(supabase, {
  idleHours = getStudentSessionIdleHours()
} = {}) {
  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      status: STUDENT_SESSION_STATUSES.EXPIRED,
      updated_at: nowIso()
    })
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .lt("last_seen_at", cutoffIso(idleHours))
    .select("id,email,student_session_id,status"));
}

export async function markStudentSessionLoggedOut(supabase, studentSessionId) {
  if (!studentSessionId) throw new Error("studentSessionId is required");
  const timestamp = nowIso();

  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      status: STUDENT_SESSION_STATUSES.LOGGED_OUT,
      logout_at: timestamp,
      updated_at: timestamp
    })
    .eq("student_session_id", studentSessionId)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function resetStudentSessionByEmail(supabase, email, {
  adminEmail = null,
  reason = null
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  const rpcResult = await supabase.rpc("reset_student_session_guard", {
    p_email: normalizedEmail,
    p_admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
    p_reason: reason || "admin_reset"
  });

  if (!rpcResult.error) {
    return {
      ok: true,
      studentSessions: Number(rpcResult.data?.studentSessions || 0),
      entryTokens: Number(rpcResult.data?.entryTokens || 0),
      lmsSessions: Number(rpcResult.data?.lmsSessions || 0),
      revokedBefore: rpcResult.data?.revokedBefore || null,
      usedRpc: true
    };
  }

  if (!/function .*reset_student_session_guard|schema cache|does not exist/i.test(String(rpcResult.error.message || ""))) {
    throw rpcResult.error;
  }

  const timestamp = nowIso();

  const sessions = await throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      status: STUDENT_SESSION_STATUSES.ADMIN_RESET,
      logout_at: timestamp,
      updated_at: timestamp
    })
    .eq("email", normalizedEmail)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .select("student_session_id"));

  const studentSessionIds = (sessions || [])
    .map(session => session.student_session_id)
    .filter(Boolean);

  await Promise.all(studentSessionIds.map(studentSessionId => Promise.all([
    revokeEntryTokensByStudentSession(supabase, studentSessionId),
    revokeLmsSessionsByStudentSession(supabase, studentSessionId, LMS_SESSION_STATUSES.ADMIN_RESET)
  ])));

  return {
    ok: true,
    studentSessions: (sessions || []).length,
    entryTokens: null,
    lmsSessions: null,
    revokedBefore: timestamp,
    usedRpc: false,
    sessions: sessions || []
  };
}

export async function createLmsEntryToken(supabase, {
  email,
  studentSessionId,
  portalDeviceId,
  courseSlug,
  postId = null,
  ttlMinutes = getLmsEntryTokenTtlMinutes(),
  createdIp = null,
  createdUserAgent = null
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  if (!studentSessionId) throw new Error("studentSessionId is required");
  if (!portalDeviceId) throw new Error("portalDeviceId is required");
  if (!courseSlug) throw new Error("courseSlug is required");

  const rawToken = generateSecureToken(48);
  const tokenHash = hashToken(rawToken);
  const entryToken = await throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .insert({
      token_hash: tokenHash,
      email: normalizedEmail,
      student_session_id: studentSessionId,
      portal_device_id: portalDeviceId,
      course_slug: courseSlug,
      post_id: postId,
      status: LMS_ENTRY_TOKEN_STATUSES.ACTIVE,
      expires_at: addMinutesIso(ttlMinutes),
      created_ip: createdIp,
      created_user_agent: createdUserAgent
    })
    .select("*")
    .single());

  return {
    rawToken,
    tokenHash,
    entryToken
  };
}

export async function verifyLmsEntryToken(supabase, rawToken) {
  const tokenHash = hashToken(rawToken);
  const entryToken = await throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle());

  if (!entryToken) {
    return { ok: false, reason: "not_found", entryToken: null };
  }

  if (entryToken.status !== LMS_ENTRY_TOKEN_STATUSES.ACTIVE) {
    return { ok: false, reason: "not_active", entryToken };
  }

  const control = await getStudentSessionControl(supabase, entryToken.email);
  if (isRevokedBySessionControl(entryToken, control)) {
    await supabase
      .from("lms_entry_tokens")
      .update({ status: LMS_ENTRY_TOKEN_STATUSES.REVOKED })
      .eq("id", entryToken.id)
      .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE);
    return { ok: false, reason: "entry_token_revoked_by_reset", entryToken };
  }

  if (isPast(entryToken.expires_at)) {
    await supabase
      .from("lms_entry_tokens")
      .update({ status: LMS_ENTRY_TOKEN_STATUSES.EXPIRED })
      .eq("id", entryToken.id)
      .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE);
    return { ok: false, reason: "expired", entryToken };
  }

  return { ok: true, reason: "valid", entryToken };
}

export async function markLmsEntryTokenUsed(supabase, entryTokenId) {
  if (!entryTokenId) throw new Error("entryTokenId is required");

  return throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .update({
      status: LMS_ENTRY_TOKEN_STATUSES.USED,
      used_at: nowIso()
    })
    .eq("id", entryTokenId)
    .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function revokeEntryTokensByStudentSession(supabase, studentSessionId) {
  if (!studentSessionId) throw new Error("studentSessionId is required");

  return throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .update({ status: LMS_ENTRY_TOKEN_STATUSES.REVOKED })
    .eq("student_session_id", studentSessionId)
    .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE)
    .select("id,status"));
}

export async function createLmsVerifiedSession(supabase, {
  email,
  studentSessionId,
  lmsDeviceId,
  courseSlug,
  entryTokenId = null,
  lmsSessionId = generateSessionId("lms"),
  ip = null,
  userAgent = null
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  if (!studentSessionId) throw new Error("studentSessionId is required");
  if (!lmsDeviceId) throw new Error("lmsDeviceId is required");
  if (!courseSlug) throw new Error("courseSlug is required");

  return throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .insert({
      lms_session_id: lmsSessionId,
      email: normalizedEmail,
      student_session_id: studentSessionId,
      lms_device_id: lmsDeviceId,
      course_slug: courseSlug,
      entry_token_id: entryTokenId,
      status: LMS_SESSION_STATUSES.ACTIVE,
      ip,
      user_agent: userAgent
    })
    .select("*")
    .single());
}

export async function getActiveLmsVerifiedSession(supabase, lmsSessionId, {
  lmsDeviceId = null,
  idleHours = getLmsSessionIdleHours()
} = {}) {
  if (!lmsSessionId) return null;

  let query = supabase
    .from("lms_verified_sessions")
    .select("*")
    .eq("lms_session_id", lmsSessionId)
    .eq("status", LMS_SESSION_STATUSES.ACTIVE);

  if (lmsDeviceId) {
    query = query.eq("lms_device_id", lmsDeviceId);
  }

  const session = await throwIfSupabaseError(await query.maybeSingle());
  if (!session) return null;

  if (new Date(session.last_seen_at).getTime() < new Date(cutoffIso(idleHours)).getTime()) {
    await supabase
      .from("lms_verified_sessions")
      .update({
        status: LMS_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("id", session.id)
      .eq("status", LMS_SESSION_STATUSES.ACTIVE);
    return null;
  }

  return session;
}

export async function touchLmsVerifiedSession(supabase, lmsSessionId) {
  if (!lmsSessionId) throw new Error("lmsSessionId is required");

  return throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .update({
      last_seen_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("lms_session_id", lmsSessionId)
    .eq("status", LMS_SESSION_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function revokeLmsSessionsByStudentSession(
  supabase,
  studentSessionId,
  status = LMS_SESSION_STATUSES.LOGGED_OUT
) {
  if (!studentSessionId) throw new Error("studentSessionId is required");
  const timestamp = nowIso();

  return throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .update({
      status,
      logout_at: timestamp,
      updated_at: timestamp
    })
    .eq("student_session_id", studentSessionId)
    .eq("status", LMS_SESSION_STATUSES.ACTIVE)
    .select("id,status"));
}

export async function verifyLmsVerifiedSessionAccess(supabase, {
  lmsSessionId,
  lmsDeviceId,
  courseSlug = null,
  lmsIdleHours = getLmsSessionIdleHours(),
  studentIdleHours = getStudentSessionIdleHours()
}) {
  if (!lmsSessionId || !lmsDeviceId) {
    return { ok: false, reason: "missing_lms_session", session: null };
  }

  const session = await throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .select("*")
    .eq("lms_session_id", lmsSessionId)
    .maybeSingle());

  if (!session) {
    return { ok: false, reason: "invalid_lms_session", session: null };
  }

  if (session.lms_device_id !== lmsDeviceId) {
    return { ok: false, reason: "device_mismatch", session };
  }

  if (session.status !== LMS_SESSION_STATUSES.ACTIVE) {
    return { ok: false, reason: `lms_session_${session.status}`, session };
  }

  const control = await getStudentSessionControl(supabase, session.email);
  if (isRevokedBySessionControl(session, control)) {
    await supabase
      .from("lms_verified_sessions")
      .update({
        status: LMS_SESSION_STATUSES.ADMIN_RESET,
        logout_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", session.id)
      .eq("status", LMS_SESSION_STATUSES.ACTIVE);
    return { ok: false, reason: "lms_session_revoked_by_reset", session };
  }

  if (isOlderThan(session.last_seen_at, lmsIdleHours)) {
    await supabase
      .from("lms_verified_sessions")
      .update({
        status: LMS_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("id", session.id)
      .eq("status", LMS_SESSION_STATUSES.ACTIVE);
    return { ok: false, reason: "lms_session_expired", session };
  }

  const expectedCourseSlug = String(courseSlug || "").trim();
  const sessionCourseSlug = String(session.course_slug || "").trim();
  if (expectedCourseSlug && sessionCourseSlug !== expectedCourseSlug) {
    return { ok: false, reason: "course_mismatch", session };
  }

  const { data: studentSession, error: studentError } = await supabase
    .from("student_active_sessions")
    .select("*")
    .eq("student_session_id", session.student_session_id)
    .eq("email", normalizeEmail(session.email))
    .maybeSingle();

  if (studentError) throw studentError;
  if (!studentSession) {
    return { ok: false, reason: "student_session_inactive", session };
  }
  if (studentSession.status !== STUDENT_SESSION_STATUSES.ACTIVE) {
    return { ok: false, reason: `student_session_${studentSession.status}`, session };
  }

  if (isRevokedBySessionControl(studentSession, control)) {
    await supabase
      .from("student_active_sessions")
      .update({
        status: STUDENT_SESSION_STATUSES.ADMIN_RESET,
        logout_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("student_session_id", session.student_session_id)
      .eq("status", STUDENT_SESSION_STATUSES.ACTIVE);
    return { ok: false, reason: "student_session_revoked_by_reset", session };
  }

  if (isOlderThan(studentSession.last_seen_at, studentIdleHours)) {
    await supabase
      .from("student_active_sessions")
      .update({
        status: STUDENT_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("student_session_id", session.student_session_id)
      .eq("status", STUDENT_SESSION_STATUSES.ACTIVE);
    return { ok: false, reason: "student_session_expired", session };
  }

  const { data: enrollments, error: enrollError } = await supabase
    .from("student_enrollments")
    .select("id,status,expired_at")
    .eq("email", normalizeEmail(session.email))
    .eq("course_slug", sessionCourseSlug)
    .limit(10);

  if (enrollError) throw enrollError;
  const activeEnrollment = (enrollments || []).find(enrollment => isEnrollmentUsable(enrollment));
  if (!activeEnrollment) {
    return { ok: false, reason: "enrollment_inactive", session };
  }

  await Promise.all([
    touchLmsVerifiedSession(supabase, lmsSessionId),
    touchStudentSession(supabase, session.student_session_id)
  ]);

  return {
    ok: true,
    reason: "valid",
    email: normalizeEmail(session.email),
    courseSlug: sessionCourseSlug,
    session,
    studentSession,
    enrollment: activeEnrollment
  };
}

export function getEntryTokenRequiredCourses() {
  return String(process.env.LMS_ENTRY_TOKEN_REQUIRED_COURSES || "")
    .split(",")
    .map((slug) => String(slug || "").trim())
    .filter(Boolean);
}

export function isEntryTokenRequiredCourse(courseSlug) {
  const normalizedCourseSlug = String(courseSlug || "").trim();
  if (!normalizedCourseSlug) return false;
  return getEntryTokenRequiredCourses().includes(normalizedCourseSlug);
}
