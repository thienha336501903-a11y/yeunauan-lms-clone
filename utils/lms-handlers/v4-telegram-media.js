import { Readable } from "node:stream";
import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";

const BOT_API_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

function pickMedia(raw, messageType) {
  const value = raw && typeof raw === "object" ? raw : {};
  if (messageType === "photo" && Array.isArray(value.photo) && value.photo.length) {
    const item = value.photo[value.photo.length - 1] || {};
    return {
      fileId: item.file_id || "",
      size: Number(item.file_size || 0),
      mimeType: "image/jpeg",
      name: "telegram-photo.jpg"
    };
  }
  const key = messageType === "video_note" ? "video_note" : messageType;
  const item = value[key] && typeof value[key] === "object" ? value[key] : null;
  if (!item) return null;
  return {
    fileId: item.file_id || "",
    size: Number(item.file_size || 0),
    mimeType: String(item.mime_type || "application/octet-stream"),
    name: String(item.file_name || `telegram-${messageType}`)
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const courseSlug = String(req.query?.course || "").trim();
    const messageRowId = String(req.query?.message || "").trim();
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });
    if (!messageRowId) return res.status(400).json({ success: false, code: "missing_message", error: "Thiếu bài đăng Telegram" });

    const { data: mapping, error: mappingError } = await supabase
      .from("lms_v4_telegram_course_sources")
      .select("source_id,enabled")
      .eq("course_slug", courseSlug)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping?.enabled) return res.status(404).json({ success: false, code: "v4_source_not_enabled", error: "Nguồn Telegram V4 chưa bật" });

    const { data: row, error: rowError } = await supabase
      .from("tgcloner_source_messages")
      .select("id,source_id,message_type,raw_message")
      .eq("id", messageRowId)
      .eq("source_id", mapping.source_id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return res.status(404).json({ success: false, code: "message_not_found", error: "Không tìm thấy media" });

    const media = pickMedia(row.raw_message, row.message_type);
    if (!media?.fileId || row.raw_message?.from_reader || media.size > BOT_API_DOWNLOAD_LIMIT) {
      return res.status(409).json({
        success: false,
        code: "mtproto_required",
        error: "Media này cần MTProto gateway để phát trực tiếp từ Telegram"
      });
    }

    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!botToken) {
      return res.status(503).json({ success: false, code: "telegram_bot_not_configured", error: "Chưa cấu hình Telegram Bot token ở server" });
    }

    const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(media.fileId)}`);
    const info = await infoResponse.json().catch(() => null);
    if (!infoResponse.ok || !info?.ok || !info?.result?.file_path) {
      return res.status(502).json({ success: false, code: "telegram_get_file_failed", error: "Telegram không trả file media" });
    }

    const fileResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`);
    if (!fileResponse.ok || !fileResponse.body) {
      return res.status(502).json({ success: false, code: "telegram_file_fetch_failed", error: "Không tải được media từ Telegram" });
    }

    const contentType = fileResponse.headers.get("content-type") || media.mimeType || "application/octet-stream";
    const contentLength = fileResponse.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(media.name || "telegram-media")}`);
    res.setHeader("Cache-Control", "private, max-age=300");

    if (req.method === "HEAD") return res.status(200).end();
    Readable.fromWeb(fileResponse.body).pipe(res);
  } catch (error) {
    console.error("[v4-telegram-media]", error);
    if (!res.headersSent) return res.status(500).json({ success: false, error: "Server error" });
    res.end();
  }
}
