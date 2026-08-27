import { getRuntimeSnapshot } from "../utils/v3-runtime-controller.js";
import { supabase } from "../utils/supabase.js";

function isV4RoutingEnabled() {
  const raw = String(process.env.LMS_V4_ROUTING_ENABLED || "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(raw);
}

async function courseDeliveryMode(courseSlug) {
  const slug = String(courseSlug || "").trim();
  if (!slug) return "";

  const { data, error } = await supabase
    .from("courses")
    .select("delivery_mode")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.warn("[learning-route] course delivery lookup failed:", error.message);
    return "";
  }

  return String(data?.delivery_mode || "").trim().toLowerCase();
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

  // A bare /learning URL has no course context. Send students to the course
  // manager instead of guessing a runtime.
  if (!hasCourse) {
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(307, "/my-courses.html");
  }

  const deliveryMode = await courseDeliveryMode(courseSlug);
  const requestedV5 = deliveryMode === "v5";
  const requestedV4 = deliveryMode === "v4";

  // V5 is an explicit per-course route and never depends on the global V4
  // routing flag. V4 keeps its existing service-worker refresh bootstrap;
  // legacy LMS/V3 routing remains unchanged.
  const target = requestedV5
    ? "/v5.html"
    : requestedV4
      ? "/v4-sw-refresh.html"
      : mode === "v3"
        ? (isV4RoutingEnabled() ? "/v4-sw-refresh.html" : "/v3")
        : "/lms.html";

  res.setHeader("Cache-Control", "no-store");
  return res.redirect(307, target + (qs ? `?${qs}` : ""));
}
