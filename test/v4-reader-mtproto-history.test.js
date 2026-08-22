import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findMtprotoVideoMessage, findWarmupVideoMessages } from '../utils/v4-telegram-media-meta.js';

const prepublish = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-prepublish.js', import.meta.url), 'utf8');
const feed = fs.readFileSync(new URL('../utils/lms-handlers/v4-telegram-feed.js', import.meta.url), 'utf8');

function readerVideo(size = 5 * 1024 * 1024) {
  return {
    id: 'reader-video',
    message_type: 'video',
    raw_message: {
      from_reader: true,
      video: {
        file_id: '',
        file_size: size,
        mime_type: 'video/mp4',
        mtproto: true,
        thumbnail: { file_id: '', file_size: 12345, mtproto: true }
      }
    }
  };
}

test('prepublish accepts MTProto descriptors without fake Bot API file IDs', () => {
  assert.match(prepublish, /item\?\.file_id \|\| item\?\.mtproto/);
  assert.match(prepublish, /thumbnail\?\.file_id \|\| thumbnail\?\.mtproto/);
  assert.match(prepublish, /file_id\/MTProto/);
});

test('V4 feed exposes Reader MTProto video thumbnails', () => {
  assert.match(feed, /thumbnail\?\.file_id \|\| thumbnail\?\.mtproto/);
  assert.match(feed, /telegram_gateway_mtproto/);
  assert.match(feed, /playbackRequired: protectedVideo/);
});

test('small Reader videos still use MTProto warmup instead of Bot API', () => {
  const row = readerVideo();
  assert.equal(findMtprotoVideoMessage([row])?.id, 'reader-video');
  assert.deepEqual(findWarmupVideoMessages([row]).map((item) => item.id), ['reader-video']);
});
