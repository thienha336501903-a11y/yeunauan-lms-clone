\set ON_ERROR_STOP on
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
  alter role service_role bypassrls;
end $$;

create table public.courses (
  id uuid primary key,
  slug text unique not null,
  delivery_mode text,
  active boolean,
  is_published boolean,
  updated_at timestamptz default now()
);
create table public.v5_releases (
  id uuid primary key,
  course_id uuid not null,
  version integer not null,
  status text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz default now()
);
create table public.v5_course_configs (
  course_id uuid primary key,
  status text not null,
  published_release_id uuid,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
create table public.orders (
  id uuid primary key,
  course_id uuid,
  course_slug text,
  status text
);
create table public.student_enrollments (
  id uuid primary key,
  course_id uuid,
  course_slug text,
  status text
);
create table public.v5_media_assets (
  id uuid primary key,
  r2_object_key text,
  bytes bigint,
  thumbnail_asset_id uuid
);
create table public.v5_lessons (id uuid primary key, course_id uuid);
create table public.v5_posts (id uuid primary key, course_id uuid);
create table public.v5_post_assets (post_id uuid, asset_id uuid);
create table public.v5_source_mappings (id uuid primary key default gen_random_uuid(), course_id uuid, asset_id uuid);
create table public.v5_jobs (id uuid primary key default gen_random_uuid(), course_id uuid, asset_id uuid, status text);
create table public.v5_upload_sessions (id uuid primary key default gen_random_uuid(), course_id uuid, asset_id uuid, status text, expires_at timestamptz);
create table public.lms_v4_telegram_course_sources (course_slug text, source_id uuid);

create or replace function public.v5_clone_factory_cleanup_allowed(p_course_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $$ select current_setting('app.test_clone_cleanup',true)='true' $$;

create or replace function public.enforce_v5_release_immutability()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$
begin
  if tg_op='DELETE' then
    if public.v5_clone_factory_cleanup_allowed(old.course_id) then return old; end if;
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
  if old.status is not distinct from new.status then return new; end if;
  if old.status='published' and new.status='superseded' then return new; end if;
  raise exception 'v5_release_status_transition_forbidden';
end $$;

create trigger v5_release_immutability_test
before update or delete on public.v5_releases
for each row execute function public.enforce_v5_release_immutability();

create or replace function public.test_sync_v5_course_failclosed()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$
begin
  if new.status <> 'published' or new.published_release_id is null then
    update public.courses set is_published=false,updated_at=now() where id=new.course_id;
  end if;
  return new;
end $$;
create trigger test_config_failclosed
after update of status,published_release_id on public.v5_course_configs
for each row execute function public.test_sync_v5_course_failclosed();

\i supabase/migrations/20260923143000_v5_retire_purge_content.sql
\i supabase/migrations/20260923154500_v5_retire_purge_trigger_privileges.sql

do $$
begin
  if has_function_privilege('anon','public.begin_v5_course_retire_purge(uuid,text,text,text,jsonb,integer,bigint)','EXECUTE')
     or has_function_privilege('authenticated','public.begin_v5_course_retire_purge(uuid,text,text,text,jsonb,integer,bigint)','EXECUTE')
     or not has_function_privilege('service_' || 'role','public.begin_v5_course_retire_purge(uuid,text,text,text,jsonb,integer,bigint)','EXECUTE') then
    raise exception 'begin function permission assertion failed';
  end if;
  if has_function_privilege('anon','public.finalize_v5_course_retire_purge(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.finalize_v5_course_retire_purge(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_' || 'role','public.finalize_v5_course_retire_purge(uuid,uuid,text)','EXECUTE') then
    raise exception 'finalize function permission assertion failed';
  end if;
  if has_function_privilege('anon','public.validate_v5_retire_purge_r2_delete_safe(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.validate_v5_retire_purge_r2_delete_safe(uuid)','EXECUTE')
     or not has_function_privilege('service_' || 'role','public.validate_v5_retire_purge_r2_delete_safe(uuid)','EXECUTE') then
    raise exception 'R2 delete validation function permission assertion failed';
  end if;
  if has_function_privilege('anon','public.enforce_v5_retired_course_sale_lock()','EXECUTE')
     or has_function_privilege('authenticated','public.enforce_v5_retired_course_sale_lock()','EXECUTE')
     or has_function_privilege('service_' || 'role','public.enforce_v5_retired_course_sale_lock()','EXECUTE') then
    raise exception 'retired course trigger function must not be directly executable';
  end if;
  if has_function_privilege('anon','public.enforce_v5_archived_config_lock()','EXECUTE')
     or has_function_privilege('authenticated','public.enforce_v5_archived_config_lock()','EXECUTE')
     or has_function_privilege('service_' || 'role','public.enforce_v5_archived_config_lock()','EXECUTE') then
    raise exception 'archived config trigger function must not be directly executable';
  end if;
end $$;

-- Published course fixture with approved order + active enrollment.
insert into public.courses(id,slug,delivery_mode,active,is_published)
values ('11111111-1111-4111-8111-111111111111','retire-target','v5',true,true);
insert into public.v5_releases(id,course_id,version,status,snapshot,created_by)
values (
  '21111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  1,'published',
  '{"asset_ids":["31111111-1111-4111-8111-111111111111"],"links":[]}'::jsonb,
  'admin@example.com'
);
insert into public.v5_course_configs(course_id,status,published_release_id,settings)
values ('11111111-1111-4111-8111-111111111111','published','21111111-1111-4111-8111-111111111111','{}');
insert into public.orders values ('41111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','retire-target','Đã duyệt');
insert into public.student_enrollments values ('51111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','retire-target','active');
insert into public.v5_media_assets values ('31111111-1111-4111-8111-111111111111','media/v5/11111111-1111-4111-8111-111111111111/asset/video.mp4',12345,null);
insert into public.v5_lessons values ('61111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');
insert into public.v5_posts values ('71111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');
insert into public.v5_post_assets values ('71111111-1111-4111-8111-111111111111','31111111-1111-4111-8111-111111111111');
insert into public.v5_upload_sessions(course_id,asset_id,status,expires_at)
values ('11111111-1111-4111-8111-111111111111','31111111-1111-4111-8111-111111111111','completed',now()-interval '1 hour');

set role service_role;
select public.begin_v5_course_retire_purge(
  '11111111-1111-4111-8111-111111111111',
  'retire-target',
  'plan-1',
  'admin@example.com',
  '{"schema":"v5-retire-purge-v1"}'::jsonb,
  1,
  12345
) as begin_result \gset
reset role;

do $$
begin
  if not exists(select 1 from public.courses where id='11111111-1111-4111-8111-111111111111' and active=false and is_published=false) then
    raise exception 'retire did not fail-close course';
  end if;
  if not exists(select 1 from public.v5_course_configs where course_id='11111111-1111-4111-8111-111111111111' and status='archived' and published_release_id is null) then
    raise exception 'config was not archived';
  end if;
  if (select count(*) from public.orders where course_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'order changed'; end if;
  if (select count(*) from public.student_enrollments where course_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'enrollment changed'; end if;
  if (select count(*) from public.v5_releases where course_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'release changed during retire'; end if;
  if (select count(*) from public.v5_media_assets where id='31111111-1111-4111-8111-111111111111') <> 1 then raise exception 'media changed during retire'; end if;
end $$;

-- Archived state is one-way in this feature. Direct sale reactivation,
-- config reactivation, or config deletion must fail closed.
do $$
begin
  begin
    update public.courses
       set active=true
     where id='11111111-1111-4111-8111-111111111111';
    raise exception 'archived sale reactivation unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_archived_course_cannot_activate%' then raise; end if;
  end;

  begin
    update public.v5_course_configs
       set status='published'
     where course_id='11111111-1111-4111-8111-111111111111';
    raise exception 'archived config reactivation unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_archived_config_reactivation_forbidden%' then raise; end if;
  end;

  begin
    delete from public.v5_course_configs
     where course_id='11111111-1111-4111-8111-111111111111';
    raise exception 'archived config delete unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_archived_config_delete_forbidden%' then raise; end if;
  end;
end $$;

-- Fresh DB-side ownership validation must pass immediately before R2 deletion.
set role service_role;
select id as r2_validation_operation_id
  from public.v5_course_retire_operations
 where course_id='11111111-1111-4111-8111-111111111111'
\gset
select public.validate_v5_retire_purge_r2_delete_safe(:'r2_validation_operation_id'::uuid);
reset role;

-- Generic release delete remains forbidden.
do $$
begin
  begin
    delete from public.v5_releases where id='21111111-1111-4111-8111-111111111111';
    raise exception 'generic release delete unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_release_delete_forbidden%' then raise; end if;
  end;
end $$;

-- Release UPDATE immutability remains intact.
do $$
begin
  begin
    update public.v5_releases set snapshot='{}'::jsonb where id='21111111-1111-4111-8111-111111111111';
    raise exception 'release mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_release_immutable%' then raise; end if;
  end;
end $$;

-- Finalize before the trusted R2-empty state is forbidden.
set role service_role;
do $$
declare v_op uuid;
begin
  select id into v_op from public.v5_course_retire_operations where course_id='11111111-1111-4111-8111-111111111111';
  begin
    perform public.finalize_v5_course_retire_purge(v_op,'11111111-1111-4111-8111-111111111111','retire-target');
    raise exception 'finalize before R2 verification unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_retire_r2_not_verified_empty%' then raise; end if;
  end;
end $$;
update public.v5_course_retire_operations
   set status='r2_verified_empty',remaining_r2_count=0
 where course_id='11111111-1111-4111-8111-111111111111';

-- Safety is revalidated at finalize: a concurrent order revoke back to pending
-- pauses destructive metadata cleanup.
reset role;
update public.orders set status='Chờ duyệt' where course_id='11111111-1111-4111-8111-111111111111';
set role service_role;
do $$
declare v_op uuid;
begin
  select id into v_op from public.v5_course_retire_operations where course_id='11111111-1111-4111-8111-111111111111';
  begin
    perform public.finalize_v5_course_retire_purge(v_op,'11111111-1111-4111-8111-111111111111','retire-target');
    raise exception 'finalize with pending order unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_retire_finalize_has_nonterminal_order%' then raise; end if;
  end;
end $$;
reset role;
update public.orders set status='Đã duyệt' where course_id='11111111-1111-4111-8111-111111111111';

-- A late V4 legacy binding also pauses finalize.
insert into public.lms_v4_telegram_course_sources(course_slug,source_id)
values ('retire-target','dddddddd-1111-4111-8111-111111111111');
set role service_role;
do $$
declare v_op uuid;
begin
  select id into v_op from public.v5_course_retire_operations where course_id='11111111-1111-4111-8111-111111111111';
  begin
    perform public.finalize_v5_course_retire_purge(v_op,'11111111-1111-4111-8111-111111111111','retire-target');
    raise exception 'finalize with V4 source unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%v5_retire_finalize_has_v4_source%' then raise; end if;
  end;
end $$;
reset role;
delete from public.lms_v4_telegram_course_sources where course_slug='retire-target';

set role service_role;
select id as operation_id
  from public.v5_course_retire_operations
 where course_id='11111111-1111-4111-8111-111111111111'
\gset
select public.finalize_v5_course_retire_purge(
  :'operation_id'::uuid,
  '11111111-1111-4111-8111-111111111111',
  'retire-target'
);
reset role;

do $$
begin
  if not exists(select 1 from public.courses where id='11111111-1111-4111-8111-111111111111') then raise exception 'course was deleted'; end if;
  if not exists(select 1 from public.v5_course_configs where course_id='11111111-1111-4111-8111-111111111111' and status='archived' and settings ? 'content_purged_at') then raise exception 'archived config missing'; end if;
  if (select count(*) from public.orders where course_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'order not preserved'; end if;
  if (select count(*) from public.student_enrollments where course_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'enrollment not preserved'; end if;
  if exists(select 1 from public.v5_releases where course_id='11111111-1111-4111-8111-111111111111') then raise exception 'releases not purged'; end if;
  if exists(select 1 from public.v5_posts where course_id='11111111-1111-4111-8111-111111111111') then raise exception 'posts not purged'; end if;
  if exists(select 1 from public.v5_lessons where course_id='11111111-1111-4111-8111-111111111111') then raise exception 'lessons not purged'; end if;
  if exists(select 1 from public.v5_media_assets where id='31111111-1111-4111-8111-111111111111') then raise exception 'media not purged'; end if;
  if not exists(select 1 from public.v5_course_retire_operations where course_id='11111111-1111-4111-8111-111111111111' and status='completed' and jsonb_array_length(release_archive)=1) then raise exception 'operation archive incomplete'; end if;
end $$;

-- Existing clone-factory release-delete capability remains functional.
insert into public.courses(id,slug,delivery_mode,active,is_published)
values ('81111111-1111-4111-8111-111111111111','clone-test','v5',false,false);
insert into public.v5_releases(id,course_id,version,status,snapshot)
values ('91111111-1111-4111-8111-111111111111','81111111-1111-4111-8111-111111111111',1,'published','{}');
select set_config('app.test_clone_cleanup','true',false);
delete from public.v5_releases where id='91111111-1111-4111-8111-111111111111';
select set_config('app.test_clone_cleanup','',false);

-- Forced rejection proves the begin RPC transaction leaves the course untouched.
insert into public.courses(id,slug,delivery_mode,active,is_published)
values ('aaaaaaaa-1111-4111-8111-111111111111','pending-target','v5',true,true);
insert into public.v5_releases(id,course_id,version,status,snapshot)
values ('bbbbbbbb-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111',1,'published','{}');
insert into public.v5_course_configs(course_id,status,published_release_id,settings)
values ('aaaaaaaa-1111-4111-8111-111111111111','published','bbbbbbbb-1111-4111-8111-111111111111','{}');
insert into public.orders values ('cccccccc-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111','pending-target','Chờ duyệt');

set role service_role;
do $$
begin
  begin
    perform public.begin_v5_course_retire_purge(
      'aaaaaaaa-1111-4111-8111-111111111111','pending-target','plan-2','admin@example.com','{}',0,0
    );
    raise exception 'pending order unexpectedly allowed';
  exception when others then
    if sqlerrm not like '%v5_retire_has_nonterminal_order%' then raise; end if;
  end;
end $$;
reset role;

do $$
begin
  if not exists(select 1 from public.courses where id='aaaaaaaa-1111-4111-8111-111111111111' and active=true and is_published=true) then
    raise exception 'failed begin mutated course';
  end if;
  if not exists(select 1 from public.v5_course_configs where course_id='aaaaaaaa-1111-4111-8111-111111111111' and status='published' and published_release_id is not null) then
    raise exception 'failed begin mutated config';
  end if;
end $$;

\echo 'V5 RETIRE/PURGE POSTGRES 17 VERIFICATION PASS'
