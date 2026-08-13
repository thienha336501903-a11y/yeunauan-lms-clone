import { getRuntimeSnapshot } from "../utils/v3-runtime-controller.js";

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
  const target = mode === "v3" ? "/channel-candidate.html" : "/lms.html";
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(307, target + (qs ? `?${qs}` : ""));
}
