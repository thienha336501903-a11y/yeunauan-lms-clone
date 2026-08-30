-- V5 release immutability guard.
-- Release snapshot and identity are append-only history. The only in-place
-- mutation allowed is the atomic Publish transition from published -> superseded.

create or replace function public.enforce_v5_release_immutability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
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

drop trigger if exists trg_enforce_v5_release_immutability on public.v5_releases;
create trigger trg_enforce_v5_release_immutability
before update or delete on public.v5_releases
for each row execute function public.enforce_v5_release_immutability();
