import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../v4.html', import.meta.url), 'utf8');

// Real-device contract: Resume returns to the latest unfinished video and restores its position.
test('V4 resume prioritizes the latest unfinished video', () => {
  assert.match(page, /videoProgressKey=`v4_video_progress_/);
  assert.match(page, /function loadVideoProgress\(\)/);
  assert.match(page, /function saveVideoProgress\(state\)/);
  assert.match(page, /function getResumeTarget\(\)[\s\S]*videoProgress[\s\S]*messageId/);
  assert.match(page, /function scrollToResumeTarget\(target\)[\s\S]*data-message-id/);
});

test('V4 persists playback position and restores it on replay', () => {
  assert.match(page, /timeupdate/);
  assert.match(page, /currentTime/);
  assert.match(page, /loadedmetadata[\s\S]*videoProgress[\s\S]*video\.currentTime/);
  assert.match(page, /ended[\s\S]*clearVideoProgress/);
});

test('V4 removes the unused top-right options button', () => {
  assert.doesNotMatch(page, /id="mobileMenuBtn"/);
  assert.doesNotMatch(page, /id="sideMenuBtn"/);
  assert.doesNotMatch(page, /id="courseMenu"/);
  assert.doesNotMatch(page, /aria-label="Tùy chọn"/);
});

test('V4 mobile resume uses a native anchor to the exact unfinished video', () => {
  assert.match(page, /<a class="resume-float" id="resumeFloat" href="#" hidden>/);
  assert.match(page, /id="resume-video-\$\{esc\(item\.id\|\|''\)\}"/);
  assert.match(page, /function updateResumeControl\(\)[\s\S]*a\.href='#'\+id/);
  assert.match(page, /scroll-margin-top:92px/);
  assert.match(page, /touch-action:manipulation/);
});
