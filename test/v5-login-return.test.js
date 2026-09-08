import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entry = readFileSync(new URL('../v3-entry.html', import.meta.url), 'utf8');

test('V3 login bridge returns authenticated V5 learners to V5', () => {
  assert.match(entry, /returnMode=String\(qs\.get\('return'\)\|\|''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(entry, /if\(returnMode==='v5'\)return '\/v5\/\?course='\+course/);
  assert.match(entry, /if\(returnMode==='v4'\)return '\/v4\.html\?course='\+course/);
});

test('V3 course selection preserves an explicit V5 return mode', () => {
  assert.match(entry, /if\(returnMode==='v4'\|\|returnMode==='v5'\)p\.set\('return',returnMode\)/);
  assert.match(entry, /a\.href=entryUrl\(slug\)/);
  assert.match(entry, /location\.href=entryUrl\(cs\[0\]\.slug\)/);
});
