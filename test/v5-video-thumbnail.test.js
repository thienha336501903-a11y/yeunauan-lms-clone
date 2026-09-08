import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V5 learner feed exposes only a safe thumbnail asset relationship', () => {
  const feed = read('utils/lms-handlers/v5-feed.js');
  assert.match(feed, /playableThumbnailIds\.has\(String\(asset\.thumbnail_asset_id \|\| ""\)\)/);
  assert.match(feed, /const thumbnailIds =/);
  assert.doesNotMatch(feed, /telegram_source_id|telegram_message_row_id|checksum_sha256/);
});

test('V5 authorizes a thumbnail only through a released parent asset', () => {
  const play = read('utils/lms-handlers/v5-play.js');
  const migration = read('sql/migration_lms_v5_playback_authorization_rpc_20260908.sql');
  assert.match(play, /v5_authorize_playback_asset/);
  assert.match(migration, /parent_asset\.thumbnail_asset_id = p_asset_id/);
  assert.match(migration, /parent_asset\.type = 'video'/);
  assert.match(migration, /parent_release_link ->> 'asset_id' = parent_asset\.id::text/);
  assert.match(migration, /vc\.status = 'published'/);
  assert.match(migration, /vr\.status = 'published'/);
});

test('V5 renders protected video posters without preloading video bytes', () => {
  const app = read('v5/app.js');
  assert.match(app, /asset\.thumbnail_asset_id \? mediaUrl\(asset\.thumbnail_asset_id\)/);
  assert.match(app, /class="video-poster-image" loading="lazy" data-v5-image data-src=/);
  assert.match(app, /video\.preload = 'none'/);
});

test('new Telegram video imports create a separate R2-mirrored thumbnail asset', () => {
  const importer = read('utils/lms-handlers/admin-v5-telegram-import.js');
  assert.match(importer, /function telegramThumbnail\(row\)/);
  assert.match(importer, /variant: "thumbnail"/);
  assert.match(importer, /thumbnail_asset_id: thumbnailAsset\?\.id \|\| null/);
  assert.match(importer, /queuedMirrorAssets\.push\(thumbnailAsset\.id\)/);
});
