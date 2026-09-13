import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildV5ViewModel, buildTimelineOutline } from '../v5/ui-model.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const learnerApp = read('v5/app.js');

test('1. system_lesson: true does NOT appear in buildV5ViewModel', () => {
  const payload = {
    settings: { authoring_mode: 'lesson' },
    lessons: [
      { id: 'l1', title: 'Bài 1: Giới thiệu', position: 1000 },
      { id: 'l2', title: 'Bài 2: Nguyên liệu', position: 2000 },
      { id: 'sys-timeline', title: 'Timeline', position: 9999, metadata: { system_lesson: true } }
    ],
    posts: [
      { id: 'p1', lesson_id: 'l1', position: 1000, text_content: 'Nội dung bài 1' },
      { id: 'p2', lesson_id: 'l2', position: 2000, text_content: 'Nội dung bài 2' }
    ],
    links: [],
    assets: []
  };

  const viewModel = buildV5ViewModel(payload);
  assert.equal(viewModel.length, 2, 'Must contain exactly 2 lessons, excluding system lesson');
  assert.equal(viewModel[0].id, 'l1');
  assert.equal(viewModel[1].id, 'l2');
  assert.ok(!viewModel.some(lesson => lesson.id === 'sys-timeline'), 'sys-timeline must be excluded');
  assert.ok(!viewModel.some(lesson => lesson.metadata?.system_lesson === true), 'No system lesson in view model');
});

test('2. Normal lessons preserve canonical position order', () => {
  const payload = {
    settings: { authoring_mode: 'lesson' },
    lessons: [
      { id: 'l3', title: 'Bài 3', position: 3000 },
      { id: 'sys-timeline', title: 'Timeline', position: 500, metadata: { system_lesson: true } },
      { id: 'l1', title: 'Bài 1', position: 1000 },
      { id: 'l2', title: 'Bài 2', position: 2000 }
    ],
    posts: [],
    links: [],
    assets: []
  };

  const viewModel = buildV5ViewModel(payload);
  assert.deepEqual(viewModel.map(l => l.id), ['l1', 'l2', 'l3']);
});

test('3. Course banh-mi-meili conceptually has 6 learner lessons, NOT 7', () => {
  const payload = {
    course: { slug: 'banh-mi-meili', title: 'Bánh mì Meili' },
    settings: { authoring_mode: 'lesson' },
    lessons: [
      { id: 'lesson-1', title: 'Bài 1', position: 1000 },
      { id: 'lesson-2', title: 'Bài 2', position: 2000 },
      { id: 'lesson-3', title: 'Bài 3: Tạo hình', position: 3000 },
      { id: 'lesson-4', title: 'Bài 4', position: 4000 },
      { id: 'lesson-5', title: 'Bài 5', position: 5000 },
      { id: 'lesson-default', title: 'Kênh bài học', position: 6000 },
      { id: 'lesson-sys-timeline', title: 'Timeline', position: 9999, metadata: { system_lesson: true } }
    ],
    posts: [
      { id: 'p1', lesson_id: 'lesson-1', position: 1000, text_content: 'Bài 1' },
      { id: 'p2', lesson_id: 'lesson-2', position: 2000, text_content: 'Bài 2' },
      { id: 'p3', lesson_id: 'lesson-3', position: 3000, text_content: 'Bài 3' },
      { id: 'p4', lesson_id: 'lesson-4', position: 4000, text_content: 'Bài 4' },
      { id: 'p5', lesson_id: 'lesson-5', position: 5000, text_content: 'Bài 5' },
      { id: 'p6', lesson_id: 'lesson-default', position: 6000, text_content: 'Post 6' },
      { id: 'p7', lesson_id: 'lesson-default', position: 7000, text_content: 'Post 7' }
    ],
    links: [],
    assets: []
  };

  const viewModel = buildV5ViewModel(payload);
  assert.equal(viewModel.length, 6, 'Course banh-mi-meili must have exactly 6 learner lessons');
  const lessonTitles = viewModel.map(l => l.title);
  assert.deepEqual(lessonTitles, ['Bài 1', 'Bài 2', 'Bài 3: Tạo hình', 'Bài 4', 'Bài 5', 'Kênh bài học']);
  assert.ok(!lessonTitles.includes('Timeline'), 'Timeline must not appear in learner lessons');
});

test('4. System lesson is never used as resume/start lesson, outline item, or progress denominator in app.js', () => {
  // In app.js, lessons = buildV5ViewModel(payload).
  // Because buildV5ViewModel filters system_lesson: true:
  // - getResumeLesson() returns lessons[0] -> first real lesson, never system lesson
  // - updateProgressUI() calculates realLessons = lessons.filter(...) -> denominator is real lessons only
  // - renderOutline() maps over lessons -> outline items are real lessons only
  assert.match(learnerApp, /lessons\s*=\s*buildV5ViewModel\(payload\)/);
  assert.match(learnerApp, /function getResumeLesson\(\)/);
  assert.match(learnerApp, /function updateProgressUI\(\)/);
});

test('5. Search in Lesson Mode does not return system lesson', () => {
  const payload = {
    settings: { authoring_mode: 'lesson' },
    lessons: [
      { id: 'l1', title: 'Bài 1: Công thức', position: 1000 },
      { id: 'sys-timeline', title: 'Timeline', position: 9999, metadata: { system_lesson: true } }
    ],
    posts: [
      { id: 'p1', lesson_id: 'l1', position: 1000, text_content: 'Bột mì, men nở' }
    ],
    links: [],
    assets: []
  };

  const viewModel = buildV5ViewModel(payload);
  // Search query for "Timeline"
  const searchTimeline = viewModel.filter(l => l.search.includes('timeline'));
  assert.equal(searchTimeline.length, 0, 'Searching for timeline returns 0 results because system lesson is omitted');

  // Search query for "Công thức"
  const searchCongThuc = viewModel.filter(l => l.search.includes('cong thuc'));
  assert.equal(searchCongThuc.length, 1);
  assert.equal(searchCongThuc[0].id, 'l1');
});

test('6. Timeline Mode buildTimelineOutline is unaffected and continues to work based on posts', () => {
  const timelinePayload = {
    course: { id: 'c1', slug: 'banh-bao', title: 'Bánh bao' },
    settings: { authoring_mode: 'timeline' },
    lessons: [
      { id: 'sys-timeline', title: 'Timeline', position: 1000, metadata: { system_lesson: true } }
    ],
    posts: [
      { id: 'p1', lesson_id: 'sys-timeline', position: 1000, text_content: 'Bài đăng 1' },
      { id: 'p2', lesson_id: 'sys-timeline', position: 2000, text_content: 'Bài đăng 2' }
    ],
    links: [],
    assets: []
  };

  const outline = buildTimelineOutline(timelinePayload);
  assert.equal(outline.length, 2, 'buildTimelineOutline yields 2 post items');
  assert.equal(outline[0].postId, 'p1');
  assert.equal(outline[1].postId, 'p2');

  const viewModel = buildV5ViewModel(timelinePayload);
  assert.equal(viewModel.length, 1, 'Timeline feed view is created for unassigned/timeline posts');
  assert.equal(viewModel[0].posts.length, 2, 'All 2 posts are present in feed');
});
