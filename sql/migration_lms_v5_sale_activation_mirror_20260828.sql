-- Follow-up hardening for the V5 course lifecycle guard.
-- A V5 course may only be activated for sale after canonical Publish. Once that
-- check succeeds, is_published becomes a verified compatibility mirror so the
-- shared course manager/feed/storefront gates all agree on sale readiness.

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

  -- `active=true` is the Commerce sale transition. Because the canonical release
  -- has just been verified, mirror Published into the shared compatibility flag.
  -- This is not a content Publish operation: LMS V5 remains the source of truth.
  if new.active is true then
    new.is_published := true;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_v5_course_lifecycle() from public;
revoke all on function public.enforce_v5_course_lifecycle() from anon;
revoke all on function public.enforce_v5_course_lifecycle() from authenticated;
