import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V4 access requires course is_published', () => {
  const src = fs.readFileSync(new URL('../utils/v4-telegram-access.js', import.meta.url), 'utf8');
  assert.match(src, /select\("[^"]*is_published[^"]*"\)/);
  assert.match(src, /course_not_ready/);
  assert.match(src, /!course\?\.is_published/);
});

test('V4 entry handles course_not_ready without opening player', () => {
  const html = fs.readFileSync(new URL('../v4-entry.html', import.meta.url), 'utf8');
  assert.match(html, /course_not_ready/);
  assert.match(html, /mode:'not_ready'/);
  assert.match(html, /Quay lại Quản lý khóa học/);
});
