import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

test('V4 five-item albums use a Telegram-style two-over-three grid', () => {
  assert.match(page, /\.media-grid\.n5\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(page, /\.media-grid\.n5 \.media-cell:nth-child\(-n\+2\)\{grid-column:span 3\}/);
  assert.match(page, /\.media-grid\.n5 \.media-cell:nth-child\(n\+3\)\{grid-column:span 2\}/);
  assert.match(page, /visual\.length===5\?'n5':'n6p'/);
});

test('V4 mobile album ratios keep five and six video grids balanced', () => {
  assert.match(page, /@media\(max-width:760px\)[\s\S]*\.media-grid\.n5\{aspect-ratio:4\/5\}/);
  assert.match(page, /@media\(max-width:760px\)[\s\S]*\.media-grid\.n6p\{aspect-ratio:1\/1\}/);
});

test('V4 video playback preserves the original frame without stretching or cropping', () => {
  assert.match(page, /\.media-cell img\{object-fit:cover\}/);
  assert.match(page, /\.media-cell video\{object-fit:contain\}/);
  assert.match(page, /\.media-cell img,\.media-cell video\{[^}]*object-position:center/);
});

test('V4 media tiles show Telegram duration metadata and cap large albums at six previews', () => {
  assert.match(page, /function fmtDuration\(n\)/);
  assert.match(page, /class="media-duration"/);
  assert.match(page, /total>6&&index===5/);
  assert.match(page, /\.media-grid\.n6p \.media-cell:nth-child\(n\+7\)\{display:none\}/);
});
