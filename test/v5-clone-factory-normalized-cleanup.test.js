import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../sql/migration_lms_v5_clone_factory_normalized_cleanup_20260907.sql', import.meta.url),
  'utf8'
);

test('normalized owner-acceptance fixtures remain fail-closed to exact V5 identity', () => {
  assert.match(migration, /v_slug is distinct from p_expected_slug/);
  assert.match(migration, /lower\(coalesce\(v_delivery_mode, ''\)\) <> 'v5'/);
  assert.match(migration, /studentDisplayTitle/);
  assert.match(migration, /clone-factory-test/);
  assert.match(migration, /__clone_factory_test/);
  assert.match(migration, /v5_test_cleanup_fixture_guard_failed/);
});

test('cleanup still refuses Commerce, V4, mappings, jobs, and order-owned enrollments', () => {
  assert.match(migration, /v5_test_cleanup_has_orders/);
  assert.match(migration, /v5_test_cleanup_has_v4_source/);
  assert.match(migration, /v5_test_cleanup_has_source_mappings/);
  assert.match(migration, /v5_test_cleanup_has_jobs/);
  assert.match(migration, /source_order_id is not null/);
  assert.match(migration, /v5_test_cleanup_has_non_test_enrollment/);
  assert.doesNotMatch(migration, /left\(coalesce\(e\.source_system/);
});

test('ordinary upload filenames are allowed only inside exact private R2 course namespace', () => {
  assert.match(migration, /lower\(coalesce\(a\.provider, ''\)\) <> 'r2'/);
  assert.match(migration, /media\/v5\//);
  assert.match(migration, /v5_test_cleanup_asset_guard_failed/);
  assert.match(migration, /v5_test_cleanup_shared_asset/);
  assert.match(migration, /v5_test_cleanup_shared_release_asset/);
  assert.doesNotMatch(migration, /original_filename/);
});

test('release immutability capability remains transaction-local and service-role only', () => {
  assert.match(migration, /set_config\('app\.v5_clone_factory_cleanup_course_id'/);
  assert.match(migration, /current_setting\('app\.v5_clone_factory_cleanup_course_id'/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.cleanup_v5_clone_factory_fixture\(uuid, text\) from anon/);
  assert.match(migration, /grant execute on function public\.cleanup_v5_clone_factory_fixture\(uuid, text\) to service_role/);
  assert.doesNotMatch(migration, /session_replication_role/i);
  assert.doesNotMatch(migration, /disable\s+trigger/i);
});

test('controlled cleanup removes only exact fixture release, config, course, enrollment cascade, and owned media', () => {
  assert.match(migration, /delete from public\.v5_releases where course_id = p_course_id/);
  assert.match(migration, /delete from public\.v5_course_configs where course_id = p_course_id/);
  assert.match(migration, /delete from public\.courses c/);
  assert.match(migration, /delete from public\.v5_media_assets/);
  assert.match(migration, /deleted_enrollments/);
  assert.match(migration, /r2_object_keys/);
});
