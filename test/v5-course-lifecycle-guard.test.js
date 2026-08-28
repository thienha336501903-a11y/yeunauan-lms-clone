import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_course_lifecycle_guard_20260828.sql', import.meta.url), 'utf8');

test('new V5 course shells are forced Draft/off-sale at the database boundary', () => {
  assert.match(migration, /new\.active := false/);
  assert.match(migration, /new\.is_published := false/);
  assert.match(migration, /v5_mode_conversion_requires_controlled_bootstrap/);
});

test('V5 sale activation requires a canonical Published release', () => {
  assert.match(migration, /join public\.v5_releases r/);
  assert.match(migration, /c\.status = 'published'/);
  assert.match(migration, /r\.status = 'published'/);
  assert.match(migration, /new\.active is true and not v_ready/);
  assert.match(migration, /v5_course_not_ready_for_sale/);
});

test('Commerce cannot directly forge or clear V5 published state', () => {
  assert.match(migration, /new\.is_published := v_ready/);
  assert.match(migration, /sync_v5_course_publish_flag/);
  assert.match(migration, /set is_published = v_ready/);
  assert.match(migration, /active = case when v_ready then active else false end/);
});

test('V5 canonical content cannot be deleted or retyped through a generic course write', () => {
  assert.match(migration, /v5_course_delete_requires_controlled_cleanup/);
  assert.match(migration, /v5_mode_change_requires_controlled_cleanup/);
  assert.match(migration, /exists \(select 1 from public\.v5_course_configs/);
});

test('lifecycle trigger helpers are definer-scoped with pinned search_path and no client execute grants', () => {
  assert.match(migration, /security definer/gi);
  assert.match(migration, /set search_path = pg_catalog, public/gi);
  assert.match(migration, /revoke all on function public\.enforce_v5_course_lifecycle\(\) from anon/);
  assert.match(migration, /revoke all on function public\.sync_v5_course_publish_flag\(\) from authenticated/);
});
