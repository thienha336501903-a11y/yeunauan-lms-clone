import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../open-in-browser.html', import.meta.url), 'utf8');

assert.match(page, /Mở bằng Safari để tiếp tục/);
assert.match(page, /Nhấn dấu •••/);
assert.match(page, /Chọn “Mở bằng Safari”/);
assert.match(page, /\/my-courses\.html\?registered=1/);
assert.match(page, /if\(iosSafari\|\|regularBrowser\)/);
assert.doesNotMatch(page, /accounts\.google\.com\/gsi\/client/);
assert.doesNotMatch(page, /requestAccessToken/);

console.log('Safari checkout handoff regression checks passed');
