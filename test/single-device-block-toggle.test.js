import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const handler = fs.readFileSync(new URL('../utils/lms-handlers/legacy-entry-token.js', import.meta.url), 'utf8');
const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

test('single-device blocking is temporarily disabled by default but can be re-enabled', () => {
  assert.match(handler, /STUDENT_SINGLE_DEVICE_BLOCK_ENABLED/);
  assert.match(handler, /toLowerCase\(\)===\"true\"/);
  assert.match(handler, /if\(singleDeviceBlockEnabled\(\)\)\{/);
  assert.match(handler, /status\(409\)/);
  assert.match(envExample, /STUDENT_SINGLE_DEVICE_BLOCK_ENABLED=false/);
});

test('a different portal device rebinds the active student session instead of bypassing course access', () => {
  assert.match(handler, /\.from\(\"student_active_sessions\"\)[\s\S]*portal_device_id:portalDeviceId/);
  assert.match(handler, /Gmail này chưa được cấp quyền học khóa này/);
  assert.match(handler, /course\.active===false/);
  assert.match(handler, /course\.is_published!==true/);
});
