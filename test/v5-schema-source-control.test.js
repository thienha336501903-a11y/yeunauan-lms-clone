import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const foundation = read('sql/migration_lms_v5_canonical_foundation_20260826.sql');
const isolation = read('sql/migration_lms_v5_commerce_isolation_20260827.sql');
const mirror = read('sql/migration_lms_v5_telegram_mirror_queue_20260827.sql');

test('canonical V5 tables and delivery mode are persisted in source control', () => {
  for (const table of ['v5_course_configs', 'v5_lessons', 'v5_posts', 'v5_media_assets', 'v5_post_assets', 'v5_releases', 'v5_jobs', 'v5_upload_sessions', 'v5_source_mappings']) {
    assert.match(foundation, new RegExp(`public\\.${table}`));
  }
  assert.match(foundation, /'v5'::text/);
  assert.match(foundation, /enable row level security/);
});

test('V5 writes remain isolated to delivery_mode=v5 courses', () => {
  assert.match(isolation, /orders_delivery_mode_check/);
  assert.match(isolation, /enforce_v5_course_mode/);
  assert.match(isolation, /lower\(coalesce\(c\.delivery_mode,''\)\) = 'v5'/);
  assert.match(isolation, /v5_source_mappings/);
});

test('Telegram mirror queue uses atomic service-role-only claim and finish RPCs', () => {
  assert.match(mirror, /claim_v5_telegram_mirror_job/);
  assert.match(mirror, /for update skip locked/);
  assert.match(mirror, /locked_at < now\(\) - interval '15 minutes'/);
  assert.match(mirror, /finish_v5_telegram_mirror_job/);
  assert.match(mirror, /status = 'ready'/);
  assert.match(mirror, /not exists[\s\S]*a2\.status not in \('ready','archived'\)/);
  assert.match(mirror, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(mirror, /grant execute on function[\s\S]*to service_role/);
});
