import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/learning.js', import.meta.url), 'utf8');

test('learning route resolves delivery_mode once per requested course', () => {
  assert.match(source, /select\("delivery_mode"\)/);
  assert.match(source, /const deliveryMode = await courseDeliveryMode\(courseSlug\)/);
  assert.match(source, /const requestedV5 = deliveryMode === "v5"/);
  assert.match(source, /const requestedV4 = deliveryMode === "v4"/);
});

test('explicit V5 and V4 course routes happen before legacy global routing', () => {
  assert.match(source, /const target = requestedV5\s*\? "\/v5\/"\s*:\s*requestedV4\s*\? "\/v4-sw-refresh\.html"/);
  assert.match(source, /isV4RoutingEnabled\(\) \? "\/v4-sw-refresh\.html" : "\/v3"/);
  assert.match(source, /: "\/lms\.html"/);
});

test('bare /learning redirects to course manager instead of legacy feed', () => {
  assert.match(source, /if \(!hasCourse\)[\s\S]*res\.redirect\(307, "\/my-courses\.html"\)/);
});
