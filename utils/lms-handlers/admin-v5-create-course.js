import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

function clean(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default async function adminV5CreateCourseHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    return res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
  }

  const title = clean(req.body?.title);
  const slug = slugify(req.body?.slug || title);
  const description = clean(req.body?.description);
  const imageUrl = clean(req.body?.imageUrl);
  const teacherName = clean(req.body?.teacherName);

  if (!title) {
    return res.status(400).json({ success: false, error: "Hãy nhập tên khóa học." });
  }
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    return res.status(400).json({ success: false, error: "Slug khóa học không hợp lệ." });
  }

  let createdCourse = null;
  try {
    const { data: existing, error: existingError } = await supabase
      .from("courses")
      .select("id,slug,delivery_mode")
      .eq("slug", slug)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "course_slug_exists",
        error: `Slug ${slug} đã tồn tại. Hãy chọn slug khác.`
      });
    }

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({
        slug,
        title,
        description: description || null,
        image_url: imageUrl || null,
        teacher_name: teacherName || null,
        active: false,
        is_published: false,
        delivery_mode: "v5",
        raw_data: {
          studentDisplayTitle: title,
          v5CreatedFrom: "course_channel"
        }
      })
      .select("id,slug,title,active,is_published,delivery_mode")
      .single();
    if (courseError) throw courseError;
    createdCourse = course;

    const { data: config, error: configError } = await supabase
      .from("v5_course_configs")
      .upsert({
        course_id: course.id,
        source_mode: "direct",
        status: "draft",
        updated_at: new Date().toISOString()
      }, { onConflict: "course_id" })
      .select("*")
      .single();
    if (configError) throw configError;

    return res.status(201).json({
      success: true,
      course,
      config,
      admin: admin.email
    });
  } catch (error) {
    if (createdCourse?.id) {
      const { error: cleanupError } = await supabase
        .from("courses")
        .delete()
        .eq("id", createdCourse.id)
        .eq("delivery_mode", "v5");
      if (cleanupError) console.error("[admin-v5-create-course] cleanup failed", cleanupError);
    }
    console.error("[admin-v5-create-course]", error);
    return res.status(500).json({ success: false, error: "Không tạo được khóa V5." });
  }
}
