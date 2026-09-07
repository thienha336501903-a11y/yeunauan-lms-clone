import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../v5/index.html', import.meta.url), 'utf8');

test('V5 course render does not attach video sources before an explicit Play action', () => {
  assert.match(html, /<video controls playsinline preload="none"/);
  assert.match(html, /data-v5-video data-src="\$\{esc\(url\)\}"/);
  assert.doesNotMatch(html, /<video[^>]+\ssrc=/);
  assert.match(html, /data-v5-start/);
  assert.match(html, /\$\('feed'\)\.addEventListener\('click'/);
  assert.match(html, /video\.setAttribute\('src',video\.dataset\.src\)/);
});

test('V5 keeps at most one active video source and releases it on navigation', () => {
  assert.match(html, /if\(activeVideo&&activeVideo!==video\)releaseVideo\(activeVideo\)/);
  assert.match(html, /video\.pause\(\)/);
  assert.match(html, /video\.removeAttribute\('src'\)/);
  assert.match(html, /video\.load\(\)/);
  assert.match(html, /addEventListener\('pagehide',\(\)=>releaseVideo\(activeVideo\)\)/);
});

test('V5 groups posts once instead of rescanning every post for every lesson', () => {
  assert.match(html, /postsByLesson=new Map\(\)/);
  assert.match(html, /postsByLesson\.get\(lesson\.id\)\|\|\[\]/);
  assert.doesNotMatch(html, /posts\.filter\(p=>p\.lesson_id===lesson\.id\)/);
});
