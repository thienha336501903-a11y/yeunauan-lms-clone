-- Migration: 20260923160000_v5_controlled_unreleased_course_cleanup.sql
-- Description: Controlled transactional cleanup RPC for Safe V5-native unreleased draft courses only.
-- Fail-closed multi-condition guards: zero releases, zero orders, zero enrollments, zero active jobs/uploads,
-- no Commerce enrichment, strictly owned namespace, and preservation of shared Telegram clone sources.
-- Execution is strictly restricted to service_role.

create or replace function public.cleanup_v5_unreleased_draft_course(
  p_course_id uuid,
  p_expected_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_course record;
  v_config_status text;
  v_published_release_id uuid;
  v_asset_ids uuid[] := array[]::uuid[];
  v_asset_count integer := 0;
  v_course_count integer := 0;
begin
  -- 1. Input identity check
  if p_course_id is null or nullif(btrim(coalesce(p_expected_slug, '')), '') is null then
    raise exception 'v5_course_cleanup_identity_required';
  end if;

  -- 2. Lock course row
  select c.id, c.slug, c.delivery_mode, c.active, c.is_published, c.price, c.image_url, c.teacher_name, c.description, c.raw_data
    into v_course
  from public.courses c
  where c.id = p_course_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', true,
      'already_missing', true,
      'course_id', p_course_id,
      'expected_slug', p_expected_slug
    );
  end if;

  -- 3. Exact slug match
  if v_course.slug is distinct from p_expected_slug then
    raise exception 'v5_course_cleanup_slug_mismatch';
  end if;

  -- 4. V5 delivery mode only
  if lower(coalesce(v_course.delivery_mode, '')) <> 'v5' then
    raise exception 'v5_course_cleanup_mode_invalid';
  end if;

  -- 5. Originated from V5 Channel creation
  if coalesce(v_course.raw_data->>'v5CreatedFrom', '') <> 'course_channel' then
    raise exception 'v5_course_cleanup_not_v5_native';
  end if;

  -- 6. Must not be active or published
  if v_course.active is true then
    raise exception 'v5_course_cleanup_active_forbidden';
  end if;
  if v_course.is_published is true then
    raise exception 'v5_course_cleanup_published_forbidden';
  end if;

  -- 7. Commerce ownership protection: no commercial enrichment
  if nullif(btrim(coalesce(v_course.price, '')), '') is not null
     or nullif(btrim(coalesce(v_course.image_url, '')), '') is not null
     or nullif(btrim(coalesce(v_course.teacher_name, '')), '') is not null
     or nullif(btrim(coalesce(v_course.description, '')), '') is not null then
    raise exception 'v5_course_cleanup_has_commerce_enrichment';
  end if;

  -- 8. V5 Course Config must exist and be draft with no published release
  select c.status, c.published_release_id
    into v_config_status, v_published_release_id
  from public.v5_course_configs c
  where c.course_id = p_course_id;

  if not found then
    raise exception 'v5_course_cleanup_missing_config';
  end if;

  if lower(coalesce(v_config_status, '')) <> 'draft' then
    raise exception 'v5_course_cleanup_config_not_draft';
  end if;

  if v_published_release_id is not null then
    raise exception 'v5_course_cleanup_has_published_release';
  end if;

  -- 9. Zero releases
  if exists (select 1 from public.v5_releases r where r.course_id = p_course_id) then
    raise exception 'v5_course_cleanup_has_releases';
  end if;

  -- 10. Zero orders by course_id OR slug identity
  if exists (
    select 1 from public.orders o
    where o.course_id = p_course_id or o.course_slug = v_course.slug
  ) then
    raise exception 'v5_course_cleanup_has_orders';
  end if;

  -- 11. Zero enrollments by course_id OR slug identity
  if exists (
    select 1 from public.student_enrollments e
    where e.course_id = p_course_id or e.course_slug = v_course.slug
  ) then
    raise exception 'v5_course_cleanup_has_enrollments';
  end if;

  -- 12. No active / non-terminal jobs
  if exists (
    select 1 from public.v5_jobs j
    where j.course_id = p_course_id
      and lower(coalesce(j.status, '')) not in ('success', 'failed', 'cancelled', 'canceled')
  ) then
    raise exception 'v5_course_cleanup_has_active_jobs';
  end if;

  -- 13. No active / non-terminal upload sessions
  if exists (
    select 1 from public.v5_upload_sessions u
    where u.course_id = p_course_id
      and lower(coalesce(u.status, '')) not in ('completed', 'aborted', 'expired')
      and (u.expires_at is null or u.expires_at > now())
  ) then
    raise exception 'v5_course_cleanup_has_active_uploads';
  end if;

  -- 14. Zero V4 source mapping
  if exists (
    select 1 from public.lms_v4_telegram_course_sources s
    where s.course_slug = v_course.slug
  ) then
    raise exception 'v5_course_cleanup_has_v4_source';
  end if;

  -- 15. Capture candidate assets owned by this course
  select coalesce(array_agg(distinct asset_id), array[]::uuid[])
    into v_asset_ids
  from (
    select pa.asset_id
    from public.v5_post_assets pa
    join public.v5_posts p on p.id = pa.post_id
    where p.course_id = p_course_id

    union

    select sm.asset_id
    from public.v5_source_mappings sm
    where sm.course_id = p_course_id and sm.asset_id is not null

    union

    select j.asset_id
    from public.v5_jobs j
    where j.course_id = p_course_id and j.asset_id is not null

    union

    select u.asset_id
    from public.v5_upload_sessions u
    where u.course_id = p_course_id and u.asset_id is not null

    union

    select a.id as asset_id
    from public.v5_media_assets a
    where left(
      coalesce(a.r2_object_key, ''),
      length('media/v5/' || p_course_id::text || '/')
    ) = 'media/v5/' || p_course_id::text || '/'

    union

    select a.thumbnail_asset_id as asset_id
    from public.v5_media_assets a
    where left(
      coalesce(a.r2_object_key, ''),
      length('media/v5/' || p_course_id::text || '/')
    ) = 'media/v5/' || p_course_id::text || '/'
      and a.thumbnail_asset_id is not null
  ) owned_assets
  where asset_id is not null;

  -- 16. Verify all candidate assets strictly reside inside media/v5/<p_course_id>/
  if exists (
    select 1
    from unnest(v_asset_ids) as owned(asset_id)
    join public.v5_media_assets a on a.id = owned.asset_id
    where left(
      coalesce(a.r2_object_key, ''),
      length('media/v5/' || p_course_id::text || '/')
    ) <> 'media/v5/' || p_course_id::text || '/'
  ) then
    raise exception 'v5_course_cleanup_asset_outside_namespace';
  end if;

  -- 17. Verify no candidate asset is shared by another course's posts
  if exists (
    select 1
    from public.v5_post_assets pa
    join public.v5_posts p on p.id = pa.post_id
    where pa.asset_id = any(v_asset_ids)
      and p.course_id <> p_course_id
  ) then
    raise exception 'v5_course_cleanup_shared_post_asset';
  end if;

  -- 18. Verify no candidate asset is shared by another course's source mappings
  if exists (
    select 1
    from public.v5_source_mappings sm
    where sm.asset_id = any(v_asset_ids)
      and sm.course_id <> p_course_id
  ) then
    raise exception 'v5_course_cleanup_shared_source_mapping_asset';
  end if;

  -- 19. Verify no candidate asset is shared by another course's jobs
  if exists (
    select 1
    from public.v5_jobs j
    where j.asset_id = any(v_asset_ids)
      and j.course_id <> p_course_id
  ) then
    raise exception 'v5_course_cleanup_shared_job_asset';
  end if;

  -- 20. Verify no candidate asset is shared by another course's upload sessions
  if exists (
    select 1
    from public.v5_upload_sessions u
    where u.asset_id = any(v_asset_ids)
      and u.course_id <> p_course_id
  ) then
    raise exception 'v5_course_cleanup_shared_upload_asset';
  end if;

  -- 21. Verify no candidate asset is referenced by another course's releases
  if exists (
    select 1
    from public.v5_releases r
    where r.course_id <> p_course_id
      and exists (
        select 1
        from unnest(v_asset_ids) as owned(asset_id)
        where coalesce(r.snapshot->'asset_ids', '[]'::jsonb) ? owned.asset_id::text
           or exists (
             select 1
             from jsonb_array_elements(coalesce(r.snapshot->'links', '[]'::jsonb)) as l(value)
             where l.value->>'asset_id' = owned.asset_id::text
           )
      )
  ) then
    raise exception 'v5_course_cleanup_shared_release_asset';
  end if;

  -- 22. Verify no candidate asset is used as thumbnail_asset_id by another course's media asset
  if exists (
    select 1
    from public.v5_media_assets other_a
    where other_a.thumbnail_asset_id = any(v_asset_ids)
      and other_a.id <> all(v_asset_ids)
  ) then
    raise exception 'v5_course_cleanup_shared_thumbnail_asset';
  end if;

  -- 23. Delete course-specific site_config keys safely (explicit known keys only, no wildcard)
  delete from public.site_config
  where key in (
    v_course.slug || '_studentDisplayTitle',
    v_course.slug || '_title',
    v_course.slug || '_description',
    v_course.slug || '_subtitle',
    v_course.slug || '_heroImage',
    v_course.slug || '_posterImage',
    v_course.slug || '_qrImage'
  );

  -- 24. Delete V5 course config first so courses delete trigger does not raise
  delete from public.v5_course_configs where course_id = p_course_id;

  -- 25. Delete canonical courses row (cascades remove posts, lessons, source mappings, jobs, upload sessions)
  delete from public.courses
  where id = p_course_id and slug = v_course.slug;
  get diagnostics v_course_count = row_count;

  if v_course_count <> 1 then
    raise exception 'v5_course_cleanup_delete_failed';
  end if;

  -- 26. Delete now-unreferenced owned media assets
  if array_length(v_asset_ids, 1) > 0 then
    delete from public.v5_media_assets
    where id = any(v_asset_ids);
    get diagnostics v_asset_count = row_count;
  end if;

  -- Telegram sources (tgcloner_sources, tgcloner_source_messages) are preserved untouched

  return jsonb_build_object(
    'success', true,
    'course_id', p_course_id,
    'slug', v_course.slug,
    'deleted_courses', v_course_count,
    'deleted_assets', v_asset_count
  );
end;
$$;

revoke all on function public.cleanup_v5_unreleased_draft_course(uuid, text) from public;
revoke all on function public.cleanup_v5_unreleased_draft_course(uuid, text) from anon;
revoke all on function public.cleanup_v5_unreleased_draft_course(uuid, text) from authenticated;
grant execute on function public.cleanup_v5_unreleased_draft_course(uuid, text) to service_role;
