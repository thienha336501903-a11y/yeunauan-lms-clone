import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { v5LearnerReleaseContent } from '../utils/v5-release-snapshot.js';
import { buildV5ViewModel, buildTimelineOutline } from '../v5/ui-model.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const learnerApp = read('v5/app.js');

function lessonSnapshot(authoringMode = 'lesson') {
  return {
    schema: 'v5-release-v1',
    config: { source_mode: 'telegram', settings: { authoring_mode: authoringMode } },
    lessons: [
      {
        id: 'sys-timeline',
        title: 'Timeline',
        position: 1000,
        metadata: {
          system_lesson: true,
          telegram_source_id: 'must-not-leak',
          telegram_marker_row_id: 'must-not-leak'
        }
      },
      { id: 'default', title: 'Nội dung khóa học', position: 2000, metadata: { imported_from: 'telegram' } },
      { id: 'l1', title: 'Bài 1', position: 3000 },
      { id: 'l2', title: 'Bài 2', position: 4000 },
      { id: 'l3', title: 'Bài 3: Tạo hình', position: 5000 },
      { id: 'l4', title: 'Bài 4', position: 6000 },
      { id: 'l5', title: 'Bài 5: Thành phẩm', position: 7000 }
    ],
    posts: authoringMode === 'timeline'
      ? [
          { id: 'p1', lesson_id: 'sys-timeline', position: 1000, text_content: 'Timeline post 1' },
          { id: 'p2', lesson_id: 'sys-timeline', position: 2000, text_content: 'Timeline post 2' }
        ]
      : [
          { id: 'p0', lesson_id: 'default', position: 1000, text_content: 'Mở đầu' },
          { id: 'p1', lesson_id: 'l1', position: 2000, text_content: 'Bài 1' },
          { id: 'p2', lesson_id: 'l2', position: 3000, text_content: 'Bài 2' },
          { id: 'p3', lesson_id: 'l3', position: 4000, text_content: 'Bài 3' },
          { id: 'p4', lesson_id: 'l4', position: 5000, text_content: 'Bài 4' },
          { id: 'p5', lesson_id: 'l5', position: 6000, text_content: 'Bài 5' }
        ],
    links: [],
    asset_ids: []
  };
}

test('learner sanitizer preserves only the safe system_lesson marker', () => {
  const content = v5LearnerReleaseContent(lessonSnapshot());
  const systemLesson = content.lessons.find(lesson => lesson.id === 'sys-timeline');
  const normalLesson = content.lessons.find(lesson => lesson.id === 'default');

  assert.deepEqual(systemLesson.metadata, { system_lesson: true });
  assert.equal(systemLesson.metadata.telegram_source_id, undefined);
  assert.equal(systemLesson.metadata.telegram_marker_row_id, undefined);
  assert.equal(normalLesson.metadata, undefined, 'ordinary authoring metadata must not be exposed to learner payload');
});

test('published snapshot -> learner sanitizer -> view model hides Timeline and yields six learner lessons', () => {
  const learnerPayload = v5LearnerReleaseContent(lessonSnapshot());
  const viewModel = buildV5ViewModel({
    settings: learnerPayload.config.settings,
    authoringMode: learnerPayload.config.settings.authoring_mode,
    lessons: learnerPayload.lessons,
    posts: learnerPayload.posts,
    links: learnerPayload.links,
    assets: []
  });

  assert.equal(viewModel.length, 6);
  assert.deepEqual(viewModel.map(lesson => lesson.title), [
    'Nội dung khóa học',
    'Bài 1',
    'Bài 2',
    'Bài 3: Tạo hình',
    'Bài 4',
    'Bài 5: Thành phẩm'
  ]);
  assert.ok(!viewModel.some(lesson => lesson.title === 'Timeline'));
});

test('timeline authoring mode still builds outline from posts after safe system lesson sanitization', () => {
  const learnerPayload = v5LearnerReleaseContent(lessonSnapshot('timeline'));
  const payload = {
    settings: learnerPayload.config.settings,
    authoringMode: learnerPayload.config.settings.authoring_mode,
    lessons: learnerPayload.lessons,
    posts: learnerPayload.posts,
    links: learnerPayload.links,
    assets: []
  };
  const outline = buildTimelineOutline(payload);
  assert.equal(outline.length, 2);
  assert.deepEqual(outline.map(item => item.postId), ['p1', 'p2']);
});

test('scrollToLesson targets the feed lesson head instead of outline buttons', () => {
  const match = learnerApp.match(/function scrollToLesson\(lessonId, flash = true\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'scrollToLesson must exist');
  const source = match[0];

  assert.match(source, /#feed \.lesson-card\[data-lesson-id=/);
  assert.match(source, /#feed \.lesson-chip\[data-for-lesson=/);
  assert.match(source, /block: 'start'/);
  assert.doesNotMatch(source, /document\.querySelector\(`\[data-lesson-id=/, 'must not query the first lesson-id anywhere in the document');

  const missingTargetGuard = source.indexOf('if (!target) return;');
  const progressWrite = source.indexOf('lastSeen = String(lessonId);');
  assert.ok(missingTargetGuard >= 0 && progressWrite > missingTargetGuard, 'missing target must fail safely before progress changes');
});

test('mobile lesson outline closes first and scrolls on the next animation frame', () => {
  assert.match(
    learnerApp,
    /document\.querySelectorAll\('\.outline-item\[data-lesson-id\]'\)[\s\S]*?const lessonId = button\.dataset\.lessonId;[\s\S]*?closeOutline\(\);[\s\S]*?requestAnimationFrame\(\(\) => scrollToLesson\(lessonId\)\);/
  );
});
