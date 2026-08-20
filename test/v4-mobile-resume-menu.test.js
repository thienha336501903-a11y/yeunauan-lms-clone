import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

// Final scope: repair Resume behavior and remove the unused top-right dots only.
test('V4 resume always advances to the next lesson from the current saved position', () => {
  assert.match(page, /function getResumeLesson\(\)[\s\S]*lastIndex<0[\s\S]*lessons\[\(lastIndex\+1\)%lessons\.length\]/);
  assert.match(page, /function scrollToLessonFromResume\(id\)[\s\S]*window\.scrollTo\(\{top,behavior:'smooth'\}\)/);
  assert.match(page, /const resume=\(\)=>\{const l=getResumeLesson\(\);if\(!l\)return;[\s\S]*applyFilter\('all'\)[\s\S]*scrollToLessonFromResume\(l\.id\)/);
});

test('V4 removes the unused top-right options button', () => {
  assert.doesNotMatch(page, /id="mobileMenuBtn"/);
  assert.doesNotMatch(page, /id="sideMenuBtn"/);
  assert.doesNotMatch(page, /id="courseMenu"/);
  assert.doesNotMatch(page, /aria-label="Tùy chọn"/);
});
