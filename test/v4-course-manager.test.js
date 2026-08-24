import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

assert.match(page, /Khóa học của tôi/);
assert.match(page, /\['lms','v4'\]\.includes/);
assert.match(page, /LMS cũ và LMS V4 được hiển thị chung/);
assert.match(page, /\/legacy-post\.html\?course=/);
assert.doesNotMatch(page, /mode==='v4'\?`\/learning\?course=/);
assert.match(page, /registeredNotice/);
assert.match(page, /isMobileZaloBrowser/);
assert.match(page, /open-in-browser\.html/);
assert.doesNotMatch(page, /https:\/\/yeunauan\.live\/my-courses/);

console.log('Unified LMS and V4 course manager checks passed');
