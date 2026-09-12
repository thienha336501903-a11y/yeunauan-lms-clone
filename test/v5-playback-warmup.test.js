import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sw = fs.readFileSync(new URL('../v5/media-sw.js', import.meta.url), 'utf8');
const warm = fs.readFileSync(new URL('../v5/media-warm.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../v5/media-bootstrap.js', import.meta.url), 'utf8');
const entryBootstrap = fs.readFileSync(new URL('../v5-sw-bootstrap.html', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../v5/index.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../cloudflare/v5-media-worker/src/index.js', import.meta.url), 'utf8');

test('V5 warms only playback leases before Play and does not preload media bytes', () => {
  assert.match(index, /\/v5\/media-warm\.js/);
  assert.match(warm, /postMessage\(\{ type: WARM_MESSAGE, course: COURSE, assetId \}/);
  assert.match(warm, /rootMargin: '700px 0px'/);
  assert.match(warm, /const IMMEDIATE_WARM_BUDGET = 2/);
  assert.match(warm, /warmFirstVideoCells\(\)/);
  assert.doesNotMatch(warm, /fetch\s*\(/);
  assert.doesNotMatch(warm, /\.src\s*=\s*mediaUrl/);
});

test('V5 waits for confirmed lease warmup and retries instead of marking a failed warm as ready', () => {
  assert.match(warm, /const warming = new Map\(\)/);
  assert.match(warm, /new MessageChannel\(\)/);
  assert.match(warm, /event\.data\?\.ok === true/);
  assert.match(warm, /warmed\.add\(assetId\)/);
  assert.match(warm, /if \(!controller\) return false/);
  assert.match(warm, /warming\.delete\(assetId\)/);
});

test('V5 service worker prewarms proof identity and deduplicates concurrent lease issuance', () => {
  assert.match(sw, /proofIdentity\(\)\.catch\(\(\) => null\)/);
  assert.match(sw, /const leaseRequests = new Map\(\)/);
  assert.match(sw, /leaseRequests\.has\(key\)/);
  assert.match(sw, /data\.type !== "v5-warm-lease"/);
  assert.match(sw, /const task = fetchLease\(course, assetId, false\)/);
  assert.match(sw, /reply\?\.postMessage\(\{ ok: true \}\)/);
  assert.match(sw, /event\.waitUntil\(task\)/);
});

test('V5 uses a smaller first video range while keeping steady-state chunks bounded', () => {
  assert.match(sw, /const STARTUP_VIDEO_RANGE_BYTES = 1 \* 1024 \* 1024/);
  assert.match(sw, /const STEADY_VIDEO_RANGE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(sw, /start === 0 \? STARTUP_VIDEO_RANGE_BYTES : STEADY_VIDEO_RANGE_BYTES/);
  assert.match(sw, /`bytes=0-\$\{STARTUP_VIDEO_RANGE_BYTES - 1\}`/);
  assert.ok(sw.includes('const openEnded = value.match(/^bytes=(\\d+)-$/i);'));
  assert.ok(sw.includes('return `bytes=${start}-${end}`;'));
  assert.doesNotMatch(sw, /if \(value\) return value;/);
  assert.doesNotMatch(sw, /\? "bytes=0-" : ""/);
});

test('V5 normal course entry activates the media worker before entering its scope', () => {
  assert.match(entryBootstrap, /register\('\/v5\/media-sw\.js', \{ scope: '\/v5\/', updateViaCache: 'none' \}\)/);
  assert.match(entryBootstrap, /registration\.active/);
  assert.match(entryBootstrap, /worker\.state === 'activated'/);
  assert.match(entryBootstrap, /setTimeout\(finish, 1800\)/);
  assert.match(entryBootstrap, /const target = '\/v5\/' \+ location\.search \+ location\.hash/);
  assert.match(entryBootstrap, /location\.replace\(target\)/);
  assert.doesNotMatch(entryBootstrap, /\/v5\/media\//);
  assert.doesNotMatch(entryBootstrap, /fetch\s*\(/);
});

test('V5 direct-entry bootstrap reloads once immediately after an active worker exists', () => {
  assert.match(index, /\/v5\/media-bootstrap\.js[\s\S]*\/v5\/app\.js/);
  assert.match(bootstrap, /navigator\.serviceWorker\.register\('\/v5\/media-sw\.js'/);
  assert.match(bootstrap, /await navigator\.serviceWorker\.ready/);
  assert.match(bootstrap, /navigator\.serviceWorker\.controller/);
  assert.match(bootstrap, /sessionStorage\.getItem\(RELOAD_GUARD\)/);
  assert.match(bootstrap, /location\.reload\(\)/);
  assert.doesNotMatch(bootstrap, /setTimeout\(finish, 1500\)/);
});

test('V5 Worker permits browser preflight caching without weakening media cache policy', () => {
  assert.match(worker, /"Access-Control-Max-Age": "3600"/);
  assert.match(worker, /"Cache-Control": "private, no-store"/);
});
