import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const feed = readFileSync(new URL('../utils/lms-handlers/v4-telegram-feed.js', import.meta.url), 'utf8');
const play = readFileSync(new URL('../utils/lms-handlers/v4-telegram-play.js', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../api/lms/portal.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../v4.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../v4-media-sw.js', import.meta.url), 'utf8');

test('V4 feed marks feed tickets and does not expose direct video URL', () => {
  assert.match(feed, /purpose:\s*"feed"/);
  assert.match(feed, /playbackRequired:\s*protectedVideo/);
  assert.match(feed, /url:\s*protectedVideo\s*\?\s*""\s*:\s*directUrl/);
});

test('V4 play endpoint issues ephemeral ECDSA-bound playback leases', () => {
  assert.match(play, /purpose:\s*"playback"/);
  assert.match(play, /generateKeyPairSync\("ec"/);
  assert.match(play, /playback_public_key_jwk:\s*publicKeyJson/);
  assert.match(play, /signingKey:\s*keys\.privateJwk/);
  assert.match(play, /bound_ua_hash/);
  assert.match(play, /bound_ip_hash/);
});

test('portal exposes the protected play endpoint without adding a top-level function', () => {
  assert.match(portal, /v4-telegram-play/);
  assert.match(portal, /v4TelegramPlayHandler/);
});

test('V4 player uses a service-worker virtual URL, hides download controls, and does not display student email watermark', () => {
  assert.match(page, /navigator\.serviceWorker\.register\('\/v4-media-sw\.js/);
  assert.match(page, /endpoint=v4-telegram-play/);
  assert.match(page, /video\.src='\/v4-media\/'/);
  assert.match(page, /nodownload noremoteplayback/);
  assert.match(page, /mark\.hidden=true/);
  assert.doesNotMatch(page, /mark\.textContent=\(lease\.email\|\|data\?\.email/);
});

test('service worker keeps gateway token/key out of video src and signs each upstream request', () => {
  assert.match(worker, /crypto\.subtle\.importKey/);
  assert.match(worker, /crypto\.subtle\.sign/);
  assert.match(worker, /Authorization/);
  assert.match(worker, /X-V4-Playback-Timestamp/);
  assert.match(worker, /X-V4-Playback-Nonce/);
  assert.match(worker, /X-V4-Playback-Signature/);
  assert.match(worker, /MEDIA_PREFIX = "\/v4-media\/"/);
});
