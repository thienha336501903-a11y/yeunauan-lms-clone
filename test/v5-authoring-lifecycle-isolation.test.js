import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const content = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-content.js', import.meta.url), 'utf8');
const telegram = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');

test('generic V5 content API cannot mutate config release lifecycle', () => {
  assert.match(content, /v5_config_lifecycle_owned_by_release/);
  assert.match(content, /body\.status !== undefined/);
  assert.match(content, /publishedReleaseId/);
  assert.match(content, /Lifecycle config V5 chỉ được thay đổi bằng Preflight \/ Publish \/ Rollback/);
});

test('Telegram import preserves an existing Published config and release pointer', () => {
  assert.match(telegram, /preserveReleaseLifecycleWhileSelectingTelegram/);
  const helper = telegram.match(/async function preserveReleaseLifecycleWhileSelectingTelegram[\s\S]*?\n}\n\nfunction telegramMedia/)?.[0] || '';
  assert.match(helper, /select\("course_id,status,published_release_id,source_mode,telegram_source_id"\)/);
  assert.match(helper, /\.update\(\{[\s\S]*source_mode: "telegram"[\s\S]*telegram_source_id: sourceId/);
  assert.doesNotMatch(helper, /\.update\(\{[\s\S]*status:\s*"draft"/);
  assert.match(helper, /\.insert\(\{[\s\S]*status:\s*"draft"/);
});

test('Telegram authoring selects source before import without taking current learners offline', () => {
  const preserveIndex = telegram.indexOf('await preserveReleaseLifecycleWhileSelectingTelegram(course.id, sourceId)');
  const rowReadIndex = telegram.indexOf('tgcloner_source_messages');
  assert.ok(preserveIndex >= 0 && rowReadIndex > preserveIndex);
  assert.doesNotMatch(telegram, /v5_course_configs"\)\.upsert\([\s\S]*status:\s*"draft"/);
});
