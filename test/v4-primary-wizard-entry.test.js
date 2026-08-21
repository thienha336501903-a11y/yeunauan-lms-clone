import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const advanced = fs.readFileSync(new URL('../v4-admin.html', import.meta.url), 'utf8');
const wizard = fs.readFileSync(new URL('../v4-course-wizard.html', import.meta.url), 'utf8');

test('main admin sends new V4 work to the launch wizard', () => {
  assert.match(admin, /href="\/v4-course-wizard\.html"[^>]*>🚀 Mở khóa V4<\/a>/);
  assert.doesNotMatch(admin, /href="\/v4-admin\.html"[^>]*>🚀 V4 Admin<\/a>/);
});

test('bare V4 admin route redirects to wizard while advanced/course routes remain available', () => {
  assert.match(advanced, /params\.get\('advanced'\)!=='1'/);
  assert.match(advanced, /!params\.get\('course'\)/);
  assert.match(advanced, /location\.replace\('\/v4-course-wizard\.html'\)/);
  assert.match(advanced, /Mở khóa mới bằng Wizard/);
  assert.match(advanced, /Tạo nhanh \(nâng cao\)/);
});

test('wizard is the primary flow and returns cleanly from Cloner', () => {
  assert.match(wizard, /href="\/v4-admin\.html\?advanced=1">V4 Admin nâng cao →<\/a>/);
  assert.match(wizard, /id="registerSourceLink"/);
  assert.match(wizard, /returnTo/);
  assert.match(wizard, /location\.origin\+'\/v4-course-wizard\.html'/);
  assert.doesNotMatch(wizard, /id="registerSourceLink"[^>]*target="_blank"/);
});
