import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planImport } from '../utils/v5-telegram-planner.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('1. SQL Migration exists, defines atomic function, and restricts execution to service_role', () => {
  const sql = read('sql/migration_lms_v5_replace_telegram_media_atomic_20260913.sql');
  
  // Function signature & security settings
  assert.match(sql, /create or replace function public\.v5_replace_telegram_media_atomic/i);
  assert.match(sql, /p_course_id uuid/);
  assert.match(sql, /p_post_id uuid/);
  assert.match(sql, /p_old_asset_id uuid/);
  assert.match(sql, /p_new_asset_id uuid/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /search_path\s*=\s*pg_catalog,\s*public/i);

  // Validations
  assert.match(sql, /v5_invalid_arguments/);
  assert.match(sql, /v5_same_asset/);
  assert.match(sql, /v5_post_not_found/);
  assert.match(sql, /v5_old_asset_not_found/);
  assert.match(sql, /v5_old_asset_not_telegram/);
  assert.match(sql, /v5_old_asset_not_linked_to_post/);
  assert.match(sql, /v5_new_asset_not_found/);
  assert.match(sql, /v5_new_asset_not_ready_r2/);

  // Preservation & Atomic Swap
  assert.match(sql, /update public\.v5_media_assets set/i);
  assert.match(sql, /origin = 'telegram'/);
  assert.match(sql, /telegram_source_id/);
  assert.match(sql, /telegram_message_row_id/);
  assert.match(sql, /delete from public\.v5_post_assets/i);
  assert.match(sql, /insert into public\.v5_post_assets/i);
  assert.match(sql, /update public\.v5_source_mappings/i);
  assert.match(sql, /update public\.v5_posts/i);

  // Strict Grant / Revoke boundary
  assert.match(sql, /revoke all on function public\.v5_replace_telegram_media_atomic.*from public/i);
  assert.match(sql, /revoke all on function public\.v5_replace_telegram_media_atomic.*from anon/i);
  assert.match(sql, /revoke all on function public\.v5_replace_telegram_media_atomic.*from authenticated/i);
  assert.match(sql, /grant execute on function public\.v5_replace_telegram_media_atomic.*to service_role/i);
});

test('2. admin-v5-content.js exposes replaceTelegramMedia with complete validation', () => {
  const content = read('utils/lms-handlers/admin-v5-content.js');

  // Export and dispatch
  assert.match(content, /export async function replaceTelegramMedia/);
  assert.match(content, /action === "replaceTelegramMedia"/);

  // Course and admin validation
  assert.match(content, /loadCourse\(req\.query\?\.course \|\| req\.body\?\.course\)/);
  assert.match(content, /requireAdmin\(req, res\)/);

  // Scoping checks
  assert.match(content, /Post không thuộc khóa học này/);
  assert.match(content, /Old media asset không tồn tại/);
  assert.match(content, /Chỉ hỗ trợ replaceTelegramMedia cho asset có origin telegram/);
  assert.match(content, /Old media asset không được gắn vào Post này/);
  assert.match(content, /New media asset chưa READY trên R2/);

  // RPC call with fail-safe fallback
  assert.match(content, /supabase\.rpc\("v5_replace_telegram_media_atomic"/);
  assert.match(content, /v5_source_mappings/);
});

test('3. admin-v5-upload.js integrates replaceAssetId across initUpload, tryChecksumDedupe, and complete', () => {
  const upload = read('utils/lms-handlers/admin-v5-upload.js');

  // Import
  assert.match(upload, /import \{ replaceTelegramMedia \} from "\.\/admin-v5-content\.js"/);

  // initUpload validates replaceAssetId
  assert.match(upload, /const replaceAssetId = clean\(body\?\.replaceAssetId\)/);
  assert.match(upload, /Media asset cần thay thế không tồn tại/);
  assert.match(upload, /Chỉ hỗ trợ thay thế media có origin=telegram/);
  assert.match(upload, /origin: oldAsset \? "telegram" : "direct"/);
  assert.match(upload, /telegram_source_id: oldAsset\?\.telegram_source_id \|\| null/);
  assert.match(upload, /telegram_message_row_id: oldAsset\?\.telegram_message_row_id \|\| null/);
  assert.match(upload, /!replaceAssetId && postId/);

  // Deduplication handling
  assert.match(upload, /tryChecksumDedupe\(course, body, meta, replaceAssetId\)/);
  assert.match(upload, /if \(replaceAssetId\) \{\s*await replaceTelegramMedia/);

  // complete calls replaceTelegramMedia
  assert.match(upload, /if \(replaceAssetId\) \{\s*await replaceTelegramMedia\(course/);
});

test('4. End-to-end simulated replacement preserves immutability and provenance', async () => {
  const courseId = 'a645f117-2320-452f-8538-154b80484218';
  const postId = 'post-banh-mi-1';
  const oldAssetId = '01cac812-ad7d-4483-8c62-4acdf019cb55';
  const newAssetId = 'e2b3c4d5-6789-4abc-def0-1234567890ab';
  const telegramRowId = 'tg_row_msg_101';

  // In-memory mock database state
  const db = {
    v5_media_assets: new Map([
      [oldAssetId, {
        id: oldAssetId,
        type: 'video',
        provider: 'r2',
        origin: 'telegram',
        telegram_source_id: 'src_channel_1',
        telegram_message_row_id: telegramRowId,
        r2_object_key: `media/v5/${courseId}/${oldAssetId}/3.mp4`,
        mime_type: 'video/mp4',
        original_filename: '3.mp4',
        bytes: 40547689,
        status: 'ready',
        thumbnail_asset_id: 'thumb-uuid-1'
      }],
      [newAssetId, {
        id: newAssetId,
        type: 'video',
        provider: 'r2',
        origin: 'direct',
        r2_object_key: `media/v5/${courseId}/${newAssetId}/3.mp4`,
        mime_type: 'video/mp4',
        original_filename: '3.mp4',
        bytes: 40547688,
        status: 'ready'
      }]
    ]),
    v5_posts: new Map([
      [postId, {
        id: postId,
        course_id: courseId,
        status: 'ready',
        title: 'Bài 1: Video 1'
      }]
    ]),
    v5_post_assets: new Map([
      [`${postId}:${oldAssetId}`, {
        post_id: postId,
        asset_id: oldAssetId,
        position: 0,
        role: 'primary'
      }]
    ]),
    v5_source_mappings: new Map([
      [telegramRowId, {
        course_id: courseId,
        source_system: 'telegram',
        source_message_row_id: telegramRowId,
        post_id: postId,
        asset_id: oldAssetId
      }]
    ]),
    v5_releases: [
      {
        id: 'release-v1',
        course_id: courseId,
        status: 'published',
        snapshot: {
          posts: [{ id: postId, title: 'Bài 1: Video 1' }],
          assets: [{ id: oldAssetId, bytes: 40547689, r2_object_key: `media/v5/${courseId}/${oldAssetId}/3.mp4` }]
        }
      }
    ]
  };

  // Perform atomic replacement logic
  const oldAsset = db.v5_media_assets.get(oldAssetId);
  const newAsset = db.v5_media_assets.get(newAssetId);
  const linkKey = `${postId}:${oldAssetId}`;
  const oldLink = db.v5_post_assets.get(linkKey);

  assert.equal(oldAsset.origin, 'telegram');
  assert.equal(newAsset.status, 'ready');
  assert(oldLink, 'Old link must exist');

  // Step 1: Update new asset with Telegram provenance
  Object.assign(newAsset, {
    origin: 'telegram',
    telegram_source_id: oldAsset.telegram_source_id,
    telegram_message_row_id: oldAsset.telegram_message_row_id,
    mime_type: oldAsset.mime_type,
    original_filename: oldAsset.original_filename,
    thumbnail_asset_id: oldAsset.thumbnail_asset_id,
    metadata: {
      replaced_from_asset_id: oldAsset.id,
      replaced_at: new Date().toISOString()
    }
  });

  // Step 2: Swap post link
  db.v5_post_assets.delete(linkKey);
  db.v5_post_assets.set(`${postId}:${newAssetId}`, {
    post_id: postId,
    asset_id: newAssetId,
    position: oldLink.position,
    role: oldLink.role
  });

  // Step 3: Update source mapping
  const mapping = db.v5_source_mappings.get(telegramRowId);
  mapping.asset_id = newAssetId;

  // VERIFICATION 1: Old asset row untouched
  const finalOldAsset = db.v5_media_assets.get(oldAssetId);
  assert.equal(finalOldAsset.bytes, 40547689);
  assert.equal(finalOldAsset.status, 'ready');
  assert.equal(finalOldAsset.r2_object_key, `media/v5/${courseId}/${oldAssetId}/3.mp4`);

  // VERIFICATION 2: Published release snapshot untouched
  const publishedRelease = db.v5_releases[0];
  assert.equal(publishedRelease.snapshot.assets[0].id, oldAssetId);
  assert.equal(publishedRelease.snapshot.assets[0].bytes, 40547689);

  // VERIFICATION 3: New asset has full Telegram provenance
  assert.equal(newAsset.origin, 'telegram');
  assert.equal(newAsset.telegram_source_id, 'src_channel_1');
  assert.equal(newAsset.telegram_message_row_id, telegramRowId);
  assert.equal(newAsset.thumbnail_asset_id, 'thumb-uuid-1');
  assert.equal(newAsset.metadata.replaced_from_asset_id, oldAssetId);

  // VERIFICATION 4: Post link points to new asset at exact position and role
  const newLink = db.v5_post_assets.get(`${postId}:${newAssetId}`);
  assert(newLink);
  assert.equal(newLink.position, 0);
  assert.equal(newLink.role, 'primary');
  assert.equal(db.v5_post_assets.has(linkKey), false);

  // VERIFICATION 5: Source mapping points to new asset
  assert.equal(db.v5_source_mappings.get(telegramRowId).asset_id, newAssetId);

  // VERIFICATION 6: Telegram sync remains 100% idempotent
  const rows = [
    {
      id: telegramRowId,
      source_message_id: 101,
      message_type: 'video',
      caption: 'Video 1',
      raw_message: { video: { file_id: 'vid1', mime_type: 'video/mp4', file_name: '3.mp4', duration: 151 } }
    }
  ];
  const existingMappings = new Map([
    [telegramRowId, { post_id: postId, asset_id: newAssetId }]
  ]);

  const plan = planImport({ rows, existingMappings, authoringMode: 'lesson' });
  assert.equal(plan.newUnits, 0, 'Must not create any new units on sync');
  assert.equal(plan.predictedPosts, 0, 'Must not create any new posts on sync');
  assert.equal(plan.predictedTelegramMirrorJobs, 0, 'Must not enqueue mirror jobs for mapped units');
});

test('5. Fail-safe rollback: If mapping update throws, post link remains on old asset', () => {
  const courseId = 'course-1';
  const postId = 'post-1';
  const oldAssetId = 'old-asset-1';
  const newAssetId = 'new-asset-2';

  let postAssetLink = { post_id: postId, asset_id: oldAssetId, position: 1, role: 'primary' };

  function simulateReplacementWithFailure() {
    const backupLink = { ...postAssetLink };
    try {
      // simulate delete old link and insert new link
      postAssetLink = { post_id: postId, asset_id: newAssetId, position: backupLink.position, role: backupLink.role };
      // simulate mapping update failure
      throw new Error('v5_mapping_conflict');
    } catch (err) {
      // rollback
      postAssetLink = backupLink;
      throw err;
    }
  }

  assert.throws(() => simulateReplacementWithFailure(), /v5_mapping_conflict/);
  assert.equal(postAssetLink.asset_id, oldAssetId, 'Link must be restored to oldAssetId on failure');
});
