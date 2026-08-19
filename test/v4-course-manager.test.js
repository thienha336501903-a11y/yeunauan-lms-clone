import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

assert.match(page, /Khóa học V4 của tôi/);
assert.match(page, /filter\(c=>String\(c\.deliveryMode\|\|''\)\.trim\(\)\.toLowerCase\(\)==='v4'\)/);
assert.match(page, /\/learning\?course=/);
assert.match(page, /registeredNotice/);
assert.match(page, /isEmbeddedBrowser/);
assert.match(page, /open-in-browser\.html/);
assert.doesNotMatch(page, /https:\/\/yeunauan\.live\/my-courses/);

console.log('V4-only course manager checks passed');
