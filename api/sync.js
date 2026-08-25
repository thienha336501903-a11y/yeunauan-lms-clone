import crypto from "crypto";
import { supabase } from "../utils/supabase.js";
import { 
  normalizeEmail, 
  syncEnrollment
} from "../utils/lms.js";
import { buildPrepublish } from "../utils/lms-handlers/admin-v4-prepublish.js";
import { grantEnrollment, requireV4Course } from "../utils/lms-handlers/admin-v4-enrollments.js";

function v4StudentUrl(courseSlug) {
  const configured = String(process.env.LMS_PUBLIC_URL || "https://hoc.yeubep.shop").trim();
  const origin = /^https:\/\//i.test(configured) ? configured.replace(/\/+$/, "") : `https://${configured.replace(/^\/+|\/+$/g, "")}`;
  return `${origin}/v4-entry.html?course=${encodeURIComponent(courseSlug)}`;
}

async function prepareV4TestAccess(courseSlug, email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    const error = new Error("Gmail kiểm thử không hợp lệ");
    error.statusCode = 400;
    throw error;
  }
  const course = await requireV4Course(courseSlug);
  const { data: courseRow, error: courseError } = await supabase
    .from("courses")
    .select("id,raw_data")
    .eq("id", course.id)
    .single();
  if (courseError) throw courseError;
  const rawData = courseRow.raw_data && typeof courseRow.raw_data === "object" ? { ...courseRow.raw_data } : {};
  const previousEmail = normalizeEmail(rawData.v4TestEmail || "");

  if (previousEmail && previousEmail !== cleanEmail) {
    const { data: previousEnrollment, error: previousError } = await supabase
      .from("student_enrollments")
      .select("id,source_system")
      .eq("course_slug", course.slug)
      .eq("email", previousEmail)
      .maybeSingle();
    if (previousError) throw previousError;
    if (previousEnrollment?.source_system === "commerce_v4_test") {
      const { error: revokeError } = await supabase
        .from("student_enrollments")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", previousEnrollment.id);
      if (revokeError) throw revokeError;
    }
  }

  const granted = await grantEnrollment({
    courseSlug: course.slug,
    email: cleanEmail,
    sourceSystem: "commerce_v4_test"
  });
  rawData.v4TestEmail = cleanEmail;
  rawData.v4TestEnrollmentId = granted.enrollment.id;
  const { error: updateError } = await supabase
    .from("courses")
    .update({ raw_data: rawData, updated_at: new Date().toISOString() })
    .eq("id", course.id);
  if (updateError) throw updateError;
  return { email: cleanEmail, enrollment: granted.enrollment, studentUrl: v4StudentUrl(course.slug) };
}

function timingSafeEqualString(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    const size = Math.max(leftBuffer.length, rightBuffer.length, 1);
    const paddedLeft = Buffer.alloc(size);
    const paddedRight = Buffer.alloc(size);
    leftBuffer.copy(paddedLeft);
    rightBuffer.copy(paddedRight);
    crypto.timingSafeEqual(paddedLeft, paddedRight);
    return false;
  }
  try {
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sync-Secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // Verify internal sync secret without leaking comparison timing.
  const syncSecret = String(req.headers["x-sync-secret"] || "");
  const systemSecret = String(process.env.INTERNAL_SYNC_SECRET || "");

  if (!systemSecret) {
    return res.status(503).json({
      success: false,
      code: "sync_misconfigured",
      error: "Internal sync is unavailable."
    });
  }

  if (!syncSecret || !timingSafeEqualString(syncSecret, systemSecret)) {
    return res.status(401).json({ success: false, error: "Unauthorized: Sync secret is invalid or missing." });
  }

  try {
    const { action, slug, title, subtitle, imageUrl, expected_start_date, active, email, courseSlug, orderId, deliveryMode, published, testEmail } = req.body || {};

    if (!action) {
      return res.status(400).json({ success: false, error: "Thiếu tham số action" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SYNC COURSE (Tạo/Sửa khóa học)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "syncCourse") {
      if (!slug || !title) {
        return res.status(400).json({ success: false, error: "Thiếu slug hoặc title" });
      }
      const normalizedSlug = String(slug).trim();
      if (!/^[a-z0-9_-]+$/.test(normalizedSlug)) {
        return res.status(400).json({ success: false, error: "Slug khóa học không hợp lệ" });
      }
      const requestedMode = ["lms", "telegram", "v4"].includes(String(deliveryMode || "").trim().toLowerCase())
        ? String(deliveryMode).trim().toLowerCase()
        : null;

      // Check if course already exists
      const { data: existingCourse, error: fetchErr } = await supabase
        .from("courses")
        .select("id, raw_data, delivery_mode, is_published")
        .eq("slug", normalizedSlug)
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      const nextTitle = String(title || "").trim();
      const nextSubtitle = String(subtitle || "").trim();
      const nextImageUrl = String(imageUrl || "").trim();
      const nextExpectedStartDate = /^\d{4}-\d{2}-\d{2}$/.test(String(expected_start_date || "").trim())
        ? String(expected_start_date).trim()
        : null;

      let result;
      if (existingCourse) {
        const existingMode = String(existingCourse.delivery_mode || "lms").trim().toLowerCase();
        if (requestedMode && requestedMode !== existingMode && (requestedMode === "v4" || existingMode === "v4")) {
          return res.status(409).json({ success: false, error: "Không thể đổi khóa qua lại V4 bằng API sync" });
        }
        // Update metadata without breaking lessons or existing raw_data
        const updatePayload = {
          title: nextTitle,
          updated_at: new Date().toISOString()
        };
        if (active !== undefined) updatePayload.active = active === true;
        if (nextSubtitle) {
          updatePayload.subtitle = nextSubtitle;
        }
        if (nextImageUrl) {
          updatePayload.image_url = nextImageUrl;
        }
        if (expected_start_date !== undefined) {
          updatePayload.expected_start_date = nextExpectedStartDate;
        }

        const { error: updateErr } = await supabase
          .from("courses")
          .update(updatePayload)
          .eq("id", existingCourse.id);

        if (updateErr) throw updateErr;
        result = { id: existingCourse.id, updated: true };
      } else {
        // Create new course in draft mode
        const newCourseId = (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : require("crypto").randomUUID());
        const { data: newCourse, error: insertErr } = await supabase
          .from("courses")
          .insert({
            id: newCourseId,
            slug: normalizedSlug,
            title: nextTitle,
            subtitle: nextSubtitle || null,
            image_url: nextImageUrl || null,
            expected_start_date: nextExpectedStartDate,
            active: active !== undefined ? active === true : requestedMode !== "v4",
            is_published: false,
            delivery_mode: requestedMode || "lms",
            sort_order: 999 // Default to end of list
          })
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        result = { id: newCourse.id, created: true };
      }

      return res.status(200).json({ success: true, course: result });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SYNC ENROLLMENT (Duyệt cấp quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "syncEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }
      if (orderId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(orderId))) {
        return res.status(400).json({ success: false, error: "orderId không hợp lệ" });
      }

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "create",
        orderId: orderId || null
      });

      return res.status(200).json(syncResult);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. REVOKE ENROLLMENT (Hủy/Thu hồi quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "revokeEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }
      if (orderId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(orderId))) {
        return res.status(400).json({ success: false, error: "orderId không hợp lệ" });
      }

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "revoke",
        orderId: orderId || null
      });

      return res.status(200).json(syncResult);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. V4 PREFLIGHT (Commerce server orchestration; never browser-direct)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "v4Preflight") {
      const normalizedSlug = String(courseSlug || "").trim();
      if (!/^[a-z0-9_-]+$/.test(normalizedSlug)) {
        return res.status(400).json({ success: false, error: "Slug khóa học không hợp lệ" });
      }
      const result = await buildPrepublish(normalizedSlug);
      return res.status(200).json({ success: true, ...result });
    }

    // Prepare one test Gmail and run the full preflight as one admin action.
    if (action === "v4PrepareRelease") {
      const normalizedSlug = String(courseSlug || "").trim();
      if (!/^[a-z0-9_-]+$/.test(normalizedSlug)) {
        return res.status(400).json({ success: false, error: "Slug khóa học không hợp lệ" });
      }
      const testAccess = await prepareV4TestAccess(normalizedSlug, testEmail);
      const preflight = await buildPrepublish(normalizedSlug);
      return res.status(200).json({ success: true, testAccess, preflight });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. V4 PUBLISH (fixed V4 policy; client cannot choose delivery_mode)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "setV4Published") {
      const normalizedSlug = String(courseSlug || "").trim();
      if (!/^[a-z0-9_-]+$/.test(normalizedSlug)) {
        return res.status(400).json({ success: false, error: "Slug khóa học không hợp lệ" });
      }

      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("id,slug,delivery_mode,is_published,raw_data")
        .eq("slug", normalizedSlug)
        .maybeSingle();
      if (courseError) throw courseError;
      if (!course || String(course.delivery_mode || "").trim().toLowerCase() !== "v4") {
        return res.status(400).json({ success: false, error: "Khóa học không tồn tại hoặc không phải V4" });
      }

      const nextPublished = published === true;
      let preflight = null;
      if (nextPublished) {
        preflight = await buildPrepublish(normalizedSlug);
        if (!preflight.ready) {
          return res.status(409).json({
            success: false,
            error: "Preflight V4 còn blocker; chưa thể Publish",
            preflight
          });
        }
      }

      const { error: updateError } = await supabase
        .from("courses")
        .update({ is_published: nextPublished, updated_at: new Date().toISOString() })
        .eq("id", course.id);
      if (updateError) throw updateError;

      return res.status(200).json({
        success: true,
        course: normalizedSlug,
        deliveryMode: "v4",
        isPublished: nextPublished,
        preflight,
        testEmail: normalizeEmail(course.raw_data?.v4TestEmail || "") || null,
        studentUrl: nextPublished ? v4StudentUrl(normalizedSlug) : null
      });
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ" });
  } catch (error) {
    console.error("[sync] Error in handler:", error);
    return res.status(Number(error.statusCode || 500)).json({ success: false, error: error.message });
  }
}
