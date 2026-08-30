import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_mirror_rpc_search_path_20260828.sql', import.meta.url), 'utf8');

test('V5 Telegram mirror SECURITY DEFINER RPCs pin pg_catalog before public', () => {
  assert.match(migration, /alter function public\.claim_v5_telegram_mirror_job\(text\)[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(migration, /alter function public\.finish_v5_telegram_mirror_job\(uuid,text,boolean,text,bigint,text,text\)[\s\S]*set search_path = pg_catalog, public/i);
});
