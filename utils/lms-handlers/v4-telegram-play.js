import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { supabase } from "../supabase.js";
import { maybeCleanupExpiredV4MediaTickets } from "../v4-media-ticket-retention.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { cloneConfig } from "../clone-config.js";

const VIDEO_TYPES = new Set(["video", "animation", "video_note"]);
const MIN_LEASE_MS = 20 * 60 * 1000;
const MAX_LEASE_MS = 2 * 60 * 60 * 1000;
const LEASE_GRACE_MS = 10 * 60 * 1000;

function clean(value) {
  return String(value || "").trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function mediaGatewayUrl() {
  return clean(process.env.TELEGRAM_MEDIA_GATEWAY_URL || "").replace(/\/$/, "") || cloneConfig().telegramMediaGatewayUrl;
}

function pickVideo(raw, messageType) {
  if (!VIDEO_TYPES.has(messageType)) return null;
  const value = raw && typeof raw === "object" ? raw : {};
  const key = messageType === "video_note" ? "video_note" : messageType;
  const item = value[key] && typeof value[key] === "object" ? value[key] : null;
  if (!item) return null;
  return {
    duration: Number(item.duration || 0),
    size: Number(item.file_size || 0)
  };
}

function leaseTtlMs(durationSeconds) {
  const requested = Math.max(0, Number(durationSeconds || 0)) * 2000 + LEASE_GRACE_MS;
  return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, requested));
}

function createPlaybackKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicJwk: publicKey.export({ format: "jwk" }),
    privateJwk: privateKey.export({ format: "jwk" })
  };
}

function scheduleTicketCleanup() {
  void maybeCleanupExpiredV4MediaTickets(supabase).then((result) => {
    if (result.error) console.warn("[v4-media-ticket-retention]", result.error);
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const courseSlug = clean(req.query?.course || req.body?.course);
    const messageRowId = clean(req.body?.message || req.query?.message);
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, code: access.code, error: access.error });
    }
    if (!messageRowId) {
      return res.status(400).json({ success: false, code: "missing_message", error: "Thiếu bài đăng Telegram" });
    }

    const { data: mapping, error: mappingError } = await supabase
      .from("lms_v4_telegram_course_sources")
      .select("source_id,enabled")
      .eq("course_slug", courseSlug)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping?.enabled) {
      return res.status(404).json({ success: false, code: "v4_source_not_enabled", error: "Nguồn Telegram V4 chưa bật" });
    }

    const { data: row, error: rowError } = await supabase
      .from("tgcloner_source_messages")
      .select("id,source_id,message_type,raw_message")
      .eq("id", messageRowId)
      .eq("source_id", mapping.source_id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) {
      return res.status(404).json({ success: false, code: "message_not_found", error: "Không tìm thấy video" });
    }

    const video = pickVideo(row.raw_message, row.message_type);
    if (!video) {
      return res.status(409).json({ success: false, code: "video_required", error: "Media này không phải video" });
    }

    scheduleTicketCleanup();

    const token = randomUUID();
    const leaseId = randomUUID();
    const keys = createPlaybackKeyPair();
    const publicKeyJson = JSON.stringify(keys.publicJwk);
    const expiresAt = new Date(Date.now() + leaseTtlMs(video.duration)).toISOString();
    const userAgent = clean(req.headers?.["user-agent"]);

    const { error: ticketError } = await supabase
      .from("lms_v4_media_tickets")
      .insert({
        token,
        course_slug: courseSlug,
        source_id: mapping.source_id,
        message_id: row.id,
        email: access.email,
        expires_at: expiresAt,
        purpose: "playback",
        playback_public_key_jwk: publicKeyJson,
        playback_proof_hash: publicKeyJson,
        bound_ua_hash: userAgent ? sha256(userAgent) : null,
        bound_ip_hash: null
      });
    if (ticketError) throw ticketError;

    return res.status(200).json({
      success: true,
      leaseId,
      token,
      signingKey: keys.privateJwk,
      proof: keys.privateJwk,
      gateway: mediaGatewayUrl(),
      expiresAt,
      email: access.email
    });
  } catch (error) {
    console.error("[v4-telegram-play]", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
