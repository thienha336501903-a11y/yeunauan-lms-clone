import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { v5LearnerReleaseContent } from "../v5-release-snapshot.js";
import { buildV5IntroItems } from "../v5-intro-content.js";
import { applySameOriginCors } from "../lms-request-origin.js";

function clean(value) {
  return String(value || "").trim();
}

export default async function v5CourseIntroHandler(req, res) {
  const originAllowed = applySameOriginCors(req, res, {
    methods: "GET, OPTIONS",
    headers: "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id"
  });
  res.setHeader("Cache-Control", "private, no-store");

  if (!originAllowed) {
    return res.status(403).json({
      success: false,
      code: "origin_not_allowed",
      error: "Origin not allowed"
    });
  }

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const courseSlug = clean(req.query?.course);
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });

    const course = access.course;
    if (!course || clean(course.delivery_mode).toLowerCase() !== "v5") {
      return res.status(404).json({ success: false, code: "v5_course_not_found", error: "Không tìm thấy khóa V5." });
    }

    const { data: config, error: configError } = await supabase
      .from("v5_course_configs")
      .select("course_id,status,published_release_id")
      .eq("course_id", course.id)
      .maybeSingle();
    if (configError) throw configError;
    if (!config || config.status !== "published" || !config.published_release_id) {
      return res.status(403).json({ success: false, code: "v5_not_published", error: "Khóa V5 chưa được Publish." });
    }

    const { data: release, error: releaseError } = await supabase
      .from("v5_releases")
      .select("id,course_id,status,snapshot")
      .eq("id", config.published_release_id)
      .eq("course_id", course.id)
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
        slug: course.slug,
        title: access.courseTitle || course.title
      },
      intro: {
        complete: true,
        count: intro.count,
        items: intro.items
      }
    });
  } catch (error) {
    console.error("[v5-course-intro]", error);
    return res.status(500).json({ success: false, error: "Không tải được Công thức & Hướng dẫn V5" });
  }
}
