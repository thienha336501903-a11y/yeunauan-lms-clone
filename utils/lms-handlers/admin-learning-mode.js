import { getAdminFromRequest } from "../lms.js";
import { getRuntimeSnapshot, setActiveMode, setKillSwitch } from "../v3-runtime-controller.js";

function payload(snapshot) {
  return {
    success: true,
    activeMode: snapshot.activeMode,
    effectiveMode: snapshot.effectiveMode,
    effective: snapshot.effective,
    killSwitch: snapshot.killSwitch,
    source: snapshot.source,
    ok: snapshot.ok,
    updatedAt: snapshot.updatedAt,
    modes: {
      v2: { label: "V2", description: "LMS hiện tại (ổn định)" },
      v3: { label: "V3", description: "Telegram Channel LMS" },
    },
  };
}

export default async function handler(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin) return res.status(401).json({ success: false, error: "admin_auth_required" });
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") return res.status(200).json(payload(await getRuntimeSnapshot()));

  if (req.method === "POST") {
    const action = String(req.body?.action || (req.body?.mode ? "set_mode" : req.body?.killSwitch !== undefined ? "set_kill_switch" : "")).trim();
    if (action === "set_mode") {
      const result = await setActiveMode(req.body?.mode);
      if (!result.ok) return res.status(result.code === "invalid_mode" ? 400 : 503).json({ success: false, error: result.code });
      return res.status(200).json({ ...payload(result), flipped: true });
    }
    if (action === "set_kill_switch") {
      const result = await setKillSwitch(req.body?.enabled ?? req.body?.killSwitch);
      if (!result.ok) return res.status(503).json({ success: false, error: result.code });
      return res.status(200).json({ ...payload(result), killSwitchChanged: true });
    }
    return res.status(400).json({ success: false, error: "invalid_action" });
  }

  return res.status(405).json({ success: false, error: "method_not_allowed" });
}
