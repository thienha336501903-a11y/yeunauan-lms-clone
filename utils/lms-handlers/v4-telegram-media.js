import { randomUUID } from "node:crypto";
import { supabase } from "../supabase.js";
import { maybeCleanupExpiredV4MediaTickets } from "../v4-media-ticket-retention.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";

const DEFAULT_GATEWAY = "https://telegram-channel-cloner.vercel.app/api/telegram/media";
const TICKET_TTL_MS = 10 * 60 * 1000;

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

function gatewayUrl() {
  const configured = String(process.env.TELEGRAM_MEDIA_GATEWAY_URL || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_GATEWAY;
}

function scheduleTicketCleanup() {
  void maybeCleanupExpiredV4MediaTickets(supabase).then((result) => {
    if (result.error) console.warn("[v4-media-ticket-retention]", result.error);
  });
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
    if (!media) {
      return res.status(409).json({ success: false, code: "media_metadata_missing", error: "Bài Telegram chưa có metadata media để phát" });
    }

    scheduleTicketCleanup();

    const gateway = gatewayUrl();
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
    const { error: ticketError } = await supabase
      .from("lms_v4_media_tickets")
      .insert({
        token,
        course_slug: courseSlug,
        source_id: mapping.source_id,
        message_id: row.id,
        email: access.email,
        expires_at: expiresAt
      });
    if (ticketError) throw ticketError;

    const location = `${gateway}?ticket=${encodeURIComponent(token)}`;
    res.statusCode = 307;
    res.setHeader("Location", location);
    res.setHeader("Cache-Control", "private, no-store");
    return res.end();
  } catch (error) {
    console.error("[v4-telegram-media]", error);
    if (!res.headersSent) return res.status(500).json({ success: false, error: "Server error" });
    res.end();
  }
}
