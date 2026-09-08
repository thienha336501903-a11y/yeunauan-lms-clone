import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildV5ViewModel, mosaicClass, normalizeSearch } from '../v5/ui-model.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('V5 maps one imported Telegram post to one ordered visual mosaic plus separate documents', () => {
  const payload = {
    lessons: [{ id: 'lesson-1', title: 'Bài 1', position: 1 }],
    posts: [{ id: 'post-1', lesson_id: 'lesson-1', position: 1, text_content: 'Text', caption: 'Caption', display: { source_title: 'Bếp An', source_date: '2026-09-07T08:15:00Z' } }],
    links: [
      { post_id: 'post-1', asset_id: 'image-2', position: 2 },
      { post_id: 'post-1', asset_id: 'doc-1', position: 3 },
      { post_id: 'post-1', asset_id: 'image-1', position: 1 }
    ],
    assets: [
      { id: 'image-1', type: 'image' }, { id: 'image-2', type: 'image' }, { id: 'doc-1', type: 'document' }
    ]
  };
  const post = buildV5ViewModel(payload)[0].posts[0];
  assert.deepEqual(post.visualAssets.map(asset => asset.id), ['image-1', 'image-2']);
  assert.deepEqual(post.fileAssets.map(asset => asset.id), ['doc-1']);
  assert.equal(post.caption, 'Text\nCaption');
  assert.equal(post.textOnly, '');
  assert.equal(post.sourceTitle, 'Bếp An');
});

test('V5 keeps video order while decorating legacy video posters from the same lesson', () => {
  const payload = {
    lessons: [{ id: 'lesson-1', title: 'Bài 1', position: 1 }],
    posts: [
      { id: 'photo-post', lesson_id: 'lesson-1', position: 1 },
      { id: 'video-post', lesson_id: 'lesson-1', position: 2 }
    ],
    links: [
      { post_id: 'photo-post', asset_id: 'photo-1', position: 1 },
      { post_id: 'video-post', asset_id: 'video-1', position: 1 }
    ],
    assets: [
      { id: 'photo-1', type: 'image' },
      { id: 'video-1', type: 'video' }
    ]
  };
  const lesson = buildV5ViewModel(payload)[0];
  assert.deepEqual(lesson.posts.map(post => post.id), ['photo-post', 'video-post']);
  assert.equal(lesson.posts[1].visualAssets[0].thumbnail_asset_id, 'photo-1');
  assert.equal(lesson.posts[1].visualAssets[0].thumbnail_fallback, true);
});

test('V5 renders text-only posts independently and tolerates old releases without display metadata', () => {
  const payload = { lessons: [{ id: 'l', title: 'Bài cũ', position: 1 }], posts: [{ id: 'p', lesson_id: 'l', position: 1, text_content: 'Nội dung cũ' }], links: [], assets: [] };
  const post = buildV5ViewModel(payload)[0].posts[0];
  assert.equal(post.textOnly, 'Nội dung cũ');
  assert.equal(post.caption, '');
  assert.equal(post.sourceDate, '');
});

test('V5 mosaic classes cover one through six-plus media', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(mosaicClass), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6p', 'n6p']);
  const css = read('v5/styles.css');
  for (const name of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6p']) assert.match(css, new RegExp(`\\.media-grid\\.${name}`));
  assert.match(css, /\.media-grid\.n6p \.media-cell:nth-child\(n\+7\)\{display:none\}/);
});

test('V5 search is accent-insensitive and indexes text/caption', () => {
  assert.equal(normalizeSearch('Công thức Đậu đỏ'), 'cong thuc dau do');
  const model = read('v5/ui-model.js');
  assert.match(model, /uniqueText\(post\.text_content, post\.caption\)/);
});

test('V5 UI keeps protected media URLs demand-driven and V5-namespaced progress', () => {
  const app = read('v5/app.js');
  assert.match(app, /`\/v5\/media\/\$\{encodeURIComponent\(assetId\)\}/);
  assert.match(app, /video\.preload = 'none'/);
  assert.match(app, /`v5_progress_/);
  assert.match(app, /`v5_video_progress_/);
  assert.doesNotMatch(app, /telegram_gateway|v4-media|v4_progress_/);
});

test('new Telegram imports preserve exact source time and V4-compatible caption placement', () => {
  const importer = read('utils/lms-handlers/admin-v5-telegram-import.js');
  assert.match(importer, /source_date: unitSourceDate\(unit\)/);
  assert.match(importer, /text_content: hasMedia \? null/);
  assert.match(importer, /caption: hasMedia \? \(text \|\| null\)/);
  assert.doesNotMatch(importer, /new Date\(\)\.toISOString\(\).*source_date/);
});
