import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../sql/migration_lms_v5_sale_activation_mirror_20260828.sql', import.meta.url), 'utf8');

test('V5 sale activation verifies canonical release before mirroring Published', () => {
  const readinessIndex = migration.indexOf("raise exception 'v5_course_not_ready_for_sale'");
  const mirrorIndex = migration.indexOf('new.is_published := true');
  assert.ok(readinessIndex >= 0 && mirrorIndex > readinessIndex);
  assert.match(migration, /c\.status = 'published'/);
  assert.match(migration, /r\.status = 'published'/);
  assert.match(migration, /if new\.active is true then[\s\S]*new\.is_published := true/);
});

test('turning V5 sale off cannot clear learner-visible Published state while canonical release remains Published', () => {
  assert.match(migration, /old\.is_published is true and new\.is_published is false/);
  assert.match(migration, /v5_publish_state_owned_by_release/);
  const guardIndex = migration.indexOf("raise exception 'v5_publish_state_owned_by_release'");
  const activationMirrorIndex = migration.indexOf('new.is_published := true');
  assert.ok(guardIndex >= 0 && activationMirrorIndex > guardIndex);
});

test('canonical lifecycle can clear the Published mirror after canonical readiness is removed', () => {
  assert.match(migration, /old\.is_published is true and new\.is_published is false and v_ready/);
  assert.doesNotMatch(migration, /if old\.is_published is true and new\.is_published is false then\s+raise exception/);
});

test('new V5 shells remain Draft and off-sale', () => {
  assert.match(migration, /if tg_op = 'INSERT'[\s\S]*new\.active := false;[\s\S]*new\.is_published := false/);
});

test('generic V5 mode conversion and canonical delete remain blocked', () => {
  assert.match(migration, /v5_mode_conversion_requires_controlled_bootstrap/);
  assert.match(migration, /v5_mode_change_requires_controlled_cleanup/);
  assert.match(migration, /v5_course_delete_requires_controlled_cleanup/);
});
