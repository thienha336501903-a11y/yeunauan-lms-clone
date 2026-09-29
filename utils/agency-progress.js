// utils/agency-progress.js
// M0D Agency lesson progress backed exclusively by Main Supabase tenant tables.

import { supabase as defaultSupabase } from "./supabase.js";
import { requireAgencyCourseAccess } from "./agency-lms-bridge.js";

function clean(value) {
  return String(value || "").trim();
}

function clampInt(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.round(num)));
}

export async function listAgencyLessonProgress(req, courseIdentifier, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const access = await requireAgencyCourseAccess(req, courseIdentifier, options);
  if (!access.ok) return access;

  const { tenant, membership, canonicalCourse } = access;
  const { data: lessons, error: lessonError } = await client
    .from("canonical_lessons")
    .select("id")
    .eq("canonical_course_id", canonicalCourse.id);

  if (lessonError) {
    return { ok: false, status: 500, code: "progress_lesson_lookup_failed", error: lessonError.message };
  }

  const lessonIds = (lessons || []).map(row => row.id).filter(Boolean);
  if (!lessonIds.length) {
    return { ok: true, status: 200, progress: [] };
  }

  const { data, error } = await client
    .from("agency_lesson_progress")
    .select("canonical_lesson_id, progress_percent, is_completed, last_position_seconds, updated_at")
    .eq("agency_id", tenant.agencyId)
    .eq("membership_id", membership.id)
    .in("canonical_lesson_id", lessonIds);

  if (error) {
    return { ok: false, status: 500, code: "progress_read_failed", error: error.message };
  }

  return { ok: true, status: 200, progress: data || [] };
}

export async function upsertAgencyLessonProgress(req, payload = {}, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const courseIdentifier = clean(payload.course || payload.courseCode);
  const canonicalLessonId = clean(payload.canonicalLessonId || payload.lessonId);

  if (!courseIdentifier) {
    return { ok: false, status: 400, code: "missing_course", error: "course is required." };
  }
  if (!canonicalLessonId) {
    return { ok: false, status: 400, code: "missing_canonical_lesson", error: "canonicalLessonId is required." };
  }

  const access = await requireAgencyCourseAccess(req, courseIdentifier, options);
  if (!access.ok) return access;

  const { tenant, membership, canonicalCourse } = access;
  const { data: lesson, error: lessonError } = await client
    .from("canonical_lessons")
    .select("id, canonical_course_id")
    .eq("id", canonicalLessonId)
    .maybeSingle();

  if (lessonError) {
    return { ok: false, status: 500, code: "progress_lesson_lookup_failed", error: lessonError.message };
  }
  if (!lesson || lesson.canonical_course_id !== canonicalCourse.id) {
    return {
      ok: false,
      status: 403,
      code: "progress_lesson_course_mismatch",
      error: "Canonical lesson does not belong to the authorized course."
    };
  }

  const completed = payload.isCompleted === true;
  const progressPercent = completed ? 100 : clampInt(payload.progressPercent, 0, 100);
  const lastPositionSeconds = clampInt(payload.lastPositionSeconds, 0, 86400 * 7);

  const row = {
    agency_id: tenant.agencyId,
    membership_id: membership.id,
    canonical_lesson_id: canonicalLessonId,
    progress_percent: progressPercent,
    is_completed: completed || progressPercent >= 100,
    last_position_seconds: lastPositionSeconds,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await client
    .from("agency_lesson_progress")
    .upsert(row, { onConflict: "agency_id,membership_id,canonical_lesson_id" })
    .select("canonical_lesson_id, progress_percent, is_completed, last_position_seconds, updated_at")
    .single();

  if (error) {
    return { ok: false, status: 500, code: "progress_write_failed", error: error.message };
  }

  return { ok: true, status: 200, progress: data };
}
