import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../api/v5-sync.js', import.meta.url), 'utf8');

test('dedicated V5 sync accepts only V5_SYNC_SECRET', () => {
  assert.match(source, /const secret = String\(process\.env\.V5_SYNC_SECRET \|\| ""\)\.trim\(\)/);
  assert.doesNotMatch(source, /INTERNAL_SYNC_SECRET/);
  assert.match(source, /if \(!secret\) return res\.status\(503\)/);
  assert.match(source, /!safeEqual\(supplied, secret\)/);
  assert.doesNotMatch(source, /secrets\.some/);
});
