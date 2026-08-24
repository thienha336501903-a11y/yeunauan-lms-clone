import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isMobileZaloBrowser } from '../client-browser.js';

const page = fs.readFileSync(new URL('../open-in-browser.html', import.meta.url), 'utf8');
const manager = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

assert.match(page, /Mở bằng trình duyệt để tiếp tục/);
assert.match(page, /Nhấn dấu ⋯/);
assert.match(page, /Chọn “Mở bằng trình duyệt”/);
assert.match(page, /Chrome, Samsung Internet, Safari hoặc trình duyệt mặc định/);
assert.match(page, /browser-cue__arrow/);
assert.match(page, /Nhấn dấu ⋯ ở đây/);
assert.match(page, /@keyframes cue-arrow/);
assert.match(page, /prefers-reduced-motion:reduce/);
assert.doesNotMatch(page, /class="phone"/);
assert.doesNotMatch(page, /Mở bằng Safari để tiếp tục/);
assert.doesNotMatch(page, /Chọn “Mở bằng Safari”/);
assert.match(page, /q\.get\('checkout'\)==='1'/);
assert.match(page, /q\.delete\('checkout'\)/);
assert.match(page, /history\.replaceState/);
assert.match(page, /\/my-courses\.html\?registered=1/);
assert.match(page, /if\(!isMobileZaloBrowser\(navigator\.userAgent\)\)/);
assert.match(manager, /if\(isMobileZaloBrowser\(navigator\.userAgent\)\)/);
assert.match(manager, /error_callback:\(\)=>showLogin/);
assert.doesNotMatch(manager, /error_callback:goLegacyHandoff/);
assert.doesNotMatch(manager, /catch\(e\)\{goLegacyHandoff\(\)\}/);
assert.doesNotMatch(page, /document\.referrer/);
assert.doesNotMatch(page, /Tôi đã mở Safari — Tiếp tục/);
assert.doesNotMatch(page, /accounts\.google\.com\/gsi\/client/);
assert.doesNotMatch(page, /requestAccessToken/);

const desktopChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';
const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const androidChrome = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/151.0 Mobile Safari/537.36';
const iosZalo = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Zalo/25.01.01';
const androidZalo = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/151.0 Mobile Safari/537.36 Zalo/25.01.01';
const desktopWithZaloText = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZaloPC/24.12 Chrome/131.0 Safari/537.36';

assert.equal(isMobileZaloBrowser(desktopChrome), false);
assert.equal(isMobileZaloBrowser(iosSafari), false);
assert.equal(isMobileZaloBrowser(androidChrome), false);
assert.equal(isMobileZaloBrowser(iosZalo), true);
assert.equal(isMobileZaloBrowser(androidZalo), true);
assert.equal(isMobileZaloBrowser(desktopWithZaloText), false);

console.log('Mobile Zalo checkout handoff checks passed');
