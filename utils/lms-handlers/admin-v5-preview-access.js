import crypto from "crypto";
import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";
import { isActiveEnrollmentStatus, isEnrollmentExpired } from "../lms-enrollment-status.js";

function clean(value) {
  return String(value || "").trim();
}

export default async function adminV5PreviewAccessHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    // 1. Authenticate admin from request session server-side
    const admin = getAdminFromRequest(req);
    if (!admin?.email) {
      return res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    }

    // 2. Derive admin email strictly from server session (ignore any client-provided email)
    const adminEmail = normalizeEmail(admin.email);
    if (!adminEmail) {
      return res.status(401).json({ success: false, error: "Email Admin không hợp lệ trong phiên đăng nhập." });
    }

    // 3. Validate course slug and delivery mode = 'v5'
    const courseSlug = clean(req.body?.course || req.query?.course);
    if (!courseSlug) {
      return res.status(400).json({ success: false, error: "Thiếu mã khóa học (course slug)." });
    }

    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("id, slug, title, is_published, active, delivery_mode")
      .eq("slug", courseSlug)
      .maybeSingle();

    if (courseErr) throw courseErr;
    if (!course) {
      return res.status(404).json({ success: false, code: "course_not_found", error: "Khóa học không tồn tại." });
    }

    if (clean(course.delivery_mode).toLowerCase() !== "v5") {
      return res.status(400).json({ success: false, code: "not_v5_course", error: "Khóa học không phải định dạng V5." });
    }

    // Check published release status without mutating course lifecycle
    const { data: config, error: configErr } = await supabase
      .from("v5_course_configs")
      .select("course_id, status, published_release_id")
      .eq("course_id", course.id)
      .maybeSingle();

    if (configErr) throw configErr;
    const hasPublishedRelease = Boolean(
      course.is_published &&
      config?.published_release_id &&
      config?.status === "published"
    );

    // 4. Ensure student row for admin email
    let studentId;
    const { data: existingStudent, error: stErr } = await supabase
      .from("students")
      .select("id")
      .eq("email", adminEmail)
      .maybeSingle();

    if (stErr) throw stErr;

    if (existingStudent) {
      studentId = existingStudent.id;
    } else {
      const { data: newStudent, error: insStErr } = await supabase
        .from("students")
        .insert({
          id: crypto.randomUUID(),
          email: adminEmail,
          status: "active",
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (insStErr) throw insStErr;
      studentId = newStudent.id;
    }

    // 5. Ensure student_enrollment for exact student + course (active = true, no duplicate, no broad update)
    const { data: existingEnrollment, error: enLookupErr } = await supabase
      .from("student_enrollments")
      .select("id, student_id, course_slug, email, status, expired_at, source_system")
      .eq("email", adminEmail)
      .eq("course_slug", course.slug)
      .maybeSingle();

    if (enLookupErr) throw enLookupErr;

    let enrollmentRecord;
    const now = new Date().toISOString();

    if (existingEnrollment) {
      const isUsable = isActiveEnrollmentStatus(existingEnrollment.status) && !isEnrollmentExpired(existingEnrollment.expired_at);
      if (isUsable) {
        // Idempotent PASS - existing active enrollment is preserved
        enrollmentRecord = existingEnrollment;
      } else {
        // Re-activate exact record
        const { data: updatedEnrollment, error: updErr } = await supabase
          .from("student_enrollments")
          .update({
            student_id: studentId,
            status: "active",
            expired_at: null,
            updated_at: now
          })
          .eq("id", existingEnrollment.id)
          .select("id, status")
          .single();

        if (updErr) throw updErr;
        enrollmentRecord = updatedEnrollment;
      }
    } else {
      // Create new enrollment row
      const payload = {
        id: crypto.randomUUID(),
        student_id: studentId,
        course_id: course.id,
        course_slug: course.slug,
        email: adminEmail,
        status: "active",
        expired_at: null,
        source_system: "admin_preview",
        updated_at: now
      };

      const { data: newEnrollment, error: insEnErr } = await supabase
        .from("student_enrollments")
        .insert(payload)
        .select("id, status")
        .single();

      if (insEnErr) throw insEnErr;
      enrollmentRecord = newEnrollment;
    }

    // Return response adhering strictly to schema requirement
    return res.status(200).json({
      success: true,
      course: course.slug,
      admin: adminEmail,
      hasPublishedRelease,
      enrollment: {
        id: enrollmentRecord.id,
        active: true
      }
    });
  } catch (error) {
    console.error("[admin-v5-preview-access]", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Lỗi hệ thống khi cấp quyền xem trước V5"
    });
  }
}
