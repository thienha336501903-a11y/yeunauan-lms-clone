import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const probe = fs.readFileSync(new URL('../utils/lms-handlers/v5-r2-probe.js', import.meta.url), 'utf8');

assert.match(admin, /adminV5R2ProbeHandler/);
assert.match(admin, /endpoint === "v5-r2-probe"/);
assert.match(probe, /process\.env\.VERCEL_ENV !== "preview"/);
assert.match(probe, /String\(req\.query\?\.playback \|\| ""\) === "1"/);
assert.match(probe, /response\.status === 206/);
assert.match(probe, /content-range/i);
assert.match(probe, /accept-ranges/i);
assert.doesNotMatch(probe, /lease\.token/);

console.log('V5 preview playback probe routing checks passed');
