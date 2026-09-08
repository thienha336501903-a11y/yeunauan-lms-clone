import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('v5/index.html');
const css = read('v5/styles.css');
const app = read('v5/app.js');

test('V5 acceptance: mobile/iPhone shell uses safe viewport, sticky header and bottom navigation', () => {
  assert.match(html, /width=device-width,initial-scale=1,viewport-fit=cover/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.mobile-filters\{position:fixed/);
});

test('V5 acceptance: long text and captions wrap without horizontal overflow', () => {
  assert.match(css, /\.lesson-text,\.caption\{[^}]*white-space:pre-wrap[^}]*overflow-wrap:anywhere/);
  assert.match(css, /body\{[^}]*overflow-x:hidden/);
});

test('V5 acceptance: visual mosaics cover 1 through 6+ and video preserves portrait/landscape frame', () => {
  for (const name of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6p']) assert.match(css, new RegExp(`\\.media-grid\\.${name}`));
  assert.match(css, /\.media-cell video\{object-fit:contain\}/);
  assert.match(css, /\.media-grid\.n6p \.media-cell:nth-child\(n\+7\)\{display:none\}/);
});

test('V5 acceptance: documents remain separate links and protected media is demand-driven', () => {
  assert.match(app, /post\.fileAssets\.map\(asset => assetHtml\(asset, 0, 1\)\)/);
  assert.match(app, /return `<a class="doc" href=/);
  assert.match(app, /video\.controls = true; video\.playsInline = true; video\.preload = 'none'/);
  assert.doesNotMatch(app, /nofullscreen/);
  assert.match(app, /video\.src = mediaUrl\(cell\.dataset\.assetId\)/);
});

test('V5 acceptance: search, outline bottom sheet, progress/resume and lightbox keyboard close are wired', () => {
  assert.match(app, /normalizeSearch\(searchQuery\)/);
  assert.match(app, /<mark>/);
  assert.match(html, /id="mobileOutlineSheet"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(css, /\.mobile-outline-sheet\.open\{transform:translateY\(0\)\}/);
  assert.match(app, /`v5_progress_/);
  assert.match(app, /`v5_video_progress_/);
  assert.match(html, /id="lightbox"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(app, /if \(event\.key === 'Escape'\) \{ closeLightbox\(\); closeOutline\(\); setMobileSearch\(false\); \}/);
});
