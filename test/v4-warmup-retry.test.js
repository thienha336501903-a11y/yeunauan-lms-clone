import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const warmup = readFileSync(new URL("../utils/lms-handlers/v4-telegram-warmup.js", import.meta.url), "utf8");

test("V4 targeted warm-up retries one transient gateway failure", () => {
  assert.match(warmup, /WARMUP_MAX_ATTEMPTS = 2/);
  assert.match(warmup, /WARMUP_RETRY_DELAY_MS = 350/);
  assert.match(warmup, /retryableWarmupStatus/);
  assert.match(warmup, /\[500, 502, 503, 504\]/);
  assert.match(warmup, /attempt < WARMUP_MAX_ATTEMPTS/);
  assert.match(warmup, /X-Media-Warmup-Attempts/);
  assert.match(warmup, /prepare retry/);
});

test("V4 warm-up does not retry non-transient gateway statuses", () => {
  assert.match(warmup, /retryableWarmupStatus\(upstream\?\.status\)/);
  assert.doesNotMatch(warmup, /\[400, 401, 403, 404, 409, 422\]/);
});
