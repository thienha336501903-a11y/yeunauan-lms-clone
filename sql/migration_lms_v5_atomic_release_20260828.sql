-- Atomic V5 release pointer switch. Learners render from the selected immutable
-- release snapshot; authoring rows may be prepared before this transaction.

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

  select c.published_release_id
    into v_previous
  from public.v5_course_configs c
  where c.course_id = p_course_id
  for update;

  if not found then
    raise exception 'v5_course_config_missing';
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

  return query select v_release, v_version, v_previous;
end;
$$;

revoke all on function public.v5_publish_release_atomic(uuid, jsonb, text) from public;
revoke all on function public.v5_publish_release_atomic(uuid, jsonb, text) from anon;
revoke all on function public.v5_publish_release_atomic(uuid, jsonb, text) from authenticated;
grant execute on function public.v5_publish_release_atomic(uuid, jsonb, text) to service_role;
