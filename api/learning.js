import { getRuntimeSnapshot } from "../utils/v3-runtime-controller.js";
import { supabase } from "../utils/supabase.js";

function isV4RoutingEnabled() {
  const raw = String(process.env.LMS_V4_ROUTING_ENABLED || "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(raw);
}

async function courseUsesV4(courseSlug) {
  const slug = String(courseSlug || "").trim();
  if (!slug) return false;

  const { data, error } = await supabase
    .from("courses")
    .select("delivery_mode")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.warn("[learning-route] course delivery lookup failed:", error.message);
    return false;
  }

  return String(data?.delivery_mode || "").trim().toLowerCase() === "v4";
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
  const courseSlug = String(params.get("course") || "").trim();
  const hasCourse = Boolean(courseSlug);
  const requestedV4 = hasCourse ? await courseUsesV4(courseSlug) : false;

  // Per-course V4 is independent from the global V4 routing flag. This lets new
  // V4 Web courses use V4 while all existing LMS courses stay on their legacy flow.
  const target = requestedV4
    ? "/v4-entry.html"
    : mode === "v3"
      ? (isV4RoutingEnabled() ? "/v4-entry.html" : "/v3")
      : (hasCourse ? "/lms.html" : "/v2-entry.html");

  res.setHeader("Cache-Control", "no-store");
  return res.redirect(307, target + (qs ? `?${qs}` : ""));
}
