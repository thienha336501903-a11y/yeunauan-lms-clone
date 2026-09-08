import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Google Drive admin auth logs only sanitized OAuth error fields', () => {
  const source = read('utils/lms-handlers/admin-drive-auth.js');
  assert.match(source, /function safeGoogleError\(err\)/);
  assert.match(source, /providerCode/);
  assert.match(source, /safeGoogleError\(err\)/);
  assert.doesNotMatch(source, /Failed to check Google Drive client info:", err\)/);
  assert.doesNotMatch(source, /\[admin-drive-auth\] Error:", err\)/);
  assert.doesNotMatch(source, /err\?\.config/);
  assert.doesNotMatch(source, /err\?\.body/);
});
