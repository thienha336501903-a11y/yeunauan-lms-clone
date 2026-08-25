import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

test('V4 mobile search has an accessible touch target and visible controls', () => {
  assert.match(page, /id="mobileSearchBtn"[^>]*aria-controls="mobileSearch"[^>]*aria-expanded="false"/);
  assert.match(page, /id="mobileSearch" role="search"/);
  assert.match(page, /id="mobileSearchInput" type="search"/);
  assert.match(page, /id="mobileSearchClear"[^>]*aria-label="Xóa nội dung tìm kiếm"/);
  assert.match(page, /id="mobileSearchStatus" aria-live="polite"/);
  assert.match(page, /\.iconbtn\{[^}]*width:44px;[^}]*height:44px;[^}]*touch-action:manipulation/);
});

test('V4 mobile search opens immediately, focuses the field and reports its state', () => {
  assert.match(page, /function setMobileSearchOpen\(open,\{clear=false\}=\{\}\)/);
  assert.match(page, /btn\.setAttribute\('aria-expanded',String\(open\)\)/);
  assert.match(page, /if\(open\)\{try\{input\.focus\(\{preventScroll:true\}\)\}/);
  assert.match(page, /mobileSearchBtn'\)\.addEventListener\('click',toggleMobileSearch\)/);
  assert.doesNotMatch(page, /setTimeout\(\(\)=>\$\('mobileSearchInput'\)\.focus\(\),50\)/);
});

test('V4 search is accent-insensitive and indexes only lesson text and media names', () => {
  assert.match(page, /normalize\('NFD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g,''\)\.replace\(\/đ\/g,'d'\)/);
  assert.match(page, /function searchFields\(posts,fallback\)/);
  assert.match(page, /texts=\[\.\.\.new Set\(posts\.map\(p=>String\(p\.text\|\|''\)/);
  assert.match(page, /files=\[\.\.\.new Set\(posts\.map\(p=>String\(p\.media\?\.name\|\|''\)/);
  assert.doesNotMatch(page, /data\.source.*search/i);
});

test('V4 search renders compact ranked results instead of full lesson cards', () => {
  assert.match(page, /id="searchResults"[^>]*hidden/);
  assert.match(page, /id="searchResultList"/);
  assert.match(page, /function searchMatch\(lesson,qn\)/);
  assert.match(page, /if\(titleAt>=0\)return\{score:300-titleAt/);
  assert.match(page, /class="search-result-snippet"/);
  assert.match(page, /feed'\)\.classList\.toggle\('feed-searching',searching\)/);
  assert.match(page, /searchResultsCache\.slice\(0,searchLimit\)/);
});

test('V4 compact search supports counts, no-result state, clear and navigation', () => {
  assert.match(page, /Tìm thấy \$\{searchResultsCache\.length\} bài học/);
  assert.match(page, /searchResultsCache\.length!==0/);
  assert.match(page, /id="searchEmpty"[^>]*hidden/);
  assert.match(page, /mobileSearchClear'\)\.addEventListener\('click',\(\)=>clearSearch/);
  assert.match(page, /id="searchReturn"[^>]*hidden/);
  assert.match(page, /function openSearchResult\(result\)/);
  assert.match(page, /if\(e\.key==='Enter'&&searchResultsCache\[0\]\)/);
});

test('V4 search result keeps the exact matched media target after the mobile keyboard closes', () => {
  assert.match(page, /data-lesson-index="\$\{index\}"/);
  assert.match(page, /data-result-rank="\$\{rank\}"/);
  assert.match(page, /querySelector\(`\.lesson-card\[data-lesson-index="\$\{result\?\.index\}"\]`\)/);
  assert.match(page, /targetMessageId:String\(post\.id\|\|post\.telegramMessageId\|\|''\)/);
  assert.match(page, /card\.querySelector\(`\[data-message-id="\$\{CSS\.escape\(String\(result\.targetMessageId\)\)\}"\]`\)/);
  assert.match(page, /const messageId=String\(item\.id\|\|item\.telegramMessageId\|\|''\)/);
  assert.match(page, /setMobileSearchOpen\(false\);applyFilter\('all'\)/);
  assert.match(page, /window\.scrollTo\(\{top,behavior:'auto'\}\)/);
  assert.match(page, /setTimeout\(\(\)=>positionSearchResult\(result\),360\)/);
  assert.match(page, /openSearchResult\(searchResultsCache\[0\]\)/);
});

test('V4 filename search identifies the matching item inside a multi-video Telegram album', () => {
  const normalizeSource = page.match(/function normalize\(v\)\{[^\n]+?\}/)?.[0];
  const searchMatchSource = page.match(/function searchMatch\(lesson,qn\)\{[^\n]+?return null\}/)?.[0];
  assert.ok(normalizeSource);
  assert.ok(searchMatchSource);
  const searchMatch = Function(`${normalizeSource};${searchMatchSource};return searchMatch`)();
  const lesson = {
    title: 'Bài 7: Hướng dẫn làm mochi',
    body: 'Nội dung không chứa từ khóa',
    posts: [
      { id: '101', media: { name: 'video mở đầu.mp4' } },
      { id: '102', media: { name: 'bánh dứa ĐH-1.mp4' } },
      { id: '103', media: { name: 'video kết thúc.mp4' } },
    ],
  };
  assert.deepEqual(searchMatch(lesson, 'dua'), {
    score: 99.995,
    targetType: 'media',
    targetMessageId: '102',
  });
});

test('V4 compact search debounces typing and requires two characters', () => {
  assert.match(page, /searchTimer=setTimeout\(applyFilter,180\)/);
  assert.match(page, /searching=qn\.length>=2/);
  assert.match(page, /Nhập ít nhất 2 ký tự để tìm/);
  assert.match(page, /searchLimit\+=20/);
});
