-- Atomic V5 release pointer switch. Learners render from the selected immutable
-- release snapshot; authoring rows may be prepared before this transaction.
-- Content Publish owns courses.is_published, while courses.active remains the
-- independent Commerce sale switch and is never enabled by this function.

create or replace function public.v5_publish_release_atomic(
  p_course_id uuid,
  p_snapshot jsonb,
  p_created_by text default null
)
returns table(release_id uuid, release_version integer, previous_release_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_previous uuid;
  v_release uuid := gen_random_uuid();
  v_version integer;
begin
  if p_course_id is null then
    raise exception 'v5_course_required';
  end if;
  if p_snapshot is null or coalesce(p_snapshot->>'schema','') <> 'v5-release-v1' then
    raise exception 'v5_release_snapshot_invalid';
  end if;
  if jsonb_typeof(coalesce(p_snapshot->'lessons', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_snapshot->'posts', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_snapshot->'links', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_snapshot->'asset_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'v5_release_snapshot_shape_invalid';
  end if;
  if jsonb_array_length(coalesce(p_snapshot->'lessons', '[]'::jsonb)) < 1
     or jsonb_array_length(coalesce(p_snapshot->'posts', '[]'::jsonb)) < 1 then
    raise exception 'v5_release_content_empty';
  end if;

  select c.published_release_id
    into v_previous
  from public.v5_course_configs c
  where c.course_id = p_course_id
  for update;

  if not found then
    raise exception 'v5_course_config_missing';
  end if;

  -- Every Lesson in the snapshot must be a canonical authoring Lesson owned by
  -- this exact V5 course. The RPC may not publish a foreign course projection.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_snapshot->'lessons', '[]'::jsonb)) as lesson_row(value)
    where nullif(btrim(coalesce(lesson_row.value->>'id', '')), '') is null
       or not exists (
         select 1
         from public.v5_lessons l
         where l.id::text = lesson_row.value->>'id'
           and l.course_id = p_course_id
       )
  ) then
    raise exception 'v5_release_lesson_ownership_invalid';
  end if;

  -- Every published Post must belong to this exact course and its parent Lesson
  -- must both exist in the snapshot and match the canonical authoring relation.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_snapshot->'posts', '[]'::jsonb)) as post_row(value)
    where nullif(btrim(coalesce(post_row.value->>'id', '')), '') is null
       or nullif(btrim(coalesce(post_row.value->>'lesson_id', '')), '') is null
       or not exists (
         select 1
         from jsonb_array_elements(coalesce(p_snapshot->'lessons', '[]'::jsonb)) as lesson_row(value)
         where lesson_row.value->>'id' = post_row.value->>'lesson_id'
       )
       or not exists (
         select 1
         from public.v5_posts p
         where p.id::text = post_row.value->>'id'
           and p.course_id = p_course_id
           and p.lesson_id::text = post_row.value->>'lesson_id'
       )
  ) then
    raise exception 'v5_release_post_lesson_invalid';
  end if;

  -- Every media link must belong to a Post in this release and must also exist
  -- in canonical v5_post_assets for a Post owned by this course.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_snapshot->'links', '[]'::jsonb)) as link_row(value)
    where nullif(btrim(coalesce(link_row.value->>'post_id', '')), '') is null
       or nullif(btrim(coalesce(link_row.value->>'asset_id', '')), '') is null
       or not exists (
         select 1
         from jsonb_array_elements(coalesce(p_snapshot->'posts', '[]'::jsonb)) as post_row(value)
         where post_row.value->>'id' = link_row.value->>'post_id'
       )
       or not exists (
         select 1
         from public.v5_post_assets pa
         join public.v5_posts p on p.id = pa.post_id
         where p.course_id = p_course_id
           and pa.post_id::text = link_row.value->>'post_id'
           and pa.asset_id::text = link_row.value->>'asset_id'
       )
  ) then
    raise exception 'v5_release_link_invalid';
  end if;

  -- asset_ids is a canonical denormalized index of link membership. It must be
  -- exactly the same set as links[].asset_id so feed/play cannot disagree.
  if exists (
    with explicit_assets as (
      select value as asset_id
      from jsonb_array_elements_text(coalesce(p_snapshot->'asset_ids', '[]'::jsonb))
    ), linked_assets as (
      select distinct link_row.value->>'asset_id' as asset_id
      from jsonb_array_elements(coalesce(p_snapshot->'links', '[]'::jsonb)) as link_row(value)
    )
    (select asset_id from explicit_assets except select asset_id from linked_assets)
    union all
    (select asset_id from linked_assets except select asset_id from explicit_assets)
  ) then
    raise exception 'v5_release_asset_index_mismatch';
  end if;

  -- Fail closed at the DB boundary: every asset referenced either explicitly or
  -- by a release link must currently exist and be learner-playable from private R2.
  if exists (
    with release_asset_ids as (
      select value as asset_id
      from jsonb_array_elements_text(coalesce(p_snapshot->'asset_ids', '[]'::jsonb))
      union
      select link_row.value->>'asset_id' as asset_id
      from jsonb_array_elements(coalesce(p_snapshot->'links', '[]'::jsonb)) as link_row(value)
    )
    select 1
    from release_asset_ids release_asset
    left join public.v5_media_assets a
      on a.id::text = release_asset.asset_id
    where nullif(btrim(coalesce(release_asset.asset_id, '')), '') is null
       or a.id is null
       or a.status <> 'ready'
       or a.provider <> 'r2'
       or nullif(btrim(coalesce(a.r2_object_key, '')), '') is null
  ) then
    raise exception 'v5_release_asset_not_ready';
  end if;

  select coalesce(max(r.version), 0) + 1
    into v_version
  from public.v5_releases r
  where r.course_id = p_course_id;

  insert into public.v5_releases(id, course_id, version, status, snapshot, created_by)
  values (v_release, p_course_id, v_version, 'published', p_snapshot, nullif(trim(p_created_by), ''));

  if v_previous is not null then
    update public.v5_releases
      set status = 'superseded'
    where id = v_previous
      and course_id = p_course_id
      and status = 'published';
  end if;

  update public.v5_course_configs
    set status = 'published',
        published_release_id = v_release,
        updated_at = now()
  where course_id = p_course_id;

  -- The canonical release is now selected, so expose content to entitled
  -- learners. Do not mutate `active`: Publish must never silently open sales.
  update public.courses
    set is_published = true,
        updated_at = now()
  where id = p_course_id
    and lower(coalesce(delivery_mode, '')) = 'v5';
  if not found then
    raise exception 'v5_course_missing_or_mode_invalid';
  end if;

  return query select v_release, v_version, v_previous;
end;
$$;

revoke all on function public.v5_publish_release_atomic(uuid, jsonb, text) from public;
revoke all on function public.v5_publish_release_atomic(uuid, jsonb, text) from anon;
revoke all on function public.v5_publish_release_atomic(uuid, jsonb, text) from authenticated;
grant execute on function public.v5_publish_release_atomic(uuid, jsonb, text) to service_role;
