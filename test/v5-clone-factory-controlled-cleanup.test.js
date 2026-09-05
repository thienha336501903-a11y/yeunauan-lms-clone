import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../sql/migration_lms_v5_clone_factory_controlled_cleanup_20260905.sql', import.meta.url),
  'utf8'
);

test('clone-factory cleanup is fail-closed to an exact reserved test fixture', () => {
  assert.match(migration, /left\(c\.slug, 20\) = '__clone_factory_test'/);
  assert.match(migration, /raw_data->>'test_fixture'/);
  assert.match(migration, /v_slug is distinct from p_expected_slug/);
  assert.match(migration, /v5_test_cleanup_fixture_guard_failed/);
});

test('cleanup refuses commerce, V4, jobs, mappings, and non-test enrollments', () => {
  assert.match(migration, /v5_test_cleanup_has_orders/);
  assert.match(migration, /v5_test_cleanup_has_v4_source/);
  assert.match(migration, /v5_test_cleanup_has_source_mappings/);
  assert.match(migration, /v5_test_cleanup_has_jobs/);
  assert.match(migration, /source_order_id is not null/);
  assert.match(migration, /source_system/);
  assert.match(migration, /v5_test_cleanup_has_non_test_enrollment/);
});

test('cleanup only accepts prefixed, course-scoped, non-shared media', () => {
  assert.match(migration, /original_filename/);
  assert.match(migration, /media\/v5\//);
  assert.match(migration, /v5_test_cleanup_asset_guard_failed/);
  assert.match(migration, /v5_test_cleanup_shared_asset/);
  assert.match(migration, /v5_test_cleanup_shared_release_asset/);
});

test('release immutability stays default-deny outside the transaction-local fixture capability', () => {
  assert.match(migration, /set_config\('app\.v5_clone_factory_cleanup_course_id'/);
  assert.match(migration, /v5_clone_factory_cleanup_allowed\(old\.course_id\)/);
  assert.match(migration, /v5_release_delete_forbidden/);
  assert.doesNotMatch(migration, /session_replication_role/i);
  assert.doesNotMatch(migration, /disable\s+trigger/i);
});

test('cleanup RPC is not browser executable and is service-role only', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.cleanup_v5_clone_factory_fixture\(uuid, text\) from public/);
  assert.match(migration, /revoke all on function public\.cleanup_v5_clone_factory_fixture\(uuid, text\) from anon/);
  assert.match(migration, /revoke all on function public\.cleanup_v5_clone_factory_fixture\(uuid, text\) from authenticated/);
  assert.match(migration, /grant execute on function public\.cleanup_v5_clone_factory_fixture\(uuid, text\) to service_role/);
});

test('controlled cleanup removes release history only inside the guarded path, then course and owned media', () => {
  assert.match(migration, /delete from public\.v5_releases where course_id = p_course_id/);
  assert.match(migration, /delete from public\.v5_course_configs where course_id = p_course_id/);
  assert.match(migration, /delete from public\.courses/);
  assert.match(migration, /delete from public\.v5_media_assets/);
  assert.match(migration, /r2_object_keys/);
});
