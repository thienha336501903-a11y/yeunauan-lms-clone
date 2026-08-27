import { getAdminFromRequest } from "../lms.js";
import { isR2Configured } from "../v5-r2.js";

function configured(name) {
  return Boolean(String(process.env[name] || "").trim());
}

export default async function adminV5CapabilitiesHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const admin = getAdminFromRequest(req);
  if (!admin?.email) return res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  return res.status(200).json({
    success: true,
    capabilities: {
      r2Upload: isR2Configured(),
      playbackSigning: configured("V5_PLAYBACK_PRIVATE_JWK"),
      mediaPublicUrl: configured("V5_MEDIA_PUBLIC_URL")
    }
  });
}
