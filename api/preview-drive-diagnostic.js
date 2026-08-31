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
    const message = String(error?.message || "").toLowerCase();
    const oauthError = String(error?.response?.data?.error || "").toLowerCase();
    const status = Number(error?.response?.status || error?.code || 0);

    let code = "drive_check_failed";
    if (/client_secret/.test(message)) code = "missing_client_secret";
    else if (oauthError === "invalid_client" || /invalid_client/.test(message)) code = "invalid_client";
    else if (oauthError === "invalid_grant" || /invalid_grant/.test(message)) code = "invalid_grant";
    else if (oauthError === "invalid_request" || /invalid_request/.test(message)) code = "invalid_request";
    else if (status === 401) code = "drive_unauthorized";
    else if (status === 403) code = "drive_forbidden";

    console.error("[preview-drive-diagnostic]", code);
    return res.status(503).json({ ok: false, code });
  }
}
