import { getGoogleDriveClient } from "../utils/lms.js";
import { supabase } from "../utils/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ ok: false });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, code: "method_not_allowed" });
  }

  try {
    const client = await getGoogleDriveClient(supabase);
    if (!client?.drive) {
      return res.status(503).json({ ok: false, code: "drive_client_unavailable" });
    }

    await client.drive.about.get({ fields: "user" });
    return res.status(200).json({
      ok: true,
      mode: client.isServiceAccount ? "service_account" : "oauth"
    });
  } catch (error) {
    const message = String(error?.message || "");
    const code = /client_secret/i.test(message)
      ? "missing_client_secret"
      : /invalid_grant|invalid_request/i.test(message)
        ? "oauth_refresh_failed"
        : "drive_check_failed";
    console.error("[preview-drive-diagnostic]", code);
    return res.status(503).json({ ok: false, code });
  }
}
