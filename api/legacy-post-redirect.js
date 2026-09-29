import { cloneConfig } from "../utils/clone-config.js";
import { resolveRequestRoute } from "../utils/agency-routing.js";

export default async function handler(req, res) {
  const routeDecision = await resolveRequestRoute(req, req.__options || {});
  if (routeDecision.route === "DENY") {
    return res.status(routeDecision.status || 403).json({
      success: false, code: routeDecision.code, error: routeDecision.error
    });
  }
  if (routeDecision.route === "AGENCY") {
    return res.status(404).json({
      success: false,
      code: "agency_legacy_post_redirect_prohibited",
      error: "Legacy post redirects are unavailable on Agency hosts."
    });
  }

  const id = String(req.query?.id || "").trim();
  if (!id || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return res.status(400).send("Invalid post id");
  return res.redirect(307, `${cloneConfig().legacyPostPublicUrl}/post/${encodeURIComponent(id)}`);
}
