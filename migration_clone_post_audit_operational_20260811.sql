-- Clone V1 operational schema alignment
-- Supabase Clone: yyiavtiwtekkocqpephr
-- Applied and postflight-tested on 2026-08-11.
--
-- This migration aligns the empty session/device/account-sharing/Drive support
-- tables with the current V1 system. It does NOT enable V2 runtime behavior.
-- SECURITY DEFINER RPCs are executable by service_role only.

begin;

-- Session guard tables
alter table public.student_active_sessions alter column id set default gen_random_uuid();
alter table public.student_active_sessions alter column email set not null;
alter table public.student_active_sessions alter column student_session_id set not null;
alter table public.student_active_sessions alter column portal_device_id set not null;
alter table public.student_active_sessions alter column status set not null;
alter table public.student_active_sessions alter column login_at set default now();
alter table public.student_active_sessions alter column login_at set not null;
alter table public.student_active_sessions alter column last_seen_at set default now();
alter table public.student_active_sessions alter column last_seen_at set not null;
alter table public.student_active_sessions alter column created_at set default now();
alter table public.student_active_sessions alter column created_at set not null;
alter table public.student_active_sessions alter column updated_at set default now();
alter table public.student_active_sessions alter column updated_at set not null;

alter table public.lms_entry_tokens alter column id set default gen_random_uuid();
alter table public.lms_entry_tokens alter column token_hash set not null;
alter table public.lms_entry_tokens alter column email set not null;
alter table public.lms_entry_tokens alter column student_session_id set not null;
alter table public.lms_entry_tokens alter column portal_device_id set not null;
alter table public.lms_entry_tokens alter column course_slug set not null;
alter table public.lms_entry_tokens alter column status set not null;
alter table public.lms_entry_tokens alter column created_at set default now();
alter table public.lms_entry_tokens alter column created_at set not null;
alter table public.lms_entry_tokens alter column expires_at set not null;

alter table public.lms_verified_sessions alter column id set default gen_random_uuid();
alter table public.lms_verified_sessions alter column lms_session_id set not null;
alter table public.lms_verified_sessions alter column email set not null;
alter table public.lms_verified_sessions alter column student_session_id set not null;
alter table public.lms_verified_sessions alter column lms_device_id set not null;
alter table public.lms_verified_sessions alter column course_slug set not null;
alter table public.lms_verified_sessions alter column status set not null;
alter table public.lms_verified_sessions alter column verified_at set default now();
alter table public.lms_verified_sessions alter column verified_at set not null;
alter table public.lms_verified_sessions alter column last_seen_at set default now();
alter table public.lms_verified_sessions alter column last_seen_at set not null;
alter table public.lms_verified_sessions alter column created_at set default now();
alter table public.lms_verified_sessions alter column created_at set not null;
alter table public.lms_verified_sessions alter column updated_at set default now();
alter table public.lms_verified_sessions alter column updated_at set not null;

alter table public.student_session_controls alter column id set default gen_random_uuid();
alter table public.student_session_controls alter column email set not null;
alter table public.student_session_controls alter column session_generation set default 1;
alter table public.student_session_controls alter column session_generation set not null;
alter table public.student_session_controls alter column created_at set default now();
alter table public.student_session_controls alter column created_at set not null;
alter table public.student_session_controls alter column updated_at set default now();
alter table public.student_session_controls alter column updated_at set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='student_active_sessions_student_session_id_key' and conrelid='public.student_active_sessions'::regclass) then
    alter table public.student_active_sessions add constraint student_active_sessions_student_session_id_key unique (student_session_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='student_active_sessions_status_check' and conrelid='public.student_active_sessions'::regclass) then
    alter table public.student_active_sessions add constraint student_active_sessions_status_check check (status = any (array['active'::text,'logged_out'::text,'expired'::text,'admin_reset'::text,'superseded'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conname='lms_entry_tokens_token_hash_key' and conrelid='public.lms_entry_tokens'::regclass) then
    alter table public.lms_entry_tokens add constraint lms_entry_tokens_token_hash_key unique (token_hash);
  end if;
  if not exists (select 1 from pg_constraint where conname='lms_entry_tokens_status_check' and conrelid='public.lms_entry_tokens'::regclass) then
    alter table public.lms_entry_tokens add constraint lms_entry_tokens_status_check check (status = any (array['active'::text,'used'::text,'expired'::text,'revoked'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conname='lms_verified_sessions_lms_session_id_key' and conrelid='public.lms_verified_sessions'::regclass) then
    alter table public.lms_verified_sessions add constraint lms_verified_sessions_lms_session_id_key unique (lms_session_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='lms_verified_sessions_entry_token_id_fkey' and conrelid='public.lms_verified_sessions'::regclass) then
    alter table public.lms_verified_sessions add constraint lms_verified_sessions_entry_token_id_fkey foreign key (entry_token_id) references public.lms_entry_tokens(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='lms_verified_sessions_status_check' and conrelid='public.lms_verified_sessions'::regclass) then
    alter table public.lms_verified_sessions add constraint lms_verified_sessions_status_check check (status = any (array['active'::text,'logged_out'::text,'expired'::text,'admin_reset'::text,'superseded'::text]));
  end if;
end $$;

create unique index if not exists idx_one_active_student_session_per_email on public.student_active_sessions (lower(email)) where status='active';
create index if not exists idx_student_active_sessions_email_status on public.student_active_sessions(email,status);
create index if not exists idx_student_active_sessions_student_session_id on public.student_active_sessions(student_session_id);
create index if not exists idx_lms_entry_tokens_token_hash on public.lms_entry_tokens(token_hash);
create index if not exists idx_lms_entry_tokens_email_course_status on public.lms_entry_tokens(email,course_slug,status);
create index if not exists idx_lms_entry_tokens_student_session_status on public.lms_entry_tokens(student_session_id,status);
create index if not exists idx_lms_verified_sessions_lms_session_id on public.lms_verified_sessions(lms_session_id);
create index if not exists idx_lms_verified_sessions_email_course_status on public.lms_verified_sessions(email,course_slug,status);
create index if not exists idx_lms_verified_sessions_student_session_status on public.lms_verified_sessions(student_session_id,status);
create unique index if not exists idx_student_session_controls_email on public.student_session_controls(lower(trim(email)));

-- Account-sharing telemetry/review tables
alter table public.admin_audit_logs alter column id set default gen_random_uuid();
alter table public.admin_audit_logs alter column action set not null;
alter table public.admin_audit_logs alter column metadata set default '{}'::jsonb;
alter table public.admin_audit_logs alter column metadata set not null;
alter table public.admin_audit_logs alter column created_at set default now();
alter table public.admin_audit_logs alter column created_at set not null;

alter table public.student_account_admin_notes alter column id set default gen_random_uuid();
alter table public.student_account_admin_notes alter column email set not null;
alter table public.student_account_admin_notes alter column note set not null;
alter table public.student_account_admin_notes alter column created_at set default now();
alter table public.student_account_admin_notes alter column created_at set not null;

alter table public.student_account_risk_reviews alter column id set default gen_random_uuid();
alter table public.student_account_risk_reviews alter column email set not null;
alter table public.student_account_risk_reviews alter column status set default 'new';
alter table public.student_account_risk_reviews alter column status set not null;
alter table public.student_account_risk_reviews alter column risk_score set default 0;
alter table public.student_account_risk_reviews alter column risk_score set not null;
alter table public.student_account_risk_reviews alter column created_at set default now();
alter table public.student_account_risk_reviews alter column created_at set not null;
alter table public.student_account_risk_reviews alter column updated_at set default now();
alter table public.student_account_risk_reviews alter column updated_at set not null;

alter table public.student_account_risk_summaries alter column id set default gen_random_uuid();
alter table public.student_account_risk_summaries alter column email set not null;
alter table public.student_account_risk_summaries alter column risk_score set default 0;
alter table public.student_account_risk_summaries alter column risk_score set not null;
alter table public.student_account_risk_summaries alter column risk_level set default 'normal';
alter table public.student_account_risk_summaries alter column risk_level set not null;
alter table public.student_account_risk_summaries alter column devices_24h set default 0;
alter table public.student_account_risk_summaries alter column devices_24h set not null;
alter table public.student_account_risk_summaries alter column devices_7d set default 0;
alter table public.student_account_risk_summaries alter column devices_7d set not null;
alter table public.student_account_risk_summaries alter column devices_30d set default 0;
alter table public.student_account_risk_summaries alter column devices_30d set not null;
alter table public.student_account_risk_summaries alter column blocked_count set default 0;
alter table public.student_account_risk_summaries alter column blocked_count set not null;
alter table public.student_account_risk_summaries alter column device_change_count set default 0;
alter table public.student_account_risk_summaries alter column device_change_count set not null;
alter table public.student_account_risk_summaries alter column recent_devices set default '[]'::jsonb;
alter table public.student_account_risk_summaries alter column recent_devices set not null;
alter table public.student_account_risk_summaries alter column course_slugs set default '[]'::jsonb;
alter table public.student_account_risk_summaries alter column course_slugs set not null;
alter table public.student_account_risk_summaries alter column reasons set default '[]'::jsonb;
alter table public.student_account_risk_summaries alter column reasons set not null;
alter table public.student_account_risk_summaries alter column review_status set default 'new';
alter table public.student_account_risk_summaries alter column review_status set not null;
alter table public.student_account_risk_summaries alter column summary_window_days set default 30;
alter table public.student_account_risk_summaries alter column summary_window_days set not null;
alter table public.student_account_risk_summaries alter column computed_at set default now();
alter table public.student_account_risk_summaries alter column computed_at set not null;
alter table public.student_account_risk_summaries alter column stale_after set default (now() + interval '15 minutes');
alter table public.student_account_risk_summaries alter column stale_after set not null;
alter table public.student_account_risk_summaries alter column created_at set default now();
alter table public.student_account_risk_summaries alter column created_at set not null;
alter table public.student_account_risk_summaries alter column updated_at set default now();
alter table public.student_account_risk_summaries alter column updated_at set not null;

alter table public.student_device_change_logs alter column id set default gen_random_uuid();
alter table public.student_device_change_logs alter column email set not null;
alter table public.student_device_change_logs alter column reason set default 'device_changed';
alter table public.student_device_change_logs alter column reason set not null;
alter table public.student_device_change_logs alter column created_at set default now();
alter table public.student_device_change_logs alter column created_at set not null;
alter table public.student_device_change_logs alter column action set not null;
alter table public.student_device_change_logs alter column event_source set default 'system';
alter table public.student_device_change_logs alter column event_source set not null;
alter table public.student_device_change_logs alter column risk_points set default 0;
alter table public.student_device_change_logs alter column risk_points set not null;
alter table public.student_device_change_logs alter column metadata set default '{}'::jsonb;
alter table public.student_device_change_logs alter column metadata set not null;
alter table public.student_device_change_logs alter column schema_version set default 'v1';
alter table public.student_device_change_logs alter column schema_version set not null;
alter table public.student_device_change_logs alter column hash_version set default 'sha256_v1';
alter table public.student_device_change_logs alter column hash_version set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='student_account_risk_reviews_status_check' and conrelid='public.student_account_risk_reviews'::regclass) then
    alter table public.student_account_risk_reviews add constraint student_account_risk_reviews_status_check check (status = any (array['new'::text,'monitoring'::text,'reviewed'::text,'suspected_sharing'::text,'false_positive'::text,'resolved'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conname='student_account_risk_summaries_risk_level_check' and conrelid='public.student_account_risk_summaries'::regclass) then
    alter table public.student_account_risk_summaries add constraint student_account_risk_summaries_risk_level_check check (risk_level = any (array['normal'::text,'watch'::text,'suspicious'::text,'high'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conname='student_account_risk_summaries_review_status_check' and conrelid='public.student_account_risk_summaries'::regclass) then
    alter table public.student_account_risk_summaries add constraint student_account_risk_summaries_review_status_check check (review_status = any (array['new'::text,'monitoring'::text,'reviewed'::text,'suspected_sharing'::text,'false_positive'::text,'resolved'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conname='chk_student_device_change_logs_event_type' and conrelid='public.student_device_change_logs'::regclass) then
    alter table public.student_device_change_logs add constraint chk_student_device_change_logs_event_type check (event_type is null or event_type = any (array['portal_session_created'::text,'portal_session_reused'::text,'login_blocked_other_device'::text,'entry_token_created'::text,'entry_token_used'::text,'entry_token_rejected'::text,'lms_session_created'::text,'lms_session_rejected'::text,'logout'::text,'admin_reset'::text,'admin_note'::text,'admin_mark_reviewed'::text,'admin_mark_suspected'::text])) not valid;
  end if;
end $$;

create index if not exists idx_admin_audit_logs_target_created on public.admin_audit_logs(lower(target_email),created_at desc);
create index if not exists idx_student_account_admin_notes_email_created on public.student_account_admin_notes(lower(trim(email)),created_at desc);
create unique index if not exists idx_student_account_risk_reviews_email on public.student_account_risk_reviews(lower(trim(email)));
create index if not exists idx_student_account_risk_reviews_status_updated on public.student_account_risk_reviews(status,updated_at desc);
create index if not exists idx_student_account_risk_reviews_monitoring on public.student_account_risk_reviews(monitoring_until) where monitoring_until is not null;
create unique index if not exists idx_student_account_risk_summaries_email on public.student_account_risk_summaries(email);
create unique index if not exists idx_student_account_risk_summaries_normalized_email on public.student_account_risk_summaries(lower(trim(email)));
create index if not exists idx_student_account_risk_summaries_risk on public.student_account_risk_summaries(risk_level,risk_score desc,last_event_at desc);
create index if not exists idx_student_account_risk_summaries_review on public.student_account_risk_summaries(review_status,updated_at desc);
create index if not exists idx_student_account_risk_summaries_stale on public.student_account_risk_summaries(stale_after);
create index if not exists idx_student_device_change_logs_created_at on public.student_device_change_logs(created_at desc);
create index if not exists idx_student_device_change_logs_email on public.student_device_change_logs(email);
create index if not exists idx_student_device_change_logs_email_created on public.student_device_change_logs(lower(email),created_at desc);
create index if not exists idx_student_device_logs_correlation_created on public.student_device_change_logs(correlation_id,created_at desc) where correlation_id is not null;
create index if not exists idx_student_device_logs_course_created on public.student_device_change_logs(course_slug,created_at desc) where course_slug is not null;
create index if not exists idx_student_device_logs_email_course_created on public.student_device_change_logs(lower(trim(email)),course_slug,created_at desc) where course_slug is not null;
create index if not exists idx_student_device_logs_event_email_created on public.student_device_change_logs(lower(trim(email)),created_at desc);
create unique index if not exists idx_student_device_logs_event_idempotency on public.student_device_change_logs(event_idempotency_key) where event_idempotency_key is not null;
create index if not exists idx_student_device_logs_event_type_created on public.student_device_change_logs(event_type,created_at desc);
create index if not exists idx_student_device_logs_reason_created on public.student_device_change_logs(reason_code,created_at desc) where reason_code is not null;
create index if not exists idx_student_device_logs_retention_created on public.student_device_change_logs(created_at);

-- Drive support tables
alter table public.drive_admin_accounts alter column id set default gen_random_uuid();
alter table public.drive_admin_accounts alter column email set not null;
alter table public.drive_admin_accounts alter column status set default 'active';
alter table public.drive_admin_accounts alter column status set not null;
alter table public.drive_admin_accounts alter column daily_share_count set default 0;
alter table public.drive_admin_accounts alter column daily_share_count set not null;
alter table public.drive_admin_accounts alter column created_at set default now();
alter table public.drive_admin_accounts alter column updated_at set default now();

alter table public.drive_permission_logs alter column id set default gen_random_uuid();
alter table public.drive_permission_logs alter column time set default now();
alter table public.drive_permission_logs alter column course_slug set not null;
alter table public.drive_permission_logs alter column email set not null;
alter table public.drive_permission_logs alter column action set not null;
alter table public.drive_permission_logs alter column status set not null;
alter table public.drive_permission_logs alter column retry_count set default 0;
alter table public.drive_permission_logs alter column created_at set default now();
alter table public.drive_permission_logs alter column updated_at set default now();

alter table public.drive_sync_queue alter column id set default gen_random_uuid();
alter table public.drive_sync_queue alter column email set not null;
alter table public.drive_sync_queue alter column course_slug set not null;
alter table public.drive_sync_queue alter column action set not null;
alter table public.drive_sync_queue alter column attempts set default 0;
alter table public.drive_sync_queue alter column created_at set default now();
alter table public.drive_sync_queue alter column updated_at set default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname='drive_admin_accounts_email_key' and conrelid='public.drive_admin_accounts'::regclass) then
    alter table public.drive_admin_accounts add constraint drive_admin_accounts_email_key unique (email);
  end if;
  if not exists (select 1 from pg_constraint where conname='drive_admin_accounts_status_check' and conrelid='public.drive_admin_accounts'::regclass) then
    alter table public.drive_admin_accounts add constraint drive_admin_accounts_status_check check (status = any (array['active'::text,'paused'::text,'quota_limited'::text,'error'::text]));
  end if;
end $$;

create index if not exists idx_drive_admin_accounts_status on public.drive_admin_accounts(status);
create index if not exists idx_drive_permission_logs_student_course on public.drive_permission_logs(student_email,course_slug);
create index if not exists idx_drive_permission_logs_admin_status on public.drive_permission_logs(drive_admin_email,status);

-- Service-role-only RPCs
create or replace function public.handle_student_session_login(
  p_email text,
  p_portal_device_id text,
  p_new_student_session_id text,
  p_device_hash text default null,
  p_device_label text default null,
  p_ip text default null,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_conflict_policy text default 'block',
  p_idle_hours integer default 24
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timestamp timestamptz := now();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_policy text := lower(trim(coalesce(p_conflict_policy, 'block')));
  v_existing student_active_sessions%rowtype;
  v_student_session_id text := trim(coalesce(p_new_student_session_id, ''));
  v_idle_hours integer := greatest(coalesce(p_idle_hours, 24), 1);
begin
  if v_email = '' then raise exception 'email is required'; end if;
  if trim(coalesce(p_portal_device_id, '')) = '' then raise exception 'portal_device_id is required'; end if;
  if v_student_session_id = '' then raise exception 'student_session_id is required'; end if;
  perform pg_advisory_xact_lock(hashtext(v_email));
  select * into v_existing from student_active_sessions where lower(email)=v_email and status='active' order by last_seen_at desc limit 1 for update;
  if found then
    if v_existing.last_seen_at < v_timestamp - make_interval(hours => v_idle_hours) then
      update student_active_sessions set status='expired',logout_at=v_timestamp,updated_at=v_timestamp where id=v_existing.id;
      update lms_verified_sessions set status='expired',logout_at=v_timestamp,updated_at=v_timestamp where student_session_id=v_existing.student_session_id and status='active';
      update lms_entry_tokens set status='expired' where student_session_id=v_existing.student_session_id and status='active';
    elsif v_existing.portal_device_id = p_portal_device_id then
      update student_active_sessions set last_seen_at=v_timestamp,updated_at=v_timestamp,ip=coalesce(p_ip,ip),user_agent=coalesce(p_user_agent,user_agent),device_hash=coalesce(p_device_hash,device_hash),device_label=coalesce(p_device_label,device_label),ip_hash=coalesce(p_ip_hash,ip_hash) where id=v_existing.id;
      return jsonb_build_object('ok',true,'action','reused','student_session_id',v_existing.student_session_id,'portal_device_id',v_existing.portal_device_id);
    elsif v_policy='supersede' then
      update student_active_sessions set status='superseded',logout_at=v_timestamp,updated_at=v_timestamp where id=v_existing.id;
      update lms_verified_sessions set status='superseded',logout_at=v_timestamp,updated_at=v_timestamp where student_session_id=v_existing.student_session_id and status='active';
      update lms_entry_tokens set status='revoked' where student_session_id=v_existing.student_session_id and status='active';
      insert into student_device_change_logs(email,action,old_device_hash,new_device_hash,old_device_label,new_device_label,old_student_session_id,new_student_session_id,user_agent,ip_hash,reason,created_at)
      values(v_email,'superseded',v_existing.device_hash,p_device_hash,v_existing.device_label,p_device_label,v_existing.student_session_id,v_student_session_id,p_user_agent,p_ip_hash,'new_device_superseded_active_session',v_timestamp);
    else
      return jsonb_build_object('ok',false,'action','blocked','reason','active_session_on_another_device','student_session_id',v_existing.student_session_id,'portal_device_id',v_existing.portal_device_id,'last_seen_at',v_existing.last_seen_at);
    end if;
  end if;
  insert into student_active_sessions(email,student_session_id,portal_device_id,status,login_at,last_seen_at,logout_at,ip,user_agent,device_hash,device_label,ip_hash,created_at,updated_at)
  values(v_email,v_student_session_id,p_portal_device_id,'active',v_timestamp,v_timestamp,null,p_ip,p_user_agent,p_device_hash,p_device_label,p_ip_hash,v_timestamp,v_timestamp);
  return jsonb_build_object('ok',true,'action','created','student_session_id',v_student_session_id,'portal_device_id',p_portal_device_id);
end;
$$;

create or replace function public.reset_student_session_guard(p_email text,p_admin_email text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_email text:=lower(trim(coalesce(p_email,''))); v_now timestamptz:=now(); v_session_ids text[]; v_student_count integer:=0; v_lms_count integer:=0; v_token_count integer:=0;
begin
  if v_email='' then raise exception 'email is required'; end if;
  perform pg_advisory_xact_lock(hashtext('reset_student_session_guard:'||v_email));
  insert into student_session_controls(email,session_generation,sessions_revoked_before,updated_by_admin_email,reason,updated_at)
  values(v_email,1,v_now,lower(trim(coalesce(p_admin_email,''))),p_reason,v_now)
  on conflict (lower(trim(email))) do update set session_generation=student_session_controls.session_generation+1,sessions_revoked_before=v_now,updated_by_admin_email=lower(trim(coalesce(p_admin_email,''))),reason=p_reason,updated_at=v_now;
  select coalesce(array_agg(student_session_id),array[]::text[]) into v_session_ids from student_active_sessions where lower(trim(email))=v_email and status='active';
  update student_active_sessions set status='admin_reset',logout_at=v_now,updated_at=v_now where lower(trim(email))=v_email and status='active'; get diagnostics v_student_count=row_count;
  if coalesce(array_length(v_session_ids,1),0)>0 then
    update lms_entry_tokens set status='revoked' where student_session_id=any(v_session_ids) and status='active'; get diagnostics v_token_count=row_count;
    update lms_verified_sessions set status='admin_reset',logout_at=v_now,updated_at=v_now where student_session_id=any(v_session_ids) and status='active'; get diagnostics v_lms_count=row_count;
  end if;
  insert into admin_audit_logs(admin_email,action,target_email,metadata,created_at) values(nullif(lower(trim(coalesce(p_admin_email,''))),''),'reset_student_session_guard',v_email,jsonb_build_object('reason',p_reason,'studentSessions',v_student_count,'entryTokens',v_token_count,'lmsSessions',v_lms_count,'revokedBefore',v_now),v_now);
  return jsonb_build_object('ok',true,'email',v_email,'studentSessions',v_student_count,'entryTokens',v_token_count,'lmsSessions',v_lms_count,'revokedBefore',v_now);
end; $$;

create or replace function public.cleanup_student_account_risk_events(p_retention_days integer default 180)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_retention_days integer:=greatest(coalesce(p_retention_days,180),30); v_cutoff timestamptz:=now()-(v_retention_days||' days')::interval; v_device_events integer:=0; v_notes integer:=0; v_audits integer:=0;
begin
  delete from student_device_change_logs where created_at<v_cutoff; get diagnostics v_device_events=row_count;
  delete from student_account_admin_notes where created_at<v_cutoff; get diagnostics v_notes=row_count;
  delete from admin_audit_logs where created_at<v_cutoff and action like 'account_sharing_%'; get diagnostics v_audits=row_count;
  return jsonb_build_object('ok',true,'retentionDays',v_retention_days,'cutoff',v_cutoff,'deviceEventsDeleted',v_device_events,'notesDeleted',v_notes,'auditLogsDeleted',v_audits);
end; $$;

revoke all on function public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) from public;
revoke all on function public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) from anon;
revoke all on function public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) from authenticated;
grant execute on function public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) to service_role;
revoke all on function public.reset_student_session_guard(text,text,text) from public;
revoke all on function public.reset_student_session_guard(text,text,text) from anon;
revoke all on function public.reset_student_session_guard(text,text,text) from authenticated;
grant execute on function public.reset_student_session_guard(text,text,text) to service_role;
revoke all on function public.cleanup_student_account_risk_events(integer) from public;
revoke all on function public.cleanup_student_account_risk_events(integer) from anon;
revoke all on function public.cleanup_student_account_risk_events(integer) from authenticated;
grant execute on function public.cleanup_student_account_risk_events(integer) to service_role;

commit;
