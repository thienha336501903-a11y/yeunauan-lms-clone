import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const tokenHandler = read('utils/lms-handlers/legacy-entry-token.js');
const tokenEntry = read('v4-token-entry.html');
const v4 = read('v4.html');
const wizard = read('v4-course-wizard.html');
const config = read('utils/clone-config.js');

assert.equal(vercel.redirects.find(item => item.source === '/')?.destination, '/my-courses.html');
assert.match(config, /lmsPublicUrl: "https:\/\/hoc\.yeubep\.shop"/);
assert.match(config, /v4PublicUrl: "https:\/\/v4\.daubepnho\.store"/);
assert.match(config, /telegramClonerUrl: "https:\/\/reader\.yeubep\.shop"/);
assert.match(tokenHandler, /cloneConfig\(\)\.v4PublicUrl/);
assert.match(tokenHandler, /process\.env\.VERCEL_ENV!=="production"/);
assert.match(tokenEntry, /api\/public-config\.js/);
assert.match(v4, /api\/public-config\.js/);
assert.match(wizard, /runtimeConfig\.telegramClonerUrl/);
assert.match(wizard, /runtimeConfig\.commercePublicUrl/);

console.log('YeuBep LMS domain routing checks passed');
