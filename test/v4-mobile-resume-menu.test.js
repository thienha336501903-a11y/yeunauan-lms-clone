import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

// Final scope: repair Resume behavior and remove the unused top-right dots only.
test('V4 resume targets the next unseen lesson after last seen', () => {
  assert.match(page, /function getResumeLesson\(\)[\s\S]*lastIndex[\s\S]*lastIndex\+1[\s\S]*!seen\.has\(lessons\[i\]\.id\)/);
  assert.match(page, /const resume=\(\)=>\{const l=getResumeLesson\(\);if\(!l\)return;[\s\S]*applyFilter\('all'\)[\s\S]*scrollToLesson\(l\.id,false\)/);
});

test('V4 removes the unused top-right options button', () => {
  assert.doesNotMatch(page, /id="mobileMenuBtn"/);
  assert.doesNotMatch(page, /id="sideMenuBtn"/);
  assert.doesNotMatch(page, /id="courseMenu"/);
  assert.doesNotMatch(page, /aria-label="Tùy chọn"/);
});
