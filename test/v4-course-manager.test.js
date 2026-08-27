import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

assert.match(page, /Khóa học của tôi/);
assert.match(page, /\['lms','v4','v5'\]\.includes/);
assert.match(page, /LMS cũ, LMS V4 và LMS V5 được hiển thị chung/);
assert.match(page, /mode==='v5'\?'LMS V5'/);
assert.match(page, /mode==='v5'\?`\/learning\?course=/);
assert.match(page, /`\/legacy-post\.html\?course=/);
assert.match(page, /registeredNotice/);
assert.match(page, /isMobileZaloBrowser/);
assert.match(page, /open-in-browser\.html/);
assert.doesNotMatch(page, /https:\/\/yeunauan\.live\/my-courses/);

console.log('Unified LMS, V4 and V5 course manager checks passed');
