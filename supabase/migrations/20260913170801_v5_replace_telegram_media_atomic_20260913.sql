-- Hardened Atomic V5 Telegram Media Replacement.
-- Allows cleanly replacing a Telegram media asset within the draft/canonical
-- projection without modifying the old released asset, mutating historical releases,
-- or leaving post linkages or source mappings in an inconsistent state.

create or replace function public.v5_replace_telegram_media_atomic(
  p_course_id uuid,
  p_post_id uuid,
  p_old_asset_id uuid,
  p_new_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old_asset record;
  v_new_asset record;
  v_post record;
  v_link record;
  v_mapping_updated integer := 0;
  v_post_ready boolean;
  v_new_in_release boolean := false;
begin
  if p_course_id is null or p_post_id is null or p_old_asset_id is null or p_new_asset_id is null then
    raise exception 'v5_invalid_arguments';
  end if;

  if p_old_asset_id = p_new_asset_id then
    raise exception 'v5_same_asset';
  end if;

  -- 1. Validate post ownership and lock row
  select * into v_post
  from public.v5_posts
  where id = p_post_id and course_id = p_course_id
  for update;

  if not found then
    raise exception 'v5_post_not_found';
  end if;

  -- 2. Validate existing post-asset link
  select * into v_link
  from public.v5_post_assets
  where post_id = p_post_id and asset_id = p_old_asset_id
  for update;

  if not found then
    raise exception 'v5_old_asset_not_linked_to_post';
  end if;

  -- 3. Validate old asset
  select * into v_old_asset
  from public.v5_media_assets
  where id = p_old_asset_id;

  if not found then
    raise exception 'v5_old_asset_not_found';
  end if;

  if coalesce(v_old_asset.origin, '') <> 'telegram' then
    raise exception 'v5_old_asset_not_telegram';
  end if;

  -- 4. Validate new asset exists and is ready on R2
  select * into v_new_asset
  from public.v5_media_assets
  where id = p_new_asset_id
  for update;

  if not found then
    raise exception 'v5_new_asset_not_found';
  end if;

  if v_new_asset.status <> 'ready' or v_new_asset.provider <> 'r2' or nullif(btrim(coalesce(v_new_asset.r2_object_key, '')), '') is null then
    raise exception 'v5_new_asset_not_ready_r2';
  end if;

  -- 5. Validate asset types match (e.g. video cannot be replaced by image)
  if v_new_asset.type <> v_old_asset.type then
    raise exception 'v5_asset_type_mismatch';
  end if;

  -- 6. Validate new asset origin is telegram
  if coalesce(v_new_asset.origin, '') <> 'telegram' then
    raise exception 'v5_new_asset_not_telegram';
  end if;

  -- 7. Validate Telegram provenance matches exactly using UUID-safe comparisons
  if v_new_asset.telegram_source_id is null
     or v_old_asset.telegram_source_id is null
     or v_new_asset.telegram_source_id is distinct from v_old_asset.telegram_source_id then
    raise exception 'v5_telegram_source_id_mismatch';
  end if;

  if v_new_asset.telegram_message_row_id is null
     or v_old_asset.telegram_message_row_id is null
     or v_new_asset.telegram_message_row_id is distinct from v_old_asset.telegram_message_row_id then
    raise exception 'v5_telegram_message_row_id_mismatch';
  end if;

  -- 8. Validate new R2 object key prefix is properly scoped to this course and asset
  if not (v_new_asset.r2_object_key like ('media/v5/' || p_course_id::text || '/' || p_new_asset_id::text || '/%')) then
    raise exception 'v5_invalid_r2_object_key_scope';
  end if;

  -- 9. Validate new asset is not already linked to any post
  if exists (
    select 1 from public.v5_post_assets where asset_id = p_new_asset_id
  ) then
    raise exception 'v5_new_asset_already_linked';
  end if;

  -- 10. Validate new asset is not referenced by any historical release snapshot
  select exists (
    select 1
    from public.v5_releases r
    where coalesce(r.snapshot->'asset_ids', '[]'::jsonb) ? p_new_asset_id::text
       or exists (
         select 1
         from jsonb_array_elements(coalesce(r.snapshot->'links', '[]'::jsonb)) as release_link(value)
         where release_link.value->>'asset_id' = p_new_asset_id::text
       )
       or r.snapshot::text like ('%' || p_new_asset_id::text || '%')
  ) into v_new_in_release;

  if v_new_in_release then
    raise exception 'v5_new_asset_already_released';
  end if;

  -- 11. Append audit trail to new asset metadata without touching old asset
  update public.v5_media_assets set
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'replaced_from_asset_id', v_old_asset.id::text,
      'replaced_at', now()::text
    ),
    updated_at = now()
  where id = p_new_asset_id;

  -- 12. Atomic swap in v5_post_assets: preserve exact position and role
  delete from public.v5_post_assets
  where post_id = p_post_id and asset_id = p_old_asset_id;

  insert into public.v5_post_assets (post_id, asset_id, position, role, metadata)
  values (p_post_id, p_new_asset_id, v_link.position, v_link.role, coalesce(v_link.metadata, '{}'::jsonb));

  -- 13. Update v5_source_mappings: move asset_id to new asset
  update public.v5_source_mappings
  set asset_id = p_new_asset_id, updated_at = now()
  where course_id = p_course_id
    and post_id = p_post_id
    and asset_id = p_old_asset_id;
  get diagnostics v_mapping_updated = row_count;

  -- Exact count enforcement: must be exactly 1 mapping updated
  if v_mapping_updated <> 1 then
    raise exception 'v5_mapping_exact_count_failed';
  end if;

  -- 14. Refresh post readiness
  select not exists (
    select 1
    from public.v5_post_assets pa
    join public.v5_media_assets ma on ma.id = pa.asset_id
    where pa.post_id = p_post_id
      and ma.status not in ('ready', 'archived')
  ) into v_post_ready;

  update public.v5_posts set
    status = case when v_post_ready then 'ready' else 'processing' end,
    metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{pending_attachments}',
      case when v_post_ready then 'false'::jsonb else 'true'::jsonb end
    ),
    updated_at = now()
  where id = p_post_id;

  return jsonb_build_object(
    'success', true,
    'course_id', p_course_id,
    'post_id', p_post_id,
    'old_asset_id', p_old_asset_id,
    'new_asset_id', p_new_asset_id,
    'position', v_link.position,
    'role', v_link.role,
    'mapping_updated', v_mapping_updated
  );
end;
$$;

revoke all on function public.v5_replace_telegram_media_atomic(uuid, uuid, uuid, uuid) from public;
revoke all on function public.v5_replace_telegram_media_atomic(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.v5_replace_telegram_media_atomic(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.v5_replace_telegram_media_atomic(uuid, uuid, uuid, uuid) to service_role;;
