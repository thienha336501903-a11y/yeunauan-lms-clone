-- Migration: V5 Retire & Purge Content
-- Purpose: retire a published/used V5 course without deleting canonical course,
-- Commerce metadata, orders, or enrollment history; then allow a tightly-scoped
-- release/content/media purge only after R2 has been independently verified empty.

create table if not exists public.v5_course_retire_operations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  course_slug text not null,
  status text not null check (status in ('retired','r2_deleting','r2_verified_empty','finalizing','completed','failed')),
  admin_email text,
  plan_hash text not null,
  initial_active boolean not null,
  initial_is_published boolean not null,
  order_count integer not null default 0 check (order_count >= 0),
  enrollment_count integer not null default 0 check (enrollment_count >= 0),
  release_count integer not null default 0 check (release_count >= 0),
  r2_object_count integer not null default 0 check (r2_object_count >= 0),
  r2_total_bytes bigint not null default 0 check (r2_total_bytes >= 0),
  manifest jsonb not null default '{}'::jsonb,
  release_archive jsonb not null default '[]'::jsonb,
  deleted_r2_count integer not null default 0 check (deleted_r2_count >= 0),
  remaining_r2_count integer not null default 0 check (remaining_r2_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists v5_course_retire_operations_one_open_per_course
  on public.v5_course_retire_operations(course_id)
  where status <> 'completed';

create index if not exists v5_course_retire_operations_slug_idx
  on public.v5_course_retire_operations(course_slug, created_at desc);

alter table public.v5_course_retire_operations enable row level security;
revoke all on table public.v5_course_retire_operations from public;
revoke all on table public.v5_course_retire_operations from anon;
revoke all on table public.v5_course_retire_operations from authenticated;
grant select, insert, update, delete on table public.v5_course_retire_operations to service_role;

create or replace function public.v5_retire_purge_release_delete_allowed(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.v5_course_retire_operations o
      join public.courses c on c.id = o.course_id
      join public.v5_course_configs cfg on cfg.course_id = o.course_id
     where o.id::text = current_setting('app.v5_retire_purge_operation_id', true)
       and o.course_id = p_course_id
       and o.status in ('r2_verified_empty', 'finalizing')
       and c.active is false
       and c.is_published is false
       and cfg.status = 'archived'
       and cfg.published_release_id is null
  );
$$;

revoke all on function public.v5_retire_purge_release_delete_allowed(uuid) from public;
revoke all on function public.v5_retire_purge_release_delete_allowed(uuid) from anon;
revoke all on function public.v5_retire_purge_release_delete_allowed(uuid) from authenticated;
grant execute on function public.v5_retire_purge_release_delete_allowed(uuid) to service_role;

-- Preserve the existing immutable release contract. The only additional DELETE
-- path is the durable Retire/Purge operation capability above.
create or replace function public.enforce_v5_release_immutability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    if public.v5_clone_factory_cleanup_allowed(old.course_id)
       or public.v5_retire_purge_release_delete_allowed(old.course_id) then
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
$function$;

create or replace function public.begin_v5_course_retire_purge(
  p_course_id uuid,
  p_expected_slug text,
  p_plan_hash text,
  p_admin_email text,
  p_manifest jsonb,
  p_r2_object_count integer,
  p_r2_total_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_course record;
  v_config record;
  v_existing record;
  v_operation_id uuid;
  v_order_count integer := 0;
  v_enrollment_count integer := 0;
  v_release_count integer := 0;
  v_asset_ids uuid[] := array[]::uuid[];
  v_after_published boolean;
begin
  if p_course_id is null
     or nullif(btrim(coalesce(p_expected_slug, '')), '') is null
     or nullif(btrim(coalesce(p_plan_hash, '')), '') is null then
    raise exception 'v5_retire_identity_required';
  end if;

  select *
    into v_course
    from public.courses
   where id = p_course_id
   for update;

  if not found then
    raise exception 'v5_retire_course_not_found';
  end if;

  if v_course.slug is distinct from p_expected_slug then
    raise exception 'v5_retire_slug_mismatch';
  end if;

  if lower(coalesce(v_course.delivery_mode, '')) <> 'v5' then
    raise exception 'v5_retire_mode_invalid';
  end if;

  select *
    into v_existing
    from public.v5_course_retire_operations
   where course_id = p_course_id
     and status <> 'completed'
   order by created_at desc
   limit 1
   for update;

  if found then
    return jsonb_build_object(
      'success', true,
      'resumed', true,
      'operation_id', v_existing.id,
      'status', v_existing.status,
      'course_id', v_existing.course_id,
      'slug', v_existing.course_slug,
      'order_count', v_existing.order_count,
      'enrollment_count', v_existing.enrollment_count,
      'release_count', v_existing.release_count,
      'r2_object_count', v_existing.r2_object_count,
      'r2_total_bytes', v_existing.r2_total_bytes
    );
  end if;

  select *
    into v_config
    from public.v5_course_configs
   where course_id = p_course_id
   for update;

  if not found then
    raise exception 'v5_retire_missing_config';
  end if;

  if lower(coalesce(v_config.status, '')) <> 'published'
     or v_config.published_release_id is null then
    raise exception 'v5_retire_config_not_published';
  end if;

  -- Current Commerce taxonomy is explicit: only approved/rejected are terminal.
  if exists (
    select 1
      from public.orders o
     where (o.course_id = p_course_id or o.course_slug = v_course.slug)
       and coalesce(o.status, '') not in ('Đã duyệt', 'Từ chối')
  ) then
    raise exception 'v5_retire_has_nonterminal_order';
  end if;

  if exists (
    select 1
      from public.v5_jobs j
     where j.course_id = p_course_id
       and lower(coalesce(j.status, '')) not in ('success','failed','cancelled','canceled')
  ) then
    raise exception 'v5_retire_has_active_jobs';
  end if;

  if exists (
    select 1
      from public.v5_upload_sessions u
     where u.course_id = p_course_id
       and lower(coalesce(u.status, '')) not in ('completed','aborted','expired')
       and (u.expires_at is null or u.expires_at > now())
  ) then
    raise exception 'v5_retire_has_active_uploads';
  end if;

  if exists (
    select 1
      from public.lms_v4_telegram_course_sources s
     where s.course_slug = v_course.slug
  ) then
    raise exception 'v5_retire_has_v4_source';
  end if;

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
    select a.id
      from public.v5_media_assets a
     where left(coalesce(a.r2_object_key, ''), length('media/v5/' || p_course_id::text || '/'))
           = 'media/v5/' || p_course_id::text || '/'

    union
    select a.thumbnail_asset_id
      from public.v5_media_assets a
     where left(coalesce(a.r2_object_key, ''), length('media/v5/' || p_course_id::text || '/'))
           = 'media/v5/' || p_course_id::text || '/'
       and a.thumbnail_asset_id is not null

    union
    select x.asset_text::uuid
      from public.v5_releases r
      cross join lateral jsonb_array_elements_text(coalesce(r.snapshot->'asset_ids','[]'::jsonb)) x(asset_text)
     where r.course_id = p_course_id

    union
    select nullif(l.value->>'asset_id','')::uuid
      from public.v5_releases r
      cross join lateral jsonb_array_elements(coalesce(r.snapshot->'links','[]'::jsonb)) l(value)
     where r.course_id = p_course_id
       and nullif(l.value->>'asset_id','') is not null
  ) owned
  where asset_id is not null;

  if exists (
    select 1
      from unnest(v_asset_ids) owned(asset_id)
      left join public.v5_media_assets a on a.id = owned.asset_id
     where a.id is null
        or left(coalesce(a.r2_object_key, ''), length('media/v5/' || p_course_id::text || '/'))
           <> 'media/v5/' || p_course_id::text || '/'
  ) then
    raise exception 'v5_retire_asset_namespace_invalid';
  end if;

  if exists (
    select 1 from public.v5_post_assets pa
    join public.v5_posts p on p.id = pa.post_id
    where pa.asset_id = any(v_asset_ids) and p.course_id <> p_course_id
  ) then raise exception 'v5_retire_shared_post_asset'; end if;

  if exists (
    select 1 from public.v5_source_mappings sm
    where sm.asset_id = any(v_asset_ids) and sm.course_id <> p_course_id
  ) then raise exception 'v5_retire_shared_source_asset'; end if;

  if exists (
    select 1 from public.v5_jobs j
    where j.asset_id = any(v_asset_ids) and j.course_id <> p_course_id
  ) then raise exception 'v5_retire_shared_job_asset'; end if;

  if exists (
    select 1 from public.v5_upload_sessions u
    where u.asset_id = any(v_asset_ids) and u.course_id <> p_course_id
  ) then raise exception 'v5_retire_shared_upload_asset'; end if;

  if exists (
    select 1
      from public.v5_releases r
     where r.course_id <> p_course_id
       and exists (
         select 1
           from unnest(v_asset_ids) owned(asset_id)
          where coalesce(r.snapshot->'asset_ids','[]'::jsonb) ? owned.asset_id::text
             or exists (
               select 1
                 from jsonb_array_elements(coalesce(r.snapshot->'links','[]'::jsonb)) l(value)
                where l.value->>'asset_id' = owned.asset_id::text
             )
       )
  ) then raise exception 'v5_retire_shared_release_asset'; end if;

  if exists (
    select 1
      from public.v5_media_assets other_a
     where other_a.thumbnail_asset_id = any(v_asset_ids)
       and other_a.id <> all(v_asset_ids)
  ) then raise exception 'v5_retire_shared_thumbnail_asset'; end if;

  select count(*) into v_order_count
    from public.orders o
   where o.course_id = p_course_id or o.course_slug = v_course.slug;

  select count(*) into v_enrollment_count
    from public.student_enrollments e
   where e.course_id = p_course_id or e.course_slug = v_course.slug;

  select count(*) into v_release_count
    from public.v5_releases r
   where r.course_id = p_course_id;

  insert into public.v5_course_retire_operations (
    course_id, course_slug, status, admin_email, plan_hash,
    initial_active, initial_is_published,
    order_count, enrollment_count, release_count,
    r2_object_count, r2_total_bytes, manifest,
    remaining_r2_count, retired_at
  ) values (
    p_course_id, v_course.slug, 'retired', nullif(btrim(coalesce(p_admin_email,'')),''),
    p_plan_hash, coalesce(v_course.active,false), coalesce(v_course.is_published,false),
    v_order_count, v_enrollment_count, v_release_count,
    greatest(coalesce(p_r2_object_count,0),0), greatest(coalesce(p_r2_total_bytes,0),0),
    coalesce(p_manifest,'{}'::jsonb),
    greatest(coalesce(p_r2_object_count,0),0), now()
  )
  returning id into v_operation_id;

  update public.courses
     set active = false,
         updated_at = now()
   where id = p_course_id;

  update public.v5_course_configs
     set status = 'archived',
         published_release_id = null,
         settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object(
           'retired_at', now(),
           'retired_by', nullif(btrim(coalesce(p_admin_email,'')),''),
           'retire_operation_id', v_operation_id,
           'retire_reason', 'content_purge'
         ),
         updated_at = now()
   where course_id = p_course_id;

  select is_published into v_after_published
    from public.courses
   where id = p_course_id;

  if v_after_published is not false then
    raise exception 'v5_retire_failclosed_unpublish_failed';
  end if;

  return jsonb_build_object(
    'success', true,
    'resumed', false,
    'operation_id', v_operation_id,
    'status', 'retired',
    'course_id', p_course_id,
    'slug', v_course.slug,
    'order_count', v_order_count,
    'enrollment_count', v_enrollment_count,
    'release_count', v_release_count,
    'r2_object_count', greatest(coalesce(p_r2_object_count,0),0),
    'r2_total_bytes', greatest(coalesce(p_r2_total_bytes,0),0)
  );
end;
$$;

revoke all on function public.begin_v5_course_retire_purge(uuid,text,text,text,jsonb,integer,bigint) from public;
revoke all on function public.begin_v5_course_retire_purge(uuid,text,text,text,jsonb,integer,bigint) from anon;
revoke all on function public.begin_v5_course_retire_purge(uuid,text,text,text,jsonb,integer,bigint) from authenticated;
grant execute on function public.begin_v5_course_retire_purge(uuid,text,text,text,jsonb,integer,bigint) to service_role;

create or replace function public.finalize_v5_course_retire_purge(
  p_operation_id uuid,
  p_course_id uuid,
  p_expected_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_op record;
  v_course record;
  v_config record;
  v_asset_ids uuid[] := array[]::uuid[];
  v_release_archive jsonb := '[]'::jsonb;
  v_deleted_releases integer := 0;
  v_deleted_posts integer := 0;
  v_deleted_lessons integer := 0;
  v_deleted_mappings integer := 0;
  v_deleted_jobs integer := 0;
  v_deleted_uploads integer := 0;
  v_deleted_assets integer := 0;
begin
  if p_operation_id is null or p_course_id is null
     or nullif(btrim(coalesce(p_expected_slug,'')),'') is null then
    raise exception 'v5_retire_finalize_identity_required';
  end if;

  select * into v_op
    from public.v5_course_retire_operations
   where id = p_operation_id
   for update;

  if not found then
    raise exception 'v5_retire_operation_not_found';
  end if;

  if v_op.status = 'completed' then
    return jsonb_build_object(
      'success', true,
      'already_completed', true,
      'operation_id', v_op.id,
      'course_id', v_op.course_id,
      'slug', v_op.course_slug
    );
  end if;

  if v_op.course_id <> p_course_id or v_op.course_slug is distinct from p_expected_slug then
    raise exception 'v5_retire_operation_identity_mismatch';
  end if;

  if v_op.status <> 'r2_verified_empty' then
    raise exception 'v5_retire_r2_not_verified_empty';
  end if;

  select * into v_course
    from public.courses
   where id = p_course_id
   for update;

  if not found or v_course.slug is distinct from p_expected_slug then
    raise exception 'v5_retire_course_identity_invalid';
  end if;

  if v_course.active is true or v_course.is_published is true then
    raise exception 'v5_retire_course_not_retired';
  end if;

  select * into v_config
    from public.v5_course_configs
   where course_id = p_course_id
   for update;

  if not found
     or lower(coalesce(v_config.status,'')) <> 'archived'
     or v_config.published_release_id is not null then
    raise exception 'v5_retire_config_not_archived';
  end if;

  if exists (
    select 1 from public.v5_jobs j
     where j.course_id = p_course_id
       and lower(coalesce(j.status,'')) not in ('success','failed','cancelled','canceled')
  ) then raise exception 'v5_retire_finalize_active_jobs'; end if;

  if exists (
    select 1 from public.v5_upload_sessions u
     where u.course_id = p_course_id
       and lower(coalesce(u.status,'')) not in ('completed','aborted','expired')
       and (u.expires_at is null or u.expires_at > now())
  ) then raise exception 'v5_retire_finalize_active_uploads'; end if;

  select coalesce(array_agg(distinct asset_id), array[]::uuid[])
    into v_asset_ids
  from (
    select pa.asset_id
      from public.v5_post_assets pa
      join public.v5_posts p on p.id = pa.post_id
     where p.course_id = p_course_id

    union
    select sm.asset_id from public.v5_source_mappings sm
     where sm.course_id = p_course_id and sm.asset_id is not null

    union
    select j.asset_id from public.v5_jobs j
     where j.course_id = p_course_id and j.asset_id is not null

    union
    select u.asset_id from public.v5_upload_sessions u
     where u.course_id = p_course_id and u.asset_id is not null

    union
    select a.id from public.v5_media_assets a
     where left(coalesce(a.r2_object_key,''), length('media/v5/' || p_course_id::text || '/'))
           = 'media/v5/' || p_course_id::text || '/'

    union
    select a.thumbnail_asset_id from public.v5_media_assets a
     where left(coalesce(a.r2_object_key,''), length('media/v5/' || p_course_id::text || '/'))
           = 'media/v5/' || p_course_id::text || '/'
       and a.thumbnail_asset_id is not null

    union
    select x.asset_text::uuid
      from public.v5_releases r
      cross join lateral jsonb_array_elements_text(coalesce(r.snapshot->'asset_ids','[]'::jsonb)) x(asset_text)
     where r.course_id = p_course_id

    union
    select nullif(l.value->>'asset_id','')::uuid
      from public.v5_releases r
      cross join lateral jsonb_array_elements(coalesce(r.snapshot->'links','[]'::jsonb)) l(value)
     where r.course_id = p_course_id and nullif(l.value->>'asset_id','') is not null
  ) owned
  where asset_id is not null;

  if exists (
    select 1
      from unnest(v_asset_ids) owned(asset_id)
      left join public.v5_media_assets a on a.id = owned.asset_id
     where a.id is null
        or left(coalesce(a.r2_object_key,''), length('media/v5/' || p_course_id::text || '/'))
           <> 'media/v5/' || p_course_id::text || '/'
  ) then raise exception 'v5_retire_finalize_asset_namespace_invalid'; end if;

  if exists (
    select 1 from public.v5_post_assets pa
    join public.v5_posts p on p.id=pa.post_id
    where pa.asset_id=any(v_asset_ids) and p.course_id<>p_course_id
  ) then raise exception 'v5_retire_finalize_shared_post_asset'; end if;

  if exists (
    select 1 from public.v5_source_mappings sm
    where sm.asset_id=any(v_asset_ids) and sm.course_id<>p_course_id
  ) then raise exception 'v5_retire_finalize_shared_source_asset'; end if;

  if exists (
    select 1 from public.v5_jobs j
    where j.asset_id=any(v_asset_ids) and j.course_id<>p_course_id
  ) then raise exception 'v5_retire_finalize_shared_job_asset'; end if;

  if exists (
    select 1 from public.v5_upload_sessions u
    where u.asset_id=any(v_asset_ids) and u.course_id<>p_course_id
  ) then raise exception 'v5_retire_finalize_shared_upload_asset'; end if;

  if exists (
    select 1 from public.v5_releases r
     where r.course_id<>p_course_id
       and exists (
         select 1 from unnest(v_asset_ids) owned(asset_id)
         where coalesce(r.snapshot->'asset_ids','[]'::jsonb) ? owned.asset_id::text
            or exists (
              select 1 from jsonb_array_elements(coalesce(r.snapshot->'links','[]'::jsonb)) l(value)
               where l.value->>'asset_id'=owned.asset_id::text
            )
       )
  ) then raise exception 'v5_retire_finalize_shared_release_asset'; end if;

  if exists (
    select 1 from public.v5_media_assets other_a
     where other_a.thumbnail_asset_id=any(v_asset_ids)
       and other_a.id<>all(v_asset_ids)
  ) then raise exception 'v5_retire_finalize_shared_thumbnail_asset'; end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.version), '[]'::jsonb)
    into v_release_archive
    from public.v5_releases r
   where r.course_id = p_course_id;

  update public.v5_course_retire_operations
     set status='finalizing',
         release_archive=v_release_archive,
         updated_at=now(),
         last_error=null
   where id=p_operation_id;

  perform set_config('app.v5_retire_purge_operation_id', p_operation_id::text, true);

  delete from public.v5_releases where course_id=p_course_id;
  get diagnostics v_deleted_releases = row_count;

  delete from public.v5_post_assets
   where post_id in (select id from public.v5_posts where course_id=p_course_id);

  delete from public.v5_source_mappings where course_id=p_course_id;
  get diagnostics v_deleted_mappings = row_count;

  delete from public.v5_jobs where course_id=p_course_id;
  get diagnostics v_deleted_jobs = row_count;

  delete from public.v5_upload_sessions where course_id=p_course_id;
  get diagnostics v_deleted_uploads = row_count;

  delete from public.v5_posts where course_id=p_course_id;
  get diagnostics v_deleted_posts = row_count;

  delete from public.v5_lessons where course_id=p_course_id;
  get diagnostics v_deleted_lessons = row_count;

  if array_length(v_asset_ids,1) > 0 then
    delete from public.v5_media_assets where id=any(v_asset_ids);
    get diagnostics v_deleted_assets = row_count;
  end if;

  update public.v5_course_configs
     set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('content_purged_at', now()),
         updated_at = now()
   where course_id=p_course_id;

  update public.v5_course_retire_operations
     set status='completed',
         remaining_r2_count=0,
         completed_at=now(),
         updated_at=now(),
         last_error=null
   where id=p_operation_id;

  perform set_config('app.v5_retire_purge_operation_id', '', true);

  return jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'course_id', p_course_id,
    'slug', p_expected_slug,
    'deleted_releases', v_deleted_releases,
    'deleted_posts', v_deleted_posts,
    'deleted_lessons', v_deleted_lessons,
    'deleted_source_mappings', v_deleted_mappings,
    'deleted_jobs', v_deleted_jobs,
    'deleted_upload_sessions', v_deleted_uploads,
    'deleted_assets', v_deleted_assets
  );
end;
$$;

revoke all on function public.finalize_v5_course_retire_purge(uuid,uuid,text) from public;
revoke all on function public.finalize_v5_course_retire_purge(uuid,uuid,text) from anon;
revoke all on function public.finalize_v5_course_retire_purge(uuid,uuid,text) from authenticated;
grant execute on function public.finalize_v5_course_retire_purge(uuid,uuid,text) to service_role;
