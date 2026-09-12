import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { v5ReleaseContent, v5LearnerReleaseContent } from '../utils/v5-release-snapshot.js';
import { buildV5ViewModel } from '../v5/ui-model.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const createCourseHandler = read('utils/lms-handlers/admin-v5-create-course.js');
const contentHandler = read('utils/lms-handlers/admin-v5-content.js');
const releaseHandler = read('utils/lms-handlers/admin-v5-release.js');
const feedHandler = read('utils/lms-handlers/v5-feed.js');
const adminPage = read('v5-admin.html');
const learnerApp = read('v5/app.js');
const releaseSnapshotUtil = read('utils/v5-release-snapshot.js');

// 1. New V5 course creation defaults to authoring_mode: 'timeline' in v5_course_configs.settings
test('1. New V5 course creation defaults to authoring_mode: timeline in v5_course_configs.settings', () => {
  assert.match(createCourseHandler, /settings:\s*\{\s*authoring_mode:\s*"timeline"\s*\}/);
});

// 2. Hidden system lesson is automatically provisioned for timeline mode (metadata: { system_lesson: true })
test('2. Hidden system lesson is automatically provisioned for timeline mode', () => {
  assert.match(createCourseHandler, /from\("v5_lessons"\)/);
  assert.match(createCourseHandler, /system_lesson:\s*true/);
  assert.match(contentHandler, /export async function ensureHiddenTimelineLesson/);
  assert.match(contentHandler, /system_lesson:\s*true/);
});

// 3. Admin content handler exposes authoringMode: 'timeline' and hiddenLessonId
test('3. Admin content handler exposes authoringMode and hiddenLessonId', () => {
  assert.match(contentHandler, /authoringMode\s*=\s*config\.settings\?\.authoring_mode/);
  assert.match(contentHandler, /hiddenLessonId/);
  assert.match(contentHandler, /return\s*\{\s*course,\s*config,\s*authoringMode,\s*hiddenLessonId/);
});

// 4. Creating a post in timeline mode without lessonId attaches to the hidden timeline lesson
test('4. Creating a post in timeline mode without lessonId attaches to the hidden timeline lesson', () => {
  assert.match(contentHandler, /if\s*\(!lessonId\s*&&\s*authoringMode\s*===\s*"timeline"\)/);
  assert.match(contentHandler, /ensureHiddenTimelineLesson\(course\.id\)/);
  assert.match(contentHandler, /lessonId\s*=\s*hiddenLesson\.id/);
});

// 5. Admin UI hides lesson controls when authoringMode === 'timeline'
test('5. Admin UI hides lesson controls when authoringMode === timeline', () => {
  assert.match(adminPage, /\$\('newLessonBtn'\)\.style\.display\s*=\s*isTimeline\s*\?\s*'none'/);
  assert.match(adminPage, /\$\('lessonList'\)\.style\.display\s*=\s*isTimeline\s*\?\s*'none'/);
});

// 6. Admin UI allows sending without selecting an active lesson in timeline mode
test('6. Admin UI allows sending without selecting an active lesson in timeline mode', () => {
  assert.match(adminPage, /const isTimeline\s*=\s*state\.authoringMode\s*===\s*'timeline'/);
  assert.match(adminPage, /const hasTarget\s*=\s*isTimeline\s*\|\|\s*state\.activeLessonId/);
  assert.match(adminPage, /if\(!isTimeline&&!state\.activeLessonId\)return toast\('Hãy tạo\/chọn một Bài học trước\.'\)/);
});

// 7. Post position is locked in immediately at createPost before file upload starts
test('7. Post position is locked in immediately at createPost before file upload starts', () => {
  const ensureR2Idx = adminPage.indexOf('if(files.length&&!(await ensureR2()))return;');
  const createPostIdx = adminPage.indexOf('const created=await contentAction(\'createPost\'', ensureR2Idx);
  const uploadLoopIdx = adminPage.indexOf('await uploadFile(files[i],postId,i)', createPostIdx);
  assert.ok(ensureR2Idx >= 0, 'ensureR2 guard must be present');
  assert.ok(createPostIdx > ensureR2Idx, 'createPost must precede file upload');
  assert.ok(uploadLoopIdx > createPostIdx, 'uploadFile must run after post ID and position are locked');
});

// 8. Multi-file upload in timeline mode creates a single post with multiple ordered attachments
test('8. Multi-file upload in timeline mode creates a single post with multiple ordered attachments', () => {
  assert.match(adminPage, /hasAttachments:\s*files\.length\s*>\s*0/);
  assert.match(adminPage, /for\(let i=0;i<files\.length;i\+\+\)\s*await uploadFile\(files\[i\],postId,i\)/);
});

// 9. Folder import in timeline mode natural-sorts files and creates sequential posts in timeline order
test('9. Folder import in timeline mode natural-sorts files and creates sequential posts in timeline order', () => {
  assert.match(adminPage, /if\(state\.authoringMode==='timeline'\)/);
  assert.match(adminPage, /localeCompare\(b\.name,undefined,\{numeric:true,sensitivity:'base'\}\)/);
  assert.match(adminPage, /const created=await contentAction\('createPost',\{lessonId:state\.hiddenLessonId\|\|null,textContent:item\.file\.name,hasAttachments:true\}\)/);
});

// 10. Post reorder action updates post positions via reorderPosts
test('10. Post reorder action updates post positions via reorderPosts', () => {
  assert.match(adminPage, /data-move-up=/);
  assert.match(adminPage, /data-move-down=/);
  assert.match(adminPage, /async function movePost\(postId,direction\)/);
  assert.match(adminPage, /contentAction\('reorderPosts',\{ids:reordered\.map\(p=>p\.id\)\}\)/);
  assert.match(contentHandler, /reorder\("v5_posts",\s*course,\s*req\.body\?\.ids\)/);
});

// 11. Preflight passes in timeline mode with hidden system lesson and attached posts
test('11. Preflight passes in timeline mode with hidden system lesson and attached posts', () => {
  // Simulate canonicalState in timeline mode
  const snapshot = {
    schema: 'v5-release-v1',
    config: { source_mode: 'direct', settings: { authoring_mode: 'timeline' } },
    lessons: [{ id: 'sys-lesson-1', title: 'Timeline', position: 1000, metadata: { system_lesson: true } }],
    posts: [
      { id: 'post-1', lesson_id: 'sys-lesson-1', position: 1000, text_content: 'Timeline message 1', metadata: {} },
      { id: 'post-2', lesson_id: 'sys-lesson-1', position: 2000, text_content: 'Timeline message 2', metadata: {} }
    ],
    links: [],
    asset_ids: []
  };
  const release = v5ReleaseContent(snapshot);
  assert.ok(release);
  assert.equal(release.lessons.length, 1);
  assert.equal(release.posts.length, 2);
  assert.equal(release.config.settings.authoring_mode, 'timeline');
});

// 12. Release snapshot preserves config.settings.authoring_mode: 'timeline'
test('12. Release snapshot preserves config.settings.authoring_mode: timeline', () => {
  assert.match(releaseHandler, /settings:\s*state\.config\.settings\s*\|\|\s*\{\}/);
  const snapshot = {
    schema: 'v5-release-v1',
    config: { source_mode: 'direct', settings: { authoring_mode: 'timeline' } },
    lessons: [{ id: 'l1', title: 'Timeline', position: 1000, metadata: { system_lesson: true } }],
    posts: [{ id: 'p1', lesson_id: 'l1', position: 1000, text_content: 'Hello' }],
    links: [],
    asset_ids: []
  };
  const content = v5LearnerReleaseContent(snapshot);
  assert.equal(content.config.settings.authoring_mode, 'timeline');
});

// 13. Learner feed endpoint (v5-feed) returns settings.authoring_mode: 'timeline'
test('13. Learner feed endpoint (v5-feed) returns settings.authoring_mode: timeline', () => {
  assert.match(feedHandler, /settings:\s*content\.config\?\.settings\s*\|\|\s*\{\s*authoring_mode:\s*authoringMode\s*\}/);
  assert.match(feedHandler, /authoringMode/);
});

// 14. Learner UI (v5/app.js, v5/ui-model.js) suppresses .lesson-chip in timeline mode
test('14. Learner UI suppresses .lesson-chip in timeline mode', () => {
  assert.match(learnerApp, /const isTimeline\s*=\s*data\?\.settings\?\.authoring_mode\s*===\s*'timeline'\s*\|\|\s*data\?\.authoringMode\s*===\s*'timeline'/);
  assert.match(learnerApp, /const showLessonChip\s*=\s*!isTimeline\s*&&\s*firstPost/);
  assert.match(learnerApp, /showLessonChip\s*\?\s*`<div class="lesson-chip"/);
});

// 15. Legacy V5 courses without timeline mode continue to render with lessons unchanged
test('15. Legacy V5 courses without timeline mode continue to render with lessons unchanged', () => {
  const legacySnapshot = {
    schema: 'v5-release-v1',
    config: { source_mode: 'telegram', settings: {} },
    lessons: [
      { id: 'l1', title: 'Bài 1', position: 1000 },
      { id: 'l2', title: 'Bài 2', position: 2000 }
    ],
    posts: [
      { id: 'p1', lesson_id: 'l1', position: 1000, text_content: 'Intro 1' },
      { id: 'p2', lesson_id: 'l2', position: 2000, text_content: 'Intro 2' }
    ],
    links: [],
    asset_ids: []
  };
  const content = v5LearnerReleaseContent(legacySnapshot);
  assert.equal(content.config.source_mode, 'telegram');
  assert.equal(content.config.settings, undefined); // No authoring_mode leaked if absent

  const viewModel = buildV5ViewModel(content);
  assert.equal(viewModel.length, 2);
  assert.equal(viewModel[0].title, 'Bài 1');
  assert.equal(viewModel[1].title, 'Bài 2');
  assert.equal(viewModel[0].posts.length, 1);
  assert.equal(viewModel[1].posts.length, 1);
});
