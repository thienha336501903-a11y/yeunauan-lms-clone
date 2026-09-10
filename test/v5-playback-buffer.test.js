import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../v5/media-sw.js', import.meta.url), 'utf8');

function extract(pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `missing ${label}`);
  return match[0];
}

function playbackRangeFixture() {
  const initial = extract(/const INITIAL_VIDEO_RANGE_BYTES = [^;]+;/, 'initial video range constant');
  const continuation = extract(/const CONTINUATION_VIDEO_RANGE_BYTES = [^;]+;/, 'continuation video range constant');
  const clean = extract(/function clean\(value\) \{[\s\S]*?\n\}/, 'clean function');
  const range = extract(/function playbackRange\(rawRange, mimeType\) \{[\s\S]*?\n\}(?=\n\nasync function issueLease)/, 'playbackRange function');
  const sandbox = {};
  vm.runInNewContext(`${initial}\n${continuation}\n${clean}\n${range}\nthis.playbackRange = playbackRange;`, sandbox);
  return sandbox.playbackRange;
}

test('V5 keeps a 4 MiB startup range but uses 8 MiB continuation ranges', () => {
  const playbackRange = playbackRangeFixture();
  assert.equal(playbackRange('', 'video/mp4'), 'bytes=0-4194303');
  assert.equal(playbackRange('bytes=0-', 'video/mp4'), 'bytes=0-4194303');
  assert.equal(playbackRange('bytes=4194304-', 'video/mp4'), 'bytes=4194304-12582911');
  assert.equal(playbackRange('bytes=25000000-', 'video/mp4'), 'bytes=25000000-33388607');
});

test('V5 continuation buffering does not rewrite finite video ranges or image ranges', () => {
  const playbackRange = playbackRangeFixture();
  assert.equal(playbackRange('bytes=100-199', 'video/mp4'), 'bytes=100-199');
  assert.equal(playbackRange('bytes=0-', 'image/jpeg'), 'bytes=0-');
  assert.equal(playbackRange('', 'image/jpeg'), '');
});
