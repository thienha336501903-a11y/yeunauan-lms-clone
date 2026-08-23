import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

test('V4 media captions preserve Telegram line breaks and readable spacing', () => {
  assert.match(page, /\.caption\{[^}]*white-space:pre-wrap/);
  assert.match(page, /\.caption\{[^}]*overflow-wrap:anywhere/);
  assert.match(page, /\.caption\{[^}]*line-height:1\.52/);
  assert.match(page, /\.caption\{[^}]*font-weight:400/);
});

test('V4 renders the original escaped caption without rewriting lesson text', () => {
  assert.match(page, /caption\?`<div class="caption">\$\{linkify\(caption\)\}<\/div>`/);
});
