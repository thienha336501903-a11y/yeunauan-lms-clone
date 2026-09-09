import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sw = fs.readFileSync(new URL('../v5/media-sw.js', import.meta.url), 'utf8');
const warm = fs.readFileSync(new URL('../v5/media-warm.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../v5/index.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../cloudflare/v5-media-worker/src/index.js', import.meta.url), 'utf8');

test('V5 warms only playback leases before Play and does not preload media bytes', () => {
  assert.match(index, /\/v5\/media-warm\.js/);
  assert.match(warm, /postMessage\(\{ type: WARM_MESSAGE, course: COURSE, assetId \}\)/);
  assert.match(warm, /rootMargin: '700px 0px'/);
  assert.doesNotMatch(warm, /fetch\s*\(/);
  assert.doesNotMatch(warm, /\.src\s*=\s*mediaUrl/);
});

test('V5 service worker prewarms proof identity and deduplicates concurrent lease issuance', () => {
  assert.match(sw, /proofIdentity\(\)\.catch\(\(\) => null\)/);
  assert.match(sw, /const leaseRequests = new Map\(\)/);
  assert.match(sw, /leaseRequests\.has\(key\)/);
  assert.match(sw, /data\.type !== "v5-warm-lease"/);
  assert.match(sw, /event\.waitUntil\(fetchLease\(course, assetId, false\)/);
});

test('V5 bounds synthesized and browser open-ended video ranges instead of requesting the whole object', () => {
  assert.match(sw, /const INITIAL_VIDEO_RANGE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(sw, /`bytes=0-\$\{INITIAL_VIDEO_RANGE_BYTES - 1\}`/);
  assert.ok(sw.includes('const openEnded = value.match(/^bytes=(\\d+)-$/i);'));
  assert.ok(sw.includes('return `bytes=${start}-${end}`;'));
  assert.doesNotMatch(sw, /if \(value\) return value;/);
  assert.doesNotMatch(sw, /\? "bytes=0-" : ""/);
});

test('V5 Worker permits browser preflight caching without weakening media cache policy', () => {
  assert.match(worker, /"Access-Control-Max-Age": "3600"/);
  assert.match(worker, /"Cache-Control": "private, no-store"/);
});
