alter table public.lms_v4_media_tickets
  add column if not exists purpose text not null default 'legacy',
  add column if not exists playback_proof_hash text,
  add column if not exists bound_ua_hash text,
  add column if not exists bound_ip_hash text;

create index if not exists lms_v4_media_tickets_purpose_expires_idx
  on public.lms_v4_media_tickets (purpose, expires_at);;
