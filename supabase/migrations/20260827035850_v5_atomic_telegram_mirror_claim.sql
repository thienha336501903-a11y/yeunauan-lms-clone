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
grant execute on function public.claim_v5_telegram_mirror_job(text) to service_role;;
