import { getRuntimeSnapshot } from "../utils/v3-runtime-controller.js";

function isV4RoutingEnabled() {
  const raw = String(process.env.LMS_V4_ROUTING_ENABLED || "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(raw);
}

export default async function handler(req, res) {
  const state = await getRuntimeSnapshot();
  const mode = state.effectiveMode === "v3" ? "v3" : "v2";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === "_path") continue;
    if (Array.isArray(value)) value.forEach(v => params.append(key, String(v)));
    else if (value != null) params.set(key, String(value));
  }

  const qs = params.toString();
  const hasCourse = Boolean(String(params.get("course") || "").trim());
  const target = mode === "v3"
    ? (isV4RoutingEnabled() ? "/v4-entry.html" : "/v3")
    : (hasCourse ? "/lms.html" : "/v2-entry.html");

  res.setHeader("Cache-Control", "no-store");
  return res.redirect(307, target + (qs ? `?${qs}` : ""));
}
