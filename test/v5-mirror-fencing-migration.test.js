import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_mirror_fencing_20260917.sql', import.meta.url), 'utf8');

test('V5 Telegram mirror lease fencing migration pins p_attempt and search_path', () => {
  assert.match(migration, /create or replace function public\.finish_v5_telegram_mirror_job/);
  assert.match(migration, /p_attempt integer default null/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(migration, /v5_mirror_lease_fenced:expected_attempt_%_got_%/);
  assert.match(migration, /grant execute on function public\.finish_v5_telegram_mirror_job/);
});
