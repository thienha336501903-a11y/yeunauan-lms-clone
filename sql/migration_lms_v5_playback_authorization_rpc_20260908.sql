-- Reduce Supabase egress on V5 playback lease issuance.
-- Membership is evaluated inside Postgres instead of returning the full release
-- snapshot to Vercel for every protected media request.

create or replace function public.v5_authorize_playback_asset(
  p_course_id uuid,
  p_asset_id uuid
)
returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select vr.id
  from public.v5_course_configs vc
  join public.v5_releases vr
    on vr.id = vc.published_release_id
   and vr.course_id = vc.course_id
  where vc.course_id = p_course_id
    and vc.status = 'published'
    and vr.status = 'published'
    and (
      exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          coalesce(vr.snapshot -> 'links', '[]'::jsonb)
        ) as release_link
        where release_link ->> 'asset_id' = p_asset_id::text
      )
      or exists (
        select 1
        from public.v5_media_assets parent_asset
        where parent_asset.thumbnail_asset_id = p_asset_id
          and parent_asset.type = 'video'
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              coalesce(vr.snapshot -> 'links', '[]'::jsonb)
            ) as parent_release_link
            where parent_release_link ->> 'asset_id' = parent_asset.id::text
          )
      )
    )
  limit 1;
$$;

revoke all on function public.v5_authorize_playback_asset(uuid, uuid) from public;
revoke all on function public.v5_authorize_playback_asset(uuid, uuid) from anon;
revoke all on function public.v5_authorize_playback_asset(uuid, uuid) from authenticated;
grant execute on function public.v5_authorize_playback_asset(uuid, uuid) to service_role;
