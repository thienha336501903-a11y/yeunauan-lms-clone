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
  assert.match(play, /\.eq\("thumbnail_asset_id", asset\.id\)/);
  assert.match(play, /some\(parent => v5ReleaseHasAsset\(release\.snapshot, parent\.id\)\)/);
});

test('V5 renders protected video posters without preloading video bytes', () => {
  const app = read('v5/app.js');
  assert.match(app, /asset\.thumbnail_asset_id \? mediaUrl\(asset\.thumbnail_asset_id\)/);
  assert.match(app, /class="video-poster-image" loading="lazy" data-v5-image data-src=/);
  assert.match(app, /video\.preload = 'none'/);
});

test('old releases reuse a nearby lesson image when a video has no dedicated thumbnail', () => {
  const model = read('v5/ui-model.js');
  assert.match(model, /const fallbackThumbnail = lessonPosts/);
  assert.match(model, /VIDEO_TYPES\.has\(asset\.type\) && !asset\.thumbnail_asset_id && fallbackThumbnail/);
  assert.match(model, /thumbnail_fallback: true/);
});

test('new Telegram video imports create a separate R2-mirrored thumbnail asset', () => {
  const importer = read('utils/lms-handlers/admin-v5-telegram-import.js');
  assert.match(importer, /function telegramThumbnail\(row\)/);
  assert.match(importer, /variant: "thumbnail"/);
  assert.match(importer, /thumbnail_asset_id: thumbnailAsset\?\.id \|\| null/);
  assert.match(importer, /queuedMirrorAssets\.push\(thumbnailAsset\.id\)/);
});
