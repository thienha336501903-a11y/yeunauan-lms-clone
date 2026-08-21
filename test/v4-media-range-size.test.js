import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sw = fs.readFileSync(new URL('../v4-media-sw.js', import.meta.url), 'utf8');

test('V4 media proxy caps each upstream range at 2 MiB', () => {
  assert.match(sw, /const MAX_UPSTREAM_RANGE_BYTES = 2 \* 1024 \* 1024;/);
  assert.match(sw, /start \+ MAX_UPSTREAM_RANGE_BYTES - 1/);
});
