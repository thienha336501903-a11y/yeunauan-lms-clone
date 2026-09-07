import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../v5/app.js', import.meta.url), 'utf8');

test('V5 course render does not attach video sources before an explicit Play action', () => {
  assert.match(app, /video\.preload = 'none'/);
  assert.doesNotMatch(app, /<video[^>]+\ssrc=/);
  assert.match(app, /data-v5-start/);
  assert.match(app, /startVideo\(cell\)/);
  assert.match(app, /video\.src = mediaUrl\(cell\.dataset\.assetId\)/);
});

test('V5 keeps at most one active video source and releases it on navigation', () => {
  assert.match(app, /if \(activeVideo\) releaseVideo\(activeVideo\)/);
  assert.match(app, /video\.pause\(\)/);
  assert.match(app, /video\.removeAttribute\('src'\)/);
  assert.match(app, /video\.load\(\)/);
  assert.match(app, /addEventListener\('pagehide', \(\) => releaseVideo\(activeVideo\)\)/);
});

test('V5 groups posts once instead of rescanning every post for every lesson', () => {
  const model = fs.readFileSync(new URL('../v5/ui-model.js', import.meta.url), 'utf8');
  assert.match(model, /const postsByLesson = new Map\(\)/);
  assert.match(model, /postsByLesson\.get\(String\(lesson\.id\)\) \|\| \[\]/);
  assert.doesNotMatch(model, /posts\.filter\(/);
});
