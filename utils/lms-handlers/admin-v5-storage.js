import { getAdminFromRequest } from "../lms.js";
import { getV5StorageSnapshot } from "../v5-course-storage.js";

function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

export default async function adminV5StorageHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const refresh = req.query?.refresh === "1" || req.query?.refresh === "true";
    const snapshot = await getV5StorageSnapshot({ refresh });
    return res.status(200).json({
      success: true,
      ...snapshot
    });
  } catch (error) {
    console.error("[admin-v5-storage]", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Lỗi lấy dữ liệu dung lượng V5."
    });
  }
}
