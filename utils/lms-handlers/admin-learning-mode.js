import { supabase } from "../supabase.js";
import { getAdminFromRequest, saveSiteConfigValue } from "../lms.js";

const MODE_KEY = "clone_learning_mode";
const ALLOWED_MODES = new Set(["v2", "v3"]);

async function readMode() {
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
    return {
      mode: valid ? raw : "v2",
      source: valid ? "site_config" : "fallback",
      updatedAt: data?.[0]?.updated_at || null,
    };
  } catch (error) {
    console.error("[admin-learning-mode] read failed:", error?.message);
    return { mode: "v2", source: "fallback", updatedAt: null };
  }
}

export default async function handler(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(401).json({ success: false, error: "admin_auth_required" });
  }

  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const state = await readMode();
    return res.status(200).json({
      success: true,
      activeMode: state.mode,
      source: state.source,
      updatedAt: state.updatedAt,
      modes: {
        v2: { label: "V2", description: "LMS hiện tại" },
        v3: { label: "V3", description: "Telegram Channel LMS" },
      },
    });
  }

  if (req.method === "POST") {
    const mode = String(req.body?.mode || "").trim().toLowerCase();
    if (!ALLOWED_MODES.has(mode)) {
      return res.status(400).json({ success: false, error: "invalid_mode" });
    }
    try {
      await saveSiteConfigValue(supabase, MODE_KEY, mode);
      return res.status(200).json({ success: true, activeMode: mode, flipped: true });
    } catch (error) {
      console.error("[admin-learning-mode] save failed:", error?.message);
      return res.status(503).json({ success: false, error: "mode_save_failed" });
    }
  }

  return res.status(405).json({ success: false, error: "method_not_allowed" });
}
