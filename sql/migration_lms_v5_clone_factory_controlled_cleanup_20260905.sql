-- Controlled cleanup for isolated V5 clone-factory fixtures only.
-- This preserves the default append-only release/media guards for every real course.
-- The cleanup RPC is service-role only and requires BOTH the reserved slug prefix
-- and raw_data.test_fixture=true on the exact course UUID.

create or replace function public.v5_clone_factory_cleanup_allowed(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    current_setting('app.v5_clone_factory_cleanup_course_id', true) = p_course_id::text
    and exists (
      select 1
      from public.courses c
      where c.id = p_course_id
        and left(c.slug, 20) = '__clone_factory_test'
        and coalesce(c.raw_data->>'test_fixture', '') = 'true'
    );
$$;

revoke all on function public.v5_clone_factory_cleanup_allowed(uuid) from public;
revoke all on function public.v5_clone_factory_cleanup_allowed(uuid) from anon;
revoke all on function public.v5_clone_factory_cleanup_allowed(uuid) from authenticated;

-- Keep release history immutable by default. The only DELETE exception is while
-- the service-only cleanup RPC is running for the exact guarded test course.
create or replace function public.enforce_v5_release_immutability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if public.v5_clone_factory_cleanup_allowed(old.course_id) then
      return old;
    end if;
    raise exception 'v5_release_delete_forbidden';
  end if;

  if old.id is distinct from new.id
     or old.course_id is distinct from new.course_id
     or old.version is distinct from new.version
     or old.snapshot is distinct from new.snapshot
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'v5_release_immutable';
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if old.status = 'published' and new.status = 'superseded' then
    return new;
  end if;

  raise exception 'v5_release_status_transition_forbidden';
end;
$$;

revoke all on function public.enforce_v5_release_immutability() from public;
revoke all on function public.enforce_v5_release_immutability() from anon;
revoke all on function public.enforce_v5_release_immutability() from authenticated;

create or replace function public.cleanup_v5_clone_factory_fixture(
  p_course_id uuid,
  p_expected_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_slug text;
  v_raw_data jsonb;
  v_asset_ids uuid[] := array[]::uuid[];
  v_r2_keys text[] := array[]::text[];
  v_release_count integer := 0;
  v_enrollment_count integer := 0;
  v_asset_count integer := 0;
  v_course_count integer := 0;
begin
  if p_course_id is null or nullif(btrim(coalesce(p_expected_slug, '')), '') is null then
    raise exception 'v5_test_cleanup_identity_required';
  end if;

  select c.slug, c.raw_data
    into v_slug, v_raw_data
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

  if v_slug is distinct from p_expected_slug
     or left(v_slug, 20) <> '__clone_factory_test'
     or coalesce(v_raw_data->>'test_fixture', '') <> 'true' then
    raise exception 'v5_test_cleanup_fixture_guard_failed';
  end if;

  -- A cleanup fixture must be isolated from real commerce/legacy ownership.
  if exists (select 1 from public.orders o where o.course_id = p_course_id) then
    raise exception 'v5_test_cleanup_has_orders';
  end if;

  if exists (
    select 1
    from public.lms_v4_telegram_course_sources s
    where s.course_slug = v_slug
  ) then
    raise exception 'v5_test_cleanup_has_v4_source';
  end if;

  if exists (select 1 from public.v5_source_mappings m where m.course_id = p_course_id) then
    raise exception 'v5_test_cleanup_has_source_mappings';
  end if;

  if exists (select 1 from public.v5_jobs j where j.course_id = p_course_id) then
    raise exception 'v5_test_cleanup_has_jobs';
  end if;

  if exists (
    select 1
    from public.student_enrollments e
    where e.course_id = p_course_id
      and (
        e.source_order_id is not null
        or left(coalesce(e.source_system, ''), 20) <> '__clone_factory_test'
      )
  ) then
    raise exception 'v5_test_cleanup_has_non_test_enrollment';
  end if;

  -- Capture every asset owned by this isolated fixture, including immutable
  -- release snapshots and any direct-upload object under this course UUID.
  select coalesce(array_agg(distinct asset_id), array[]::uuid[])
    into v_asset_ids
  from (
    select pa.asset_id
    from public.v5_post_assets pa
    join public.v5_posts p on p.id = pa.post_id
    where p.course_id = p_course_id

    union

    select a.asset_text::uuid
    from public.v5_releases r
    cross join lateral jsonb_array_elements_text(
      coalesce(r.snapshot->'asset_ids', '[]'::jsonb)
    ) as a(asset_text)
    where r.course_id = p_course_id

    union

    select nullif(l.value->>'asset_id', '')::uuid
    from public.v5_releases r
    cross join lateral jsonb_array_elements(
      coalesce(r.snapshot->'links', '[]'::jsonb)
    ) as l(value)
    where r.course_id = p_course_id
      and nullif(l.value->>'asset_id', '') is not null

    union

    select a.id
    from public.v5_media_assets a
    where left(
      coalesce(a.r2_object_key, ''),
      length('media/v5/' || p_course_id::text || '/')
    ) = 'media/v5/' || p_course_id::text || '/'
  ) owned_assets
  where asset_id is not null;

  if exists (
    select 1
    from unnest(v_asset_ids) as owned(asset_id)
    left join public.v5_media_assets a on a.id = owned.asset_id
    where a.id is null
       or left(coalesce(a.original_filename, ''), 20) <> '__clone_factory_test'
       or left(
            coalesce(a.r2_object_key, ''),
            length('media/v5/' || p_course_id::text || '/')
          ) <> 'media/v5/' || p_course_id::text || '/'
       or a.thumbnail_asset_id is not null
  ) then
    raise exception 'v5_test_cleanup_asset_guard_failed';
  end if;

  -- Refuse shared assets even if a malformed fixture somehow references one.
  if exists (
    select 1
    from public.v5_post_assets pa
    join public.v5_posts p on p.id = pa.post_id
    where pa.asset_id = any(v_asset_ids)
      and p.course_id <> p_course_id
  ) then
    raise exception 'v5_test_cleanup_shared_asset';
  end if;

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
    raise exception 'v5_test_cleanup_shared_release_asset';
  end if;

  select coalesce(array_agg(a.r2_object_key order by a.r2_object_key), array[]::text[])
    into v_r2_keys
  from public.v5_media_assets a
  where a.id = any(v_asset_ids)
    and nullif(btrim(coalesce(a.r2_object_key, '')), '') is not null;

  select count(*) into v_release_count
  from public.v5_releases r
  where r.course_id = p_course_id;

  select count(*) into v_enrollment_count
  from public.student_enrollments e
  where e.course_id = p_course_id;

  -- Transaction-local capability. The release trigger still rejects every
  -- other course and every DELETE outside this guarded function call.
  perform set_config('app.v5_clone_factory_cleanup_course_id', p_course_id::text, true);

  delete from public.v5_releases where course_id = p_course_id;
  delete from public.v5_course_configs where course_id = p_course_id;

  delete from public.courses
  where id = p_course_id
    and slug = v_slug
    and left(slug, 20) = '__clone_factory_test'
    and coalesce(raw_data->>'test_fixture', '') = 'true';
  get diagnostics v_course_count = row_count;

  if v_course_count <> 1 then
    raise exception 'v5_test_cleanup_course_delete_failed';
  end if;

  delete from public.v5_media_assets
  where id = any(v_asset_ids);
  get diagnostics v_asset_count = row_count;

  perform set_config('app.v5_clone_factory_cleanup_course_id', '', true);

  return jsonb_build_object(
    'success', true,
    'course_id', p_course_id,
    'slug', v_slug,
    'deleted_courses', v_course_count,
    'deleted_releases', v_release_count,
    'deleted_enrollments', v_enrollment_count,
    'deleted_assets', v_asset_count,
    'r2_object_keys', to_jsonb(v_r2_keys)
  );
end;
$$;

revoke all on function public.cleanup_v5_clone_factory_fixture(uuid, text) from public;
revoke all on function public.cleanup_v5_clone_factory_fixture(uuid, text) from anon;
revoke all on function public.cleanup_v5_clone_factory_fixture(uuid, text) from authenticated;
grant execute on function public.cleanup_v5_clone_factory_fixture(uuid, text) to service_role;
