-- System B only: read-only operational snapshot for staged V5 pilot monitoring.
-- Safe to run repeatedly on Supabase B. No writes, DDL, grants, or mutations.

select
  now() as sampled_at,
  pg_database_size(current_database()) as db_size_bytes,
  pg_size_pretty(pg_database_size(current_database())) as db_size_pretty,
  (select count(*) from pg_stat_activity) as db_connections,
  (select count(*) from pg_stat_activity where state = 'active') as active_connections,
  coalesce((
    select sum(calls)::bigint
    from pg_stat_statements
    where query ilike '%v5_authorize_playback_asset%'
  ), 0) as playback_rpc_related_calls,
  coalesce((
    select sum(calls)::bigint
    from pg_stat_statements
    where query ilike '%update%student_active_sessions%last_seen_at%'
  ), 0) as student_session_heartbeat_calls,
  coalesce((
    select sum(calls)::bigint
    from pg_stat_statements
    where query ilike '%update%lms_verified_sessions%last_seen_at%'
  ), 0) as verified_session_heartbeat_calls,
  (select count(*) from student_active_sessions where last_seen_at >= now() - interval '15 minutes') as active_student_sessions_15m,
  (select count(*) from student_active_sessions where last_seen_at >= now() - interval '24 hours') as active_student_sessions_24h,
  (select count(*) from lms_verified_sessions where last_seen_at >= now() - interval '15 minutes') as verified_sessions_15m,
  (select count(*) from lms_verified_sessions where last_seen_at >= now() - interval '24 hours') as verified_sessions_24h;
