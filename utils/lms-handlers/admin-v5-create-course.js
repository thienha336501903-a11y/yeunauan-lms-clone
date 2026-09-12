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
  let createdCourseWasInserted = false;
  try {
    const { data: existing, error: existingError } = await supabase
      .from("courses")
      .select("id,slug,title,description,image_url,teacher_name,active,is_published,delivery_mode,raw_data,price,sort_order")
      .eq("slug", slug)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      const existingMode = clean(existing.delivery_mode).toLowerCase();
      if (existingMode !== "v5") {
        return res.status(409).json({
          success: false,
          code: "mode_conflict",
          error: `Slug này đã thuộc khóa ở chế độ ${existingMode || 'khác'}. Không thể tự chuyển sang V5.`
        });
      }

      // Case 2: Commerce created the V5 course row first.
      // Reuse the existing canonical course row without inserting a duplicate.
      // Preserve Commerce data (price, image_url, description, teacher, raw_data, sale state active, is_published, orders, enrollments).
      createdCourse = existing;

      // Ensure v5_course_configs
      const { data: existingConfig, error: cfgLookupErr } = await supabase
        .from("v5_course_configs")
        .select("*")
        .eq("course_id", existing.id)
        .maybeSingle();
      if (cfgLookupErr) throw cfgLookupErr;

      let config;
      if (!existingConfig) {
        const { data: newConfig, error: insCfgErr } = await supabase
          .from("v5_course_configs")
          .insert({
            course_id: existing.id,
            source_mode: "direct",
            status: "draft",
            settings: {
              authoring_mode: "timeline"
            },
            updated_at: new Date().toISOString()
          })
          .select("*")
          .single();
        if (insCfgErr) throw insCfgErr;
        config = newConfig;
      } else {
        const currentSettings = existingConfig.settings && typeof existingConfig.settings === "object" ? existingConfig.settings : {};
        if (!currentSettings.authoring_mode) {
          const { data: updConfig, error: updCfgErr } = await supabase
            .from("v5_course_configs")
            .update({
              settings: {
                ...currentSettings,
                authoring_mode: "timeline"
              },
              updated_at: new Date().toISOString()
            })
            .eq("course_id", existing.id)
            .select("*")
            .single();
          if (updCfgErr) throw updCfgErr;
          config = updConfig;
        } else {
          config = existingConfig;
        }
      }

      // Ensure hidden timeline lesson
      const { data: lessons, error: lErr } = await supabase
        .from("v5_lessons")
        .select("id,metadata")
        .eq("course_id", existing.id);
      if (lErr) throw lErr;

      const hasHiddenLesson = (lessons || []).some(l => l.metadata?.system_lesson === true);
      if (!hasHiddenLesson) {
        const { error: insLessonErr } = await supabase
          .from("v5_lessons")
          .insert({
            course_id: existing.id,
            title: "Timeline",
            position: 1000,
            status: "draft",
            metadata: {
              system_lesson: true
            }
          });
        if (insLessonErr) throw insLessonErr;
      }

      return res.status(200).json({
        success: true,
        operation: "reused_existing_course",
        course: existing,
        config,
        admin: admin.email,
        message: "Khóa đã tồn tại trên Commerce. Đã mở/khởi tạo V5 Channel trên cùng khóa."
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
    createdCourseWasInserted = true;

    const { data: config, error: configError } = await supabase
      .from("v5_course_configs")
      .upsert({
        course_id: course.id,
        source_mode: "direct",
        status: "draft",
        settings: {
          authoring_mode: "timeline"
        },
        updated_at: new Date().toISOString()
      }, { onConflict: "course_id" })
      .select("*")
      .single();
    if (configError) throw configError;

    const { error: lessonError } = await supabase
      .from("v5_lessons")
      .insert({
        course_id: course.id,
        title: "Timeline",
        position: 1000,
        status: "draft",
        metadata: {
          system_lesson: true
        }
      });
    if (lessonError) throw lessonError;

    return res.status(201).json({
      success: true,
      course,
      config,
      admin: admin.email
    });
  } catch (error) {
    if (createdCourseWasInserted && createdCourse?.id) {
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
