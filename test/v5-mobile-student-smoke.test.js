import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V5 student renderer keeps the mobile playback contract', () => {
  const html = read('v5/index.html');
  const css = read('v5/styles.css');
  const app = read('v5/app.js');
  assert.match(html, /name="viewport"\s+content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(app, /video\.playsInline = true; video\.preload = 'none'/);
  assert.doesNotMatch(app, /<video[^>]+\ssrc=/);
  assert.match(app, /data-v5-start/);
  assert.match(app, /video\.src = mediaUrl\(cell\.dataset\.assetId\)/);
  assert.match(app, /if \(activeVideo\) releaseVideo\(activeVideo\)/);
  assert.match(app, /navigator\.serviceWorker\.register\('\/v5\/media-sw\.js'/);
  assert.match(app, /credentials: 'include'/);
});

test('V5 media service worker preserves byte-range playback on mobile browsers', () => {
  const sw = read('v5/media-sw.js');
  assert.match(sw, /playbackRange\(request\.headers\.get\("range"\), lease\.mimeType\)/);
  assert.match(sw, /if \(range\) headers\.set\("Range", range\)/);
  assert.match(sw, /"content-range"/);
  assert.match(sw, /"accept-ranges"/);
  assert.match(sw, /"retry-after"/);
  assert.match(sw, /credentials:\s*"omit"/);
  assert.match(sw, /\[401, 403, 410\]\.includes\(upstream\.status\)/);
});

test('Unified My Courses exposes V5 and routes ready students through learning', () => {
  const html = read('my-courses.html');
  assert.match(html, /\['lms','v4','v5'\]\.includes/);
  assert.match(html, /mode==='v5'\?'LMS V5'/);
  assert.match(html, /mode==='v5'\?`\/learning\?course=\$\{encodeURIComponent\(c\.slug\)\}`/);
  assert.match(html, /@media\(max-width:420px\)/);
});

test('Learning router sends only V5 courses through the isolated V5 worker bootstrap', () => {
  const learning = read('api/learning.js');
  const bootstrap = read('v5-sw-bootstrap.html');
  assert.match(learning, /const requestedV5 = deliveryMode === "v5"/);
  assert.match(learning, /requestedV5\s*\?\s*"\/v5-sw-bootstrap\.html"/);
  assert.match(bootstrap, /const target = '\/v5\/' \+ location\.search \+ location\.hash/);
  assert.match(learning, /res\.redirect\(307, target \+ \(qs \? `\?\$\{qs\}` : ""\)\)/);
});
