import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('V5 playback signs short ECDSA P-256 leases on demand without exposing R2 object keys in feed', () => {
  const lease = read('utils/v5-playback-lease.js');
  const play = read('utils/lms-handlers/v5-play.js');
  const feed = read('utils/lms-handlers/v5-feed.js');
  const player = read('v5/index.html');
  const sw = read('v5/media-sw.js');

  assert.match(lease, /V5_PLAYBACK_PRIVATE_JWK/);
  assert.match(lease, /crv !== "P-256"/);
  assert.match(lease, /dsaEncoding: "ieee-p1363"/);
  assert.match(lease, /DEFAULT_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(lease, /uah:/);

  assert.match(play, /requireV4CourseAccess/);
  assert.match(play, /issueV5PlaybackLease/);
  assert.match(play, /asset\.provider !== "r2"/);
  assert.match(play, /published_release_id/);
  assert.match(play, /v5ReleaseHasAsset/);
  assert.match(play, /playbackUrl: lease\.url/);
  assert.match(play, /expiresAt: lease\.expiresAt/);

  assert.match(feed, /playback_ready/);
  assert.match(feed, /published_release_id/);
  assert.match(feed, /v5ReleaseContent/);
  assert.doesNotMatch(feed, /issueV5PlaybackLease/);
  assert.doesNotMatch(feed, /playback_url/);
  assert.doesNotMatch(feed, /r2_object_key\s*:/);

  assert.match(player, /serviceWorker\.register\('\/v5\/media-sw\.js',\{scope:'\/v5\/'/);
  assert.match(player, /\/v5\/media\/\$\{encodeURIComponent\(assetId\)\}/);
  assert.doesNotMatch(player, /playback_url/);

  assert.match(sw, /endpoint: "v5-play"/);
  assert.match(sw, /credentials: "include"/);
  assert.match(sw, /REFRESH_SKEW_MS = 45 \* 1000/);
  assert.match(sw, /\[401, 403, 410\]\.includes\(upstream\.status\)/);
  assert.match(sw, /fetchLease\(course, assetId, true\)/);
});

test('V5 capability reporting follows JWK runtime configuration', () => {
  const capabilities = read('utils/lms-handlers/admin-v5-capabilities.js');
  assert.match(capabilities, /V5_PLAYBACK_PRIVATE_JWK/);
  assert.match(capabilities, /V5_MEDIA_PUBLIC_URL/);
  assert.doesNotMatch(capabilities, /V5_PLAYBACK_PRIVATE_KEY_PEM/);
  assert.doesNotMatch(capabilities, /V5_PLAYBACK_PUBLIC_KEY_PEM/);
});

test('V5 release lifecycle blocks unfinished media and switches the learner release atomically', () => {
  const release = read('utils/lms-handlers/admin-v5-release.js');
  const migration = read('sql/migration_lms_v5_atomic_release_20260828.sql');
  assert.match(release, /Post đang xử lý media/);
  assert.match(release, /media chưa READY/);
  assert.match(release, /media upload trực tiếp chưa có object R2/);
  assert.match(release, /releaseSnapshot/);
  assert.match(release, /v5_publish_release_atomic/);
  assert.match(migration, /for update/);
  assert.match(migration, /published_release_id = v_release/);
  assert.match(migration, /status = 'superseded'/);
  assert.match(migration, /grant execute[\s\S]*service_role/i);
});

test('V5 rollback moves current positions aside before atomically selecting a historical snapshot copy', () => {
  const release = read('utils/lms-handlers/admin-v5-release.js');
  assert.match(release, /movePositionsToTemporarySpace/);
  assert.match(release, /200000000/);
  assert.match(release, /300000000/);
  assert.match(release, /atomicPublishSnapshot\(course\.id, snapshot, admin\.email\)/);
  assert.match(release, /rollbackFrom/);
});
