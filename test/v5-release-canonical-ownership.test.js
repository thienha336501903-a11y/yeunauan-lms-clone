import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_atomic_release_20260828.sql', import.meta.url), 'utf8');

test('atomic Publish refuses empty learner content even if UI preflight is bypassed', () => {
  assert.match(migration, /jsonb_array_length\(coalesce\(p_snapshot->'lessons'/);
  assert.match(migration, /jsonb_array_length\(coalesce\(p_snapshot->'posts'/);
  assert.match(migration, /v5_release_content_empty/);
});

test('snapshot Lessons and Posts must belong to the exact canonical course', () => {
  assert.match(migration, /from public\.v5_lessons l/);
  assert.match(migration, /l\.course_id = p_course_id/);
  assert.match(migration, /from public\.v5_posts p/);
  assert.match(migration, /p\.course_id = p_course_id/);
  assert.match(migration, /p\.lesson_id::text = post_row\.value->>'lesson_id'/);
  assert.match(migration, /v5_release_lesson_ownership_invalid/);
});

test('snapshot media links must exist in canonical post-asset membership for this course', () => {
  assert.match(migration, /from public\.v5_post_assets pa/);
  assert.match(migration, /join public\.v5_posts p on p\.id = pa\.post_id/);
  assert.match(migration, /pa\.post_id::text = link_row\.value->>'post_id'/);
  assert.match(migration, /pa\.asset_id::text = link_row\.value->>'asset_id'/);
});

test('asset_ids and link asset membership must be the same set', () => {
  assert.match(migration, /with explicit_assets as/);
  assert.match(migration, /linked_assets as/);
  assert.match(migration, /except select asset_id from linked_assets/);
  assert.match(migration, /except select asset_id from explicit_assets/);
  assert.match(migration, /v5_release_asset_index_mismatch/);
});
