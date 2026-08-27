-- LMS V5 delivery-mode and DB isolation changes applied to System B on 2026-08-27.

alter table public.orders drop constraint if exists orders_delivery_mode_check;
alter table public.orders add constraint orders_delivery_mode_check check (delivery_mode = any (array['lms'::text,'v4'::text,'telegram'::text,'v5'::text]));

create or replace function public.enforce_v5_course_mode()
returns trigger
language plpgsql
as $$
begin
  if new.course_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.courses c
    where c.id = new.course_id
      and lower(coalesce(c.delivery_mode,'')) = 'v5'
  ) then
    raise exception 'V5 data requires a delivery_mode=v5 course';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'v5_course_configs','v5_jobs','v5_lessons','v5_posts',
    'v5_releases','v5_source_mappings','v5_upload_sessions'
  ] loop
    execute format('drop trigger if exists trg_enforce_v5_course_mode on public.%I', t);
    execute format('create trigger trg_enforce_v5_course_mode before insert or update of course_id on public.%I for each row execute function public.enforce_v5_course_mode()', t);
  end loop;
end $$;
