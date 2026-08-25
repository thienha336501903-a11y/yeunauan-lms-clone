import { randomUUID } from "node:crypto";
import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import {
  findMtprotoVideoMessage,
  telegramVideoMessageTypes
} from "../v4-telegram-media-meta.js";
import { cloneConfig } from "../clone-config.js";

const TICKET_TTL_MS = 2 * 60 * 1000;
const WARMUP_TIMEOUT_MS = 20 * 1000;
const WARMUP_DEFER_MS = 1800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mtprotoPrepareGatewayUrl() {
  const configured = String(process.env.TELEGRAM_MTPROTO_GATEWAY_URL || "").trim();
  const base = configured || `${cloneConfig().telegramMtprotoGatewayUrl}?prepare=1`;
  try {
    const url = new URL(base);
    url.searchParams.delete("stream");
    url.searchParams.set("prepare", "1");
    return url.toString();
  } catch {
    const clean = base.replace(/\/$/, "").replace(/([?&])stream=1(?:&|$)/, "$1").replace(/[?&]$/, "");
    if (/[?&]prepare=1(?:&|$)/.test(clean)) return clean;
    return clean.includes("?") ? `${clean}&prepare=1` : `${clean}?prepare=1`;
  }
}

function gatewayUrlWithTicket(url, ticket) {
  return `${url}${url.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
}

async function cleanupWarmupTicket(token) {
  if (!token) return;
  const { error } = await supabase
    .from("lms_v4_media_tickets")
    .delete()
    .eq("token", token);
  if (error) console.warn("[v4-telegram-warmup] ticket cleanup failed", error.message || error);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  let warmupToken = "";
  try {
    await sleep(WARMUP_DEFER_MS);

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
      .select("id,source_id,source_message_id,message_type,raw_message")
      .eq("source_id", mapping.source_id)
      .in("message_type", telegramVideoMessageTypes())
      .order("source_message_id", { ascending: true })
      .limit(2000);
    if (rowsError) throw rowsError;

    const row = findMtprotoVideoMessage(rows);
    if (!row) {
      res.setHeader("X-MTProto-Warmup", "skipped-no-mtproto-video");
      return res.status(204).end();
    }

    warmupToken = randomUUID();
    const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
    const { error: ticketError } = await supabase
      .from("lms_v4_media_tickets")
      .insert({
        token: warmupToken,
        course_slug: courseSlug,
        source_id: mapping.source_id,
        message_id: row.id,
        email: access.email,
        expires_at: expiresAt,
        purpose: "warmup"
      });
    if (ticketError) throw ticketError;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(gatewayUrlWithTicket(mtprotoPrepareGatewayUrl(), warmupToken), {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const timing = upstream.headers.get("server-timing");
    if (timing) res.setHeader("Server-Timing", timing);
    const transport = upstream.headers.get("x-telegram-media-transport");
    if (transport) res.setHeader("X-Telegram-Media-Transport", transport);
    const layout = upstream.headers.get("x-mp4-layout");
    if (layout) res.setHeader("X-MP4-Layout", layout);
    const cacheSource = upstream.headers.get("x-mp4-index-cache");
    if (cacheSource) res.setHeader("X-MP4-Index-Cache", cacheSource);

    if (!upstream.ok) {
      console.warn("[v4-telegram-warmup] MTProto prepare failed", upstream.status);
      res.setHeader("X-MTProto-Warmup", "failed");
      return res.status(502).json({ success: false, code: "warmup_gateway_failed" });
    }

    res.setHeader("X-MTProto-Warmup", "ready");
    res.setHeader("X-Media-Warmup-Count", "1/1");
    return res.status(204).end();
  } catch (error) {
    console.error("[v4-telegram-warmup]", error?.name || "Error", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error" });
  } finally {
    await cleanupWarmupTicket(warmupToken);
  }
}
