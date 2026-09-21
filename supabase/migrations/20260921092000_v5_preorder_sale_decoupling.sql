-- ==============================================================================
-- SYSTEM B — LMS V5 PRE-ORDER / SALE-CONTENT-ACCESS DECOUPLING MIGRATION
-- Timestamp UTC: 2026-09-21T09:20:00Z
-- Supabase Project: yyiavtiwtekkocqpephr
-- Target Tables: public.courses, public.v5_course_configs
-- Objectives:
--   1. Allow V5 courses to be activated for sale (active = true) in pre-order mode
--      before canonical content is Published (is_published = false).
--   2. Enforce that is_published = true requires canonical Published release (fail-closed).
--   3. Ensure Commerce sale toggle (active = true / false) never mutates is_published.
--   4. Ensure canonical content unpublish / fail-close clears is_published without
--      mutating Commerce sales status (active).
--   5. Ensure canonical config DELETE trigger path remains fail-closed (F-01).
-- ==============================================================================

-- 1. UPDATE FUNCTION: public.enforce_v5_course_lifecycle()
create or replace function public.enforce_v5_course_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ready boolean := false;
  v_old_mode text := '';
  v_new_mode text := '';
begin
  if tg_op <> 'INSERT' then
    v_old_mode := lower(coalesce(old.delivery_mode, ''));
  end if;
  if tg_op <> 'DELETE' then
    v_new_mode := lower(coalesce(new.delivery_mode, ''));
  end if;

  -- 1. Guard against direct deletion of V5 courses with associated configs
  if tg_op = 'DELETE' then
    if v_old_mode = 'v5' and exists (
      select 1 from public.v5_course_configs c where c.course_id = old.id
    ) then
      raise exception 'v5_course_delete_requires_controlled_cleanup';
    end if;
    return old;
  end if;

  -- 2. Guard against invalid delivery mode conversions
  if tg_op = 'UPDATE' and v_old_mode <> 'v5' and v_new_mode = 'v5' then
    raise exception 'v5_mode_conversion_requires_controlled_bootstrap';
  end if;

  if tg_op = 'UPDATE' and v_old_mode = 'v5' and v_new_mode <> 'v5' then
    if exists (select 1 from public.v5_course_configs c where c.course_id = old.id) then
      raise exception 'v5_mode_change_requires_controlled_cleanup';
    end if;
  end if;

  if v_new_mode <> 'v5' then
    return new;
  end if;

  -- 3. On INSERT: content starts unpublished; active can be initialized (e.g. pre-order)
  if tg_op = 'INSERT' then
    new.is_published := false;
    if new.active is null then
      new.active := false;
    end if;
    return new;
  end if;

  -- 4. Check whether canonical Published release exists when content publish is evaluated
  if new.is_published is true
     or (old.is_published is true and new.is_published is false) then
    select exists (
      select 1
      from public.v5_course_configs c
      join public.v5_releases r
        on r.id = c.published_release_id
       and r.course_id = c.course_id
      where c.course_id = new.id
        and c.status = 'published'
        and c.published_release_id is not null
        and r.status = 'published'
    ) into v_ready;
  end if;

  -- 5. Content access is strictly fail-closed: only published content requires canonical readiness.
  -- active = true is decoupled to support Pre-order sales prior to launch date.
  if new.is_published is true and not v_ready then
    raise exception 'v5_course_not_ready_for_sale';
  end if;

  -- 6. is_published is learner-visible release state owned by the LMS V5 release lifecycle.
  -- Direct mutation of is_published to false while a valid canonical release exists is blocked.
  if old.is_published is true and new.is_published is false and v_ready then
    raise exception 'v5_publish_state_owned_by_release';
  end if;

  -- 7. Decoupled sale switch: active=true/false is Commerce sale transition only.
  -- It does NOT mirror into is_published and does NOT take paying learners offline.

  return new;
end;
$$;

revoke all on function public.enforce_v5_course_lifecycle() from public;
revoke all on function public.enforce_v5_course_lifecycle() from anon;
revoke all on function public.enforce_v5_course_lifecycle() from authenticated;

drop trigger if exists trg_enforce_v5_course_lifecycle on public.courses;
create trigger trg_enforce_v5_course_lifecycle
before insert or update or delete on public.courses
for each row execute function public.enforce_v5_course_lifecycle();


-- 2. UPDATE FUNCTION: public.sync_v5_course_failclosed_flags()
create or replace function public.sync_v5_course_failclosed_flags()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_course_id uuid;
  v_mode text := '';
  v_ready boolean := false;
begin
  if tg_op = 'DELETE' then
    v_course_id := old.course_id;
  else
    v_course_id := new.course_id;
  end if;

  select lower(coalesce(c.delivery_mode, ''))
    into v_mode
  from public.courses c
  where c.id = v_course_id;

  if v_mode <> 'v5' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'DELETE' and new.status = 'published' and new.published_release_id is not null then
    select exists (
      select 1
      from public.v5_releases r
      where r.id = new.published_release_id
        and r.course_id = new.course_id
        and r.status = 'published'
    ) into v_ready;
  end if;

  -- If canonical config is deleted, unpublished, or missing published release:
  -- fail-close learner-visible content access (is_published = false)
  -- while preserving courses.active (Commerce sales switch).
  if not v_ready then
    update public.courses
       set is_published = false,
           updated_at = now()
     where id = v_course_id
       and is_published is true;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_v5_course_failclosed_flags() from public;
revoke all on function public.sync_v5_course_failclosed_flags() from anon;
revoke all on function public.sync_v5_course_failclosed_flags() from authenticated;

drop trigger if exists trg_sync_v5_course_failclosed_flags on public.v5_course_configs;
create trigger trg_sync_v5_course_failclosed_flags
after insert or update or delete on public.v5_course_configs
for each row execute function public.sync_v5_course_failclosed_flags();
