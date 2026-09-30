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

  console.warn("[m0e] retired legacy post deep-link requested");
  return res.status(410).json({
    success: false,
    code: "legacy_post_retired_m0e",
    error: "Legacy post redirects have been retired. Use the Main LMS course manager."
  });
}
