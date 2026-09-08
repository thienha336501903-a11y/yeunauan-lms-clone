import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('direct V5 video uploads extract a frame locally and upload it as a separate R2 image', () => {
  const admin = read('v5-admin.html');
  assert.match(admin, /function videoThumbnailFile\(file\)/);
  assert.match(admin, /drawImage\(video/);
  assert.match(admin, /canvas\.toBlob/);
  assert.match(admin, /makeThumbnail:false/);
  assert.match(admin, /action:'attachThumbnail'/);
});

test('thumbnail attachment is admin-only, course-scoped, type-checked and never links the image as post media', () => {
  const upload = read('utils/lms-handlers/admin-v5-upload.js');
  assert.match(upload, /async function attachThumbnail\(course, body\)/);
  assert.match(upload, /\.eq\("asset_id", parentAssetId\)/);
  assert.match(upload, /parent\.type !== "video"/);
  assert.match(upload, /thumbnail\.type !== "image"/);
  assert.match(upload, /thumbnail_asset_id: thumbnail\.id/);
  assert.doesNotMatch(upload, /linkAssetToPost\(course, [^\n]*thumbnailAssetId/);
});
