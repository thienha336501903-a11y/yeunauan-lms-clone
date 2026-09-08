import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { v5LearnerReleaseContent, v5ReleaseContent, v5ReleaseHasAsset } from '../utils/v5-release-snapshot.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('release snapshot content remains isolated from later draft mutations', () => {
  const snapshot = {
    schema: 'v5-release-v1',
    config: { source_mode: 'direct' },
    lessons: [{ id: 'lesson-1', title: 'Release title', position: 1, metadata: {} }],
    posts: [{ id: 'post-1', lesson_id: 'lesson-1', position: 1, text_content: 'Release text', caption: null, origin: 'direct', metadata: {} }],
    links: [{ post_id: 'post-1', asset_id: 'asset-1', position: 1, role: 'attachment', metadata: {} }],
    asset_ids: ['asset-1']
  };
  const draft = {
    lessons: [{ id: 'lesson-1', title: 'Edited draft title', position: 9 }],
    posts: [],
    links: []
  };
  const content = v5ReleaseContent(snapshot);
  draft.lessons[0].title = 'Edited again';
  assert.equal(content.lessons[0].title, 'Release title');
  assert.equal(content.posts[0].text_content, 'Release text');
  assert.equal(content.links[0].asset_id, 'asset-1');
  assert.equal(v5ReleaseHasAsset(snapshot, 'asset-1'), true);
  assert.equal(v5ReleaseHasAsset(snapshot, 'asset-2'), false);
});

test('learner release payload excludes authoring metadata while preserving render fields', () => {
  const snapshot = {
    schema: 'v5-release-v1',
    config: { source_mode: 'telegram', settings: { internal: true } },
    lessons: [{ id: 'lesson-1', title: 'Lesson', position: 1, metadata: { internal: true } }],
    posts: [{ id: 'post-1', lesson_id: 'lesson-1', position: 1, text_content: 'Text', caption: 'Caption', origin_ref: { secret: true }, metadata: { internal: true, source_title: 'Bếp An', sender_label: 'Cô An', source_date: '2026-09-07T08:15:00Z' } }],
    links: [{ post_id: 'post-1', asset_id: 'asset-1', position: 1, role: 'attachment', metadata: { internal: true } }],
    asset_ids: ['asset-1']
  };
  const content = v5LearnerReleaseContent(snapshot);
  assert.deepEqual(content.config, { source_mode: 'telegram' });
  assert.deepEqual(content.lessons, [{ id: 'lesson-1', title: 'Lesson', position: 1 }]);
  assert.deepEqual(content.posts, [{
    id: 'post-1', lesson_id: 'lesson-1', position: 1, text_content: 'Text', caption: 'Caption',
    display: { source_title: 'Bếp An', sender_label: 'Cô An', source_date: '2026-09-07T08:15:00.000Z' }
  }]);
  assert.deepEqual(content.links, [{ post_id: 'post-1', asset_id: 'asset-1', position: 1 }]);
  assert.deepEqual(content.assetIds, ['asset-1']);
  assert.doesNotMatch(JSON.stringify(content), /internal|origin_ref|metadata|role|secret/);
});

test('student feed and playback do not read mutable authoring membership tables', () => {
  const feed = read('utils/lms-handlers/v5-feed.js');
  const play = read('utils/lms-handlers/v5-play.js');
  const playbackAuth = read('sql/migration_lms_v5_playback_authorization_rpc_20260908.sql');
  assert.doesNotMatch(feed, /\.from\("v5_lessons"\)/);
  assert.doesNotMatch(feed, /\.from\("v5_posts"\)/);
  assert.doesNotMatch(feed, /\.from\("v5_post_assets"\)/);
  assert.doesNotMatch(play, /\.from\("v5_posts"\)/);
  assert.doesNotMatch(play, /\.from\("v5_post_assets"\)/);
  assert.match(feed, /\.from\("v5_releases"\)/);
  assert.match(play, /v5_authorize_playback_asset/);
  assert.doesNotMatch(play, /\.from\("v5_releases"\)/);
  assert.doesNotMatch(playbackAuth, /v5_lessons|v5_posts|v5_post_assets/);
  assert.match(playbackAuth, /vr\.snapshot -> 'links'/);
  assert.doesNotMatch(feed, /\.from\("courses"\)/);
  assert.doesNotMatch(play, /\.from\("courses"\)/);
});

test('atomic switch migration is service-role only and pins search_path', () => {
  const migration = read('sql/migration_lms_v5_atomic_release_20260828.sql');
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all[\s\S]*from anon/i);
  assert.match(migration, /revoke all[\s\S]*from authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
});

test('V5 Publish owns learner content readiness but never opens Commerce sales', () => {
  const migration = read('sql/migration_lms_v5_atomic_release_20260828.sql');
  assert.match(migration, /update public\.v5_course_configs[\s\S]*published_release_id = v_release/);
  assert.match(migration, /update public\.courses[\s\S]*set is_published = true/);
  assert.match(migration, /lower\(coalesce\(delivery_mode, ''\)\) = 'v5'/);
  assert.doesNotMatch(migration, /set[\s\S]{0,80}active\s*=\s*true/i);
});
