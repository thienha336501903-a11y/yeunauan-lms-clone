alter table public.tgcloner_sources
  add column if not exists last_ingested_at timestamptz,
  add column if not exists last_source_date timestamptz;

update public.tgcloner_sources s
set last_ingested_at = x.last_ingested_at,
    last_source_date = x.last_source_date
from (
  select source_id,
         max(updated_at) as last_ingested_at,
         max(source_date) as last_source_date
  from public.tgcloner_source_messages
  group by source_id
) x
where x.source_id = s.id
  and (s.last_ingested_at is null or x.last_ingested_at > s.last_ingested_at
       or s.last_source_date is null or x.last_source_date > s.last_source_date);

create or replace function public.tgcloner_update_source_ingest_activity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.tgcloner_sources
  set last_ingested_at = case
        when new.updated_at is null then last_ingested_at
        when last_ingested_at is null then new.updated_at
        else greatest(last_ingested_at, new.updated_at)
      end,
      last_source_date = case
        when new.source_date is null then last_source_date
        when last_source_date is null then new.source_date
        else greatest(last_source_date, new.source_date)
      end
  where id = new.source_id;
  return new;
end;
$$;

drop trigger if exists tgcloner_source_message_ingest_activity on public.tgcloner_source_messages;
create trigger tgcloner_source_message_ingest_activity
after insert or update of updated_at, source_date on public.tgcloner_source_messages
for each row execute function public.tgcloner_update_source_ingest_activity();
