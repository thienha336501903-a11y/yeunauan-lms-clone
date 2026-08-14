-- LMS V4 Telegram source POC
-- Isolated from V2/V3 lesson storage. Reuses tgcloner_sources/tgcloner_source_messages.

create table if not exists public.lms_v4_telegram_course_sources (
  course_slug text primary key,
  source_id uuid not null,
  enabled boolean not null default false,
  media_mode text not null default 'telegram_bot_poc',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lms_v4_telegram_course_sources_course_fk
    foreign key (course_slug) references public.courses(slug)
    on update cascade on delete restrict,
  constraint lms_v4_telegram_course_sources_source_fk
    foreign key (source_id) references public.tgcloner_sources(id)
    on update cascade on delete restrict,
  constraint lms_v4_telegram_course_sources_media_mode_check
    check (media_mode in ('telegram_bot_poc', 'mtproto_gateway', 'mirror'))
);

create index if not exists idx_lms_v4_telegram_course_sources_source
  on public.lms_v4_telegram_course_sources(source_id);

alter table public.lms_v4_telegram_course_sources enable row level security;
revoke all on table public.lms_v4_telegram_course_sources from anon, authenticated;
grant all on table public.lms_v4_telegram_course_sources to service_role;

comment on table public.lms_v4_telegram_course_sources is
  'Clone-only V4 mapping from LMS course slug to Telegram Cloner source. No learner direct access.';

-- Short-lived bearer tickets issued only after LMS enrollment/session checks.
-- The browser receives only the random ticket UUID; Telegram bot credentials stay in the media gateway.
create table if not exists public.lms_v4_media_tickets (
  token uuid primary key,
  course_slug text not null,
  source_id uuid not null references public.tgcloner_sources(id) on delete cascade,
  message_id uuid not null references public.tgcloner_source_messages(id) on delete cascade,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists lms_v4_media_tickets_expires_idx
  on public.lms_v4_media_tickets(expires_at);
create index if not exists lms_v4_media_tickets_message_idx
  on public.lms_v4_media_tickets(message_id);

alter table public.lms_v4_media_tickets enable row level security;
revoke all on table public.lms_v4_media_tickets from anon, authenticated;
grant all on table public.lms_v4_media_tickets to service_role;

comment on table public.lms_v4_media_tickets is
  'Server-only, short-lived V4 media tickets. Used to keep Telegram credentials out of the LMS/browser.';
