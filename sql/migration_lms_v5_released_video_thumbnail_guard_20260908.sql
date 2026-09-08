-- Allow one narrowly-scoped post-release enrichment: attach the first real
-- thumbnail to a released READY R2 video. All other released-asset content
-- remains immutable, and an existing thumbnail cannot be replaced or removed.

create or replace function public.enforce_v5_media_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_released boolean := false;
  v_valid_thumbnail boolean := false;
begin
  if tg_op <> 'DELETE' and new.status = 'ready' then
    if new.provider <> 'r2' or nullif(btrim(coalesce(new.r2_object_key, '')), '') is null then
      raise exception 'v5_ready_asset_requires_r2';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  select exists (
    select 1
      from public.v5_releases r
     where coalesce(r.snapshot->>'schema', '') = 'v5-release-v1'
       and (
         coalesce(r.snapshot->'asset_ids', '[]'::jsonb) ? old.id::text
         or exists (
           select 1
           from jsonb_array_elements(coalesce(r.snapshot->'links', '[]'::jsonb)) as release_link(value)
           where release_link.value->>'asset_id' = old.id::text
         )
       )
  ) into v_released;

  if not v_released then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'v5_released_asset_delete_forbidden';
  end if;

  if old.status is distinct from new.status or new.status <> 'ready' then
    raise exception 'v5_released_asset_status_immutable';
  end if;

  if old.type = 'video'
     and old.provider = 'r2'
     and old.status = 'ready'
     and old.thumbnail_asset_id is null
     and new.thumbnail_asset_id is not null
     and row(
       old.type,
       old.provider,
       old.origin,
       old.r2_object_key,
       old.telegram_source_id,
       old.telegram_message_row_id,
       old.mime_type,
       old.original_filename,
       old.bytes,
       old.width,
       old.height,
       old.duration_ms,
       old.checksum_sha256
     ) is not distinct from row(
       new.type,
       new.provider,
       new.origin,
       new.r2_object_key,
       new.telegram_source_id,
       new.telegram_message_row_id,
       new.mime_type,
       new.original_filename,
       new.bytes,
       new.width,
       new.height,
       new.duration_ms,
       new.checksum_sha256
     ) then
    select exists (
      select 1
        from public.v5_media_assets t
       where t.id = new.thumbnail_asset_id
         and t.type = 'image'
         and t.provider = 'r2'
         and t.status = 'ready'
         and lower(coalesce(t.mime_type, '')) = 'image/jpeg'
         and nullif(btrim(coalesce(t.r2_object_key, '')), '') is not null
    ) into v_valid_thumbnail;

    if not v_valid_thumbnail then
      raise exception 'v5_released_video_thumbnail_requires_ready_r2_jpeg';
    end if;

    return new;
  end if;

  if row(
      old.type,
      old.provider,
      old.origin,
      old.r2_object_key,
      old.telegram_source_id,
      old.telegram_message_row_id,
      old.mime_type,
      old.original_filename,
      old.bytes,
      old.width,
      old.height,
      old.duration_ms,
      old.checksum_sha256,
      old.thumbnail_asset_id
    ) is distinct from row(
      new.type,
      new.provider,
      new.origin,
      new.r2_object_key,
      new.telegram_source_id,
      new.telegram_message_row_id,
      new.mime_type,
      new.original_filename,
      new.bytes,
      new.width,
      new.height,
      new.duration_ms,
      new.checksum_sha256,
      new.thumbnail_asset_id
    ) then
    raise exception 'v5_released_asset_content_immutable';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_v5_media_integrity() from public;
revoke all on function public.enforce_v5_media_integrity() from anon;
revoke all on function public.enforce_v5_media_integrity() from authenticated;
