-- Atomic Telegram -> R2 mirror queue RPCs applied to System B on 2026-08-27.
-- Reader claims through service-role only. Browser/anon/authenticated roles cannot execute these functions.

create or replace function public.claim_v5_telegram_mirror_job(p_agent_id text)
returns setof public.v5_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(p_agent_id),'') = '' then
    raise exception 'agent_id_required';
  end if;

  update public.v5_jobs
     set status = 'queued',
         locked_at = null,
         locked_by = null,
         available_at = now() + interval '30 seconds',
         updated_at = now(),
         last_error = coalesce(last_error, 'stale_reader_lease_requeued')
   where job_type = 'telegram_mirror'
     and status = 'running'
     and locked_at < now() - interval '15 minutes'
     and attempts < max_attempts;

  update public.v5_jobs
     set status = 'failed',
         locked_at = null,
         locked_by = null,
         finished_at = now(),
         updated_at = now(),
         last_error = coalesce(last_error, 'mirror_max_attempts_exhausted')
   where job_type = 'telegram_mirror'
     and status = 'running'
     and locked_at < now() - interval '15 minutes'
     and attempts >= max_attempts;

  return query
  with candidate as (
    select id
      from public.v5_jobs
     where job_type = 'telegram_mirror'
       and status = 'queued'
       and available_at <= now()
       and attempts < max_attempts
     order by created_at asc
     for update skip locked
     limit 1
  )
  update public.v5_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_at = now(),
         locked_by = btrim(p_agent_id),
         started_at = coalesce(j.started_at, now()),
         last_error = null,
         updated_at = now()
    from candidate c
   where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_v5_telegram_mirror_job(text) from public, anon, authenticated;
grant execute on function public.claim_v5_telegram_mirror_job(text) to service_role;

create or replace function public.finish_v5_telegram_mirror_job(
  p_job_id uuid,
  p_agent_id text,
  p_ok boolean,
  p_object_key text default null,
  p_bytes bigint default null,
  p_etag text default null,
  p_error text default null
)
returns public.v5_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.v5_jobs;
  now_ts timestamptz := now();
begin
  select * into j
    from public.v5_jobs
   where id = p_job_id
     and job_type = 'telegram_mirror'
     and status = 'running'
     and locked_by = btrim(p_agent_id)
   for update;

  if not found then
    raise exception 'v5_mirror_job_not_owned';
  end if;

  if p_ok then
    if coalesce(btrim(p_object_key),'') = '' then
      raise exception 'r2_object_key_required';
    end if;

    update public.v5_media_assets
       set provider = 'r2',
           r2_object_key = btrim(p_object_key),
           bytes = coalesce(p_bytes, bytes),
           status = 'ready',
           uploaded_at = now_ts,
           last_verified_at = now_ts,
           last_error = null,
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'telegram_mirrored', true,
             'r2_etag', nullif(btrim(coalesce(p_etag,'')), '')
           ),
           updated_at = now_ts
     where id = j.asset_id;

    update public.v5_posts p
       set status = 'ready',
           metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object('pending_attachments', false),
           updated_at = now_ts
     where exists (
       select 1 from public.v5_post_assets pa
        where pa.post_id = p.id and pa.asset_id = j.asset_id
     )
       and not exists (
         select 1
           from public.v5_post_assets pa2
           join public.v5_media_assets a2 on a2.id = pa2.asset_id
          where pa2.post_id = p.id
            and a2.status not in ('ready','archived')
       );

    update public.v5_jobs
       set status = 'success',
           progress_current = coalesce(p_bytes, progress_total, progress_current),
           progress_total = coalesce(p_bytes, progress_total),
           result = jsonb_build_object('object_key', btrim(p_object_key), 'bytes', p_bytes, 'etag', p_etag),
           last_error = null,
           finished_at = now_ts,
           locked_at = null,
           locked_by = null,
           updated_at = now_ts
     where id = j.id
     returning * into j;
  else
    if j.attempts >= j.max_attempts then
      update public.v5_jobs
         set status = 'failed',
             last_error = left(coalesce(p_error,'telegram_mirror_failed'), 2000),
             finished_at = now_ts,
             locked_at = null,
             locked_by = null,
             updated_at = now_ts
       where id = j.id
       returning * into j;

      update public.v5_media_assets
         set status = 'failed',
             last_error = left(coalesce(p_error,'telegram_mirror_failed'), 2000),
             updated_at = now_ts
       where id = j.asset_id;
    else
      update public.v5_jobs
         set status = 'queued',
             available_at = now_ts + make_interval(secs => least(300, greatest(30, j.attempts * 30))),
             last_error = left(coalesce(p_error,'telegram_mirror_failed'), 2000),
             locked_at = null,
             locked_by = null,
             updated_at = now_ts
       where id = j.id
       returning * into j;
    end if;
  end if;

  return j;
end;
$$;

revoke all on function public.finish_v5_telegram_mirror_job(uuid,text,boolean,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.finish_v5_telegram_mirror_job(uuid,text,boolean,text,bigint,text,text) to service_role;
