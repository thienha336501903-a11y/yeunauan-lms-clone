import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_released_video_thumbnail_guard_20260908.sql', import.meta.url), 'utf8');

test('released READY R2 video may only gain its first thumbnail', () => {
  assert.match(migration, /old\.type = 'video'/);
  assert.match(migration, /old\.provider = 'r2'/);
  assert.match(migration, /old\.status = 'ready'/);
  assert.match(migration, /old\.thumbnail_asset_id is null/);
  assert.match(migration, /new\.thumbnail_asset_id is not null/);
});

test('released thumbnail target must be a READY R2 JPEG image', () => {
  assert.match(migration, /t\.type = 'image'/);
  assert.match(migration, /t\.provider = 'r2'/);
  assert.match(migration, /t\.status = 'ready'/);
  assert.match(migration, /image\/jpeg/);
  assert.match(migration, /v5_released_video_thumbnail_requires_ready_r2_jpeg/);
});

test('all non-thumbnail released media fields remain immutable', () => {
  for (const field of [
    'r2_object_key',
    'telegram_source_id',
    'telegram_message_row_id',
    'mime_type',
    'original_filename',
    'bytes',
    'width',
    'height',
    'duration_ms',
    'checksum_sha256'
  ]) {
    assert.match(migration, new RegExp(`old\\.${field}`));
    assert.match(migration, new RegExp(`new\\.${field}`));
  }
  assert.match(migration, /v5_released_asset_content_immutable/);
});

test('existing thumbnail replacement/removal is not granted an exception', () => {
  const exceptionStart = migration.indexOf("old.thumbnail_asset_id is null");
  const immutableStart = migration.indexOf('v5_released_asset_content_immutable');
  assert.ok(exceptionStart >= 0 && immutableStart > exceptionStart);
  assert.doesNotMatch(migration, /old\.thumbnail_asset_id is not null[\s\S]*return new/);
});
