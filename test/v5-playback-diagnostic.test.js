import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sw = read('v5/media-sw.js');

function extract(pattern, label) {
  const match = sw.match(pattern);
  assert.ok(match, `missing ${label}`);
  return match[0];
}

test('diagnostic Range override is Preview-only and Production remains 4 MiB', () => {
  assert.match(sw, /self\.location\.hostname\.endsWith\("\.vercel\.app"\)/);
  assert.match(sw, /url\.searchParams\.get\("v5diag"\) !== "1"/);
  assert.match(sw, /new Set\(\[4, 8, 16\]\)/);

  const initial = extract(/const INITIAL_VIDEO_RANGE_BYTES = [^;]+;/, 'initial range');
  const clean = extract(/function clean\(value\) \{[\s\S]*?\n\}/, 'clean');
  const range = extract(/function playbackRange\(rawRange, mimeType, chunkBytes = INITIAL_VIDEO_RANGE_BYTES\) \{[\s\S]*?\n\}(?=\n\nasync function notifyDiagnostic)/, 'playbackRange');
  const sandbox = {};
  vm.runInNewContext(`${initial}\n${clean}\n${range}\nthis.playbackRange = playbackRange;`, sandbox);

  assert.equal(sandbox.playbackRange('bytes=0-', 'video/mp4'), 'bytes=0-4194303');
  assert.equal(sandbox.playbackRange('bytes=4194304-', 'video/mp4', 8 * 1024 * 1024), 'bytes=4194304-12582911');
  assert.equal(sandbox.playbackRange('bytes=4194304-', 'video/mp4', 16 * 1024 * 1024), 'bytes=4194304-20971519');
  assert.equal(sandbox.playbackRange('bytes=100-199', 'video/mp4', 16 * 1024 * 1024), 'bytes=100-199');
});

test('diagnostic page records browser/player, lease, Range, TTFB, throughput and retry fields locally', () => {
  const html = read('v5/playback-diagnostic.html');
  const client = read('v5/playback-diagnostic.js');
  assert.match(html, /V5 Sustained Playback Diagnostic/);
  assert.match(client, /browserRangePattern/);
  assert.match(client, /workerTtfbMs/);
  assert.match(client, /throughputMiBs/);
  assert.match(client, /retries401_403_410/);
  assert.match(client, /video:stall-complete/);
  assert.match(client, /bufferedAhead/);
  assert.match(client, /readyState/);
  assert.match(client, /networkState/);
  assert.doesNotMatch(client, /playbackLease|Authorization|privateKey|signature/i);
});
