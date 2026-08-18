import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../open-in-browser.html', import.meta.url), 'utf8');

assert.match(page, /Mở bằng Safari để tiếp tục/);
assert.match(page, /Nhấn dấu •••/);
assert.match(page, /Chọn “Mở bằng Safari”/);
assert.match(page, /q\.get\('checkout'\)==='1'/);
assert.match(page, /q\.delete\('checkout'\)/);
assert.match(page, /history\.replaceState/);
assert.match(page, /\/my-courses\.html\?registered=1/);
assert.doesNotMatch(page, /navigator\.userAgent/);
assert.doesNotMatch(page, /document\.referrer/);
assert.doesNotMatch(page, /Tôi đã mở Safari — Tiếp tục/);
assert.doesNotMatch(page, /accounts\.google\.com\/gsi\/client/);
assert.doesNotMatch(page, /requestAccessToken/);

console.log('Simplified legacy Safari checkout handoff checks passed');
