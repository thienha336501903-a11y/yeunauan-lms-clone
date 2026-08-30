import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../api/sync.js', import.meta.url), 'utf8');

test('legacy sync rejects explicit V5 course writes before mode coercion', () => {
  assert.match(source, /const rawRequestedMode = String\(deliveryMode \|\| ""\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /if \(rawRequestedMode === "v5"\) return legacyV5Forbidden\(res\)/);
  assert.match(source, /code: "v5_legacy_sync_forbidden"/);
});

test('legacy sync rejects writes to an existing V5 course even when stale clients omit deliveryMode', () => {
  assert.match(source, /const existingMode = String\(existingCourse\.delivery_mode \|\| "lms"\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /if \(existingMode === "v5"\) return legacyV5Forbidden\(res\)/);
});

test('legacy enrollment and revoke routes reject V5 before generic syncEnrollment', () => {
  assert.match(source, /async function isV5CourseSlug\(courseSlug\)/);
  const createBlock = source.match(/if \(action === "syncEnrollment"\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const revokeBlock = source.match(/if \(action === "revokeEnrollment"\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(createBlock, /await isV5CourseSlug\(courseSlug\)/);
  assert.match(revokeBlock, /await isV5CourseSlug\(courseSlug\)/);
  assert.match(source, /V5 phải đồng bộ qua \/api\/v5-sync/);
});
