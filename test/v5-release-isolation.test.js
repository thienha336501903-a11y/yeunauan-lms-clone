import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { v5ReleaseContent, v5ReleaseHasAsset } from '../utils/v5-release-snapshot.js';

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

test('student feed and playback do not read mutable authoring membership tables', () => {
  const feed = read('utils/lms-handlers/v5-feed.js');
  const play = read('utils/lms-handlers/v5-play.js');
  assert.doesNotMatch(feed, /\.from\("v5_lessons"\)/);
  assert.doesNotMatch(feed, /\.from\("v5_posts"\)/);
  assert.doesNotMatch(feed, /\.from\("v5_post_assets"\)/);
  assert.doesNotMatch(play, /\.from\("v5_posts"\)/);
  assert.doesNotMatch(play, /\.from\("v5_post_assets"\)/);
  assert.match(feed, /\.from\("v5_releases"\)/);
  assert.match(play, /\.from\("v5_releases"\)/);
});

test('atomic switch migration is service-role only and pins search_path', () => {
  const migration = read('sql/migration_lms_v5_atomic_release_20260828.sql');
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all[\s\S]*from anon/i);
  assert.match(migration, /revoke all[\s\S]*from authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
});
