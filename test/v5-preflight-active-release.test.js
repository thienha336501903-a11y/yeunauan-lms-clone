import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-release.js', import.meta.url), 'utf8');

test('V5 preflight only evaluates media linked to active posts', () => {
  assert.match(source, /const activePostIds = new Set\(activePosts\.map/);
  assert.match(source, /const activeLinks = \(state\.links \|\| \[\]\)\.filter\(link => activePostIds\.has\(link\.post_id\)\)/);
  assert.match(source, /const activeAssets = \(state\.assets \|\| \[\]\)\.filter\(asset => linkedAssetIds\.has\(asset\.id\)\)/);
});

test('V5 preflight rejects active posts under archived lessons and missing linked assets', () => {
  assert.match(source, /invalidParentPosts/);
  assert.match(source, /Post thuộc Bài học đã archived\/không hợp lệ/);
  assert.match(source, /missingAssetCount/);
  assert.match(source, /media được gắn vào Post nhưng không còn tồn tại/);
});

test('every release media must be READY and backed by R2', () => {
  assert.match(source, /const nonReadyAssets = activeAssets\.filter\(a => a\.status !== "ready"\)/);
  assert.match(source, /const nonR2Assets = activeAssets\.filter\(a => a\.status === "ready" && \(a\.provider !== "r2" \|\| !a\.r2_object_key\)\)/);
});

test('Publish lifecycle warning reflects sale/content ownership split', () => {
  assert.match(source, /Publish chỉ cập nhật nội dung; hệ thống sẽ không tự mở bán/);
  assert.doesNotMatch(source, /học viên sẽ chưa vào được dù V5 đã Publish/);
});

test('V5 release endpoint rejects non-V5 course modes explicitly', () => {
  assert.match(source, /v5_course_mode_required/);
});
