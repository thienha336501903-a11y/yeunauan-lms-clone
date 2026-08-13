import { supabase } from "../supabase.js";

const MODE_KEY = "clone_learning_mode";
const ALLOWED_MODES = new Set(["v2", "v3"]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "method_not_allowed", activeMode: "v2" });
  }

  try {
    const { data, error } = await supabase
      .from("site_config")
      .select("value,updated_at")
      .eq("key", MODE_KEY)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const raw = String(data?.[0]?.value || "").trim().toLowerCase();
    const valid = ALLOWED_MODES.has(raw);
    return res.status(200).json({
      success: true,
      activeMode: valid ? raw : "v2",
      source: valid ? "site_config" : "fallback",
      updatedAt: data?.[0]?.updated_at || null,
    });
  } catch (error) {
    console.error("[learning-mode] read failed:", error?.message);
    return res.status(200).json({ success: true, activeMode: "v2", source: "fallback", updatedAt: null });
  }
}
