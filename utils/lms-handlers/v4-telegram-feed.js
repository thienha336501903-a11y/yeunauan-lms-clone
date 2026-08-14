import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";

const BOT_API_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const MEDIA_MESSAGE_TYPES = new Set([
  "photo",
  "video",
  "document",
  "audio",
  "voice",
  "animation",
  "video_note"
]);

function pickMedia(raw, messageType) {
  const value = raw && typeof raw === "object" ? raw : {};
  if (messageType === "photo" && Array.isArray(value.photo) && value.photo.length) {
    const item = value.photo[value.photo.length - 1] || {};
    return {
      type: "photo",
      fileId: item.file_id || "",
      size: Number(item.file_size || 0),
      width: Number(item.width || 0),
      height: Number(item.height || 0),
      mimeType: "image/jpeg",
      name: ""
    };
  }

  const key = messageType === "video_note" ? "video_note" : messageType;
  const item = value[key] && typeof value[key] === "object" ? value[key] : null;
  if (!item) return null;

  return {
    type: messageType,
    fileId: item.file_id || "",
    size: Number(item.file_size || 0),
    width: Number(item.width || item.length || 0),
    height: Number(item.height || item.length || 0),
    duration: Number(item.duration || 0),
    mimeType: String(item.mime_type || ""),
    name: String(item.file_name || "")
  };
}

function publicMedia(row, courseSlug) {
  const fromHistoricalReader = Boolean(row.raw_message?.from_reader);
  let media = pickMedia(row.raw_message, row.message_type);

  if (!media && fromHistoricalReader && MEDIA_MESSAGE_TYPES.has(row.message_type)) {
    media = {
      type: row.message_type,
      fileId: "",
      size: 0,
      width: 0,
      height: 0,
      duration: 0,
      mimeType: "",
      name: ""
    };
  }
  if (!media) return null;

  const botDownloadable = Boolean(media.fileId) && (!media.size || media.size <= BOT_API_DOWNLOAD_LIMIT);
  let delivery = "metadata_only";
  if (botDownloadable) delivery = "telegram_bot_proxy";
  else if (fromHistoricalReader || media.size > BOT_API_DOWNLOAD_LIMIT) delivery = "mtproto_required";

  return {
    type: media.type,
    size: media.size,
    width: media.width || 0,
    height: media.height || 0,
    duration: media.duration || 0,
    mimeType: media.mimeType || "",
    name: media.name || "",
    delivery,
    url: delivery === "telegram_bot_proxy"
      ? `/api/lms/portal?endpoint=v4-telegram-media&course=${encodeURIComponent(courseSlug)}&message=${encodeURIComponent(row.id)}`
      : ""
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const courseSlug = String(req.query?.course || "").trim();
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });

    const { data: mapping, error: mappingError } = await supabase
      .from("lms_v4_telegram_course_sources")
      .select("source_id,enabled,media_mode")
      .eq("course_slug", courseSlug)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping || !mapping.enabled) {
      return res.status(404).json({ success: false, code: "v4_source_not_enabled", error: "Khóa học này chưa bật nguồn Telegram V4" });
    }

    const { data: source, error: sourceError } = await supabase
      .from("tgcloner_sources")
      .select("id,title,username,chat_id,indexed_at,indexed_message_count")
      .eq("id", mapping.source_id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) return res.status(404).json({ success: false, code: "telegram_source_missing", error: "Không tìm thấy kênh Telegram nguồn" });

    const { data: rows, error: rowsError } = await supabase
      .from("tgcloner_source_messages")
      .select("id,source_message_id,media_group_id,message_type,text,caption,is_pinned,raw_message,source_date,updated_at")
      .eq("source_id", mapping.source_id)
      .order("source_message_id", { ascending: true })
      .limit(2000);
    if (rowsError) throw rowsError;

    const posts = (rows || []).map((row) => ({
      id: row.id,
      telegramMessageId: row.source_message_id,
      mediaGroupId: row.media_group_id || "",
      type: row.message_type,
      text: row.text || row.caption || "",
      isPinned: Boolean(row.is_pinned),
      date: row.source_date || row.updated_at,
      media: publicMedia(row, courseSlug)
    }));

    const stats = posts.reduce((acc, post) => {
      acc.total += 1;
      if (post.media?.delivery === "telegram_bot_proxy") acc.botProxy += 1;
      if (post.media?.delivery === "mtproto_required") acc.mtprotoRequired += 1;
      return acc;
    }, { total: 0, botProxy: 0, mtprotoRequired: 0 });

    return res.status(200).json({
      success: true,
      mode: "v4-telegram-source-poc",
      course: courseSlug,
      email: access.email,
      mediaMode: mapping.media_mode,
      source: {
        title: source.title || source.username || "Telegram",
        username: source.username || "",
        indexedAt: source.indexed_at,
        indexedMessageCount: source.indexed_message_count || 0
      },
      stats,
      posts
    });
  } catch (error) {
    console.error("[v4-telegram-feed]", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
