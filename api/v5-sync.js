import crypto from "node:crypto";
import { supabase } from "../utils/supabase.js";
import { normalizeEmail } from "../utils/lms.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

function validSlug(value) { return /^[a-z0-9_-]+$/.test(String(value || "").trim()); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value)); }

async function requireV5Course(courseSlug) {
  const slug = String(courseSlug || "").trim();
  if (!validSlug(slug)) throw Object.assign(new Error("Slug khóa học không hợp lệ"), { statusCode: 400 });
  const { data, error } = await supabase.from("courses").select("id,slug,title,delivery_mode").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data || String(data.delivery_mode || "").toLowerCase() !== "v5") throw Object.assign(new Error("Khóa học không tồn tại hoặc không phải V5"), { statusCode: 409 });
  return data;
}

async function upsertStudent(email) {
  const cleanEmail = normalizeEmail(email);
  const { data: existing, error: readError } = await supabase.from("students").select("id,email").eq("email", cleanEmail).maybeSingle();
  if (readError) throw readError;
  if (existing) return existing;
  const { data, error } = await supabase.from("students").insert({ id: crypto.randomUUID(), email: cleanEmail, status: "active", updated_at: new Date().toISOString() }).select("id,email").single();
  if (error) throw error;
  return data;
}

async function syncEnrollment({ email, courseSlug, orderId, action }) {
  if (!validEmail(email)) throw Object.assign(new Error("Email học viên không hợp lệ"), { statusCode: 400 });
  const course = await requireV5Course(courseSlug);
  const cleanEmail = normalizeEmail(email);
  const now = new Date().toISOString();
  if (action === "revoke") {
    const { data, error } = await supabase.from("student_enrollments").update({ status: "revoked", updated_at: now }).eq("email", cleanEmail).eq("course_slug", course.slug).select("id,email,course_slug,status").maybeSingle();
    if (error) throw error;
    return { success: true, enrollment: data || null, lms: "SUCCESS", portal: "SKIPPED_V5", error: null };
  }
  const student = await upsertStudent(cleanEmail);
  const payload = {
    student_id: student.id,
    course_id: course.id,
    course_slug: course.slug,
    email: cleanEmail,
    normalized_email: cleanEmail,
    status: "active",
    source_system: "commerce_v5",
    source_order_id: orderId || null,
    updated_at: now
  };
  const { data, error } = await supabase.from("student_enrollments").upsert(payload, { onConflict: "email,course_slug" }).select("id,email,course_slug,status,source_system,source_order_id").single();
  if (error) throw error;
  return { success: true, enrollment: data, lms: "SUCCESS", portal: "SKIPPED_V5", error: null };
}

async function syncCourse(body) {
  const slug = String(body.slug || "").trim();
  const title = String(body.title || "").trim();
  if (!validSlug(slug) || !title) throw Object.assign(new Error("Thiếu hoặc sai slug/title"), { statusCode: 400 });
  const { data: existing, error: readError } = await supabase.from("courses").select("id,delivery_mode").eq("slug", slug).maybeSingle();
  if (readError) throw readError;
  if (existing && String(existing.delivery_mode || "").toLowerCase() !== "v5") throw Object.assign(new Error("Không thể đổi khóa hiện hữu sang V5 bằng sync API"), { statusCode: 409 });
  const patch = {
    slug,
    title,
    subtitle: String(body.subtitle || "").trim() || null,
    image_url: String(body.imageUrl || "").trim() || null,
    delivery_mode: "v5",
    active: body.active !== false,
    updated_at: new Date().toISOString()
  };
  if (body.expected_start_date !== undefined) patch.expected_start_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expected_start_date || "")) ? String(body.expected_start_date) : null;
  let course;
  if (existing) {
    const { data, error } = await supabase.from("courses").update(patch).eq("id", existing.id).select("id,slug,title,delivery_mode").single();
    if (error) throw error;
    course = data;
  } else {
    const { data, error } = await supabase.from("courses").insert({ id: crypto.randomUUID(), ...patch, is_published: false, sort_order: 999 }).select("id,slug,title,delivery_mode").single();
    if (error) throw error;
    course = data;
  }
  await supabase.from("v5_course_configs").upsert({ course_id: course.id, source_mode: "direct", status: "draft", updated_at: new Date().toISOString() }, { onConflict: "course_id" });
  return { success: true, course };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
  const supplied = String(req.headers["x-sync-secret"] || "");
  const secret = String(process.env.INTERNAL_SYNC_SECRET || "");
  if (!secret) return res.status(503).json({ success: false, error: "Internal sync is unavailable." });
  if (!supplied || !safeEqual(supplied, secret)) return res.status(401).json({ success: false, error: "Unauthorized" });
  try {
    const action = String(req.body?.action || "").trim();
    if (action === "syncCourse") return res.status(200).json(await syncCourse(req.body || {}));
    if (action === "syncEnrollment") return res.status(200).json(await syncEnrollment({ ...req.body, action: "create" }));
    if (action === "revokeEnrollment") return res.status(200).json(await syncEnrollment({ ...req.body, action: "revoke" }));
    return res.status(400).json({ success: false, error: "Action không hợp lệ" });
  } catch (error) {
    console.error("[v5-sync]", error);
    return res.status(Number(error.statusCode || 500)).json({ success: false, error: error.message || "V5 sync error" });
  }
}
