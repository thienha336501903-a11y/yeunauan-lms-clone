import { randomUUID } from "node:crypto";
import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { findMtprotoVideoMessage, telegramVideoMessageTypes } from "../v4-telegram-media-meta.js";

const DEFAULT_MTPROTO_GATEWAY = "https://telegram-channel-cloner.vercel.app/api/telegram/warmup?stream=1";
const TICKET_TTL_MS = 2 * 60 * 1000;
const WARMUP_TIMEOUT_MS = 20 * 1000;

function mtprotoGatewayUrl() {
  const configured = String(process.env.TELEGRAM_MTPROTO_GATEWAY_URL || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_MTPROTO_GATEWAY;
}

function gatewayUrlWithTicket(url, ticket) {
  return `${url}${url.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const courseSlug = String(req.query?.course || "").trim();
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, code: access.code, error: access.error });
    }

    const { data: mapping, error: mappingError } = await supabase
      .from("lms_v4_telegram_course_sources")
      .select("source_id,enabled")
      .eq("course_slug", courseSlug)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping?.enabled) {
      res.setHeader("X-MTProto-Warmup", "skipped-no-source");
      return res.status(204).end();
    }

    const { data: rows, error: rowsError } = await supabase
      .from("tgcloner_source_messages")
      .select("id,source_id,message_type,raw_message")
      .eq("source_id", mapping.source_id)
      .in("message_type", telegramVideoMessageTypes())
      .limit(2000);
    if (rowsError) throw rowsError;

    const row = findMtprotoVideoMessage(rows);
    if (!row) {
      res.setHeader("X-MTProto-Warmup", "skipped-bot-api-only");
      return res.status(204).end();
    }

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
    let upstream;
    try {
      const url = gatewayUrlWithTicket(mtprotoGatewayUrl(), token);
      upstream = await fetch(url, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const serverTiming = upstream.headers.get("server-timing");
    if (serverTiming) res.setHeader("Server-Timing", serverTiming);
    const transport = upstream.headers.get("x-telegram-media-transport");
    if (transport) res.setHeader("X-Telegram-Media-Transport", transport);
    if (!upstream.ok) {
      console.warn("[v4-telegram-warmup] upstream rejected warm-up", upstream.status);
      return res.status(502).json({ success: false, code: "warmup_gateway_failed" });
    }

    res.setHeader("X-MTProto-Warmup", "ready");
    return res.status(204).end();
  } catch (error) {
    console.error("[v4-telegram-warmup]", error?.name || "Error", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
