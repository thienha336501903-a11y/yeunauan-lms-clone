import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const upload = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-upload.js', import.meta.url), 'utf8');

test('direct V5 upload reaches READY only after verified R2 HEAD and exact byte size', () => {
  assert.match(upload, /await headR2Object\(\{ key: session\.object_key \}\)/);
  assert.match(upload, /Kích thước object không khớp/);
  assert.match(upload, /update\(\{ status: "ready", uploaded_at: now, last_verified_at: now/);
});

test('direct V5 upload does not enqueue orphan media_probe jobs', () => {
  assert.doesNotMatch(upload, /job_type:\s*["']media_probe["']/);
  assert.doesNotMatch(upload, /reason:\s*["']direct_upload_complete["']/);
  assert.match(upload, /No asynchronous media_probe consumer currently exists/);
});
