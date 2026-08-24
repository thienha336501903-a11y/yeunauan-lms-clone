import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manager = read('my-courses.html');
const post = read('legacy-post.html');
const tokenHandler = read('utils/lms-handlers/legacy-entry-token.js');
const tokenEntry = read('v4-token-entry.html');
const verifier = read('utils/lms-handlers/verify-entry-token.js');

// Both legacy LMS and V4 courses must enter through the same student-facing post.
assert.match(manager, /const learningUrl=`\/legacy-post\.html\?course=/);
assert.doesNotMatch(manager, /mode==='v4'\?`\/learning\?course=/);
assert.match(post, /\['lms','v4'\]\.includes\(mode\)/);
assert.match(post, /Bài học gốc phục vụ giảng dạy/);
assert.match(post, /endpoint=legacy-entry-token/);

// Delivery mode is resolved from the course row on the server, never trusted from the browser.
assert.match(tokenHandler, /select\("slug,active,is_published,delivery_mode"\)/);
assert.match(tokenHandler, /SUPPORTED_DELIVERY_MODES\.has\(deliveryMode\)/);
assert.doesNotMatch(tokenHandler, /req\.body\?\.delivery_mode/);
assert.match(tokenHandler, /deliveryMode==="v4"/);
assert.match(tokenHandler, /\/v4-token-entry\.html\?course=/);
assert.match(tokenHandler, /\/lms\.html\?entry_token=/);

// V4 consumes the one-time token, stores the verified session, then resumes normal V4 routing.
assert.match(tokenEntry, /endpoint=verify-entry-token/);
assert.match(tokenEntry, /history\.replaceState/);
assert.match(tokenEntry, /lms_verified_session_id/);
assert.match(tokenEntry, /lms_session_id/);
assert.match(tokenEntry, /location\.replace\('\/learning\?course='/);
assert.match(verifier, /markLmsEntryTokenUsed/);

console.log('V4 protected post bridge checks passed');
