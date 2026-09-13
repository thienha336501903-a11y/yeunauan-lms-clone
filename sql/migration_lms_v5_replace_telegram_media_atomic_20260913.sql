-- Atomic V5 Telegram Media Replacement.
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

  -- 2. Validate old asset
  select * into v_old_asset
  from public.v5_media_assets
  where id = p_old_asset_id;

  if not found then
    raise exception 'v5_old_asset_not_found';
  end if;

  if coalesce(v_old_asset.origin, '') <> 'telegram' then
    raise exception 'v5_old_asset_not_telegram';
  end if;

  -- 3. Validate existing post-asset link
  select * into v_link
  from public.v5_post_assets
  where post_id = p_post_id and asset_id = p_old_asset_id
  for update;

  if not found then
    raise exception 'v5_old_asset_not_linked_to_post';
  end if;

  -- 4. Validate new asset
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

  -- 5. Ensure Telegram provenance is preserved on the new asset
  update public.v5_media_assets set
    origin = 'telegram',
    telegram_source_id = coalesce(v_new_asset.telegram_source_id, v_old_asset.telegram_source_id),
    telegram_message_row_id = coalesce(v_new_asset.telegram_message_row_id, v_old_asset.telegram_message_row_id),
    mime_type = coalesce(v_new_asset.mime_type, v_old_asset.mime_type),
    original_filename = coalesce(v_new_asset.original_filename, v_old_asset.original_filename),
    thumbnail_asset_id = coalesce(v_new_asset.thumbnail_asset_id, v_old_asset.thumbnail_asset_id),
    metadata = coalesce(v_new_asset.metadata, '{}'::jsonb) || jsonb_build_object(
      'replaced_from_asset_id', v_old_asset.id::text,
      'replaced_at', now()::text
    ),
    updated_at = now()
  where id = p_new_asset_id;

  -- 6. Atomic swap in v5_post_assets: preserve exact position and role
  delete from public.v5_post_assets
  where post_id = p_post_id and asset_id = p_old_asset_id;

  insert into public.v5_post_assets (post_id, asset_id, position, role, metadata)
  values (p_post_id, p_new_asset_id, v_link.position, v_link.role, coalesce(v_link.metadata, '{}'::jsonb));

  -- 7. Update v5_source_mappings: move asset_id to new asset
  update public.v5_source_mappings
  set asset_id = p_new_asset_id, updated_at = now()
  where course_id = p_course_id
    and post_id = p_post_id
    and asset_id = p_old_asset_id;
  get diagnostics v_mapping_updated = row_count;

  -- 8. Refresh post readiness
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
grant execute on function public.v5_replace_telegram_media_atomic(uuid, uuid, uuid, uuid) to service_role;
