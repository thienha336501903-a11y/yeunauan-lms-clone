// Production retrigger marker: student expiry UX is covered without changing enrollment data or runtime behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

test('V4 course manager explains expired access clearly', () => {
  assert.match(page, /course\.expiredAt/);
  assert.match(page, /Đã hết hạn/);
  assert.match(page, /toLocaleDateString\('vi-VN'\)/);
  assert.match(page, /Liên hệ hỗ trợ nếu bạn cần gia hạn/);
  assert.match(page, /const action=c\.state==='ready'/);
});
