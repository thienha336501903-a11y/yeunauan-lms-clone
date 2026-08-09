import { supabase } from "../utils/supabase.js";
import { 
  normalizeEmail, 
  syncEnrollment
} from "../utils/lms.js";

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

  // Verify internal sync secret
  const syncSecret = req.headers["x-sync-secret"];
  const systemSecret = process.env.INTERNAL_SYNC_SECRET;

  if (!systemSecret || syncSecret !== systemSecret) {
    return res.status(401).json({ success: false, error: "Unauthorized: Sync secret is invalid or missing." });
  }

  try {
    const { action, slug, title, subtitle, imageUrl, expected_start_date, active, email, courseSlug } = req.body || {};

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

      // Check if course already exists
      const { data: existingCourse, error: fetchErr } = await supabase
        .from("courses")
        .select("id, raw_data")
        .eq("slug", slug.trim())
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
        // Update metadata without breaking lessons or existing raw_data
        const updatePayload = {
          title: nextTitle,
          active: active !== undefined ? active : true,
          updated_at: new Date().toISOString()
        };
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
            slug: slug.trim(),
            title: nextTitle,
            subtitle: nextSubtitle || null,
            image_url: nextImageUrl || null,
            expected_start_date: nextExpectedStartDate,
            active: active !== undefined ? active : true,
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

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "create"
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

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "revoke"
      });

      return res.status(200).json(syncResult);
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ" });
  } catch (error) {
    console.error("[sync] Error in handler:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
