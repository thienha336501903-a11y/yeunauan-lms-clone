-- Follow-up for clone-factory cleanup after the V5 authoring UI normalized slugs
-- and retained ordinary upload filenames/source_system values.
--
-- This keeps cleanup fail-closed to the exact course UUID + expected slug, requires
-- an isolated V5 fixture marker, rejects any Commerce-owned enrollment, and keeps
-- release deletion possible only inside the transaction-local cleanup capability.

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
        and lower(coalesce(c.delivery_mode, '')) = 'v5'
        and (
          left(coalesce(c.title, ''), 20) = '__clone_factory_test'
          or left(coalesce(c.raw_data->>'studentDisplayTitle', ''), 20) = '__clone_factory_test'
          or coalesce(c.raw_data->>'test_fixture', '') = 'true'
          or left(coalesce(c.slug, ''), 20) = '__clone_factory_test'
          or left(coalesce(c.slug, ''), 18) = 'clone-factory-test'
        )
    );
$$;

revoke all on function public.v5_clone_factory_cleanup_allowed(uuid) from public;
revoke all on function public.v5_clone_factory_cleanup_allowed(uuid) from anon;
revoke all on function public.v5_clone_factory_cleanup_allowed(uuid) from authenticated;

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
  v_title text;
  v_delivery_mode text;
  v_raw_data jsonb;
  v_fixture_marked boolean := false;
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

  select c.slug, c.title, c.delivery_mode, c.raw_data
    into v_slug, v_title, v_delivery_mode, v_raw_data
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

  v_fixture_marked :=
    left(coalesce(v_title, ''), 20) = '__clone_factory_test'
    or left(coalesce(v_raw_data->>'studentDisplayTitle', ''), 20) = '__clone_factory_test'
    or coalesce(v_raw_data->>'test_fixture', '') = 'true'
    or left(coalesce(v_slug, ''), 20) = '__clone_factory_test'
    or left(coalesce(v_slug, ''), 18) = 'clone-factory-test';

  if v_slug is distinct from p_expected_slug
     or lower(coalesce(v_delivery_mode, '')) <> 'v5'
     or not v_fixture_marked then
    raise exception 'v5_test_cleanup_fixture_guard_failed';
  end if;

  -- A cleanup fixture must remain isolated from real Commerce/V4/source ownership.
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

  -- Owner-acceptance grants are created through the normal admin enrollment path,
  -- so source_system may legitimately be `lms`. Any order-linked enrollment is
  -- still forbidden because it may represent a real Commerce entitlement.
  if exists (
    select 1
    from public.student_enrollments e
    where e.course_id = p_course_id
      and e.source_order_id is not null
  ) then
    raise exception 'v5_test_cleanup_has_non_test_enrollment';
  end if;

  -- Capture every asset owned by this isolated fixture, including immutable
  -- release snapshots and direct-upload objects under this exact course UUID.
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

  -- Ordinary upload filenames are valid. Ownership is proven by the exact R2
  -- namespace, R2 provider, fixture UUID, and non-sharing checks below.
  if exists (
    select 1
    from unnest(v_asset_ids) as owned(asset_id)
    left join public.v5_media_assets a on a.id = owned.asset_id
    where a.id is null
       or lower(coalesce(a.provider, '')) <> 'r2'
       or left(
            coalesce(a.r2_object_key, ''),
            length('media/v5/' || p_course_id::text || '/')
          ) <> 'media/v5/' || p_course_id::text || '/'
       or a.thumbnail_asset_id is not null
  ) then
    raise exception 'v5_test_cleanup_asset_guard_failed';
  end if;

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

  perform set_config('app.v5_clone_factory_cleanup_course_id', p_course_id::text, true);

  delete from public.v5_releases where course_id = p_course_id;
  delete from public.v5_course_configs where course_id = p_course_id;

  delete from public.courses c
  where c.id = p_course_id
    and c.slug = v_slug
    and lower(coalesce(c.delivery_mode, '')) = 'v5'
    and (
      left(coalesce(c.title, ''), 20) = '__clone_factory_test'
      or left(coalesce(c.raw_data->>'studentDisplayTitle', ''), 20) = '__clone_factory_test'
      or coalesce(c.raw_data->>'test_fixture', '') = 'true'
      or left(coalesce(c.slug, ''), 20) = '__clone_factory_test'
      or left(coalesce(c.slug, ''), 18) = 'clone-factory-test'
    );
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
