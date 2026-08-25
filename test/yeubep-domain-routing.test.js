import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const tokenHandler = read('utils/lms-handlers/legacy-entry-token.js');
const tokenEntry = read('v4-token-entry.html');
const v4 = read('v4.html');
const wizard = read('v4-course-wizard.html');

assert.equal(vercel.redirects.find(item => item.source === '/')?.destination, 'https://hoc.yeubep.shop/my-courses.html');
assert.match(tokenHandler, /process\.env\.V4_PUBLIC_URL\|\|"https:\/\/v4\.daubepnho\.store"/);
assert.match(tokenHandler, /process\.env\.VERCEL_ENV!=="production"/);
assert.match(tokenEntry, /href="https:\/\/hoc\.yeubep\.shop\/my-courses\.html"/);
assert.match(v4, /https:\/\/reader\.yeubep\.shop/);
assert.match(v4, /location\.href='https:\/\/hoc\.yeubep\.shop\/my-courses\.html'/);
assert.match(wizard, /new URL\('https:\/\/reader\.yeubep\.shop\/'\)/);
assert.match(wizard, /u\.hostname==='yeubep\.shop'/);

console.log('YeuBep LMS domain routing checks passed');
