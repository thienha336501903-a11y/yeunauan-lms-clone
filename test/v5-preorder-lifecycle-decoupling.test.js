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

test('canonical V5 failclosed flags trigger handles DELETE fail-closed and only clears is_published', () => {
  assert.match(migration, /sync_v5_course_failclosed_flags/);
  // Trigger must fire on INSERT OR UPDATE OR DELETE
  assert.match(migration, /after insert or update or delete on public\.v5_course_configs/i);
  // DELETE path uses old.course_id and returns old
  assert.match(migration, /if tg_op = 'DELETE' then\s*v_course_id := old\.course_id;\s*else\s*v_course_id := new\.course_id;/);
  assert.match(migration, /if tg_op = 'DELETE' then\s*return old;\s*end if;\s*return new;/);
  // Failclosed path clears is_published without mutating active
  assert.match(migration, /set is_published = false,\s*updated_at = now\(\)/);
  assert.match(migration, /and is_published is true;/);
  assert.doesNotMatch(migration, /set is_published = false,\s*active = false/);
});

test('security definer and search_path invariants are strictly preserved', () => {
  assert.match(migration, /security definer/gi);
  assert.match(migration, /set search_path = pg_catalog, public/gi);
  assert.match(migration, /revoke all on function public\.enforce_v5_course_lifecycle\(\) from authenticated/);
  assert.match(migration, /revoke all on function public\.sync_v5_course_failclosed_flags\(\) from authenticated/);
});
