import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../v5/app.js', import.meta.url), 'utf8');

test('V5 direct video Play always starts from the beginning instead of auto-resuming saved progress', () => {
  assert.match(app, /async function startVideo\(cell, \{ resume = false \} = \{\}\)/);
  assert.match(app, /const resumeAt = resume \? resumeTimeFor\(cell\.dataset\.assetId\) : 0/);
  assert.match(app, /addEventListener\('click', \(\) => startVideo\(cell\)\)/);
  assert.doesNotMatch(app, /loadedmetadata', \(\) => \{ if \(unfinishedVideo\(videoProgress\)/);
});

test('V5 saved position is used only from an explicit Continue learning action', () => {
  assert.match(app, /function resumeSavedVideo\(\)/);
  assert.match(app, /startVideo\(cell, \{ resume: true \}\)/);
  assert.match(app, /resumeFloat'\)\.addEventListener\('click', resumeSavedVideo\)/);
  assert.match(app, /resumeSide'\)\.addEventListener\('click', \(\) => \{ if \(unfinishedVideo\(videoProgress\)\) resumeSavedVideo\(\)/);
  assert.match(app, /if \(resumeAt > \.5\) video\.addEventListener\('loadedmetadata'/);
});

test('V5 keeps the protected thumbnail as the video poster while the first frame is being prepared', () => {
  assert.match(app, /const posterImage = cell\.querySelector\('\.video-poster-image'\)/);
  assert.match(app, /if \(posterSource\) video\.poster = posterSource/);
});
