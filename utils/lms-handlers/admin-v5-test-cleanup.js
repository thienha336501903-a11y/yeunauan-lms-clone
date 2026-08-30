import { getAdminFromRequest } from "../lms.js";
import { deleteR2Object, headR2Object, isR2Configured } from "../v5-r2.js";

const CONFIRMATION = "DELETE_CLONE_FACTORY_TEST_R2";
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

function validateKeys(courseId, values) {
  if (!UUID.test(courseId)) throw new Error("Course ID cleanup không hợp lệ.");
  const keys = [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
  if (!keys.length || keys.length > 10) throw new Error("Danh sách R2 cleanup phải có từ 1 đến 10 object.");
  const prefix = `media/v5/${courseId}/`;
  for (const key of keys) {
    const filename = key.split("/").pop() || "";
    if (!key.startsWith(prefix) || !filename.startsWith("__clone_factory_test")) {
      throw new Error("Cleanup bị chặn: object không thuộc đúng fixture clone factory test.");
    }
  }
  return keys;
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
    const keys = validateKeys(courseId, req.body?.objectKeys);
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
