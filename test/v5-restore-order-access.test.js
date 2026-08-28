import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../api/v5-sync.js', import.meta.url), 'utf8');

test('restoreEnrollment is a distinct authenticated sync action', () => {
  assert.match(source, /action === "restoreEnrollment"/);
  assert.match(source, /action: "restore"/);
  assert.match(source, /\["create", "restore", "revoke"\]/);
});

test('new V5 enrollment still requires sale active while restore ignores sale switch', () => {
  assert.match(source, /requireV5PublishedForExistingAccess/);
  assert.match(source, /if \(course\.active !== true\).*v5_course_inactive/);
  assert.match(source, /action === "restore"[\s\S]*requireV5PublishedForExistingAccess/);
  assert.match(source, /requireV5PublishedForExistingAccess[\s\S]*course\.is_published !== true/);
  assert.match(source, /requireCanonicalPublishedRelease\(course\)/);
});

test('restore keeps exact Commerce order ownership and resets expired_at', () => {
  assert.match(source, /source_system:\s*"commerce_v5"/);
  assert.match(source, /source_order_id:\s*cleanOrderId/);
  assert.match(source, /expired_at:\s*null/);
  assert.match(source, /v5_enrollment_owned_by_other_grant/);
});

test('revoke remains available after sale/content state changes and stays order-scoped', () => {
  const revoke = source.match(/if \(action === "revoke"\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(revoke, /requireV5Course\(courseSlug\)/);
  assert.match(revoke, /\.eq\("source_system", "commerce_v5"\)/);
  assert.match(revoke, /\.eq\("source_order_id", cleanOrderId\)/);
  assert.doesNotMatch(revoke, /requireV5PublishedForExistingAccess/);
});
