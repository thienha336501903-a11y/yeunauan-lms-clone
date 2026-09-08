import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('verified V5 access reuses the enrollment and course already loaded by the access gate', () => {
  const access = read('utils/v4-telegram-access.js');
  const feed = read('utils/lms-handlers/v5-feed.js');
  const play = read('utils/lms-handlers/v5-play.js');

  assert.match(access, /verifiedEnrollment = access\.enrollment \|\| null/);
  assert.match(access, /if \(!enrollment\)/);
  assert.match(access, /courseTitle, course/);
  assert.match(feed, /const course = access\.course/);
  assert.match(play, /const course = access\.course/);
  assert.doesNotMatch(feed, /\.from\("courses"\)/);
  assert.doesNotMatch(play, /\.from\("courses"\)/);
});

test('V5 learner feed selects and returns only renderer-required asset fields', () => {
  const feed = read('utils/lms-handlers/v5-feed.js');
  assert.match(feed, /select\("id,type,provider,r2_object_key,original_filename,bytes,status,mime_type,duration_ms,width,height,thumbnail_asset_id"\)/);
  for (const field of ['origin:', 'metadata:']) {
    assert.doesNotMatch(feed, new RegExp(field));
  }
  assert.doesNotMatch(feed, /telegram_source_id|telegram_message_row_id|checksum_sha256/);
});
