// utils/agency-lms-bridge.js
// System B Milestone B6 — Agency LMS & Existing V5 Playback Bridge
// Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md
// Milestone M0B.1 Hardened Implementation

import { supabase as defaultSupabase } from "./supabase.js";
import { resolveTenant, getTrustedHost } from "./tenant-resolver.js";
import { requireAgencyMembership, requireAgencyRole } from "./agency-auth.js";
import { issueV5PlaybackLease } from "./v5-playback-lease.js";
import { v5LearnerReleaseContent } from "./v5-release-snapshot.js";
import { buildV5IntroItems } from "./v5-intro-content.js";

function clean(value) {
  return String(value || "").trim();
}

function proofPublicJwk(encodedValue) {
  const encoded = clean(encodedValue);
  if (encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (value?.kty !== "EC" || value?.crv !== "P-256" || !clean(value.x) || !clean(value.y) || value.d) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Returns the list of explicitly configured Legacy hostnames.
 * Reads from process.env.LEGACY_HOST_ALLOWLIST.
 */
export function getLegacyHostAllowlist() {
  const raw = process.env.LEGACY_HOST_ALLOWLIST || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Checks whether the incoming hostname is an explicitly approved Legacy hostname.
 */
export function isExplicitLegacyHost(host) {
  if (!host) return false;
  const allowlist = getLegacyHostAllowlist();
  const normalizedHost = host.toLowerCase().split(":")[0];
  return allowlist.includes(host.toLowerCase()) || allowlist.includes(normalizedHost);
}

/**
 * Resolves request routing mode:
 * 1. If host explicitly matches legacy allowlist -> { route: "LEGACY", host }
 * 2. Else -> resolves Agency tenant
 *    - If valid: { route: "AGENCY", tenant, host }
 *    - If invalid / unknown / conflicting / resolver error: { route: "DENY", status, code, error }
 * NO FALLBACK from unknown/invalid Agency host to Legacy!
 */
export async function resolveRequestRoute(req, options = {}) {
  let host;
  try {
    host = getTrustedHost(req);
  } catch (err) {
    return {
      route: "DENY",
      status: 400,
      code: "invalid_host_header",
      error: err.message || "Invalid or conflicting Host/Forwarded headers."
    };
  }

  if (!host) {
    return {
      route: "DENY",
      status: 400,
      code: "missing_host_header",
      error: "Host header is required."
    };
  }

  // 1. Explicit Legacy Check
  if (isExplicitLegacyHost(host)) {
    return { route: "LEGACY", host };
  }

  // 2. Resolve Agency Tenant
  try {
    const resolved = await resolveTenant(req, options);
    if (resolved.ok && resolved.tenant?.agencyId) {
      return { route: "AGENCY", tenant: resolved.tenant, host };
    }

    return {
      route: "DENY",
      status: resolved.status || 404,
      code: resolved.code || "unknown_tenant_host",
      error: resolved.error || "Unknown or unmapped agency tenant domain."
    };
  } catch (err) {
    return {
      route: "DENY",
      status: 500,
      code: "tenant_resolution_error",
      error: err.message || "Tenant resolution failed."
    };
  }
}

/**
 * Checks whether an incoming request is addressed to an Agency tenant domain.
 * Strictly checks that route === "AGENCY".
 */
export async function isAgencyRequest(req, options = {}) {
  const routeDecision = await resolveRequestRoute(req, options);
  return routeDecision.route === "AGENCY";
}

/**
 * Validates course access for an Agency student.
 * B6 Rule: Old student_enrollments / email / HMAC fallback is FORBIDDEN on agency path.
 * Chain: trusted tenant -> verified auth.uid() -> active membership -> entitlement -> canonical course.
 */
export async function requireAgencyCourseAccess(req, courseIdentifier, options = {}) {
  const client = options.supabaseClient || defaultSupabase;

  // 1. Authenticate user and active membership in current request tenant
  const authResult = await requireAgencyMembership(req, options);
  if (!authResult.ok) {
    return authResult;
  }

  const { user, membership, tenant } = authResult;
  const courseCodeOrSlug = clean(courseIdentifier);
  if (!courseCodeOrSlug) {
    return { ok: false, status: 400, code: "missing_course", error: "Missing course identifier." };
  }

  // 2. Resolve canonical course linked to this identifier
  const { data: canonicalCourse, error: courseErr } = await client
    .from("canonical_courses")
    .select("id, course_id, code, default_title, status")
    .eq("code", courseCodeOrSlug)
    .maybeSingle();

  if (courseErr) {
    console.error("[agency-lms] Error resolving canonical course:", courseErr);
    return { ok: false, status: 500, code: "course_error", error: "Failed to resolve canonical course." };
  }

  if (!canonicalCourse) {
    return { ok: false, status: 404, code: "course_not_found", error: "Khóa học không tồn tại trên hệ thống." };
  }

  // 3. Verify student entitlement in this agency
  const { data: entitlement, error: entErr } = await client
    .from("student_entitlements")
    .select("id, agency_id, membership_id, canonical_course_id, status, expires_at")
    .eq("agency_id", tenant.agencyId)
    .eq("membership_id", membership.id)
    .eq("canonical_course_id", canonicalCourse.id)
    .eq("status", "active")
    .maybeSingle();

  if (entErr) {
    console.error("[agency-lms] Error fetching entitlement:", entErr);
    return { ok: false, status: 500, code: "entitlement_error", error: "Failed to verify course entitlement." };
  }

  const now = new Date();
  const isExpired = entitlement?.expires_at && new Date(entitlement.expires_at) <= now;

  if (!entitlement || isExpired) {
    return {
      ok: false,
      status: 403,
      code: "entitlement_missing",
      error: "Học viên chưa đăng ký hoặc quyền truy cập khóa học đã hết hạn."
    };
  }

  return {
    ok: true,
    user,
    membership,
    tenant,
    entitlement,
    canonicalCourse,
    v5CourseId: canonicalCourse.course_id
  };
}

/**
 * Handles Agency-aware V5 Playback request (/api/lms/portal?endpoint=v5-play).
 * Enforces B1.1 Authorization RPC: v5_authorize_agency_playback.
 * Bridges tenant entitlement to existing V5 playback lease issuance without altering V5 architecture.
 */
export async function handleAgencyV5Play(req, res, options = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  const client = options.supabaseClient || defaultSupabase;

  try {
    const courseSlug = clean(req.query?.course);
    const assetId = clean(req.query?.asset);
    const requestedLessonId = clean(req.query?.lesson);

    if (!assetId) {
      return res.status(400).json({ success: false, code: "missing_asset", error: "Thiếu media asset." });
    }

    const proofHeader = clean(req.headers?.["x-v5-playback-key"]);
    if (!proofHeader) {
      return res.status(426).json({
        success: false,
        code: "v5_playback_v2_required",
        error: "Phiên phát V5 cần Service Worker V2. Hãy tải lại trang học."
      });
    }

    const playbackProofKey = proofPublicJwk(proofHeader);
    if (!playbackProofKey) {
      return res.status(400).json({
        success: false,
        code: "v5_playback_proof_invalid",
        error: "Khóa proof V5 không hợp lệ."
      });
    }

    // 1. Enforce strict Agency course access (no old email/HMAC fallback)
    const access = await requireAgencyCourseAccess(req, courseSlug, options);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, code: access.code, error: access.error });
    }

    const { tenant, membership, canonicalCourse, v5CourseId } = access;
    if (!v5CourseId) {
      return res.status(404).json({
        success: false,
        code: "v5_course_not_linked",
        error: "Khóa học chưa được liên kết với media V5."
      });
    }

    // 2. Resolve canonical lesson for this asset / course (F3: Real canonical lesson mapping required)
    let lessonId = requestedLessonId;
    if (!lessonId) {
      // Look up canonical lesson linked to this course
      const { data: lessonRow, error: lessonLookupErr } = await client
        .from("canonical_lessons")
        .select("id")
        .eq("canonical_course_id", canonicalCourse.id)
        .limit(1)
        .maybeSingle();

      if (lessonLookupErr || !lessonRow) {
        return res.status(404).json({
          success: false,
          code: "canonical_lesson_not_found",
          error: "Không tìm thấy bài học canonical tương ứng với nội dung phát."
        });
      }
      lessonId = lessonRow.id;
    }

    // 3. Call B1.1 Authorization RPC: v5_authorize_agency_playback
    const { data: authData, error: authError } = await client.rpc("v5_authorize_agency_playback", {
      p_agency_id: tenant.agencyId,
      p_membership_id: membership.id,
      p_lesson_id: lessonId,
      p_asset_id: assetId
    });

    if (authError) {
      console.error("[agency-lms-v5-play] B1.1 RPC authorization error:", authError);
      return res.status(500).json({
        success: false,
        code: "authorization_rpc_error",
        error: authError.message || "Failed to authorize playback via agency RPC."
      });
    }

    if (!authData?.authorized) {
      const code = authData?.code || "unauthorized";
      const status = code === "lesson_not_found" || code === "media_not_in_release" ? 404 : 403;
      return res.status(status).json({
        success: false,
        code,
        error: authData?.error || "Playback not authorized for current agency."
      });
    }

    // 4. Verify media asset readiness in v5_media_assets
    const { data: asset, error: assetErr } = await client
      .from("v5_media_assets")
      .select("id,type,provider,r2_object_key,mime_type,original_filename,bytes,status")
      .eq("id", assetId)
      .maybeSingle();

    if (assetErr) throw assetErr;

    if (!asset || asset.status !== "ready" || asset.provider !== "r2" || !asset.r2_object_key) {
      return res.status(404).json({
        success: false,
        code: "v5_media_not_ready",
        error: "Media V5 chưa sẵn sàng."
      });
    }

    // 5. Issue existing V5 cryptographic playback lease (Preserved ECDSA P-256 lease)
    const lease = issueV5PlaybackLease({
      version: 2,
      assetId: asset.id,
      courseSlug,
      objectKey: asset.r2_object_key,
      mediaType: asset.type,
      mimeType: asset.mime_type,
      filename: asset.original_filename,
      bytes: asset.bytes,
      userAgent: req.headers["user-agent"] || "",
      email: access.user.email || "",
      proofPublicJwk: playbackProofKey
    });

    return res.status(200).json({
      success: true,
      assetId: asset.id,
      releaseId: authData.release_id,
      playbackUrl: lease.url,
      playbackLease: lease.token,
      mimeType: asset.mime_type,
      expiresAt: lease.expiresAt
    });
  } catch (error) {
    console.error("[agency-lms-v5-play]", error);
    const status = error?.code === "v5_playback_not_configured" ? 503 : 500;
    return res.status(status).json({
      success: false,
      code: error?.code || "v5_play_failed",
      error: status === 503 ? error.message : "V5 playback server error"
    });
  }
}

/**
 * Handles Agency-aware Learner Dashboard (/api/lms/portal?endpoint=student-dashboard).
 */
export async function handleAgencyLearnerDashboard(req, res, options = {}) {
  res.setHeader("Cache-Control", "no-store");

  const authResult = await requireAgencyMembership(req, options);
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, code: authResult.code, error: authResult.error });
  }

  const { user, membership, tenant } = authResult;
  const client = options.supabaseClient || defaultSupabase;

  try {
    const { data: entitlements, error: entErr } = await client
      .from("student_entitlements")
      .select("id, canonical_course_id, status, expires_at, created_at")
      .eq("agency_id", tenant.agencyId)
      .eq("membership_id", membership.id)
      .eq("status", "active");

    if (entErr) throw entErr;

    const courseIds = (entitlements || []).map(e => e.canonical_course_id);
    let courses = [];
    if (courseIds.length > 0) {
      const { data: courseRows, error: courseErr } = await client
        .from("canonical_courses")
        .select("id, code, default_title, status, curriculum_metadata")
        .in("id", courseIds)
        .eq("status", "published");

      if (courseErr) throw courseErr;
      courses = courseRows || [];
    }

    const { data: devices, error: devErr } = await client
      .from("student_devices")
      .select("id, device_fingerprint, device_name, last_ip, last_seen_at, is_active")
      .eq("agency_id", tenant.agencyId)
      .eq("membership_id", membership.id);

    if (devErr) throw devErr;

    return res.status(200).json({
      success: true,
      agency: {
        id: tenant.agencyId,
        slug: tenant.agencySlug,
        name: tenant.agencyName
      },
      member: {
        id: membership.id,
        userId: user.id,
        email: user.email,
        displayName: membership.display_name,
        role: membership.role,
        status: membership.status
      },
      entitlements: entitlements || [],
      courses,
      devices: devices || []
    });
  } catch (error) {
    console.error("[agency-lms-dashboard]", error);
    return res.status(500).json({ success: false, error: "Failed to load learner dashboard." });
  }
}

/**
 * Handles Agency-aware Course Intro (/api/lms/portal?endpoint=v5-course-intro).
 */
export async function handleAgencyCourseIntro(req, res, options = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  const client = options.supabaseClient || defaultSupabase;

  try {
    const courseSlug = clean(req.query?.course);
    const access = await requireAgencyCourseAccess(req, courseSlug, options);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, code: access.code, error: access.error });
    }

    const { canonicalCourse, v5CourseId } = access;
    if (!v5CourseId) {
      return res.status(404).json({ success: false, code: "v5_course_not_found", error: "Không tìm thấy khóa V5." });
    }

    const { data: config, error: configError } = await client
      .from("v5_course_configs")
      .select("course_id,status,published_release_id")
      .eq("course_id", v5CourseId)
      .maybeSingle();

    if (configError) throw configError;
    if (!config || config.status !== "published" || !config.published_release_id) {
      return res.status(403).json({ success: false, code: "v5_not_published", error: "Khóa V5 chưa được Publish." });
    }

    const { data: release, error: releaseError } = await client
      .from("v5_releases")
      .select("id,course_id,status,snapshot")
      .eq("id", config.published_release_id)
      .eq("course_id", v5CourseId)
      .eq("status", "published")
      .maybeSingle();

    if (releaseError) throw releaseError;
    if (!release) {
      return res.status(404).json({ success: false, code: "v5_release_not_found", error: "Không tìm thấy Release V5." });
    }

    const introItems = buildV5IntroItems(release.snapshot);

    return res.status(200).json({
      success: true,
      course: {
        code: canonicalCourse.code,
        title: canonicalCourse.default_title,
        introItems
      }
    });
  } catch (error) {
    console.error("[agency-lms-course-intro]", error);
    return res.status(500).json({ success: false, error: "Failed to load course intro." });
  }
}

/**
 * Handles Agency-aware V5 Feed (/api/lms/portal?endpoint=v5-feed).
 */
export async function handleAgencyV5Feed(req, res, options = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  const client = options.supabaseClient || defaultSupabase;

  try {
    const courseSlug = clean(req.query?.course);
    const access = await requireAgencyCourseAccess(req, courseSlug, options);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, code: access.code, error: access.error });
    }

    const { v5CourseId } = access;
    if (!v5CourseId) {
      return res.status(404).json({ success: false, code: "v5_course_not_found", error: "Không tìm thấy khóa V5." });
    }

    const { data: config, error: configError } = await client
      .from("v5_course_configs")
      .select("course_id,status,published_release_id")
      .eq("course_id", v5CourseId)
      .maybeSingle();

    if (configError) throw configError;
    if (!config || config.status !== "published" || !config.published_release_id) {
      return res.status(403).json({ success: false, code: "v5_not_published", error: "Khóa V5 chưa được Publish." });
    }

    const { data: release, error: releaseError } = await client
      .from("v5_releases")
      .select("id,course_id,status,snapshot")
      .eq("id", config.published_release_id)
      .eq("course_id", v5CourseId)
      .eq("status", "published")
      .maybeSingle();

    if (releaseError) throw releaseError;
    if (!release) {
      return res.status(404).json({ success: false, code: "v5_release_not_found", error: "Không tìm thấy Release V5." });
    }

    const feed = v5LearnerReleaseContent(release.snapshot);

    return res.status(200).json({
      success: true,
      feed
    });
  } catch (error) {
    console.error("[agency-lms-v5-feed]", error);
    return res.status(500).json({ success: false, error: "Failed to load V5 feed." });
  }
}
