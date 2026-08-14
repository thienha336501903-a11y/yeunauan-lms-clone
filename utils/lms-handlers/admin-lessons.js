import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { fetchRecipeText } from "./public-lesson.js";

function normalizeMaterials(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = String(item.name || item.fileName || "").trim();
      const url = String(item.url || item.webViewLink || item.downloadUrl || "").trim();
      if (!name || !url) return null;
      return {
        id: String(item.id || item.fileId || url),
        name,
        url,
        downloadUrl: String(item.downloadUrl || url),
        mimeType: String(item.mimeType || ""),
        size: Number(item.size || 0),
        source: String(item.source || "google_drive")
      };
    })
    .filter(Boolean);
}

function normalizeSharedLinks(value) {
  return String(value || "")
    .replace(/(https?:\/\/[^\s()]+)\s*\((https?:\/\/[^\s()]+)\)/gi, (whole, visible, target) => {
      try {
        const visibleUrl = new URL(visible);
        const targetUrl = new URL(target);
        if (visibleUrl.origin === targetUrl.origin && visibleUrl.pathname === targetUrl.pathname) {
          return visible;
        }
      } catch {
        // Keep the original text if either side is not a valid URL.
      }
      return whole;
    })
    .replace(/https?:\/\/s\.shopee\.vn\/([A-Za-z0-9_-]+)\?[^\s)]+/gi, "https://s.shopee.vn/$1");
}

const PORTAL_RECIPE_PLACEHOLDER = "noi dung bai viet se som duoc cap nhat boi giang vien";
const MIN_REAL_RECIPE_CHARS = 40;
const TITLE_ONLY_RECIPE_TEXTS = new Set([
  "tai lieu lop hoc",
  "tai lieu khoa hoc",
  "tong quan",
  "chua co mo ta ngan"
]);

function normalizePlainText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function hasRealRecipeText(value, lessonTitle = "") {
  const normalized = normalizePlainText(value);
  if (!normalized || normalized.length < MIN_REAL_RECIPE_CHARS) return false;
  if (normalized.includes(PORTAL_RECIPE_PLACEHOLDER)) return false;
  if (TITLE_ONLY_RECIPE_TEXTS.has(normalized)) return false;
  if (normalized === normalizePlainText(lessonTitle)) return false;
  return true;
}

export async function buildCourseRecipeDigest(courseSlug) {
  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("lesson_no, title, recipe_url, is_section, status")
    .eq("course_slug", courseSlug)
    .neq("status", "hidden")
    .order("lesson_no", { ascending: true });

  if (error) throw error;

  const sections = (lessons || []).some((lesson) => Boolean(lesson.is_section));
  const chunks = [];
  let chapterNumber = 0;
  let lessonNumberInChapter = 0;
  let lessonNumberNoSections = 0;
  let currentChapter = null;
  let emittedChapterKey = null;
  let recipeLessonCount = 0;

  for (const lesson of lessons || []) {
    if (Boolean(lesson.is_section)) {
      chapterNumber++;
      lessonNumberInChapter = 0;
      currentChapter = {
        key: chapterNumber,
        title: String(lesson.title || `Chương ${chapterNumber}`).trim()
      };
      continue;
    }

    if (sections) {
      lessonNumberInChapter++;
    } else {
      lessonNumberNoSections++;
    }

    if (!lesson.recipe_url) continue;
    const recipeText = await fetchRecipeText(lesson.recipe_url);
    if (!hasRealRecipeText(recipeText, lesson.title)) continue;

    if (sections && currentChapter && emittedChapterKey !== currentChapter.key) {
      chunks.push(`# CHƯƠNG ${currentChapter.key} — ${currentChapter.title}`);
      emittedChapterKey = currentChapter.key;
    }

    const displayLesson = sections ? lessonNumberInChapter : lessonNumberNoSections;
    const title = String(lesson.title || `Bài ${displayLesson}`).trim();
    chunks.push(`## Bài ${displayLesson} — ${title}`);
    chunks.push(String(recipeText).trim());
    recipeLessonCount++;
  }

  const recipe = chunks.join("\n\n").trim();
  return {
    recipe,
    totalLessons: (lessons || []).filter((lesson) => !Boolean(lesson.is_section)).length,
    recipeLessons: recipeLessonCount,
    recipeLength: recipe.length
  };
}

async function syncCourseRecipeDigestToPortal(courseSlug) {
  const sys1Url = process.env.SYSTEM1_URL;
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!sys1Url || !secret || !courseSlug) return { skipped: "missing_sync_config" };

  const digest = await buildCourseRecipeDigest(courseSlug);
  if (!digest.recipe) return { skipped: "no_real_recipe", ...digest };

  const response = await fetch(`${sys1Url.trim().replace(/\/$/, '')}/api/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sync-Secret": secret
    },
    body: JSON.stringify({
      action: "syncRecipe",
      courseSlug,
      recipe: digest.recipe,
      createIfMissing: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Portal recipe sync failed with status ${response.status}: ${detail.slice(0, 300)}`);
  }

  const result = await response.json().catch(() => ({ success: true }));
  return { ...result, ...digest };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    // ── GET: Read lessons for a course ────────────────────────────────────────
    if (req.method === "GET") {
      const { course } = req.query || {};
      if (!course) {
        return res.status(400).json({ success: false, error: "Thiếu tham số course" });
      }
      const courseSlug = String(course).trim();

      const { data: lessons, error } = await supabase
        .from("lessons")
        .select("*")
        .eq("course_slug", courseSlug)
        .order("lesson_no", { ascending: true });

      if (error) throw error;

      const hasSection = (lessons || []).some(l => Boolean(l.is_section));
      let sectionCounter = 0;
      let globalCounter = 0;

      const formattedLessons = (lessons || []).map(l => {
        const isSec = Boolean(l.is_section);
        let displayLesson = l.lesson_no;
        if (isSec) {
          sectionCounter = 0;
        } else {
          sectionCounter++;
          globalCounter++;
          displayLesson = hasSection ? sectionCounter : globalCounter;
        }

        return {
          id: l.id,
          course: l.course_slug,
          lesson: l.lesson_no,
          displayLesson: displayLesson,
          title: l.title,
          description: l.description || "",
          duration: l.duration_text || "",
          level: l.level || "",
          thumbnailUrl: l.thumbnail_url || "",
          videoUrl: l.video_url || "",
          recipeUrl: l.recipe_url || "",
          mediaUrls: l.media_urls || "",
          materials: normalizeMaterials(l.materials),
          isSection: isSec,
          status: l.status || "active"
        };
      });

      return res.status(200).json({ success: true, lessons: formattedLessons });
    }

    // ── POST: Create / Update / Delete ────────────────────────────────────────
    if (req.method === "POST") {
      const { action, course, lesson, originalCourse, originalLesson, lessonData } = req.body || {};

      if (!action) {
        return res.status(400).json({ success: false, error: "Thiếu tham số action" });
      }

      // Action: CREATE
      if (action === "create") {
        if (!lessonData || typeof lessonData !== "object") {
          return res.status(400).json({ success: false, error: "Thiếu dữ liệu lessonData" });
        }

        // Fetch course ID by slug
        const { data: courseRec } = await supabase
          .from("courses")
          .select("id")
          .eq("slug", lessonData.course)
          .maybeSingle();

        // Calculate next unique lesson_no for backend to guarantee no duplicate key error
        const { data: existingLessons } = await supabase
          .from("lessons")
          .select("lesson_no")
          .eq("course_slug", lessonData.course);

        let maxLessonNo = 0;
        (existingLessons || []).forEach(l => {
          const no = parseInt(l.lesson_no, 10);
          if (!isNaN(no) && no > maxLessonNo) maxLessonNo = no;
        });
        const targetLessonNo = maxLessonNo + 1;

        const insertPayload = {
          course_id: courseRec?.id || null,
          course_slug: lessonData.course,
          lesson_no: targetLessonNo,
          title: lessonData.title,
          description: normalizeSharedLinks(lessonData.description || ""),
          duration_text: lessonData.duration || "",
          level: lessonData.level || "",
          thumbnail_url: lessonData.thumbnailUrl || "",
          video_url: lessonData.videoUrl || "",
          recipe_url: lessonData.recipeUrl || "",
          media_urls: lessonData.mediaUrls || "",
          materials: Boolean(lessonData.isSection) ? [] : normalizeMaterials(lessonData.materials),
          is_section: Boolean(lessonData.isSection),
          status: "active",
          sort_order: targetLessonNo,
          updated_at: new Date().toISOString()
        };

        let { error: insertErr } = await supabase.from("lessons").insert(insertPayload);

        // Fallback: If insert fails for any reason (e.g. is_section column missing), retry without is_section
        if (insertErr) {
          console.warn("[admin-lessons] Insert with is_section failed:", insertErr.message, "- retrying without is_section...");
          delete insertPayload.is_section;
          const retryRes = await supabase.from("lessons").insert(insertPayload);
          if (!retryRes.error) {
            insertErr = null;
          } else {
            console.error("[admin-lessons] Insert retry also failed:", retryRes.error.message);
          }
        }

        if (insertErr) throw insertErr;

        // Sync the aggregated real course recipe to System 1 Portal.
        try {
          await syncCourseRecipeDigestToPortal(lessonData.course);
        } catch (syncErr) {
          console.error("[admin-lessons] Sync recipe failed on create:", syncErr.message);
        }

        return res.status(200).json({ success: true, message: "Tạo bài học thành công" });
      }

      // Action: UPDATE
      if (action === "update") {
        if (!originalCourse || !originalLesson) {
          return res.status(400).json({ success: false, error: "Thiếu originalCourse hoặc originalLesson" });
        }
        if (!lessonData || typeof lessonData !== "object") {
          return res.status(400).json({ success: false, error: "Thiếu dữ liệu lessonData" });
        }

        // Fetch course ID by slug
        const { data: courseRec } = await supabase
          .from("courses")
          .select("id")
          .eq("slug", lessonData.course)
          .maybeSingle();

        const updatePayload = {
          course_id: courseRec?.id || null,
          course_slug: lessonData.course,
          lesson_no: parseInt(lessonData.lesson, 10),
          title: lessonData.title,
          description: normalizeSharedLinks(lessonData.description || ""),
          duration_text: lessonData.duration || "",
          level: lessonData.level || "",
          thumbnail_url: lessonData.thumbnailUrl || "",
          video_url: lessonData.videoUrl || "",
          recipe_url: lessonData.recipeUrl || "",
          media_urls: lessonData.mediaUrls || "",
          materials: Boolean(lessonData.isSection) ? [] : normalizeMaterials(lessonData.materials),
          is_section: Boolean(lessonData.isSection),
          status: lessonData.status || "active",
          sort_order: parseInt(lessonData.lesson, 10),
          updated_at: new Date().toISOString()
        };

        let { error: updateErr } = await supabase
          .from("lessons")
          .update(updatePayload)
          .eq("course_slug", originalCourse)
          .eq("lesson_no", parseInt(originalLesson, 10));

        // Fallback: If update fails for any reason, retry without is_section
        if (updateErr) {
          console.warn("[admin-lessons] Update with is_section failed:", updateErr.message, "- retrying without is_section...");
          delete updatePayload.is_section;
          const retryRes = await supabase
            .from("lessons")
            .update(updatePayload)
            .eq("course_slug", originalCourse)
            .eq("lesson_no", parseInt(originalLesson, 10));
          if (!retryRes.error) {
            updateErr = null;
          } else {
            console.error("[admin-lessons] Update retry also failed:", retryRes.error.message);
          }
        }

        if (updateErr) throw updateErr;

        // Sync the aggregated real course recipe to System 1 Portal.
        try {
          await syncCourseRecipeDigestToPortal(lessonData.course);
        } catch (syncErr) {
          console.error("[admin-lessons] Sync recipe failed on update:", syncErr.message);
        }

        return res.status(200).json({ success: true, message: "Cập nhật bài học thành công" });
      }

      // Action: DELETE (Soft delete)
      if (action === "delete") {
        if (!course || !lesson) {
          return res.status(400).json({ success: false, error: "Thiếu tham số course hoặc lesson" });
        }

        const { error: deleteErr } = await supabase
          .from("lessons")
          .update({
            status: "hidden",
            updated_at: new Date().toISOString()
          })
          .eq("course_slug", course)
          .eq("lesson_no", parseInt(lesson, 10));

        if (deleteErr) throw deleteErr;
        return res.status(200).json({ success: true, message: "Đã ẩn bài học thành công" });
      }

      return res.status(400).json({ success: false, error: `Action '${action}' không hợp lệ` });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-lessons] Error:", err);
    return res.status(500).json({
      success: false,
      error: `Lỗi server trong admin-lessons: ${err.message || String(err)}`,
      message: err.message
    });
  }
}
