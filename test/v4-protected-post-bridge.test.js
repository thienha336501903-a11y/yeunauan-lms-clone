import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manager = read('my-courses.html');
const post = read('legacy-post.html');
const dashboard = read('utils/lms-handlers/student-dashboard.js');
const tokenHandler = read('utils/lms-handlers/legacy-entry-token.js');
const tokenEntry = read('v4-token-entry.html');
const verifier = read('utils/lms-handlers/verify-entry-token.js');

// Both legacy LMS and V4 courses must enter through the same student-facing post.
assert.match(manager, /const learningUrl=`\/legacy-post\.html\?course=/);
assert.doesNotMatch(manager, /mode==='v4'\?`\/learning\?course=/);
assert.match(post, /\['lms','v4'\]\.includes\(mode\)/);
assert.equal((post.match(/Ấn để xem Bài học gốc phục vụ giảng dạy/g)||[]).length,2);
assert.match(post, /endpoint=legacy-entry-token/);
assert.match(post, /#FCF8F2/i);
assert.match(post, /Playfair Display/);
assert.match(post, /Công Thức &amp; Hướng Dẫn/);
assert.match(post, /grid-template-columns:1\.2fr 1fr/);
assert.match(post, /border-radius:28px/);
assert.match(post, /animation:entryNudge 4\.8s \.15s ease-in-out infinite/);
assert.match(post, /@keyframes entryNudge/);
assert.match(post, /0%,16%,100%/);
assert.match(post, /prefers-reduced-motion:reduce/);
assert.match(post, /\.entry:disabled[^}]*animation:none/);
assert.match(dashboard, /studentDisplayDescription/);
assert.match(dashboard, /originalLessonEntryVisible:raw\.originalLessonEntryVisible!==false/);
assert.match(post, /course\.originalLessonEntryVisible!==false/);
assert.match(post, /Bài học gốc hiện chưa được mở\./);
assert.match(post, /if\(enterButton\)enterButton\.addEventListener/);

// Delivery mode is resolved from the course row on the server, never trusted from the browser.
assert.match(tokenHandler, /select\("slug,active,is_published,delivery_mode,raw_data"\)/);
assert.match(tokenHandler, /SUPPORTED_DELIVERY_MODES\.has\(deliveryMode\)/);
assert.match(tokenHandler, /course\.raw_data\?\.originalLessonEntryVisible===false/);
assert.match(tokenHandler, /original_lesson_hidden/);
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
