import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { loadV4IntroContent, MAX_V4_INTRO_ROWS } from "../v4-intro-loader.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const courseSlug = String(req.query?.course || "").trim();
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });

    const { data: mapping, error: mappingError } = await supabase
      .from("lms_v4_telegram_course_sources")
      .select("source_id,enabled")
      .eq("course_slug", courseSlug)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping?.enabled || !mapping?.source_id) {
      return res.status(404).json({ success: false, code: "v4_source_not_enabled", error: "Khóa học này chưa bật nguồn Telegram V4" });
    }

    const { count, error: countError } = await supabase
      .from("tgcloner_source_messages")
      .select("id", { count: "exact", head: true })
      .eq("source_id", mapping.source_id);
    if (countError) throw countError;

    const content = await loadV4IntroContent(mapping.source_id, Number(count || 0));
    return res.status(200).json({
      success: true,
      course: { slug: courseSlug, title: access.courseTitle },
      intro: {
        items: content.items,
        textItemCount: content.items.length,
        scannedMessageCount: content.rows.length,
        totalMessageCount: content.total,
        complete: content.complete,
        maxRows: MAX_V4_INTRO_ROWS
      }
    });
  } catch (error) {
    console.error("[v4-course-intro]", error);
    return res.status(500).json({ success: false, error: "Không tải được Công thức & Hướng dẫn V4" });
  }
}
