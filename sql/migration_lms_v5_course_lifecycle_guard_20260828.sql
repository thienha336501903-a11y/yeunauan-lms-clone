-- V5 course lifecycle guard.
-- Canonical V5 release/config state owns content readiness. Commerce may keep
-- sale/readiness flags OFF at any time, but may only turn them ON after a valid
-- canonical Published release exists.

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

  if tg_op = 'DELETE' then
    if v_old_mode = 'v5' and exists (
      select 1 from public.v5_course_configs c where c.course_id = old.id
    ) then
      raise exception 'v5_course_delete_requires_controlled_cleanup';
    end if;
    return old;
  end if;

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

  -- A newly-created V5 shell is always Draft + off-sale. The canonical V5
  -- bootstrap creates v5_course_configs after the course row exists.
  if tg_op = 'INSERT' then
    new.active := false;
    new.is_published := false;
    return new;
  end if;

  if new.active is true or new.is_published is true then
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

    if not v_ready then
      raise exception 'v5_course_not_ready_for_sale';
    end if;
  end if;

  -- OFF is always allowed. This preserves the ownership split: LMS owns
  -- canonical content Publish; Commerce owns whether a ready course is for sale.
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

create or replace function public.sync_v5_course_failclosed_flags()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_course_id uuid;
  v_ready boolean := false;
begin
  if tg_op = 'DELETE' then
    v_course_id := old.course_id;
  else
    v_course_id := new.course_id;
    select exists (
      select 1
      from public.v5_releases r
      where new.status = 'published'
        and new.published_release_id is not null
        and r.id = new.published_release_id
        and r.course_id = new.course_id
        and r.status = 'published'
    ) into v_ready;
  end if;

  -- Canonical state may force Commerce flags OFF, never ON. A successful LMS
  -- Publish leaves sale/readiness flags untouched until Commerce explicitly
  -- enables them; unpublish/archive/delete immediately fails closed.
  if not v_ready then
    update public.courses
       set is_published = false,
           active = false,
           updated_at = now()
     where id = v_course_id
       and lower(coalesce(delivery_mode, '')) = 'v5';
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

drop trigger if exists trg_sync_v5_course_publish_flag on public.v5_course_configs;
drop trigger if exists trg_sync_v5_course_failclosed_flags on public.v5_course_configs;
create trigger trg_sync_v5_course_failclosed_flags
after insert or update or delete on public.v5_course_configs
for each row execute function public.sync_v5_course_failclosed_flags();
