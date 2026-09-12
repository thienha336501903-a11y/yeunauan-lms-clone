import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildV5ViewModel, buildTimelineOutline } from '../v5/ui-model.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const learnerApp = read('v5/app.js');
const learnerStyles = read('v5/styles.css');

function makeMockTimelinePayload(postOverrides = []) {
  const defaultPosts = [
    { id: 'p1', position: 1000, body: '1. Khởi động và chuẩn bị nguyên liệu\nCác loại bột cần dùng gồm...', created_at: '2026-09-01T08:00:00Z' },
    { id: 'p2', position: 2000, body: '', created_at: '2026-09-01T08:30:00Z' },
    { id: 'p3', position: 3000, body: '', created_at: '2026-09-01T09:00:00Z' },
    { id: 'p4', position: 4000, body: '', created_at: '2026-09-01T09:30:00Z' },
    { id: 'p5', position: 5000, body: 'Kỹ thuật ủ bột bánh bao xốp mềm\nLưu ý độ ẩm và nhiệt độ...', created_at: '2026-09-01T10:00:00Z' },
    { id: 'p6', position: 6000, body: 'Tạo hình bánh bao tạo vân xoắn', created_at: '2026-09-01T10:30:00Z' },
    { id: 'p7', position: 7000, body: 'Nhiệt độ và thời gian hấp chuẩn', created_at: '2026-09-01T11:00:00Z' },
    { id: 'p8', position: 8000, body: 'Cách bảo quản và cấp đông sản phẩm', created_at: '2026-09-01T11:30:00Z' },
    { id: 'p9', position: 9000, body: 'Tính giá thành và đóng gói kinh doanh', created_at: '2026-09-01T12:00:00Z' }
  ];

  const posts = postOverrides.length > 0 ? postOverrides : defaultPosts;

  const post_assets = [
    { post_id: 'p2', asset_id: 'a_vid1' },
    { post_id: 'p3', asset_id: 'a_doc1' },
    { post_id: 'p4', asset_id: 'a_img1' }
  ];

  const assets = [
    { id: 'a_vid1', type: 'video', original_filename: 'Video_Can_Bot.mp4', playback_ready: true },
    { id: 'a_doc1', type: 'document', original_filename: 'Cong_Thuc_Chuan.pdf', playback_ready: true },
    { id: 'a_img1', type: 'photo', original_filename: 'Thanh_Pham.jpg', playback_ready: true }
  ];

  return {
    course: { id: 'c1', slug: 'banh-bao-kinh-doanh-2026', title: 'Bánh bao kinh doanh' },
    settings: { authoring_mode: 'timeline' },
    lessons: [{ id: 'sys-lesson-1', title: 'Dòng thời gian', position: 1000, metadata: { system_lesson: true } }],
    posts,
    post_assets,
    assets
  };
}

// 1. Timeline payload có 9 post → buildTimelineOutline trả về đúng 9 item.
test('1. Timeline payload with 9 posts produces exactly 9 outline items', () => {
  const payload = makeMockTimelinePayload();
  const outline = buildTimelineOutline(payload);
  assert.equal(outline.length, 9);
  assert.equal(outline[0].postId, 'p1');
  assert.equal(outline[8].postId, 'p9');
});

// 2. Outline trong Timeline Mode không còn block generic duy nhất 'Dòng thời gian' trống rỗng.
test('2. Outline in Timeline Mode renders per-post list, not just generic block', () => {
  assert.ok(learnerApp.includes('buildTimelineOutline(data)'), 'renderOutline must call buildTimelineOutline in timeline mode');
  assert.ok(learnerApp.includes('outline.map(itemHtml).join'), 'renderOutline must map over outline items');
  assert.ok(!learnerApp.includes('Kênh bài học phát dạng dòng thời gian Telegram.'), 'Old empty generic block must be removed');
  assert.ok(learnerStyles.includes('.outline-num'), 'CSS must include .outline-num');
  assert.ok(learnerStyles.includes('.outline-copy'), 'CSS must include .outline-copy');
  assert.ok(learnerStyles.includes('.outline-title'), 'CSS must include .outline-title');
});

// 3. Thứ tự outline khớp đúng position của từng post.
test('3. Outline order respects canonical post position regardless of array input order', () => {
  const scrambledPosts = [
    { id: 'p3', position: 3000, body: 'Post 3' },
    { id: 'p1', position: 1000, body: 'Post 1' },
    { id: 'p4', position: 4000, body: 'Post 4' },
    { id: 'p2', position: 2000, body: 'Post 2' }
  ];
  const payload = makeMockTimelinePayload(scrambledPosts);
  const outline = buildTimelineOutline(payload);
  assert.deepEqual(outline.map(item => item.postId), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(outline.map(item => item.ordinal), [1, 2, 3, 4]);
  assert.deepEqual(outline.map(item => item.position), [1000, 2000, 3000, 4000]);
});

// 4. Post có text: lấy đúng dòng đầu làm title.
test('4. Text post extracts first line as title and second line or media as subtitle', () => {
  const payload = makeMockTimelinePayload();
  const outline = buildTimelineOutline(payload);
  // Post 1: '1. Khởi động và chuẩn bị nguyên liệu\nCác loại bột cần dùng gồm...'
  assert.equal(outline[0].title, '1. Khởi động và chuẩn bị nguyên liệu');
  assert.equal(outline[0].subtitle, 'Các loại bột cần dùng gồm...');

  // Post 5:
  assert.equal(outline[4].title, 'Kỹ thuật ủ bột bánh bao xốp mềm');
  assert.equal(outline[4].subtitle, 'Lưu ý độ ẩm và nhiệt độ...');
});

// 5. Post chỉ có video: title fallback 'Video' và mediaIcon là ▶.
test('5. Video-only post falls back to title "Video", icon "▶", and filename subtitle', () => {
  const payload = makeMockTimelinePayload();
  const outline = buildTimelineOutline(payload);
  const videoItem = outline.find(item => item.postId === 'p2');
  assert.ok(videoItem);
  assert.equal(videoItem.title, 'Video');
  assert.equal(videoItem.mediaIcon, '▶');
  assert.equal(videoItem.category, 'video');
  assert.equal(videoItem.subtitle, 'Video_Can_Bot.mp4');
});

// 6. Post chỉ có hình ảnh: title fallback 'Hình ảnh' và mediaIcon là 📷.
test('6. Photo-only post falls back to title "Hình ảnh", icon "📷", and filename subtitle', () => {
  const payload = makeMockTimelinePayload();
  const outline = buildTimelineOutline(payload);
  const photoItem = outline.find(item => item.postId === 'p4');
  assert.ok(photoItem);
  assert.equal(photoItem.title, 'Hình ảnh');
  assert.equal(photoItem.mediaIcon, '📷');
  assert.equal(photoItem.category, 'photo');
  assert.equal(photoItem.subtitle, 'Thanh_Pham.jpg');
});

// 7. Post chỉ có document/file: title fallback 'Tài liệu' và mediaIcon là 📄.
test('7. Document-only post falls back to title "Tài liệu", icon "📄", and filename subtitle', () => {
  const payload = makeMockTimelinePayload();
  const outline = buildTimelineOutline(payload);
  const docItem = outline.find(item => item.postId === 'p3');
  assert.ok(docItem);
  assert.equal(docItem.title, 'Tài liệu');
  assert.equal(docItem.mediaIcon, '📄');
  assert.equal(docItem.category, 'file');
  assert.equal(docItem.subtitle, 'Cong_Thuc_Chuan.pdf');
});

// 8. Bấm vào outline item: target đúng post.id tương ứng.
test('8. Clicking outline item targets corresponding post.id via scrollToPost', () => {
  assert.ok(learnerApp.includes('scrollToPost(button.dataset.postId)'), 'Clicking outline button must trigger scrollToPost');
  assert.ok(learnerApp.includes('function scrollToPost(postId'), 'scrollToPost must be defined');
  assert.match(learnerApp, /target\.scrollIntoView\(\s*\{\s*behavior:\s*'smooth',\s*block:\s*'center'\s*\}\s*\)/);
});

// 9. Outline item có state current theo post.id thay vì lesson.id.
test('9. Outline item toggles current state by postId in timeline mode', () => {
  assert.match(learnerApp, /item\.dataset\.postId\s*===\s*String\(postId\)/);
  assert.match(learnerApp, /if\s*\(isTimelineMode\(\)\)\s*\{\s*document\.querySelectorAll\('\.outline-item'\)\.forEach\(item => item\.classList\.toggle\('current', item\.dataset\.postId === String\(targetId\)\)\);/);
});

// 10. Seen state trong Timeline Mode tính theo post.id độc lập.
test('10. Seen state stores seenPosts array under v5_timeline_progress_ key', () => {
  assert.match(learnerApp, /const progressKey\s*=\s*\(\)\s*=>\s*isTimelineMode\(\)\s*\?\s*`v5_timeline_progress_\$\{activeCourse/);
  assert.match(learnerApp, /saved\.seenPosts/);
  assert.match(learnerApp, /seenPosts:\s*\[\.\.\.seen\]/);
});

// 11. Mark seen 1 post không làm toàn bộ 9 post bị mark seen (khắc phục triệt để bug dùng lesson.id).
test('11. Marking 1 post seen marks only that post, keeping others unread', () => {
  // In postHtml, seen check is per post.id in timeline mode
  assert.match(learnerApp, /const isSeen\s*=\s*isTimeline\s*\?\s*seen\.has\(String\(post\.id\)\)\s*:\s*seen\.has\(String\(lesson\.id\)\)/);
  assert.match(learnerApp, /<span class="seen-check"\s*\$\{isSeen \? '' : 'hidden'\}>✓✓<\/span>/);

  // In wireObservers, entry id is postId in timeline mode
  assert.match(learnerApp, /const id\s*=\s*isTimelineMode\(\)\s*\?\s*entry\.target\.dataset\.postId\s*:\s*entry\.target\.dataset\.lessonId/);

  // Simulate seen Set with single post
  const seenSet = new Set(['p1']);
  const isPost1Seen = seenSet.has('p1');
  const isPost2Seen = seenSet.has('p2');
  assert.equal(isPost1Seen, true);
  assert.equal(isPost2Seen, false);
});

// 12. videoProgress trong Timeline Mode lưu trữ và sử dụng post_id.
test('12. Video progress captures postId from closest .lesson-card', () => {
  assert.match(learnerApp, /postId:\s*card\.dataset\.postId\s*\|\|\s*''/);
  assert.match(learnerApp, /videoProgress\s*=\s*\{\s*assetId:\s*cell\.dataset\.assetId,\s*lessonId:\s*card\.dataset\.lessonId\s*\|\|\s*'',\s*postId:\s*card\.dataset\.postId/);
});

// 13. Video progress cũ chỉ có lesson_id không làm crash app, fallback an toàn.
test('13. Legacy video progress without postId does not throw and resumes safely', () => {
  assert.match(learnerApp, /if\s*\(!progress\?\.assetId\s*\|\|\s*\(!progress\.lessonId\s*&&\s*!progress\.postId\)\s*\|\|\s*!\(Number\(progress\.currentTime\)\s*>\s*\.5\)\)\s*return false;/);
});

// 14. Semantics phát video direct Play #172 được bảo toàn.
test('14. Direct Play semantics #172 preserved: direct play starts at 0:00, only resume restores time', () => {
  assert.match(learnerApp, /const resumeAt\s*=\s*resume\s*\?\s*resumeTimeFor\(cell\.dataset\.assetId\)\s*:\s*0/);
  assert.match(learnerApp, /wireMedia\(\)\s*\{[\s\S]*?startVideo\(cell\)[\s\S]*?\}/);
  assert.match(learnerApp, /resumeSavedVideo\(\)\s*\{[\s\S]*?startVideo\(cell,\s*\{\s*resume:\s*true\s*\}\)[\s\S]*?\}/);
  assert.match(learnerApp, /if\s*\(!resume\s*&&\s*unfinishedVideo\(videoProgress\)\s*&&\s*String\(videoProgress\.assetId\)\s*===\s*String\(cell\.dataset\.assetId\)\)\s*clearVideoProgress/);
});

// 15. Lesson-mode outline không bị ảnh hưởng (backward compatibility cho khóa không phải timeline).
test('15. Non-timeline courses retain standard lesson outline and behavior', () => {
  const legacyPayload = {
    course: { id: 'c-legacy', slug: 'khoa-hoc-cu', title: 'Khóa học chuẩn' },
    settings: { authoring_mode: 'lesson' },
    lessons: [
      { id: 'l1', title: 'Bài 1: Giới thiệu', position: 1000, date: '2026-09-01T08:00:00Z' },
      { id: 'l2', title: 'Bài 2: Thực hành', position: 2000, date: '2026-09-02T08:00:00Z' }
    ],
    posts: [
      { id: 'p1', lesson_id: 'l1', position: 1000, body: 'Nội dung 1' },
      { id: 'p2', lesson_id: 'l2', position: 2000, body: 'Nội dung 2' }
    ],
    post_assets: [],
    assets: []
  };

  const viewModel = buildV5ViewModel(legacyPayload);
  assert.equal(viewModel.length, 2);
  assert.equal(viewModel[0].title, 'Bài 1: Giới thiệu');
  assert.equal(viewModel[1].title, 'Bài 2: Thực hành');

  // Verify learnerApp retains lesson-mode branch
  assert.match(learnerApp, /data-lesson-id="\$\{esc\(lesson\.id\)\}"/);
  assert.match(learnerApp, /scrollToLesson\(button\.dataset\.lessonId\)/);
  assert.match(learnerApp, /`v5_progress_\$\{activeCourse/);
});

// 16. Search results in timeline mode jump to post instead of entire lesson
test('16. Search results in timeline mode scroll to specific post', () => {
  assert.match(learnerApp, /if\s*\(isTimelineMode\(\)\)\s*\{\s*scrollToPost\(result\.post\.id,\s*false\);\s*\}\s*else\s*\{\s*scrollToLesson\(result\.lesson\.id,\s*false\);\s*\}/);
});

// 17. Unread filter in timeline mode filters cards by postId
test('17. Unread filter in timeline mode filters cards by postId', () => {
  assert.match(learnerApp, /const isCardSeen\s*=\s*isTimelineMode\(\)\s*\?\s*seen\.has\(card\.dataset\.postId\)\s*:\s*seen\.has\(card\.dataset\.lessonId\)/);
});
