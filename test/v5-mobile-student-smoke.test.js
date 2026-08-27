import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V5 student renderer keeps the mobile playback contract', () => {
  const html = read('v5/index.html');
  assert.match(html, /name="viewport"\s+content="width=device-width,initial-scale=1"/);
  assert.match(html, /@media\(max-width:640px\)/);
  assert.match(html, /<video controls playsinline preload="metadata"/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/v5\/media-sw\.js'/);
  assert.match(html, /credentials:'include'/);
});

test('V5 media service worker preserves byte-range playback on mobile browsers', () => {
  const sw = read('v5/media-sw.js');
  assert.match(sw, /headers\.set\("Range", playbackRange\(request\.headers\.get\("range"\)\)\)/);
  assert.match(sw, /"content-range"/);
  assert.match(sw, /"accept-ranges"/);
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

test('Learning router sends only V5 courses to the isolated V5 renderer', () => {
  const learning = read('api/learning.js');
  assert.match(learning, /const requestedV5 = deliveryMode === "v5"/);
  assert.match(learning, /requestedV5\s*\?\s*"\/v5\/"/);
  assert.match(learning, /res\.redirect\(307, target \+ \(qs \? `\?\$\{qs\}` : ""\)\)/);
});
