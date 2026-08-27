import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('V5 multipart uses direct browser-to-R2 presigned part URLs', () => {
  const r2 = read('utils/v5-r2.js');
  const upload = read('utils/lms-handlers/admin-v5-upload.js');
  assert.match(r2, /presignUploadPart/);
  assert.match(r2, /X-Amz-Signature/);
  assert.match(r2, /UNSIGNED-PAYLOAD/);
  assert.match(upload, /action === "partUrl"/);
  assert.doesNotMatch(upload, /req\.body\?.*(?:buffer|base64|fileData)/i);
});

test('V5 multipart persists resumable sessions and verifies final object size', () => {
  const upload = read('utils/lms-handlers/admin-v5-upload.js');
  assert.match(upload, /v5_upload_sessions/);
  assert.match(upload, /provider_upload_id/);
  assert.match(upload, /part_size/);
  assert.match(upload, /completeMultipartUpload/);
  assert.match(upload, /headR2Object/);
  assert.match(upload, /Kích thước object không khớp/);
});

test('V5 upload is admin authenticated, course scoped, and can deduplicate ready R2 assets', () => {
  const upload = read('utils/lms-handlers/admin-v5-upload.js');
  assert.match(upload, /getAdminFromRequest/);
  assert.match(upload, /eq\("course_id", courseId\)/);
  assert.match(upload, /checksum_sha256/);
  assert.match(upload, /deduplicated: true/);
});

test('V5 upload routes through existing LMS admin function to preserve function budget', () => {
  const admin = read('api/lms/admin.js');
  assert.match(admin, /adminV5UploadHandler/);
  assert.match(admin, /endpoint === "v5-upload"/);
});
