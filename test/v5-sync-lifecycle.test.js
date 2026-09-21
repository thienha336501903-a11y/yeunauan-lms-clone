import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../api/v5-sync.js', import.meta.url), 'utf8');

test('new/shared-shell V5 sync is fail-closed and only bootstraps a missing Draft config', () => {
  assert.match(source, /is_published:\s*false/);
  assert.match(source, /async function ensureDraftConfigIfMissing\(courseId\)/);
  assert.match(source, /if \(existingConfig\) return existingConfig/);
  const ensureBlock = source.match(/async function ensureDraftConfigIfMissing\(courseId\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(ensureBlock, /\.insert\(\{[\s\S]*status:\s*"draft"/);
  assert.doesNotMatch(ensureBlock, /\.update\(/);
  assert.doesNotMatch(ensureBlock, /\.upsert\(/);
});

test('existing Published V5 metadata sync never mutates canonical lifecycle fields', () => {
  const ensureBlock = source.match(/async function ensureDraftConfigIfMissing\(courseId\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(ensureBlock, /select\("course_id,status,published_release_id,source_mode"\)/);
  assert.match(ensureBlock, /if \(existingConfig\) return existingConfig/);
  assert.doesNotMatch(ensureBlock, /\.update\(/);
  assert.doesNotMatch(ensureBlock, /\.upsert\(/);
});

test('V5 enrollment create does not block on course.active and validates canonical release when published', () => {
  assert.doesNotMatch(source, /course\.active !== true/);
  assert.match(source, /course\.is_published !== true/);
  assert.match(source, /config\.status !== "published"/);
  assert.match(source, /!config\.published_release_id/);
  assert.match(source, /release\.status !== "published"/);
  assert.match(source, /requireV5ReadyForEnrollment\(courseSlug\)/);
});

test('V5 revoke remains available after unpublish or deactivation', () => {
  const revokeBlock = source.match(/if \(action === "revoke"\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(revokeBlock, /requireV5Course\(courseSlug\)/);
  assert.doesNotMatch(revokeBlock, /requireV5ReadyForEnrollment/);
  assert.match(revokeBlock, /status:\s*"revoked"/);
});

test('sale activation allows pre-order before canonical published release', () => {
  assert.match(source, /patch\.active = body\.active === true;/);
  assert.doesNotMatch(source, /body\.active === true && !\(await canActivateExistingV5\(existing\)\)/);
});

test('sync errors expose a stable code instead of collapsing readiness conflicts into generic 500s', () => {
  assert.match(source, /code:\s*error\.code \|\| "v5_sync_error"/);
  assert.match(source, /statusCode:\s*409/);
});
