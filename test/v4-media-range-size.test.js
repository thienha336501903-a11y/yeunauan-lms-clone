import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sw = fs.readFileSync(new URL('../v4-media-sw.js', import.meta.url), 'utf8');

test('V4 media proxy keeps the 2 MiB cap for finite upstream ranges', () => {
  assert.match(sw, /const MAX_UPSTREAM_RANGE_BYTES = 2 \* 1024 \* 1024;/);
  assert.match(sw, /const capEnd = start \+ MAX_UPSTREAM_RANGE_BYTES - 1;/);
  assert.match(sw, /const end = Math\.min\(requestedEnd, capEnd\);/);
});

test('V4 media proxy preserves open-ended playback ranges for continuous streaming', () => {
  assert.match(sw, /if \(!match\[2\]\) return `bytes=\$\{start\}-`;/);
});

test('V4 media proxy streams range-less playback continuously from byte zero', () => {
  assert.match(sw, /if \(!value\) return "bytes=0-";/);
  assert.doesNotMatch(sw, /if \(!value\) return `bytes=0-\$\{MAX_UPSTREAM_RANGE_BYTES - 1\}`/);
});
