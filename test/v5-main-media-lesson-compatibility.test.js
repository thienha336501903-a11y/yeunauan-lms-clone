import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Main V5 media proxy keeps canonical lesson optional at the service-worker boundary', () => {
  const sw = read('v5/media-sw.js');

  assert.match(sw, /if \(!assetId \|\| !course\) \{/);
  assert.doesNotMatch(sw, /if \(!assetId \|\| !course \|\| !lessonId\)/);
  assert.match(sw, /if \(lessonId\) params\.set\("lesson", lessonId\);/);
  assert.match(sw, /proxyMedia\(event\.request, course, lessonId, assetId\)/);
});

test('Agency V5 playback still fails closed when canonical lesson is missing', () => {
  const agencyBridge = read('utils/agency-lms-bridge.js');

  assert.match(agencyBridge, /if \(!requestedLessonId\) \{/);
  assert.match(agencyBridge, /code: "missing_lesson"/);
  assert.match(agencyBridge, /p_lesson_id: canonicalLesson\.id/);
  assert.match(agencyBridge, /canonicalLesson\.canonical_course_id !== canonicalCourse\.id/);
});

test('Legacy\/Main v5-play handler does not require an Agency canonical lesson', () => {
  const play = read('utils/lms-handlers/v5-play.js');

  assert.doesNotMatch(play, /missing_lesson/);
  assert.match(play, /issueV5PlaybackLease/);
  assert.match(play, /version: 2/);
});
