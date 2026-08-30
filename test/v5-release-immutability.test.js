import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_release_immutability_20260828.sql', import.meta.url), 'utf8');

test('published release snapshot and identity are immutable append-only history', () => {
  assert.match(migration, /old\.snapshot is distinct from new\.snapshot/);
  assert.match(migration, /old\.course_id is distinct from new\.course_id/);
  assert.match(migration, /old\.version is distinct from new\.version/);
  assert.match(migration, /v5_release_immutable/);
});

test('release rows cannot be deleted', () => {
  assert.match(migration, /tg_op = 'DELETE'/i);
  assert.match(migration, /v5_release_delete_forbidden/);
});

test('only atomic Publish status transition published to superseded is allowed', () => {
  assert.match(migration, /old\.status = 'published' and new\.status = 'superseded'/);
  assert.match(migration, /v5_release_status_transition_forbidden/);
});

test('release guard is pinned and not executable by browser roles', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.enforce_v5_release_immutability\(\) from anon/);
  assert.match(migration, /revoke all on function public\.enforce_v5_release_immutability\(\) from authenticated/);
});
