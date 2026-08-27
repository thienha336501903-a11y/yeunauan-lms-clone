import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const composer = read('v5-admin.html');
const upload = read('utils/lms-handlers/admin-v5-upload.js');
const adminRouter = read('api/lms/admin.js');
const capabilities = read('utils/lms-handlers/admin-v5-capabilities.js');

test('V5 composer lists only delivery_mode=v5 courses', () => {
  assert.match(composer, /courseMeta\?\.\[slug\]\?\.deliveryMode/);
  assert.match(composer, /toLowerCase\(\)==='v5'/);
});

test('smart folder upload can group folder paths and numbered filenames', () => {
  assert.match(composer, /id="folderInput"[^>]*webkitdirectory/);
  assert.match(composer, /function groupDescriptor\(file\)/);
  assert.match(composer, /function groupSmartFiles\(files\)/);
  assert.match(composer, /Bài \$\{String\(number\)\.padStart\(2,'0'\)\}/);
  assert.match(composer, /smartFolderImport\(files\)/);
  assert.match(composer, /contentAction\('createLesson'/);
});

test('media post is not created when R2 capability is unavailable', () => {
  const ensureIndex = composer.indexOf("if(files.length&&!(await ensureR2()))return;");
  const createIndex = composer.indexOf("contentAction('createPost'", ensureIndex);
  assert.ok(ensureIndex >= 0, 'R2 guard must exist before media post creation');
  assert.ok(createIndex > ensureIndex, 'media post creation must happen after R2 guard');
  assert.match(adminRouter, /endpoint === "v5-capabilities"/);
  assert.match(capabilities, /r2Upload: isR2Configured\(\)/);
});

test('multi-file posts stay processing until every linked asset is ready', () => {
  assert.match(upload, /async function refreshPostReadiness/);
  assert.match(upload, /assets\.every\(asset => asset\.status === "ready" \|\| asset\.status === "archived"\)/);
  assert.match(upload, /nextStatus = "processing"/);
  const assetInsert = upload.indexOf('.from("v5_media_assets")\n    .insert');
  const link = upload.indexOf('linkAssetToPost(course, postId, asset.id', assetInsert);
  const multipart = upload.indexOf('createMultipartUpload', assetInsert);
  assert.ok(assetInsert >= 0 && link > assetInsert, 'asset must be linked to the post after asset creation');
  assert.ok(multipart > link, 'asset must be linked before multipart upload starts');
});

test('Preflight / Publish button calls the real V5 release lifecycle', () => {
  assert.match(composer, /endpoint=v5-release/);
  assert.match(composer, /action:'preflight'/);
  assert.match(composer, /action:'publish'/);
  assert.match(composer, /Cổng bán vẫn tách riêng/);
});
