import { headR2Object, isR2Configured } from "../v5-r2.js";

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ success: false, error: "Not found" });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!isR2Configured()) {
    return res.status(503).json({ success: false, r2: false, error: "r2_not_configured" });
  }

  try {
    const key = `__v5_probe__/never-exists-${Date.now()}`;
    const object = await headR2Object({ key });
    if (object) {
      return res.status(200).json({ success: true, r2: true, probe: "object_exists" });
    }
    return res.status(200).json({ success: true, r2: true, probe: "authenticated_404" });
  } catch (error) {
    return res.status(502).json({
      success: false,
      r2: false,
      error: "r2_probe_failed",
      detail: String(error?.message || error || "unknown").slice(0, 180)
    });
  }
}
