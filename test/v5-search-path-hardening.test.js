import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_pin_search_path_20260828.sql', import.meta.url), 'utf8');

test('V5 course-mode trigger pins a safe search_path with a forward-only migration', () => {
  assert.match(migration, /alter function public\.enforce_v5_course_mode\(\)/i);
  assert.match(migration, /set search_path\s*=\s*pg_catalog,\s*public/i);
  assert.doesNotMatch(migration, /drop function|drop trigger|truncate|delete from/i);
});
