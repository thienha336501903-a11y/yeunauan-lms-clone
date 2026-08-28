import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_media_integrity_guard_20260828.sql', import.meta.url), 'utf8');

test('READY V5 media must be backed by R2 before Publish/playback', () => {
  assert.match(migration, /new\.status = 'ready'/);
  assert.match(migration, /new\.provider <> 'r2'/);
  assert.match(migration, /new\.r2_object_key/);
  assert.match(migration, /v5_ready_asset_requires_r2/);
});

test('released asset detection covers both asset_ids and linked asset membership', () => {
  assert.match(migration, /snapshot->'asset_ids'/);
  assert.match(migration, /jsonb_array_elements\(coalesce\(r\.snapshot->'links'/);
  assert.match(migration, /release_link\.value->>'asset_id' = old\.id::text/);
});

test('released asset status cannot leave READY so current and rollback releases keep media', () => {
  assert.match(migration, /old\.status is distinct from new\.status/);
  assert.match(migration, /new\.status <> 'ready'/);
  assert.match(migration, /v5_released_asset_status_immutable/);
});

test('released asset identity, locator and learner-visible media metadata are immutable', () => {
  assert.match(migration, /old\.r2_object_key/);
  assert.match(migration, /old\.provider/);
  assert.match(migration, /old\.checksum_sha256/);
  assert.match(migration, /old\.width/);
  assert.match(migration, /old\.height/);
  assert.match(migration, /old\.duration_ms/);
  assert.match(migration, /old\.thumbnail_asset_id/);
  assert.match(migration, /v5_released_asset_content_immutable/);
});

test('released assets cannot be deleted in place and helper has pinned search_path', () => {
  assert.match(migration, /v5_released_asset_delete_forbidden/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.enforce_v5_media_integrity\(\) from anon/);
});
