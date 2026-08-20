// Final PR head marker: mobile resume/menu behavior is covered without touching course data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

test('V4 resume targets the next unseen lesson after last seen', () => {
  assert.match(page, /function getResumeLesson\(\)[\s\S]*lastIndex[\s\S]*lastIndex\+1[\s\S]*!seen\.has\(lessons\[i\]\.id\)/);
  assert.match(page, /function resumeCourse\(\)[\s\S]*applyFilter\('all'\)[\s\S]*scrollToLesson\(l\.id,false\)/);
  assert.match(page, /id="resumeFloatLabel"/);
});

test('V4 top-right options button opens a real course menu', () => {
  assert.match(page, /id="sideMenuBtn"/);
  assert.match(page, /id="mobileMenuBtn"/);
  assert.match(page, /id="courseMenu"/);
  assert.match(page, /id="menuResume"/);
  assert.match(page, /id="menuSearch"/);
  assert.match(page, /id="menuOutline"/);
  assert.match(page, /id="menuRefresh"/);
  assert.match(page, /id="menuCourses"/);
  assert.match(page, /function openCourseMenu\(/);
  assert.match(page, /\$\('mobileMenuBtn'\)\.onclick=openCourseMenu/);
});
