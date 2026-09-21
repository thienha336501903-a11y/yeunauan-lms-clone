import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_allow_preorder_sale_20260921.sql', import.meta.url), 'utf8');

test('V5 pre-order decoupling migration allows active sale before content is published', () => {
  assert.match(migration, /enforce_v5_course_lifecycle/);
  assert.match(migration, /new\.is_published := false/);
  // active is not forced to false on insert
  assert.match(migration, /if new\.active is null then\s*new\.active := false;/);
});

test('V5 readiness gate guards content publish (is_published) but not sale activation (active)', () => {
  // Only is_published requires v_ready
  assert.match(migration, /if new\.is_published is true and not v_ready then\s*raise exception 'v5_course_not_ready_for_sale';/);
  // active=true does NOT mirror into is_published
  assert.doesNotMatch(migration, /if new\.active is true then\s*new\.is_published := true;/);
});

test('canonical V5 failclosed flags trigger only clears is_published, never mutates active', () => {
  assert.match(migration, /sync_v5_course_failclosed_flags/);
  assert.match(migration, /set is_published = false,\s*updated_at = now\(\)/);
  assert.match(migration, /and is_published is true;/);
  // active = false must NOT appear in failclosed update
  assert.doesNotMatch(migration, /set is_published = false,\s*active = false/);
});

test('security definer and search_path invariants are strictly preserved', () => {
  assert.match(migration, /security definer/gi);
  assert.match(migration, /set search_path = pg_catalog, public/gi);
  assert.match(migration, /revoke all on function public\.enforce_v5_course_lifecycle\(\) from authenticated/);
  assert.match(migration, /revoke all on function public\.sync_v5_course_failclosed_flags\(\) from authenticated/);
});
