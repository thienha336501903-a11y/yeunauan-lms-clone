import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findMtprotoVideoMessage, findWarmupVideoMessages } from "../utils/v4-telegram-media-meta.js";

const MiB = 1024 * 1024;

function videoRow(size, overrides = {}) {
  return {
    id: overrides.id || `video-${size}`,
    message_type: overrides.message_type || "video",
    raw_message: {
      [overrides.message_type || "video"]: {
        file_id: overrides.file_id === undefined ? "telegram-file-id" : overrides.file_id,
        file_size: size
      }
    }
  };
}

test("does not warm Bot API videos at or below 20 MiB", () => {
  assert.equal(findMtprotoVideoMessage([videoRow(20 * MiB)]), null);
  assert.equal(findMtprotoVideoMessage([videoRow(8 * MiB)]), null);
});

test("selects one video above the Bot API limit", () => {
  const small = videoRow(3 * MiB, { id: "small" });
  const large = videoRow(20 * MiB + 1, { id: "large" });
  assert.equal(findMtprotoVideoMessage([small, large])?.id, "large");
});

test("ignores non-video documents even when they are large", () => {
  const document = {
    id: "document",
    message_type: "document",
    raw_message: { document: { file_id: "document-id", file_size: 50 * MiB } }
  };
  assert.equal(findMtprotoVideoMessage([document]), null);
});

test("supports Telegram video notes", () => {
  const note = videoRow(25 * MiB, { id: "note", message_type: "video_note" });
  assert.equal(findMtprotoVideoMessage([note])?.id, "note");
});

test("selects only one MTProto video for one background warm-up", () => {
  const first = videoRow(24 * MiB, { id: "first" });
  const second = videoRow(30 * MiB, { id: "second" });
  assert.equal(findMtprotoVideoMessage([first, second])?.id, "first");
});

test("warms a bounded near-start window with two videos per transport", () => {
  const firstBot = videoRow(19 * MiB, { id: "first-bot" });
  const secondBot = videoRow(8 * MiB, { id: "second-bot" });
  const thirdBot = videoRow(6 * MiB, { id: "third-bot" });
  const firstMtproto = videoRow(25 * MiB, { id: "first-mtproto" });
  const secondMtproto = videoRow(30 * MiB, { id: "second-mtproto" });
  const thirdMtproto = videoRow(35 * MiB, { id: "third-mtproto" });
  assert.deepEqual(
    findWarmupVideoMessages([
      firstBot,
      secondBot,
      thirdBot,
      firstMtproto,
      secondMtproto,
      thirdMtproto
    ]).map((row) => row.id),
    ["first-bot", "second-bot", "first-mtproto", "second-mtproto"]
  );
});

test("warm window honors a smaller total budget", () => {
  const rows = [
    videoRow(19 * MiB, { id: "bot-1" }),
    videoRow(8 * MiB, { id: "bot-2" }),
    videoRow(25 * MiB, { id: "mtproto-1" }),
    videoRow(30 * MiB, { id: "mtproto-2" })
  ];
  assert.deepEqual(
    findWarmupVideoMessages(rows, { maxTotal: 3, maxPerTransport: 2 }).map((row) => row.id),
    ["bot-1", "bot-2", "mtproto-1"]
  );
});

test("V4 unauthenticated flow returns to V4 after the existing student login", () => {
  const v4 = readFileSync(new URL("../v4.html", import.meta.url), "utf8");
  const entry = readFileSync(new URL("../v3-entry.html", import.meta.url), "utf8");

  assert.match(v4, /\/v3\?return=v4&course=/);
  assert.match(entry, /returnToV4=qs\.get\('return'\)==='v4'/);
  assert.match(entry, /returnToV4\?'\/v4\.html\?course='/);
});

test("V4 feed sends large video tickets directly to MTProto streaming", () => {
  const feed = readFileSync(new URL("../utils/lms-handlers/v4-telegram-feed.js", import.meta.url), "utf8");

  assert.match(feed, /DEFAULT_MEDIA_GATEWAY = .*\/api\/telegram\/media/);
  assert.match(feed, /DEFAULT_MTPROTO_GATEWAY = .*\/api\/telegram\/warmup\?stream=1/);
  assert.match(feed, /delivery === "telegram_gateway_mtproto" \? mtprotoGatewayUrl\(\) : mediaGatewayUrl\(\)/);
  assert.match(feed, /url\.includes\("\?"\) \? "&" : "\?"/);
});

test("V4 starts non-blocking warm-up alongside feed and preconnects the gateway", () => {
  const v4 = readFileSync(new URL("../v4.html", import.meta.url), "utf8");
  const warmAt = v4.indexOf("warmMtprotoInBackground();try{const r=await fetch('/api/lms/portal?endpoint=v4-telegram-feed");

  assert.ok(warmAt > 0);
  assert.match(v4, /rel="preconnect" href="https:\/\/telegram-channel-cloner\.vercel\.app" crossorigin/);
  assert.doesNotMatch(v4, /render\(d\);if\(Number\(d\.stats\?\.mtprotoGateway/);
});

test("LMS Functions run near Vietnam, Supabase Asia, and the Cloner", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

  assert.deepEqual(config.regions, ["sin1"]);
});

test("MTProto warm-up skips the media redirect and limits concurrency", () => {
  const warmup = readFileSync(new URL("../utils/lms-handlers/v4-telegram-warmup.js", import.meta.url), "utf8");

  assert.match(warmup, /DEFAULT_MTPROTO_GATEWAY = .*\/api\/telegram\/warmup\?prepare=1/);
  assert.match(warmup, /DEFAULT_MEDIA_GATEWAY = .*\/api\/telegram\/media\?prepare=1/);
  assert.match(warmup, /ticket\.size > BOT_API_DOWNLOAD_LIMIT \? mtprotoGatewayUrl\(\) : mediaGatewayUrl\(\)/);
  assert.match(warmup, /Promise\.allSettled/);
  assert.match(warmup, /WARMUP_CONCURRENCY = 2/);
  assert.match(warmup, /X-Media-Warmup-Count/);
  assert.match(warmup, /cleanupWarmupTickets/);
});

test("V4 manually limits eager thumbnail requests", () => {
  const v4 = readFileSync(new URL("../v4.html", import.meta.url), "utf8");

  assert.match(v4, /img data-lazy-src=/);
  assert.match(v4, /images\.slice\(0,2\)/);
  assert.match(v4, /rootMargin:'240px 0px'/);
  assert.doesNotMatch(v4, /img loading="lazy" src=/);
});
