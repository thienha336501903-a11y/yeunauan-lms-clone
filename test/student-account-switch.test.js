import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

test('student can switch Google accounts without an auth bypass', () => {
  assert.match(page, /id="switchAccountBtn"[\s\S]*>Đổi tài khoản<\/button>/);
  assert.match(page, /function switchAccount\(\)\{sessionToken='';/);
  assert.match(page, /localStorage\.removeItem\('lms_verified_session_id'\)/);
  assert.match(page, /localStorage\.removeItem\('lms_session_id'\)/);
  assert.match(page, /localStorage\.removeItem\('lms_device_id'\)/);
  assert.match(page, /showLogin\('Chọn tài khoản Google khác để tiếp tục\.'\)/);
  assert.match(page, /tokenClient\.requestAccessToken\(\{prompt:'select_account'\}\)/);
  assert.doesNotMatch(page, /auth[_-]?bypass/i);
});
