import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_order_entitlement_ownership_20260828.sql', import.meta.url), 'utf8');
const syncSource = fs.readFileSync(new URL('../api/v5-sync.js', import.meta.url), 'utf8');

test('one Commerce V5 order can own at most one enrollment row', () => {
  assert.match(migration, /create unique index if not exists student_enrollments_commerce_v5_order_unique_idx/i);
  assert.match(migration, /on public\.student_enrollments\(source_order_id\)/i);
  assert.match(migration, /where source_system = 'commerce_v5'/i);
});

test('enrollment ownership transfer is guarded by old row identity and owner state', () => {
  assert.match(syncSource, /readCommerceOrderEnrollment/);
  assert.match(syncSource, /readTargetEnrollment/);
  assert.match(syncSource, /guardNullable\(query, "status", existing\.status\)/);
  assert.match(syncSource, /guardNullable\(query, "source_system", existing\.source_system\)/);
  assert.match(syncSource, /guardNullable\(query, "source_order_id", existing\.source_order_id\)/);
  assert.match(syncSource, /v5_enrollment_write_race/);
});

test('new V5 approvals cannot steal a live entitlement owned by another grant', () => {
  assert.match(syncSource, /v5_order_entitlement_identity_locked/);
  assert.match(syncSource, /v5_enrollment_owned_by_other_grant/);
  assert.match(syncSource, /v5_enrollment_history_owned_by_other_source/);
  assert.match(syncSource, /v5_enrollment_history_conflict/);
});

test('optional Commerce metadata is preserved when omitted from syncCourse', () => {
  assert.match(syncSource, /if \(body\.subtitle !== undefined\) patch\.subtitle/);
  assert.match(syncSource, /if \(body\.imageUrl !== undefined\) patch\.image_url/);
  assert.match(syncSource, /if \(body\.expected_start_date !== undefined\) patch\.expected_start_date/);
});
