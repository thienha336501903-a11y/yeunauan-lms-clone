import assert from 'node:assert/strict';
import fs from 'node:fs';

const r2 = fs.readFileSync(new URL('../utils/v5-r2.js', import.meta.url), 'utf8');
const upload = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-upload.js', import.meta.url), 'utf8');

assert.match(r2, /X-Amz-Content-Sha256/);
assert.match(r2, /UNSIGNED-PAYLOAD/);
assert.match(r2, /\.map\(\(\[key, value\]\) => \[rfc3986\(key\), rfc3986\(value\)\]\)/);
assert.doesNotMatch(r2, /localeCompare/);
assert.match(r2, /Range: "bytes=0-0"/);
assert.match(r2, /content-range/);
assert.match(r2, /rangeStatR2Object/);
assert.match(r2, /if \(head\.bytes > 0\) return head/);
assert.match(upload, /headR2Object\(\{ key: session\.object_key \}\)/);
assert.match(upload, /Kích thước object không khớp/);

console.log('V5 R2 SigV4 and range verification checks passed');
