import { cloneConfig } from "../utils/clone-config.js";
import { isAgencyRequest } from "../utils/agency-routing.js";

export default async function handler(req, res) {
  if (await isAgencyRequest(req, req.__options || {})) {
    return res.status(404).json({
      success: false,
      code: "agency_legacy_post_blocked",
      error: "Legacy post redirects are not available on Agency tenant domains."
    });
  }

  const id = String(req.query?.id || "").trim();
  if (!id || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return res.status(400).send("Invalid post id");
  return res.redirect(307, `${cloneConfig().legacyPostPublicUrl}/post/${encodeURIComponent(id)}`);
}
