import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const play = fs.readFileSync(new URL('../utils/lms-handlers/v4-telegram-play.js', import.meta.url), 'utf8');

test('V4 playback tickets do not bind to client IP', () => {
  assert.match(play, /bound_ip_hash:\s*null/);
  assert.doesNotMatch(play, /function requestIp\(/);
  assert.doesNotMatch(play, /const ip = requestIp\(req\)/);
});

test('V4 playback keeps stronger request binding protections', () => {
  assert.match(play, /bound_ua_hash:/);
  assert.match(play, /playback_public_key_jwk:/);
  assert.match(play, /playback_proof_hash:/);
});
