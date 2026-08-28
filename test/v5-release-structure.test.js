import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_atomic_release_20260828.sql', import.meta.url), 'utf8');

test('atomic Publish validates release snapshot collection shapes', () => {
  assert.match(migration, /p_snapshot->'lessons'/);
  assert.match(migration, /p_snapshot->'posts'/);
  assert.match(migration, /p_snapshot->'links'/);
  assert.match(migration, /p_snapshot->'asset_ids'/);
  assert.match(migration, /v5_release_snapshot_shape_invalid/);
});

test('every published Post must reference a Lesson inside the same release', () => {
  assert.match(migration, /jsonb_array_elements\(coalesce\(p_snapshot->'posts'/);
  assert.match(migration, /post_row\.value->>'lesson_id'/);
  assert.match(migration, /jsonb_array_elements\(coalesce\(p_snapshot->'lessons'/);
  assert.match(migration, /v5_release_post_lesson_invalid/);
});

test('every release link must reference a Post in the same snapshot and a non-empty asset id', () => {
  assert.match(migration, /link_row\.value->>'post_id'/);
  assert.match(migration, /link_row\.value->>'asset_id'/);
  assert.match(migration, /v5_release_link_invalid/);
});

test('asset readiness gate covers both explicit asset_ids and link asset_ids', () => {
  assert.match(migration, /with release_asset_ids as/);
  assert.match(migration, /jsonb_array_elements_text\(coalesce\(p_snapshot->'asset_ids'/);
  assert.match(migration, /select link_row\.value->>'asset_id' as asset_id/);
  assert.match(migration, /a\.status <> 'ready'/);
  assert.match(migration, /a\.provider <> 'r2'/);
  assert.match(migration, /v5_release_asset_not_ready/);
});
