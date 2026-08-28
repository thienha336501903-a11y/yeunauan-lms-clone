-- V5 media integrity guard.
-- 1) A learner-playable READY asset must already be backed by private R2.
-- 2) Once an asset id has appeared in any immutable release snapshot, its
--    content locator/identity/display fields cannot be rewritten in-place.
--    New media must receive a new asset id and be published in a new release.

create or replace function public.enforce_v5_media_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_released boolean := false;
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
       and coalesce(r.snapshot->'asset_ids', '[]'::jsonb) ? old.id::text
  ) into v_released;

  if not v_released then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'v5_released_asset_delete_forbidden';
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

drop trigger if exists trg_enforce_v5_media_integrity on public.v5_media_assets;
create trigger trg_enforce_v5_media_integrity
before insert or update or delete on public.v5_media_assets
for each row execute function public.enforce_v5_media_integrity();
