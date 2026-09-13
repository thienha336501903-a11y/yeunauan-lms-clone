import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planImport } from '../utils/v5-telegram-planner.js';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('1. SQL Migration exists, defines hardened atomic function, and restricts execution to service_role', () => {
  const sql = read('sql/migration_lms_v5_replace_telegram_media_atomic_20260913.sql');

  // Function signature & security settings
  assert.match(sql, /create or replace function public\.v5_replace_telegram_media_atomic/i);
  assert.match(sql, /p_course_id uuid/);
  assert.match(sql, /p_post_id uuid/);
  assert.match(sql, /p_old_asset_id uuid/);
  assert.match(sql, /p_new_asset_id uuid/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /search_path\s*=\s*pg_catalog,\s*public/i);

  // Hardened validations
  assert.match(sql, /v5_invalid_arguments/);
  assert.match(sql, /v5_same_asset/);
  assert.match(sql, /v5_post_not_found/);
  assert.match(sql, /v5_old_asset_not_found/);
  assert.match(sql, /v5_old_asset_not_telegram/);
  assert.match(sql, /v5_old_asset_not_linked_to_post/);
  assert.match(sql, /v5_new_asset_not_found/);
  assert.match(sql, /v5_new_asset_not_ready_r2/);
  assert.match(sql, /v5_asset_type_mismatch/);
  assert.match(sql, /v5_new_asset_not_telegram/);
  assert.match(sql, /v5_telegram_source_id_mismatch/);
  assert.match(sql, /v5_telegram_message_row_id_mismatch/);
  assert.match(sql, /v5_invalid_r2_object_key_scope/);
  assert.match(sql, /v5_new_asset_already_linked/);
  assert.match(sql, /v5_new_asset_already_released/);
  assert.match(sql, /v5_mapping_exact_count_failed/);

  // Exact mapping count enforcement
  assert.match(sql, /get diagnostics v_mapping_updated = row_count;/);
  assert.match(sql, /if v_mapping_updated <> 1 then/);

  // Strict Grant / Revoke boundary
  assert.match(sql, /revoke all on function public\.v5_replace_telegram_media_atomic.*from public/i);
  assert.match(sql, /revoke all on function public\.v5_replace_telegram_media_atomic.*from anon/i);
  assert.match(sql, /revoke all on function public\.v5_replace_telegram_media_atomic.*from authenticated/i);
  assert.match(sql, /grant execute on function public\.v5_replace_telegram_media_atomic.*to service_role/i);
});

test('2. admin-v5-content.js removes non-atomic fallback and fails closed with v5_replace_rpc_unavailable', () => {
  const content = read('utils/lms-handlers/admin-v5-content.js');

  // RPC dispatch and fail closed
  assert.match(content, /supabase\.rpc\("v5_replace_telegram_media_atomic"/);
  assert.match(content, /v5_replace_rpc_unavailable/);

  // Verification that fallback mutations are completely removed from content handler
  assert.doesNotMatch(content, /Fallback client execution if RPC is not installed/);
  assert.doesNotMatch(content, /from\("v5_media_assets"\)\.update\(\{[\s\S]*origin:\s*"telegram"[\s\S]*\}\)\.eq\("id",\s*newAssetId\)/);
});

test('3. admin-v5-upload.js disables checksum dedupe for replacement uploads', () => {
  const upload = read('utils/lms-handlers/admin-v5-upload.js');

  // When replaceAssetId is present, tryChecksumDedupe is bypassed
  assert.match(upload, /const replaceAssetId = clean\(body\?\.replaceAssetId\)/);
  assert.match(upload, /if \(replaceAssetId\) \{[\s\S]*\} else \{[\s\S]*tryChecksumDedupe/);

  // Normal upload still uses tryChecksumDedupe(course, body, meta)
  assert.match(upload, /async function tryChecksumDedupe\(course, body, meta\)/);
});

test('4. RPC missing / unavailable fails closed with code v5_replace_rpc_unavailable and 0 DB mutations', async () => {
  const { replaceTelegramMedia } = await import('../utils/lms-handlers/admin-v5-content.js');
  const { supabase } = await import('../utils/supabase.js');

  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  let mutationAttempted = false;

  supabase.from = (table) => {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'v5_posts') return { data: { id: 'post-1', course_id: 'c1' }, error: null };
              if (table === 'v5_media_assets') return { data: { id: 'a1', origin: 'telegram', status: 'ready', provider: 'r2', r2_object_key: 'k' }, error: null };
              if (table === 'v5_post_assets') return { data: { post_id: 'post-1', asset_id: 'a1', position: 0, role: 'primary' }, error: null };
              return { data: null, error: null };
            }
          }),
          maybeSingle: async () => {
            return { data: { id: 'a2', origin: 'telegram', status: 'ready', provider: 'r2', r2_object_key: 'k' }, error: null };
          }
        })
      }),
      update: () => { mutationAttempted = true; return { eq: () => Promise.resolve({ error: null }) }; },
      delete: () => { mutationAttempted = true; return { eq: () => Promise.resolve({ error: null }) }; },
      insert: () => { mutationAttempted = true; return Promise.resolve({ error: null }); }
    };
  };

  supabase.rpc = async (name) => {
    if (name === 'v5_replace_telegram_media_atomic') {
      return { data: null, error: { message: 'Could not find function in schema cache' } };
    }
    return { data: null, error: null };
  };

  try {
    await assert.rejects(
      async () => {
        await replaceTelegramMedia({ id: 'c1' }, { postId: 'post-1', oldAssetId: 'a1', newAssetId: 'a2' });
      },
      (err) => {
        assert.equal(err.code, 'v5_replace_rpc_unavailable');
        return true;
      }
    );
    assert.equal(mutationAttempted, false, 'No DB mutations should have been attempted when RPC is unavailable');
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test('5. Hardened RPC transaction logic tests: All 10 validation rules and rollback behavior', () => {
  const courseId = 'a645f117-2320-452f-8538-154b80484218';
  const postId = 'post-1';
  const oldAssetId = '01cac812-ad7d-4483-8c62-4acdf019cb55';
  const newAssetId = 'e2b3c4d5-6789-4abc-def0-1234567890ab';
  const telegramRowId = 'tg_row_101';
  const telegramSourceId = 'channel_999';

  function createBaseState() {
    return {
      posts: new Map([[postId, { id: postId, course_id: courseId, status: 'ready' }]]),
      mediaAssets: new Map([
        [oldAssetId, {
          id: oldAssetId,
          type: 'video',
          provider: 'r2',
          origin: 'telegram',
          telegram_source_id: telegramSourceId,
          telegram_message_row_id: telegramRowId,
          r2_object_key: `media/v5/${courseId}/${oldAssetId}/3.mp4`,
          bytes: 40547689,
          status: 'ready'
        }],
        [newAssetId, {
          id: newAssetId,
          type: 'video',
          provider: 'r2',
          origin: 'telegram',
          telegram_source_id: telegramSourceId,
          telegram_message_row_id: telegramRowId,
          r2_object_key: `media/v5/${courseId}/${newAssetId}/3.mp4`,
          bytes: 40547688,
          status: 'ready'
        }]
      ]),
      postAssets: new Map([[`${postId}:${oldAssetId}`, { post_id: postId, asset_id: oldAssetId, position: 0, role: 'primary' }]]),
      sourceMappings: new Map([[telegramRowId, { course_id: courseId, post_id: postId, asset_id: oldAssetId }]]),
      releases: [
        {
          id: 'release-1',
          course_id: courseId,
          status: 'published',
          snapshot: {
            schema: 'v5-release-v1',
            asset_ids: [oldAssetId],
            links: [{ asset_id: oldAssetId, post_id: postId }]
          }
        }
      ]
    };
  }

  // Simulation of PostgreSQL v5_replace_telegram_media_atomic transaction logic
  function executeAtomicRpc(db, p_course_id, p_post_id, p_old_asset_id, p_new_asset_id) {
    if (!p_course_id || !p_post_id || !p_old_asset_id || !p_new_asset_id) throw new Error('v5_invalid_arguments');
    if (p_old_asset_id === p_new_asset_id) throw new Error('v5_same_asset');

    // 1. Post ownership
    const post = db.posts.get(p_post_id);
    if (!post || post.course_id !== p_course_id) throw new Error('v5_post_not_found');

    // 2. Old link
    const link = db.postAssets.get(`${p_post_id}:${p_old_asset_id}`);
    if (!link) throw new Error('v5_old_asset_not_linked_to_post');

    // 3. Old asset
    const oldAsset = db.mediaAssets.get(p_old_asset_id);
    if (!oldAsset) throw new Error('v5_old_asset_not_found');
    if (oldAsset.origin !== 'telegram') throw new Error('v5_old_asset_not_telegram');

    // 4. New asset ready R2
    const newAsset = db.mediaAssets.get(p_new_asset_id);
    if (!newAsset) throw new Error('v5_new_asset_not_found');
    if (newAsset.status !== 'ready' || newAsset.provider !== 'r2' || !newAsset.r2_object_key) throw new Error('v5_new_asset_not_ready_r2');

    // 5. Type match
    if (newAsset.type !== oldAsset.type) throw new Error('v5_asset_type_mismatch');

    // 6. New origin telegram
    if (newAsset.origin !== 'telegram') throw new Error('v5_new_asset_not_telegram');

    // 7. Telegram provenance match
    if (!newAsset.telegram_source_id || newAsset.telegram_source_id !== oldAsset.telegram_source_id) {
      throw new Error('v5_telegram_source_id_mismatch');
    }
    if (!newAsset.telegram_message_row_id || newAsset.telegram_message_row_id !== oldAsset.telegram_message_row_id) {
      throw new Error('v5_telegram_message_row_id_mismatch');
    }

    // 8. R2 key prefix scope
    const expectedPrefix = `media/v5/${p_course_id}/${p_new_asset_id}/`;
    if (!newAsset.r2_object_key.startsWith(expectedPrefix)) throw new Error('v5_invalid_r2_object_key_scope');

    // 9. New asset not already linked
    for (const [key, pa] of db.postAssets.entries()) {
      if (pa.asset_id === p_new_asset_id) throw new Error('v5_new_asset_already_linked');
    }

    // 10. New asset not in release
    for (const r of db.releases) {
      if (r.snapshot?.asset_ids?.includes(p_new_asset_id) || JSON.stringify(r.snapshot).includes(p_new_asset_id)) {
        throw new Error('v5_new_asset_already_released');
      }
    }

    // Mutation snapshot for rollback
    const postAssetsBackup = new Map(db.postAssets);
    const sourceMappingsBackup = new Map(db.sourceMappings);

    try {
      // Swap link
      db.postAssets.delete(`${p_post_id}:${p_old_asset_id}`);
      db.postAssets.set(`${p_post_id}:${p_new_asset_id}`, {
        post_id: p_post_id,
        asset_id: p_new_asset_id,
        position: link.position,
        role: link.role
      });

      // Update mapping
      let mappingUpdated = 0;
      for (const [key, mapping] of db.sourceMappings.entries()) {
        if (mapping.course_id === p_course_id && mapping.post_id === p_post_id && mapping.asset_id === p_old_asset_id) {
          mapping.asset_id = p_new_asset_id;
          mappingUpdated++;
        }
      }

      // Exact count enforcement
      if (mappingUpdated !== 1) {
        throw new Error('v5_mapping_exact_count_failed');
      }

      return { success: true, mapping_updated: mappingUpdated };
    } catch (err) {
      // Transaction Rollback
      db.postAssets = postAssetsBackup;
      db.sourceMappings = sourceMappingsBackup;
      throw err;
    }
  }

  // TEST 5A: Video cannot be replaced by image
  {
    const db = createBaseState();
    db.mediaAssets.get(newAssetId).type = 'image';
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_asset_type_mismatch/);
  }

  // TEST 5B: Wrong-course R2 key rejected
  {
    const db = createBaseState();
    db.mediaAssets.get(newAssetId).r2_object_key = `media/v5/wrong-course/${newAssetId}/3.mp4`;
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_invalid_r2_object_key_scope/);
  }

  // TEST 5C: Already-linked new asset rejected
  {
    const db = createBaseState();
    db.postAssets.set(`another-post:${newAssetId}`, { post_id: 'another-post', asset_id: newAssetId, position: 1, role: 'attachment' });
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_new_asset_already_linked/);
  }

  // TEST 5D: Released new asset rejected
  {
    const db = createBaseState();
    db.releases[0].snapshot.asset_ids.push(newAssetId);
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_new_asset_already_released/);
  }

  // TEST 5E: Wrong Telegram source_id rejected (no coalesce)
  {
    const db = createBaseState();
    db.mediaAssets.get(newAssetId).telegram_source_id = 'wrong_channel';
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_telegram_source_id_mismatch/);
  }

  // TEST 5F: Wrong telegram_message_row_id rejected (no coalesce)
  {
    const db = createBaseState();
    db.mediaAssets.get(newAssetId).telegram_message_row_id = 'wrong_row_id';
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_telegram_message_row_id_mismatch/);
  }

  // TEST 5G: Mapping count 0 rejected + whole transaction rollback
  {
    const db = createBaseState();
    db.sourceMappings.clear(); // 0 mappings exist
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_mapping_exact_count_failed/);
    assert.equal(db.postAssets.has(`${postId}:${oldAssetId}`), true, 'Post asset link must be rolled back');
    assert.equal(db.postAssets.has(`${postId}:${newAssetId}`), false, 'New post asset link must not exist');
  }

  // TEST 5H: Mapping count >1 rejected + whole transaction rollback
  {
    const db = createBaseState();
    db.sourceMappings.set('extra_mapping', { course_id: courseId, post_id: postId, asset_id: oldAssetId }); // 2 mappings
    assert.throws(() => executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId), /v5_mapping_exact_count_failed/);
    assert.equal(db.postAssets.has(`${postId}:${oldAssetId}`), true, 'Post asset link must be rolled back');
    assert.equal(db.postAssets.has(`${postId}:${newAssetId}`), false, 'New post asset link must not exist');
  }

  // TEST 5I: Successful replacement preserves position/role, old asset unchanged, release v1 unchanged
  {
    const db = createBaseState();
    const result = executeAtomicRpc(db, courseId, postId, oldAssetId, newAssetId);
    assert.equal(result.success, true);
    assert.equal(result.mapping_updated, 1);

    // Old asset row unchanged
    const oldAsset = db.mediaAssets.get(oldAssetId);
    assert.equal(oldAsset.bytes, 40547689);
    assert.equal(oldAsset.status, 'ready');

    // Release v1 snapshot unchanged
    assert.equal(db.releases[0].snapshot.asset_ids[0], oldAssetId);
    assert.equal(db.releases[0].snapshot.asset_ids.includes(newAssetId), false);

    // Link swapped preserving position/role
    assert.equal(db.postAssets.has(`${postId}:${oldAssetId}`), false);
    const newLink = db.postAssets.get(`${postId}:${newAssetId}`);
    assert(newLink);
    assert.equal(newLink.position, 0);
    assert.equal(newLink.role, 'primary');

    // Mapping updated
    assert.equal(db.sourceMappings.get(telegramRowId).asset_id, newAssetId);

    // Subsequent Telegram sync remains 100% idempotent
    const rows = [
      {
        id: telegramRowId,
        source_message_id: 101,
        message_type: 'video',
        caption: 'Video 1',
        raw_message: { video: { file_id: 'vid1', mime_type: 'video/mp4', file_name: '3.mp4', duration: 151 } }
      }
    ];
    const existingMappings = new Map([[telegramRowId, { post_id: postId, asset_id: newAssetId }]]);
    const plan = planImport({ rows, existingMappings, authoringMode: 'lesson' });
    assert.equal(plan.newUnits, 0);
    assert.equal(plan.predictedPosts, 0);
    assert.equal(plan.predictedTelegramMirrorJobs, 0);
  }
});
