import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clean,
  parseLessonMarker,
  isMarkerOnly,
  groupRows,
  telegramMedia,
  telegramThumbnail,
  planImport
} from '../utils/v5-telegram-planner.js';

test('1. parseLessonMarker correctly parses various Bài N formats', () => {
  assert.deepEqual(parseLessonMarker('Bài 1'), {
    isMarker: true,
    number: 1,
    suffix: '',
    title: 'Bài 1'
  });

  assert.deepEqual(parseLessonMarker('Bài 2: Hướng dẫn nhồi bột'), {
    isMarker: true,
    number: 2,
    suffix: 'Hướng dẫn nhồi bột',
    title: 'Bài 2: Hướng dẫn nhồi bột'
  });

  assert.deepEqual(parseLessonMarker('bai 10 - Nướng bánh'), {
    isMarker: true,
    number: 10,
    suffix: 'Nướng bánh',
    title: 'Bài 10: Nướng bánh'
  });

  assert.deepEqual(parseLessonMarker('Đây là bài viết giới thiệu'), {
    isMarker: false
  });
});

test('2. isMarkerOnly differentiates short markers from content posts', () => {
  // Short marker with no media -> marker-only (<= 16 words)
  assert.equal(isMarkerOnly('Bài 1: Mở đầu', false), true);
  assert.equal(isMarkerOnly('Bài 2: Kỹ thuật nhào bột căn bản cho người mới bắt đầu', false), true);

  // Marker with media -> NOT marker-only (creates a post)
  assert.equal(isMarkerOnly('Bài 1', true), false);

  // Long post (> 16 words) even if starting with Bài -> NOT marker-only
  const longText = 'Bài 1: Chào mừng các bạn đến với khóa học làm bánh bao kinh doanh 2026. Trong bài học này chúng ta sẽ cùng tìm hiểu về nguyên liệu và cách bảo quản men.';
  assert.equal(isMarkerOnly(longText, false), false);
});

test('3. groupRows natural-sorts and bundles media groups into single units', () => {
  const rows = [
    { id: 'r2', source_message_id: 102, media_group_id: 'mg1', message_type: 'photo' },
    { id: 'r1', source_message_id: 101, media_group_id: 'mg1', message_type: 'photo' },
    { id: 'r3', source_message_id: 103, media_group_id: null, message_type: 'text', text: 'Single post' }
  ];

  const units = groupRows(rows);
  assert.equal(units.length, 2);

  // First unit is the media group with 2 rows sorted by earliest source_message_id
  assert.equal(units[0].key, 'group:mg1');
  assert.equal(units[0].rows.length, 2);
  assert.equal(units[0].rows[0].id, 'r2'); // lowest source_message_id in unit is 101, but rows in group preserved

  // Second unit is the single message
  assert.equal(units[1].key, 'row:r3');
  assert.equal(units[1].rows[0].id, 'r3');
});

test('4. Partial media group import triggers controlled reconcile error', () => {
  const rows = [
    { id: 'r1', source_message_id: 101, media_group_id: 'mg1', message_type: 'photo' },
    { id: 'r2', source_message_id: 102, media_group_id: 'mg1', message_type: 'photo' }
  ];

  // Only r1 is mapped, r2 is unmapped
  const existingMappings = new Map([['r1', { post_id: 'p1' }]]);

  assert.throws(
    () => planImport({ rows, existingMappings, authoringMode: 'lesson' }),
    /đang import dở từ lần trước; cần reconcile trước khi tiếp tục/
  );
});

test('5. Preview dry-run in Lesson Mode accurately predicts lessons, posts, and mirror jobs', () => {
  const rows = [
    { id: 'r1', source_message_id: 1, message_type: 'text', text: 'Bài 1: Giới thiệu' }, // marker only (0 post)
    { id: 'r2', source_message_id: 2, message_type: 'video', caption: 'Video hướng dẫn', raw_message: { video: { file_id: 'vid1', mime_type: 'video/mp4', file_name: 'v1.mp4', duration: 60 } } }, // 1 post, 1 asset
    { id: 'r3', source_message_id: 3, media_group_id: 'album1', message_type: 'photo', raw_message: { photo: [{ file_id: 'p1' }] } }, // album 1 post, 2 assets
    { id: 'r4', source_message_id: 4, media_group_id: 'album1', message_type: 'photo', raw_message: { photo: [{ file_id: 'p2' }] } },
    { id: 'r5', source_message_id: 5, message_type: 'text', text: 'Bài 2: Làm nhân bánh' }, // marker only (0 post)
    { id: 'r6', source_message_id: 6, message_type: 'document', raw_message: { document: { file_id: 'doc1', file_name: 'recipe.pdf' } } } // 1 post, 1 asset
  ];

  const plan = planImport({
    rows,
    existingMappings: new Map(),
    existingLessons: [],
    authoringMode: 'lesson',
    sourceId: 'src-1'
  });

  assert.equal(plan.authoringMode, 'lesson');
  assert.equal(plan.totalRows, 6);
  assert.equal(plan.groupedUnits, 5); // r1, r2, [r3, r4], r5, r6
  assert.equal(plan.albums, 1);
  assert.equal(plan.detectedMarkers.length, 2);
  assert.equal(plan.predictedLessons, 2); // Lesson 1 and Lesson 2
  assert.equal(plan.predictedPosts, 3); // r2 (video), [r3,r4] (album), r6 (document)
  assert.equal(plan.predictedMediaAssets, 4); // 1 video + 2 photos + 1 doc
  assert.equal(plan.predictedTelegramMirrorJobs, 4);
});

test('6. Preview dry-run in Timeline Mode treats markers as regular continuous posts', () => {
  const rows = [
    { id: 'r1', source_message_id: 1, message_type: 'text', text: 'Bài 1: Giới thiệu' },
    { id: 'r2', source_message_id: 2, message_type: 'video', caption: 'Video 1', raw_message: { video: { file_id: 'vid1' } } },
    { id: 'r3', source_message_id: 3, media_group_id: 'album1', message_type: 'photo', raw_message: { photo: [{ file_id: 'p1' }] } },
    { id: 'r4', source_message_id: 4, media_group_id: 'album1', message_type: 'photo', raw_message: { photo: [{ file_id: 'p2' }] } },
    { id: 'r5', source_message_id: 5, message_type: 'text', text: 'Bài 2: Làm nhân' }
  ];

  const plan = planImport({
    rows,
    existingMappings: new Map(),
    existingLessons: [],
    authoringMode: 'timeline',
    sourceId: 'src-1',
    hiddenLessonId: 'hidden-timeline-lesson'
  });

  assert.equal(plan.authoringMode, 'timeline');
  assert.equal(plan.totalRows, 5);
  assert.equal(plan.groupedUnits, 4); // r1, r2, [r3,r4], r5
  assert.equal(plan.predictedLessons, 0); // zero lessons created in timeline mode!
  assert.equal(plan.predictedPosts, 4); // every unit is a continuous timeline post
  assert.equal(plan.detectedMarkers.length, 0); // markers NOT treated as lessons

  // Verify all target lessons point to hidden system lesson
  for (const unit of plan.plannedUnits) {
    assert.equal(unit.targetLesson.id, 'hidden-timeline-lesson');
  }
});

test('7. Incremental sync in Lesson Mode correctly reconstructs active lesson context', () => {
  // Scenario: In run 1, Bài 1 (r1), Video A (r2), Bài 2 (r3), Video B (r4) were imported.
  // Now in run 2, Telegram added Video C (r5) under Bài 2.
  const existingLessons = [
    { id: 'lesson-1', title: 'Bài 1: Bột', position: 1000, metadata: { imported_from: 'telegram', telegram_marker_row_id: 'r1', lesson_number: 1 } },
    { id: 'lesson-2', title: 'Bài 2: Nhân', position: 2000, metadata: { imported_from: 'telegram', telegram_marker_row_id: 'r3', lesson_number: 2 } }
  ];

  const existingMappings = new Map([
    ['r2', { post_id: 'post-1' }],
    ['r4', { post_id: 'post-2' }]
  ]);

  const rows = [
    { id: 'r1', source_message_id: 1, message_type: 'text', text: 'Bài 1: Bột' },
    { id: 'r2', source_message_id: 2, message_type: 'video', raw_message: { video: { file_id: 'v1' } } },
    { id: 'r3', source_message_id: 3, message_type: 'text', text: 'Bài 2: Nhân' },
    { id: 'r4', source_message_id: 4, message_type: 'video', raw_message: { video: { file_id: 'v2' } } },
    { id: 'r5', source_message_id: 5, message_type: 'video', caption: 'Video C bổ sung', raw_message: { video: { file_id: 'v3' } } }
  ];

  const plan = planImport({
    rows,
    existingMappings,
    existingLessons,
    authoringMode: 'lesson',
    sourceId: 'src-1'
  });

  assert.equal(plan.predictedLessons, 0, 'No new lessons should be created');
  assert.equal(plan.alreadySyncedUnits, 4, '4 units already synced');
  assert.equal(plan.newUnits, 1, 'Only 1 new unit to sync');
  assert.equal(plan.predictedPosts, 1, 'Only 1 new post');

  // Verify the new unit (r5) targetLesson is reconstructed to lesson-2 (Bài 2)!
  const newUnit = plan.plannedUnits.find(u => u.unitKey === 'row:r5');
  assert.ok(newUnit, 'Unit r5 must exist in plannedUnits');
  assert.equal(newUnit.targetLesson.id, 'lesson-2', 'Video C must attach to existing Bài 2');
});

test('8. Full idempotency: Running import plan a second time yields 0 new items', () => {
  const existingLessons = [
    { id: 'lesson-1', title: 'Bài 1: Bột', position: 1000, metadata: { imported_from: 'telegram', telegram_marker_row_id: 'r1', lesson_number: 1 } },
    { id: 'lesson-2', title: 'Bài 2: Nhân', position: 2000, metadata: { imported_from: 'telegram', telegram_marker_row_id: 'r3', lesson_number: 2 } }
  ];

  const existingMappings = new Map([
    ['r2', { post_id: 'p1' }],
    ['r4', { post_id: 'p2' }]
  ]);

  const rows = [
    { id: 'r1', source_message_id: 1, message_type: 'text', text: 'Bài 1: Bột' },
    { id: 'r2', source_message_id: 2, message_type: 'video', raw_message: { video: { file_id: 'v1' } } },
    { id: 'r3', source_message_id: 3, message_type: 'text', text: 'Bài 2: Nhân' },
    { id: 'r4', source_message_id: 4, message_type: 'video', raw_message: { video: { file_id: 'v2' } } }
  ];

  const plan = planImport({
    rows,
    existingMappings,
    existingLessons,
    authoringMode: 'lesson',
    sourceId: 'src-1'
  });

  assert.equal(plan.alreadySyncedUnits, 4);
  assert.equal(plan.newUnits, 0);
  assert.equal(plan.predictedLessons, 0);
  assert.equal(plan.predictedPosts, 0);
  assert.equal(plan.predictedMediaAssets, 0);
  assert.equal(plan.predictedTelegramMirrorJobs, 0);
});

test('9. Marker with substantial content creates both a lesson and a learner post', () => {
  const rows = [
    {
      id: 'r1',
      source_message_id: 1,
      message_type: 'video',
      caption: 'Bài 1: Kỹ thuật nhồi bột chuẩn và công thức chi tiết đính kèm',
      raw_message: { video: { file_id: 'v1', mime_type: 'video/mp4' } }
    }
  ];

  const plan = planImport({
    rows,
    existingMappings: new Map(),
    existingLessons: [],
    authoringMode: 'lesson',
    sourceId: 'src-1'
  });

  assert.equal(plan.predictedLessons, 1);
  assert.equal(plan.predictedPosts, 1);
  assert.equal(plan.plannedUnits[0].markerOnly, false);
  assert.equal(plan.plannedUnits[0].createsLesson, true);
  assert.equal(plan.plannedUnits[0].createsPost, true);
});

test('10. Telegram thumbnail is extracted correctly for video notes and videos', () => {
  const rowWithThumb = {
    source_message_id: 10,
    message_type: 'video',
    raw_message: {
      video: {
        file_id: 'v1',
        thumbnail: { file_id: 'thumb1', file_size: 1234, width: 320, height: 240 }
      }
    }
  };

  const thumb = telegramThumbnail(rowWithThumb);
  assert.ok(thumb);
  assert.equal(thumb.type, 'image');
  assert.equal(thumb.telegram.fileId, 'thumb1');
  assert.equal(thumb.telegram.variant, 'thumbnail');
  assert.equal(thumb.bytes, 1234);
});

test('11. Source binding: Cannot silently bind to a different Telegram source when mappings exist', async () => {
  const handlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');
  assert.match(handlerCode, /checkSourceBinding/);
  assert.match(handlerCode, /source_conflict/);
  assert.match(handlerCode, /Khóa này đã được liên kết với một nguồn Telegram khác/);
});

test('12. Published course safety: Telegram selection preserves published_release_id', async () => {
  const handlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');
  assert.match(handlerCode, /preserveReleaseLifecycleWhileSelectingTelegram/);
  assert.match(handlerCode, /select\("course_id,status,published_release_id,source_mode,telegram_source_id,settings"\)/);
});

test('13. Preview dry-run contract: action === "preview" is strictly read-only', async () => {
  const handlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');
  assert.match(handlerCode, /if\s*\(action\s*===\s*"preview"\)/);
  assert.match(handlerCode, /previewSource\(course,\s*sourceId\)/);
  // previewSource must not call .insert( or .update(
  const previewFnMatch = handlerCode.match(/async function previewSource[\s\S]*?return \{/);
  assert.ok(previewFnMatch, 'previewSource function must exist');
  assert.doesNotMatch(previewFnMatch[0], /\.insert\(/);
  assert.doesNotMatch(previewFnMatch[0], /\.update\(/);
  assert.doesNotMatch(previewFnMatch[0], /\.delete\(/);
});

test('14. Sources listing endpoint supports GET and action: "sources" without non-existent columns', async () => {
  const handlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');
  assert.match(handlerCode, /tgcloner_sources/);
  assert.match(handlerCode, /req\.method\s*===\s*"GET"\s*\|\|\s*req\.body\?\.action\s*===\s*"sources"/);
  // Must NOT query last_synced_at (column does not exist in tgcloner_sources)
  assert.doesNotMatch(handlerCode, /last_synced_at/);
  // Must select valid production columns
  assert.match(handlerCode, /\.select\("id,title,username,chat_id,indexed_message_count,created_at"\)/);
});

test('15. Single source of truth for mode: v5_course_configs.settings.authoring_mode', async () => {
  const handlerCode = fs.readFileSync(new URL('../utils/lms-handlers/admin-v5-telegram-import.js', import.meta.url), 'utf8');
  assert.match(handlerCode, /authoring_mode === "lesson" \? "lesson" : "timeline"/);
  assert.doesNotMatch(handlerCode, /telegram_import_mode/);
});

test('16. Invariants preserved: #172 direct play, #176 outline per post, #177 search session', () => {
  const learnerApp = fs.readFileSync(new URL('../v5/app.js', import.meta.url), 'utf8');
  // #172: direct play starts at 0:00, only explicit resume sets resume: true
  assert.match(learnerApp, /const resumeAt\s*=\s*resume\s*\?\s*resumeTimeFor\(cell\.dataset\.assetId\)\s*:\s*0/);
  assert.match(learnerApp, /startVideo\(cell,\s*\{\s*resume:\s*true\s*\}\)/);

  // #176: timeline outline per post and v5_timeline_progress
  assert.match(learnerApp, /buildTimelineOutline/);
  assert.match(learnerApp, /v5_timeline_progress_/);

  // #177: search navigation persistent session
  assert.match(learnerApp, /navigateSearchResult/);
  assert.match(learnerApp, /searchNavigator/);
});


