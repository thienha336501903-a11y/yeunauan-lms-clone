import { getAdminFromRequest } from "../lms.js";
import { supabase } from "../supabase.js";
import { deleteR2Object, headR2Object, isR2Configured } from "../v5-r2.js";

const CONFIRMATION = "DELETE_CLONE_FACTORY_TEST_R2";
const TEST_PREFIX = "__clone_factory_test";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return String(value || "").trim();
}

function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

async function requireFixtureCourse(courseId) {
  if (!UUID.test(courseId)) throw new Error("Course ID cleanup không hợp lệ.");
  const { data: course, error } = await supabase
    .from("courses")
    .select("id,slug,title,delivery_mode,raw_data")
    .eq("id", courseId)
    .maybeSingle();
  if (error) throw error;
  if (!course || clean(course.delivery_mode).toLowerCase() !== "v5") {
    throw new Error("Cleanup bị chặn: không tìm thấy đúng khóa V5 test.");
  }
  const raw = course.raw_data && typeof course.raw_data === "object" ? course.raw_data : {};
  const fixtureMarked = raw.test_fixture === true
    || clean(raw.test_fixture).toLowerCase() === "true"
    || clean(course.title).startsWith(TEST_PREFIX)
    || clean(raw.studentDisplayTitle).startsWith(TEST_PREFIX)
    || clean(course.slug).startsWith(TEST_PREFIX);
  if (!fixtureMarked) {
    throw new Error("Cleanup bị chặn: khóa học không có dấu hiệu clone factory test.");
  }
  return course;
}

function validateKeys(courseId, values) {
  const keys = [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
  if (!keys.length || keys.length > 10) throw new Error("Danh sách R2 cleanup phải có từ 1 đến 10 object.");
  const prefix = `media/v5/${courseId}/`;
  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      throw new Error("Cleanup bị chặn: object không thuộc đúng course fixture.");
    }
  }
  return keys;
}

async function verifyRegisteredFixtureKeys(keys) {
  const { data, error } = await supabase
    .from("v5_media_assets")
    .select("r2_object_key")
    .in("r2_object_key", keys);
  if (error) throw error;
  const registered = new Set((data || []).map(row => clean(row.r2_object_key)).filter(Boolean));
  const missing = keys.filter(key => !registered.has(key));
  if (missing.length) {
    throw new Error("Cleanup bị chặn: có object không còn được đăng ký trong media fixture.");
  }
}

export default async function adminV5TestCleanupHandler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
  if (!isR2Configured()) return res.status(503).json({ success: false, error: "R2 chưa được cấu hình đầy đủ." });

  try {
    const courseId = clean(req.body?.courseId);
    if (clean(req.body?.confirmation) !== CONFIRMATION) {
      return res.status(400).json({ success: false, error: "Xác nhận cleanup R2 không hợp lệ." });
    }
    await requireFixtureCourse(courseId);
    const keys = validateKeys(courseId, req.body?.objectKeys);
    await verifyRegisteredFixtureKeys(keys);
    const results = [];
    for (const key of keys) {
      const before = await headR2Object({ key });
      const deletion = await deleteR2Object({ key });
      const after = await headR2Object({ key });
      if (after) throw new Error(`R2 vẫn còn object sau cleanup: ${key}`);
      results.push({ key, existed: Boolean(before), deleted: deletion.deleted, verifiedMissing: true });
    }
    return res.status(200).json({ success: true, deleted: results.filter(item => item.deleted).length, results });
  } catch (error) {
    console.error("[admin-v5-test-cleanup]", error);
    return res.status(409).json({ success: false, error: error.message || "Cleanup R2 test thất bại." });
  }
}
