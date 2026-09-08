import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../v5/app.js', import.meta.url), 'utf8');

test('V5 protected images wait for the media service worker before requesting bytes', () => {
  assert.match(app, /<img loading="lazy" data-v5-image data-src=/);
  assert.doesNotMatch(app, /<img loading="lazy" src="\$\{esc\(url\)\}"/);
  assert.match(app, /async function hydrateProtectedImages\(\) \{\s*await ensureMediaWorker\(\)/);
  assert.match(app, /image\.setAttribute\('src', image\.dataset\.src\)/);
  assert.match(app, /hydrateProtectedImages\(\)\.catch/);
});

test('V5 lightbox also waits for the protected media worker', () => {
  assert.match(app, /data-kind="image"[\s\S]*addEventListener\('click', async \(\) => \{\s*try \{ await ensureMediaWorker\(\); openLightbox\(cell\.dataset\.src\)/);
});
