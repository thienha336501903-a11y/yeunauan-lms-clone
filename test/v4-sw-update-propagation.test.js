import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const learningRoute = fs.readFileSync(new URL('../api/learning.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../v4-sw-refresh.html', import.meta.url), 'utf8');
const player = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

function registeredWorkerPath(source) {
  return source.match(/serviceWorker\.register\(['"]([^'"]+)['"]/)?.[1] ||
    source.match(/const WORKER_PATH=['"]([^'"]+)['"]/)?.[1] ||
    '';
}

test('V4 learning traffic passes through the service worker refresh bootstrap', () => {
  assert.match(learningRoute, /requestedV4\s*\?\s*"\/v4-sw-refresh\.html"/);
});

test('bootstrap forces playback worker v4 without cached update bytes', () => {
  assert.match(bootstrap, /\/v4-media-sw\.js\?v=4/);
  assert.match(bootstrap, /updateViaCache:'none'/);
  assert.match(bootstrap, /registration\.update\(\)/);
  assert.match(bootstrap, /controllerchange/);
  assert.match(bootstrap, /\/v4-entry\.html/);
});

test('bootstrap and player fallback register the same playback worker version', () => {
  const bootstrapWorkerPath = registeredWorkerPath(bootstrap);
  const fallbackWorkerPath = registeredWorkerPath(player);

  assert.equal(bootstrapWorkerPath, '/v4-media-sw.js?v=4');
  assert.equal(fallbackWorkerPath, bootstrapWorkerPath);
});
