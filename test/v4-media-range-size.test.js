import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sw = fs.readFileSync(new URL('../v4-media-sw.js', import.meta.url), 'utf8');

test('V4 media proxy preserves finite browser playback ranges', () => {
  assert.match(sw, /return `bytes=\$\{start\}-\$\{requestedEnd\}`;/);
  assert.doesNotMatch(sw, /MAX_UPSTREAM_RANGE_BYTES/);
  assert.doesNotMatch(sw, /Math\.min\(requestedEnd/);
});

test('V4 media proxy preserves open-ended playback ranges for continuous streaming', () => {
  assert.match(sw, /if \(!match\[2\]\) return `bytes=\$\{start\}-`;/);
});

test('V4 media proxy streams range-less playback continuously from byte zero', () => {
  assert.match(sw, /if \(!value\) return "bytes=0-";/);
});
