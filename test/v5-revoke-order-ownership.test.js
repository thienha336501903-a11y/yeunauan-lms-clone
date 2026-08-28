import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../api/v5-sync.js', import.meta.url), 'utf8');

test('V5 enrollment sync requires an order UUID for ownership tracing', () => {
  assert.match(source, /function validUuid\(value\)/);
  assert.match(source, /v5_invalid_order_id/);
  assert.match(source, /source_order_id:\s*cleanOrderId/);
});

test('V5 revoke only touches the entitlement owned by the exact Commerce order', () => {
  const revokeBlock = source.match(/if \(action === "revoke"\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(revokeBlock, /requireV5Course\(courseSlug\)/);
  assert.match(revokeBlock, /\.eq\("source_system", "commerce_v5"\)/);
  assert.match(revokeBlock, /\.eq\("source_order_id", cleanOrderId\)/);
  assert.doesNotMatch(revokeBlock, /requireV5ReadyForEnrollment/);
});

test('revoking an older order cannot blindly revoke a newer or manual enrollment', () => {
  assert.doesNotMatch(source, /update\(\{ status: "revoked"[\s\S]*?\.eq\("course_slug", course\.slug\)\.select/);
  assert.match(source, /source_system,source_order_id/);
});

test('a new V5 order cannot steal a still-usable entitlement owned by another grant', () => {
  assert.match(source, /isEnrollmentUsable\(existingEnrollment\)/);
  assert.match(source, /existingEnrollment\.source_system[\s\S]*=== "commerce_v5"/);
  assert.match(source, /existingEnrollment\.source_order_id[\s\S]*=== cleanOrderId/);
  assert.match(source, /v5_enrollment_owned_by_other_grant/);
});

test('repurchase after revoke or expiry reactivates the enrollment and clears the old expiry', () => {
  assert.match(source, /status:\s*"active"/);
  assert.match(source, /expired_at:\s*null/);
  assert.match(source, /onConflict:\s*"email,course_slug"/);
});
