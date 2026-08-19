import crypto from "crypto";
import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";
import { isActiveEnrollmentStatus, isEnrollmentExpired, normalizeEnrollmentStatus } from "../lms-enrollment-status.js";

function normalizeExpiry(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Hạn quyền học không hợp lệ");
  return new Date(time).toISOString();
}

async function requireV4Course(courseSlug) {
  const slug = String(courseSlug || "").trim();
  if (!slug) throw new Error("Thiếu khóa học V4");
  const { data: course, error } = await supabase
    .from("courses")
    .select("id,slug,title,delivery_mode")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!course || String(course.delivery_mode || "").toLowerCase() !== "v4") {
    const err = new Error("Khóa học không tồn tại hoặc không phải V4");
    err.statusCode = 400;
    throw err;
  }
  return course;
}

async function listEnrollments(courseSlug, search = "") {
  const course = await requireV4Course(courseSlug);
  let query = supabase
    .from("student_enrollments")
    .select("id,student_id,course_id,course_slug,email,status,expired_at,created_at,updated_at,source_system")
    .eq("course_slug", course.slug)
    .order("created_at", { ascending: false });
  const cleanSearch = String(search || "").trim();
  if (cleanSearch) query = query.ilike("email", `%${cleanSearch}%`);
  const { data: rows, error } = await query;
  if (error) throw error;

  const studentIds = [...new Set((rows || []).map(row => row.student_id).filter(Boolean))];
  const emails = [...new Set((rows || []).map(row => normalizeEmail(row.email)).filter(Boolean))];
  const students = [];
  if (studentIds.length) {
    const { data, error: studentError } = await supabase
      .from("students")
      .select("id,email,full_name,phone,status")
      .in("id", studentIds);
    if (studentError) throw studentError;
    students.push(...(data || []));
  }
  const knownEmails = new Set(students.map(row => normalizeEmail(row.email)));
  const missingEmails = emails.filter(email => !knownEmails.has(email));
  if (missingEmails.length) {
    const { data, error: studentError } = await supabase
      .from("students")
      .select("id,email,full_name,phone,status")
      .in("email", missingEmails);
    if (studentError) throw studentError;
    students.push(...(data || []));
  }
  const byId = new Map(students.filter(row => row.id).map(row => [row.id, row]));
  const byEmail = new Map(students.map(row => [normalizeEmail(row.email), row]));
  const now = Date.now();
  const enrollments = (rows || []).map(row => {
    const student = byId.get(row.student_id) || byEmail.get(normalizeEmail(row.email)) || null;
    const expired = isEnrollmentExpired(row.expired_at, now);
    const active = isActiveEnrollmentStatus(row.status) && !expired;
    return {
      ...row,
      email: normalizeEmail(row.email),
      active,
      expired,
      effectiveStatus: expired ? "expired" : normalizeEnrollmentStatus(row.status),
      student: student ? {
        fullName: student.full_name || "",
        phone: student.phone || "",
        status: student.status || ""
      } : null
    };
  });
  return {
    course: { slug: course.slug, title: course.title || course.slug },
    enrollments,
    summary: {
      total: enrollments.length,
      active: enrollments.filter(row => row.active).length,
      revoked: enrollments.filter(row => !row.active && !row.expired).length,
      expired: enrollments.filter(row => row.expired).length
    }
  };
}

async function upsertStudent({ email, fullName = "", phone = "" }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Email học viên không hợp lệ");
  const { data: existing, error: lookupError } = await supabase
    .from("students")
    .select("id,email,full_name,phone,status")
    .eq("email", cleanEmail)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const patch = { status: "active", updated_at: new Date().toISOString() };
    if (String(fullName || "").trim()) patch.full_name = String(fullName).trim();
    if (String(phone || "").trim()) patch.phone = String(phone).trim();
    const { data, error } = await supabase
      .from("students")
      .update(patch)
      .eq("id", existing.id)
      .select("id,email,full_name,phone,status")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("students")
    .insert({
      id: crypto.randomUUID(),
      email: cleanEmail,
      full_name: String(fullName || "").trim() || null,
      phone: String(phone || "").trim() || null,
      status: "active",
      raw_data: {},
      updated_at: new Date().toISOString()
    })
    .select("id,email,full_name,phone,status")
    .single();
  if (error) throw error;
  return data;
}

async function grantEnrollment({ courseSlug, email, fullName, phone, expiredAt }) {
  const course = await requireV4Course(courseSlug);
  const student = await upsertStudent({ email, fullName, phone });
  const cleanEmail = normalizeEmail(email);
  const now = new Date().toISOString();
  const payload = {
    student_id: student.id,
    course_id: course.id,
    course_slug: course.slug,
    email: cleanEmail,
    normalized_email: cleanEmail,
    status: "active",
    expired_at: normalizeExpiry(expiredAt),
    source_system: "lms_v4_admin",
    updated_at: now
  };
  const { data, error } = await supabase
    .from("student_enrollments")
    .upsert(payload, { onConflict: "email,course_slug" })
    .select("id,student_id,course_id,course_slug,email,status,expired_at,created_at,updated_at,source_system")
    .single();
  if (error) throw error;
  return { enrollment: data, student };
}

async function updateEnrollment({ id, action, expiredAt }) {
  const enrollmentId = String(id || "").trim();
  if (!enrollmentId) throw new Error("Thiếu ID quyền học viên");
  const { data: existing, error: lookupError } = await supabase
    .from("student_enrollments")
    .select("id,course_slug,email,status,expired_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) {
    const err = new Error("Không tìm thấy quyền học viên");
    err.statusCode = 404;
    throw err;
  }
  await requireV4Course(existing.course_slug);

  const normalizedAction = String(action || "").trim();
  const patch = { updated_at: new Date().toISOString() };
  if (normalizedAction === "revoke") {
    patch.status = "revoked";
  } else if (normalizedAction === "activate") {
    patch.status = "active";
    patch.expired_at = normalizeExpiry(expiredAt);
  } else {
    throw new Error("Thao tác quyền học viên không hợp lệ");
  }

  const { data, error } = await supabase
    .from("student_enrollments")
    .update(patch)
    .eq("id", enrollmentId)
    .select("id,student_id,course_id,course_slug,email,status,expired_at,created_at,updated_at,source_system")
    .single();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const admin = getAdminFromRequest(req);
    if (!admin) return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });

    if (req.method === "GET") {
      const result = await listEnrollments(req.query?.course, req.query?.search);
      return res.status(200).json({ success: true, ...result });
    }
    if (req.method === "POST") {
      const { course, email, fullName, phone, expiredAt } = req.body || {};
      if (!course || !email) return res.status(400).json({ success: false, error: "Thiếu khóa học hoặc email" });
      const result = await grantEnrollment({ courseSlug: course, email, fullName, phone, expiredAt });
      return res.status(200).json({ success: true, ...result });
    }
    if (req.method === "PUT") {
      const { id, action, expiredAt } = req.body || {};
      const enrollment = await updateEnrollment({ id, action, expiredAt });
      return res.status(200).json({ success: true, enrollment });
    }
    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-v4-enrollments] Error:", err);
    return res.status(Number(err.statusCode || 500)).json({
      success: false,
      error: err.message || "Lỗi quản lý học viên V4"
    });
  }
}
