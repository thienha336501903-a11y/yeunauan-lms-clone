import { supabase } from "../utils/supabase.js";

const MODE_KEY = "clone_learning_mode";

export default async function handler(req, res) {
  let mode = "v2";
  try {
    const { data, error } = await supabase
      .from("site_config")
      .select("value,updated_at")
      .eq("key", MODE_KEY)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (!error && String(data?.[0]?.value || "").trim().toLowerCase() === "v3") mode = "v3";
  } catch {}

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
