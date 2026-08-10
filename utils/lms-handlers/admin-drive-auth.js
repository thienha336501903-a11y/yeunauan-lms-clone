import { getAdminFromRequest, isAdminEmail, normalizeEmail } from "../lms.js";
import { google } from "googleapis";

export async function readStoredRefreshToken(supabase) {
  const { data, error } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "google_drive_refresh_token")
    .maybeSingle();

  if (error) {
    throw new Error(`Không thể đọc Refresh Token đã lưu: ${error.message}`);
  }

  return data?.value?.val || null;
}

async function canRefreshAccessToken(refreshToken) {
  if (!refreshToken) return false;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const tokenRes = await oauth2Client.getAccessToken();
    return Boolean(tokenRes?.token);
  } catch (err) {
    console.warn("[admin-drive-auth] Stored refresh token is no longer valid:", err?.message);
    return false;
  }
}

export async function saveSiteConfigValue(supabase, key, value) {
  const { error } = await supabase.from("site_config").upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });

  if (error) {
    throw new Error(`Không thể lưu cấu hình ${key}: ${error.message}`);
  }
}

export async function verifyStoredDriveTokens(supabase, expectedAccessToken, expectedRefreshToken) {
  const { data, error } = await supabase
    .from("site_config")
    .select("key, value")
    .in("key", ["google_drive_access_token", "google_drive_refresh_token"]);

  if (error) {
    throw new Error(`Không thể kiểm tra lại token Google Drive: ${error.message}`);
  }

  const values = new Map((data || []).map((row) => [row.key, row.value?.val]));
  if (
    values.get("google_drive_access_token") !== expectedAccessToken ||
    values.get("google_drive_refresh_token") !== expectedRefreshToken
  ) {
    throw new Error("Token Google Drive chưa được lưu đầy đủ. Vui lòng kết nối lại.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const { supabase } = await import("../supabase.js");

    // ── GET: Check connection status ─────────────────────────────────────────
    if (req.method === "GET") {
      const { getGoogleDriveClient } = await import("../lms.js");
      try {
        const clientInfo = await getGoogleDriveClient(supabase);
        if (clientInfo && clientInfo.drive) {
          const type = clientInfo.isServiceAccount ? "service_account" : "oauth";
          return res.status(200).json({
            success: true,
            connected: true,
            type,
            accessToken: clientInfo.accessToken
          });
        }
      } catch (err) {
        console.error("Failed to check Google Drive client info:", err);
      }

      return res.status(200).json({ success: true, connected: false });
    }

    // ── POST: Exchange Authorization Code for Refresh/Access Tokens ──────────
    if (req.method === "POST") {
      const { code } = req.body || {};

      if (!code || typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ success: false, error: "Thiếu Authorization Code" });
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "postmessage"
      );

      const { tokens } = await oauth2Client.getToken(code);
      const { access_token, refresh_token, expiry_date } = tokens;

      if (!access_token) {
        return res.status(400).json({ success: false, error: "Không nhận được Access Token từ Google" });
      }

      // Verify email via access_token info
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`
      );
      const tokenInfo = await tokenInfoRes.json();

      if (tokenInfo.error) {
        return res.status(400).json({ success: false, error: "Token vừa nhận được không hợp lệ hoặc đã hết hạn" });
      }

      const tokenEmail = normalizeEmail(tokenInfo.email);
      if (!isAdminEmail(tokenEmail)) {
        return res.status(403).json({
          success: false,
          error: `Tài khoản Google (${tokenEmail}) vừa chọn không khớp với danh sách quản trị viên`
        });
      }

      let durableRefreshToken = refresh_token || null;
      if (!durableRefreshToken) {
        const storedRefreshToken = await readStoredRefreshToken(supabase);
        if (await canRefreshAccessToken(storedRefreshToken)) {
          durableRefreshToken = storedRefreshToken;
        }
      }

      if (!durableRefreshToken) {
        return res.status(409).json({
          success: false,
          code: "DRIVE_REAUTH_REQUIRED",
          error: "Google chưa cấp Refresh Token mới và token cũ đã hết hiệu lực. Hãy thu hồi quyền của ứng dụng trong Tài khoản Google, sau đó bấm Kết nối Drive lại."
        });
      }

      // Persist the durable credential first, then the short-lived access token.
      // Every write is checked so the UI cannot report a false successful connection.
      await saveSiteConfigValue(supabase, "google_drive_refresh_token", {
        val: durableRefreshToken
      });
      await saveSiteConfigValue(supabase, "google_drive_access_token", {
        val: access_token,
        expires_at: expiry_date || (Date.now() + 3600 * 1000)
      });
      await verifyStoredDriveTokens(supabase, access_token, durableRefreshToken);

      return res.status(200).json({
        success: true,
        email: tokenEmail,
        message: "Kết nối Google Drive thành công!"
      });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-drive-auth] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi server khi kết nối Google Drive",
      detail: err.message
    });
  }
}
