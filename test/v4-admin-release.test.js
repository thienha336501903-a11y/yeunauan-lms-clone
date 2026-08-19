import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const handler = fs.readFileSync(new URL('../utils/lms-handlers/admin-courses.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

test('admin courses API exposes V4 release metadata', () => {
  assert.match(handler, /is_published, delivery_mode/);
  assert.match(handler, /courseMeta/);
  assert.match(handler, /action === \"setPublished\"/);
  assert.match(handler, /update\(\{ is_published: published/);
  assert.match(handler, /delivery_mode[\s\S]*!== \"v4\"/);
});

test('admin UI can mark a selected V4 course ready or hidden', () => {
  assert.match(page, /id=\"v4ReleaseBox\"/);
  assert.match(page, /id=\"v4ReadyBtn\"/);
  assert.match(page, /id=\"v4HideBtn\"/);
  assert.match(page, /function setV4Release\(published\)/);
  assert.match(page, /action: \"setPublished\"/);
  assert.match(page, /\/learning\?course=/);
});
