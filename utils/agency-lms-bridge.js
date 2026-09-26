// utils/agency-lms-bridge.js
// System B Milestone B6 — Agency LMS & Existing V5 Playback Bridge
// Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md

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
 * Checks whether an incoming request is addressed to an Agency tenant domain.
 */
export async function isAgencyRequest(req, options = {}) {
  const host = getTrustedHost(req);
  if (!host) return false;
  // If host is the legacy domain (e.g. localhost during single-tenant test or specific legacy host),
  // check if resolveTenant finds an active agency.
  try {
    const resolved = await resolveTenant(req, options);
    return Boolean(resolved.ok && resolved.tenant?.agencyId);
  } catch {
    return false;
  }
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

  // Check if entitlement exists and is not expired
  const now = new Date();
  const isExpired = entitlement?.expires_at && new Date(entitlement.expires_at) <= now;

  if (!entitlement || isExpired) {
    return {
      ok: false,
      status: 403,
      code: "forbidden_course_access",
      error: "Học viên chưa đăng ký hoặc gói học đã hết hạn trong đơn vị đào tạo này."
    };
  }

  return {
    ok: true,
    tenant,
    user,
    membership,
    entitlement,
    canonicalCourse,
    v5CourseId: canonicalCourse.course_id
  };
}

/**
 * Handles Agency-aware V5 Playback request (/api/lms/portal?endpoint=v5-play).
 * Bridges tenant entitlement to existing V5 playback lease issuance without altering V5 architecture.
 */
export async function handleAgencyV5Play(req, res, options = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  const client = options.supabaseClient || defaultSupabase;

  try {
    const courseSlug = clean(req.query?.course);
    const assetId = clean(req.query?.asset);
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

    const v5CourseId = access.v5CourseId;
    if (!v5CourseId) {
      return res.status(404).json({
        success: false,
        code: "v5_course_not_linked",
        error: "Khóa học chưa được liên kết với media V5."
      });
    }

    // 2. Authorize playback asset against existing V5 published release
    const [authorizationResult, assetResult] = await Promise.all([
      client.rpc("v5_authorize_playback_asset", {
        p_course_id: v5CourseId,
        p_asset_id: assetId
      }),
      client
        .from("v5_media_assets")
        .select("id,type,provider,r2_object_key,mime_type,original_filename,bytes,status")
        .eq("id", assetId)
        .maybeSingle()
    ]);

    if (authorizationResult.error) throw authorizationResult.error;
    if (assetResult.error) throw assetResult.error;

    const releaseId = clean(authorizationResult.data);
    const asset = assetResult.data;

    if (!releaseId) {
      return res.status(404).json({
        success: false,
        code: "v5_media_not_linked",
        error: "Media không thuộc release V5 đang Publish."
      });
    }

    if (!asset || asset.status !== "ready" || asset.provider !== "r2" || !asset.r2_object_key) {
      return res.status(404).json({
        success: false,
        code: "v5_media_not_ready",
        error: "Media V5 chưa sẵn sàng."
      });
    }

    // 3. Issue existing V5 cryptographic playback lease
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
      releaseId,
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
    // 1. Fetch member entitlements
    const { data: entitlements, error: entErr } = await client
      .from("student_entitlements")
      .select("id, canonical_course_id, status, expires_at, created_at")
      .eq("agency_id", tenant.agencyId)
      .eq("membership_id", membership.id)
      .eq("status", "active");

    if (entErr) throw entErr;

    // 2. Fetch canonical courses for these entitlements
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

    // 3. Fetch student devices
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

    const content = release ? v5LearnerReleaseContent(release.snapshot) : null;
    if (!content) {
      return res.status(403).json({ success: false, code: "v5_release_invalid", error: "Release V5 hiện tại không hợp lệ." });
    }

    const intro = buildV5IntroItems(content);

    return res.status(200).json({
      success: true,
      course: {
        slug: canonicalCourse.code,
        title: canonicalCourse.default_title
      },
      intro: {
        complete: true,
        count: intro.count,
        items: intro.items
      }
    });
  } catch (error) {
    console.error("[agency-lms-course-intro]", error);
    return res.status(500).json({ success: false, error: "Không tải được Công thức & Hướng dẫn V5" });
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

    const { canonicalCourse, membership, tenant } = access;

    // Fetch canonical lessons for this course
    const { data: lessons, error: lessonErr } = await client
      .from("canonical_lessons")
      .select("id, canonical_course_id, title, sort_order, is_free_preview, duration_seconds")
      .eq("canonical_course_id", canonicalCourse.id)
      .order("sort_order", { ascending: true });

    if (lessonErr) throw lessonErr;

    // Fetch student's progress in this agency
    const { data: progress, error: progErr } = await client
      .from("agency_lesson_progress")
      .select("id, canonical_lesson_id, progress_percent, is_completed, last_position_seconds")
      .eq("agency_id", tenant.agencyId)
      .eq("membership_id", membership.id);

    if (progErr) throw progErr;

    const progressByLesson = new Map((progress || []).map(p => [p.canonical_lesson_id, p]));

    const feedLessons = (lessons || []).map(l => {
      const p = progressByLesson.get(l.id) || {};
      return {
        id: l.id,
        title: l.title,
        sortOrder: l.sort_order,
        isFreePreview: l.is_free_preview,
        durationSeconds: l.duration_seconds,
        progressPercent: p.progress_percent || 0,
        isCompleted: Boolean(p.is_completed),
        lastPositionSeconds: p.last_position_seconds || 0
      };
    });

    return res.status(200).json({
      success: true,
      course: {
        slug: canonicalCourse.code,
        title: canonicalCourse.default_title
      },
      lessons: feedLessons
    });
  } catch (error) {
    console.error("[agency-lms-v5-feed]", error);
    return res.status(500).json({ success: false, error: "Failed to load V5 feed." });
  }
}
