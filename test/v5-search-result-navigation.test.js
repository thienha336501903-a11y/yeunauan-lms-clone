import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildV5ViewModel, buildTimelineOutline, normalizeSearch } from '../v5/ui-model.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const learnerApp = read('v5/app.js');
const learnerHtml = read('v5/index.html');
const learnerStyles = read('v5/styles.css');

// 1. Search 'Bài' trả N kết quả
test('1. Search function correctly returns matches across lessons and posts', () => {
  const sampleLessons = [
    {
      id: 'l1',
      title: 'Bài 1: Giới thiệu bánh bao',
      posts: [
        { id: 'p1', body: 'Chuẩn bị nguyên liệu làm bánh' },
        { id: 'p2', body: 'Ủ bột lần một' }
      ]
    },
    {
      id: 'l2',
      title: 'Bài 2: Tạo hình bánh bao',
      posts: [
        { id: 'p3', body: 'Tạo hình bánh bao hình con nhím' },
        { id: 'p4', body: 'Hấp bánh bao ở nhiệt độ chuẩn' }
      ]
    }
  ];

  function searchResults(lessons, query) {
    const results = [];
    for (const lesson of lessons) {
      for (const post of lesson.posts) {
        if (normalizeSearch(`${lesson.title} ${post.body}`).includes(query)) {
          results.push({ lesson, post });
        }
      }
    }
    return results;
  }

  const query = normalizeSearch('Bài');
  const results = searchResults(sampleLessons, query);
  assert.equal(results.length, 4, 'Should find all 4 posts in lessons matching "Bài"');
});

// 2. Click result thứ 2 → vẫn giữ keyword/search session
test('2. Clicking search result retains search query and does not invoke clearSearch', () => {
  assert.ok(learnerApp.includes('navigateSearchResult(Number(button.dataset.result))'), 'Clicking result must call navigateSearchResult without clearSearch');
  assert.doesNotMatch(
    learnerApp,
    /\$\('searchResultList'\)\.querySelectorAll\('\[data-result\]'\)\.forEach\([^)]*=>\s*\{[^}]*clearSearch/,
    'Result click listener must not call clearSearch'
  );
});

// 3. Hiển thị đúng 2 / N
test('3. Search navigator displays exact 1-based active result index over total (e.g. 2 / N)', () => {
  assert.match(learnerApp, /\$\('searchNavCount'\)\.textContent\s*=\s*`\$\{activeSearchResultIndex \+ 1\} \/ \$\{total\}`/);
});

// 4. Next → đúng result 3
test('4. nextSearchResult increments activeSearchResultIndex and updates navigation', () => {
  assert.ok(learnerApp.includes('function nextSearchResult()'), 'nextSearchResult must be defined');
  assert.match(learnerApp, /if\s*\(activeSearchResultIndex < searchResultsList\.length - 1\)\s*\{\s*navigateSearchResult\(activeSearchResultIndex \+ 1\);\s*\}/);
});

// 5. Previous → quay đúng result 2
test('5. previousSearchResult decrements activeSearchResultIndex and updates navigation', () => {
  assert.ok(learnerApp.includes('function previousSearchResult()'), 'previousSearchResult must be defined');
  assert.match(learnerApp, /if\s*\(activeSearchResultIndex > 0\)\s*\{\s*navigateSearchResult\(activeSearchResultIndex - 1\);\s*\}/);
});

// 6. Scroll đúng post.id trong Timeline Mode
test('6. Search navigation calls scrollToPost in Timeline Mode with false flash', () => {
  assert.match(learnerApp, /if\s*\(isTimelineMode\(\)\)\s*\{\s*scrollToPost\(result\.post\.id,\s*false\);\s*\}\s*else\s*\{\s*scrollToLesson\(result\.lesson\.id,\s*false\);\s*\}/);
});

// 7. Highlight đúng target
test('7. Search navigation calls highlightPost with post id and search query', () => {
  assert.match(learnerApp, /highlightPost\(result\.post\.id,\s*query\)/);
  assert.ok(learnerApp.includes('function highlightPost(postId, query)'), 'highlightPost must be present');
});

// 8. Không tự clear input sau click
test('8. Search input value is preserved after navigating to a result', () => {
  assert.match(learnerApp, /function navigateSearchResult\(index\)\s*\{/);
  // Verify navigateSearchResult does not clear search inputs
  const navigateFn = learnerApp.slice(learnerApp.indexOf('function navigateSearchResult'), learnerApp.indexOf('function nextSearchResult'));
  assert.ok(!navigateFn.includes("$('searchInput').value = ''"), 'navigateSearchResult must not clear desktop search input');
  assert.ok(!navigateFn.includes("$('mobileSearchInput').value = ''"), 'navigateSearchResult must not clear mobile search input');
  assert.ok(!navigateFn.includes("searchQuery = ''"), 'navigateSearchResult must not reset searchQuery');
});

// 9. Nút Close/Hủy mới clear search
test('9. Only explicit Close / Cancel actions clear the search session', () => {
  assert.match(learnerApp, /\$\('searchNavClose'\)\.addEventListener\('click',\s*clearSearch\)/);
  assert.match(learnerApp, /\$\('searchCancel'\)\.addEventListener\('click',\s*clearSearch\)/);
  assert.match(learnerApp, /\$\('mobileSearchClear'\)\.addEventListener\('click',\s*clearSearch\)/);
});

// 10. First result: Previous disabled
test('10. Previous button is disabled at the first result (index 0) without wrapping', () => {
  assert.match(learnerApp, /\$\('searchNavPrev'\)\.disabled\s*=\s*activeSearchResultIndex\s*<=\s*0/);
});

// 11. Last result: Next disabled
test('11. Next button is disabled at the last result (index total - 1) without wrapping', () => {
  assert.match(learnerApp, /\$\('searchNavNext'\)\.disabled\s*=\s*activeSearchResultIndex\s*>=\s*total\s*-\s*1/);
});

// 12. Search query mới reset active index hợp lý
test('12. Changing search query resets activeSearchResultIndex to -1 and hides navigator until selection', () => {
  assert.match(learnerApp, /if\s*\(searchQuery\s*!==\s*value\)\s*\{\s*activeSearchResultIndex\s*=\s*-1;\s*\}/);
});

// 13. Không có result → UI không lỗi
test('13. Zero-result search gracefully handles state and hides navigator without errors', () => {
  assert.match(learnerApp, /\$\('searchEmpty'\)\.hidden\s*=\s*results\.length\s*>\s*0/);
  assert.match(learnerApp, /if\s*\(!total\s*\|\|\s*activeSearchResultIndex\s*<\s*0\)\s*\{\s*\$\('searchNavigator'\)\.hidden\s*=\s*true;\s*return;\s*\}/);
});

// 14. Timeline 9 posts vẫn outline 9 items
test('14. Timeline Mode continues to render all 9 posts in the outline', () => {
  const posts = Array.from({ length: 9 }, (_, i) => ({
    id: `post-${i + 1}`,
    position: (i + 1) * 1000,
    body: `Bài học số ${i + 1}`
  }));
  const payload = {
    settings: { authoring_mode: 'timeline' },
    posts,
    links: [],
    assets: []
  };
  const outline = buildTimelineOutline(payload);
  assert.equal(outline.length, 9);
});

// 15. Mark seen một post không mark toàn bộ
test('15. Discrete seen state per post is preserved in Timeline Mode', () => {
  assert.match(learnerApp, /const isSeen\s*=\s*isTimeline\s*\?\s*seen\.has\(String\(post\.id\)\)\s*:\s*seen\.has\(String\(lesson\.id\)\)/);
  assert.match(learnerApp, /entry\.target\.dataset\.postId\s*:\s*entry\.target\.dataset\.lessonId/);
});

// 16. Direct Play sau F5 vẫn bắt đầu 0:00
test('16. Direct video play always starts at 0:00 (#172 semantics preserved)', () => {
  assert.match(learnerApp, /const resumeAt\s*=\s*resume\s*\?\s*resumeTimeFor\(cell\.dataset\.assetId\)\s*:\s*0/);
  assert.match(learnerApp, /startVideo\(cell\)/);
});

// 17. Chỉ “Tiếp tục học” mới resume saved position
test('17. Only explicit resume actions pass resume: true', () => {
  assert.match(learnerApp, /resumeSavedVideo\(\)\s*\{[\s\S]*?startVideo\(cell,\s*\{\s*resume:\s*true\s*\}\)[\s\S]*?\}/);
});

// 18. Legacy lesson-mode không regression
test('18. Non-timeline courses continue to use scrollToLesson on search jump', () => {
  assert.match(learnerApp, /else\s*\{\s*scrollToLesson\(result\.lesson\.id,\s*false\);\s*\}/);
});

// 19. Search navigator elements exist in index.html
test('19. searchNavigator elements are present in v5/index.html with expected IDs', () => {
  assert.ok(learnerHtml.includes('id="searchNavigator"'));
  assert.ok(learnerHtml.includes('id="searchNavQuery"'));
  assert.ok(learnerHtml.includes('id="searchNavCount"'));
  assert.ok(learnerHtml.includes('id="searchNavPrev"'));
  assert.ok(learnerHtml.includes('id="searchNavNext"'));
  assert.ok(learnerHtml.includes('id="searchNavListBtn"'));
  assert.ok(learnerHtml.includes('id="searchNavClose"'));
});

// 20. Search navigator styles exist in v5/styles.css
test('20. Search navigator styles and active state classes are defined in v5/styles.css', () => {
  assert.ok(learnerStyles.includes('.search-navigator'));
  assert.ok(learnerStyles.includes('.search-nav-bar'));
  assert.ok(learnerStyles.includes('.search-nav-query'));
  assert.ok(learnerStyles.includes('.search-nav-count'));
  assert.ok(learnerStyles.includes('.search-nav-btn'));
  assert.ok(learnerStyles.includes('.search-result.active'));
});
