import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/learning.js', import.meta.url), 'utf8');

test('learning route resolves delivery_mode per requested course', () => {
  assert.match(source, /select\("delivery_mode"\)/);
  assert.match(source, /=== "v4"/);
  assert.match(source, /const requestedV4 = hasCourse \? await courseUsesV4\(courseSlug\) : false/);
});

test('per-course V4 override happens before legacy/global routing', () => {
  assert.match(source, /const target = requestedV4\s*\? "\/v4-entry\.html"/);
  assert.match(source, /isV4RoutingEnabled\(\) \? "\/v4-entry\.html" : "\/v3"/);
  assert.match(source, /hasCourse \? "\/lms\.html" : "\/v2-entry\.html"/);
});


test('bare /learning redirects to course manager instead of legacy feed', () => {
  assert.match(source, /if \(!hasCourse\)[\s\S]*res\.redirect\(307, \"\/my-courses\.html\"\)/);
});
