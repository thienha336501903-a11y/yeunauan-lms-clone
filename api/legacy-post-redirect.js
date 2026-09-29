import { cloneConfig } from "../utils/clone-config.js";
import { resolveTenant } from "../utils/tenant-resolver.js";

async function isAgencyRequest(req, options = {}) {
  const resolved = await resolveTenant(req, options);
  if (resolved?.ok && resolved?.tenant?.agencyId) return true;
  if (Number(resolved?.status || 0) >= 500) {
    const error = new Error("Agency tenant resolution is unavailable.");
    error.statusCode = 503;
    throw error;
  }
  return false;
}

export default async function handler(req, res) {
  try {
    if (await isAgencyRequest(req, req.__options || {})) {
      return res.status(403).json({
        success: false,
        code: "agency_legacy_post_blocked",
        error: "Legacy post redirect is not available on an Agency domain."
      });
    }
  } catch {
    return res.status(503).json({
      success: false,
      code: "agency_route_check_failed",
      error: "Unable to validate tenant boundary."
    });
  }

  const id = String(req.query?.id || "").trim();
  if (!id || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return res.status(400).send("Invalid post id");
  return res.redirect(307, `${cloneConfig().legacyPostPublicUrl}/post/${encodeURIComponent(id)}`);
}
