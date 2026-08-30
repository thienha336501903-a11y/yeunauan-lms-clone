import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_atomic_release_20260828.sql', import.meta.url), 'utf8');

test('atomic V5 Publish rejects missing, archived or non-R2 release assets', () => {
  assert.match(migration, /jsonb_array_elements_text\(coalesce\(p_snapshot->'asset_ids'/);
  assert.match(migration, /left join public\.v5_media_assets/);
  assert.match(migration, /a\.id is null/);
  assert.match(migration, /a\.status <> 'ready'/);
  assert.match(migration, /a\.provider <> 'r2'/);
  assert.match(migration, /a\.r2_object_key/);
  assert.match(migration, /v5_release_asset_not_ready/);
});

test('asset readiness is validated before the release row and learner pointer are changed', () => {
  const gate = migration.indexOf("raise exception 'v5_release_asset_not_ready'");
  const insert = migration.indexOf('insert into public.v5_releases');
  const pointer = migration.indexOf('published_release_id = v_release');
  assert.ok(gate >= 0 && insert > gate && pointer > insert);
});
