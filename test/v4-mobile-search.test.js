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

test('V4 search is accent-insensitive and searches captions and media names', () => {
  assert.match(page, /normalize\('NFD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g,''\)\.replace\(\/đ\/g,'d'\)/);
  assert.match(page, /searchText=\[title,\.\.\.group\.map\(x=>`\$\{x\.text\|\|''\} \$\{x\.media\?\.name\|\|''\}`\)\]/);
  assert.match(page, /hay=normalize\(el\.dataset\.search\|\|''\)/);
});

test('V4 mobile search shows result counts, empty state and a working clear action', () => {
  assert.match(page, /Tìm thấy \$\{visibleCount\}\/\$\{lessons\.length\} bài học/);
  assert.match(page, /empty\.hidden=!\(qn&&visibleCount===0\)/);
  assert.match(page, /id="searchEmpty"[^>]*hidden/);
  assert.match(page, /mobileSearchClear'\)\.addEventListener\('click',\(\)=>\{syncSearch\('','mobile'\)/);
  assert.match(page, /document\.addEventListener\('keydown',e=>\{if\(e\.key==='Escape'\)[\s\S]*setMobileSearchOpen\(false\)/);
});
