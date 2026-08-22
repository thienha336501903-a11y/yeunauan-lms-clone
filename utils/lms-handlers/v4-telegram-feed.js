import { randomUUID } from "node:crypto";
import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";

const BOT_API_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const DEFAULT_MEDIA_GATEWAY = "https://telegram-channel-cloner.vercel.app/api/telegram/media";
const DEFAULT_MTPROTO_GATEWAY = "https://telegram-channel-cloner.vercel.app/api/telegram/warmup?stream=1";
const DEFAULT_THUMBNAIL_GATEWAY = "https://telegram-channel-cloner.vercel.app/api/telegram/thumbnail";
const GATEWAY_TICKET_TTL_MS = 10 * 60 * 1000;
const GATEWAY_TICKET_REUSE_BUFFER_MS = 2 * 60 * 1000;
const INITIAL_THUMBNAIL_BUDGET = 4;
const VIDEO_TYPES = new Set(["video", "animation", "video_note"]);
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
      duration: 0,
      mimeType: "image/jpeg",
      name: "",
      hasThumbnail: false
    };
  }

  const key = messageType === "video_note" ? "video_note" : messageType;
  const item = value[key] && typeof value[key] === "object" ? value[key] : null;
  if (!item) return null;
  const thumbnail = item.thumbnail || item.thumb || null;

  return {
    type: messageType,
    fileId: item.file_id || "",
    size: Number(item.file_size || 0),
    width: Number(item.width || item.length || 0),
    height: Number(item.height || item.length || 0),
    duration: Number(item.duration || 0),
    mimeType: String(item.mime_type || ""),
    name: String(item.file_name || ""),
    hasThumbnail: Boolean(thumbnail?.file_id || thumbnail?.mtproto)
  };
}

function thumbnailGatewayUrl() {
  const configured = String(process.env.TELEGRAM_THUMBNAIL_GATEWAY_URL || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_THUMBNAIL_GATEWAY;
}

function mediaGatewayUrl() {
  const configured = String(process.env.TELEGRAM_MEDIA_GATEWAY_URL || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_MEDIA_GATEWAY;
}

function mtprotoGatewayUrl() {
  const configured = String(process.env.TELEGRAM_MTPROTO_GATEWAY_URL || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_MTPROTO_GATEWAY;
}

function gatewayUrlWithTicket(url, ticket) {
  return `${url}${url.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
}

async function issueGatewayTickets({ rows, courseSlug, sourceId, email }) {
  const candidates = (rows || []).filter((row) => Boolean(pickMedia(row.raw_message, row.message_type)));
  if (!candidates.length) return new Map();

  const messageIds = candidates.map((row) => row.id);
  const reusableAfter = new Date(Date.now() + GATEWAY_TICKET_REUSE_BUFFER_MS).toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("lms_v4_media_tickets")
    .select("token,message_id,created_at")
    .eq("course_slug", courseSlug)
    .eq("source_id", sourceId)
    .eq("email", email)
    .eq("purpose", "feed")
    .is("revoked_at", null)
    .gt("expires_at", reusableAfter)
    .in("message_id", messageIds)
    .order("created_at", { ascending: false });
  if (existingError) throw existingError;

  const tickets = new Map();
  for (const ticket of existing || []) {
    if (!tickets.has(ticket.message_id)) tickets.set(ticket.message_id, ticket.token);
  }

  const expiresAt = new Date(Date.now() + GATEWAY_TICKET_TTL_MS).toISOString();
  const records = candidates.filter((row) => !tickets.has(row.id)).map((row) => ({
    token: randomUUID(),
    course_slug: courseSlug,
    source_id: sourceId,
    message_id: row.id,
    email,
    expires_at: expiresAt,
    purpose: "feed"
  }));
  if (records.length) {
    const { error } = await supabase.from("lms_v4_media_tickets").insert(records);
    if (error) throw error;
    for (const record of records) tickets.set(record.message_id, record.token);
  }
  return tickets;
}

function publicMedia(row, courseSlug, gatewayTicket, { includeThumbnail = true } = {}) {
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
      name: "",
      hasThumbnail: false
    };
  }
  if (!media) return null;

  let delivery = "metadata_only";
  if (media.fileId && (!media.size || media.size <= BOT_API_DOWNLOAD_LIMIT)) {
    delivery = "telegram_gateway_bot";
  } else if (MEDIA_MESSAGE_TYPES.has(row.message_type)) {
    delivery = "telegram_gateway_mtproto";
  }

  const playable = delivery === "telegram_gateway_bot" || delivery === "telegram_gateway_mtproto";
  const protectedVideo = playable && VIDEO_TYPES.has(media.type);
  const base = `/api/lms/portal?course=${encodeURIComponent(courseSlug)}&message=${encodeURIComponent(row.id)}`;
  const fallbackUrl = playable ? `${base}&endpoint=v4-telegram-media` : "";
  const gatewayUrl = delivery === "telegram_gateway_mtproto" ? mtprotoGatewayUrl() : mediaGatewayUrl();
  const directUrl = playable
    ? (gatewayTicket ? gatewayUrlWithTicket(gatewayUrl, gatewayTicket) : fallbackUrl)
    : "";
  const directThumbnailUrl = media.hasThumbnail
    ? (gatewayTicket
        ? `${thumbnailGatewayUrl()}?ticket=${encodeURIComponent(gatewayTicket)}`
        : `${base}&endpoint=v4-telegram-thumbnail`)
    : "";

  return {
    type: media.type,
    size: media.size,
    width: media.width || 0,
    height: media.height || 0,
    duration: media.duration || 0,
    mimeType: media.mimeType || "",
    name: media.name || "",
    delivery,
    url: protectedVideo ? "" : directUrl,
    fallbackUrl: protectedVideo ? "" : fallbackUrl,
    playbackRequired: protectedVideo,
    thumbnailUrl: includeThumbnail ? directThumbnailUrl : "",
    deferredThumbnailUrl: includeThumbnail ? "" : directThumbnailUrl
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

    let gatewayTickets = new Map();
    try {
      gatewayTickets = await issueGatewayTickets({
        rows,
        courseSlug,
        sourceId: mapping.source_id,
        email: access.email
      });
    } catch (error) {
      console.warn("[v4-telegram-feed] batch gateway tickets failed; using protected fallback", error?.message || error);
    }

    let remainingInitialThumbnails = INITIAL_THUMBNAIL_BUDGET;
    const posts = (rows || []).map((row) => {
      const rawMedia = pickMedia(row.raw_message, row.message_type);
      const hasThumbnail = Boolean(rawMedia?.hasThumbnail);
      const includeThumbnail = hasThumbnail && remainingInitialThumbnails > 0;
      if (includeThumbnail) remainingInitialThumbnails -= 1;
      return {
        id: row.id,
        telegramMessageId: row.source_message_id,
        mediaGroupId: row.media_group_id || "",
        type: row.message_type,
        text: row.text || row.caption || "",
        isPinned: Boolean(row.is_pinned),
        date: row.source_date || row.updated_at,
        media: publicMedia(row, courseSlug, gatewayTickets.get(row.id), { includeThumbnail })
      };
    });

    const stats = posts.reduce((acc, post) => {
      acc.total += 1;
      if (post.media?.delivery === "telegram_gateway_bot") {
        acc.playable += 1;
        acc.botGateway += 1;
      }
      if (post.media?.delivery === "telegram_gateway_mtproto") {
        acc.playable += 1;
        acc.mtprotoGateway += 1;
      }
      if (post.media && post.media.delivery === "metadata_only") acc.unavailable += 1;
      if (post.media?.thumbnailUrl) acc.initialThumbnails += 1;
      if (post.media?.deferredThumbnailUrl) acc.deferredThumbnails += 1;
      return acc;
    }, { total: 0, playable: 0, botGateway: 0, mtprotoGateway: 0, unavailable: 0, initialThumbnails: 0, deferredThumbnails: 0 });

    res.setHeader("X-V4-Initial-Thumbnails", String(stats.initialThumbnails));
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
