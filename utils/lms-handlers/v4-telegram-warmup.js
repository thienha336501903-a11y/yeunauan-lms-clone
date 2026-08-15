import { randomUUID } from "node:crypto";
import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import {
  BOT_API_DOWNLOAD_LIMIT,
  findWarmupVideoMessages,
  telegramVideoMessageTypes
} from "../v4-telegram-media-meta.js";

const DEFAULT_MEDIA_GATEWAY = "https://telegram-channel-cloner.vercel.app/api/telegram/media?prepare=1";
const DEFAULT_MTPROTO_GATEWAY = "https://telegram-channel-cloner.vercel.app/api/telegram/warmup?prepare=1";
const TICKET_TTL_MS = 2 * 60 * 1000;
const WARMUP_TIMEOUT_MS = 20 * 1000;
const WARMUP_CONCURRENCY = 2;

function mtprotoGatewayUrl() {
  const configured = String(process.env.TELEGRAM_MTPROTO_GATEWAY_URL || "").trim().replace(/\/$/, "");
  if (!configured) return DEFAULT_MTPROTO_GATEWAY;
  if (/[?&]prepare=1(?:&|$)/.test(configured)) return configured;
  return configured.includes("?") ? `${configured}&prepare=1` : `${configured}?prepare=1`;
}

function mediaGatewayUrl() {
  const configured = String(process.env.TELEGRAM_MEDIA_GATEWAY_URL || "").trim().replace(/\/$/, "");
  if (!configured) return DEFAULT_MEDIA_GATEWAY;
  if (/[?&]prepare=1(?:&|$)/.test(configured)) return configured;
  return configured.includes("?") ? `${configured}&prepare=1` : `${configured}?prepare=1`;
}

function gatewayUrlWithTicket(url, ticket) {
  return `${url}${url.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
}

async function allSettledInBatches(items, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += WARMUP_CONCURRENCY) {
    const batch = items.slice(index, index + WARMUP_CONCURRENCY);
    results.push(...await Promise.allSettled(batch.map(worker)));
  }
  return results;
}

async function cleanupWarmupTickets(tickets) {
  const tokens = tickets.map((ticket) => ticket.token).filter(Boolean);
  if (!tokens.length) return;
  const { error } = await supabase
    .from("lms_v4_media_tickets")
    .delete()
    .in("token", tokens);
  if (error) console.warn("[v4-telegram-warmup] ticket cleanup failed", error.message || error);
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
      .select("id,source_id,source_message_id,message_type,raw_message")
      .eq("source_id", mapping.source_id)
      .in("message_type", telegramVideoMessageTypes())
      .order("source_message_id", { ascending: true })
      .limit(2000);
    if (rowsError) throw rowsError;

    const warmupRows = findWarmupVideoMessages(rows);
    if (!warmupRows.length) {
      res.setHeader("X-Media-Warmup", "skipped-no-video");
      res.setHeader("X-MTProto-Warmup", "skipped-no-video");
      return res.status(204).end();
    }

    const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
    const tickets = warmupRows.map((row) => ({
      token: randomUUID(),
      course_slug: courseSlug,
      source_id: mapping.source_id,
      message_id: row.id,
      email: access.email,
      expires_at: expiresAt,
      size: Number(row.raw_message?.[row.message_type === "video_note" ? "video_note" : row.message_type]?.file_size || 0)
    }));
    const { error: ticketError } = await supabase
      .from("lms_v4_media_tickets")
      .insert(tickets.map(({ size, ...ticket }) => ticket));
    if (ticketError) throw ticketError;

    const upstreams = await allSettledInBatches(tickets, async (ticket) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
      const gateway = ticket.size > BOT_API_DOWNLOAD_LIMIT ? mtprotoGatewayUrl() : mediaGatewayUrl();
      try {
        return await fetch(gatewayUrlWithTicket(gateway, ticket.token), {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
    });

    const ready = upstreams.flatMap((result, index) => (
      result.status === "fulfilled" && result.value.ok
        ? [{ response: result.value, ticket: tickets[index] }]
        : []
    ));
    await cleanupWarmupTickets(tickets);

    const timings = ready.map(({ response }) => response.headers.get("server-timing")).filter(Boolean);
    if (timings.length) res.setHeader("Server-Timing", timings.join(", "));
    const transports = ready.map(({ response }) => response.headers.get("x-telegram-media-transport")).filter(Boolean);
    if (transports.length) res.setHeader("X-Telegram-Media-Transport", transports.join(","));
    res.setHeader("X-Media-Warmup-Count", `${ready.length}/${tickets.length}`);

    if (!ready.length) {
      console.warn("[v4-telegram-warmup] all upstream warm-ups failed");
      return res.status(502).json({ success: false, code: "warmup_gateway_failed" });
    }
    if (ready.length !== tickets.length) {
      console.warn("[v4-telegram-warmup] partial upstream warm-up", ready.length, tickets.length);
    }

    const hasMtproto = tickets.some((ticket) => ticket.size > BOT_API_DOWNLOAD_LIMIT);
    const mtprotoReady = ready.some(({ ticket }) => ticket.size > BOT_API_DOWNLOAD_LIMIT);
    res.setHeader("X-Media-Warmup", ready.length === tickets.length ? "ready" : "partial");
    res.setHeader("X-MTProto-Warmup", hasMtproto ? (mtprotoReady ? "ready" : "failed") : "skipped-bot-api-only");
    return res.status(204).end();
  } catch (error) {
    console.error("[v4-telegram-warmup]", error?.name || "Error", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
