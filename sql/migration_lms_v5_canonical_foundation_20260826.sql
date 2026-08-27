-- Canonical LMS V5 schema as applied to System B on 2026-08-26.
-- Additive only. Does not change V4 routing or legacy LMS data.

create table if not exists public.v5_course_configs (
  course_id uuid primary key references public.courses(id) on delete cascade,
  source_mode text not null default 'direct' check (source_mode in ('direct','telegram','hybrid')),
  status text not null default 'draft' check (status in ('draft','processing','ready','published','archived')),
  telegram_source_id uuid null references public.tgcloner_sources(id) on delete set null,
  published_release_id uuid null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v5_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  position integer not null default 0,
  status text not null default 'draft' check (status in ('draft','ready','published','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, position)
);

create table if not exists public.v5_posts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid null references public.v5_lessons(id) on delete cascade,
  position integer not null default 0,
  text_content text null,
  caption text null,
  origin text not null default 'direct' check (origin in ('direct','telegram')),
  origin_ref jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','processing','ready','published','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v5_media_assets (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('image','video','document','other')),
  provider text not null default 'r2' check (provider in ('r2','telegram')),
  origin text not null default 'direct' check (origin in ('direct','telegram')),
  r2_object_key text null unique,
  telegram_source_id uuid null references public.tgcloner_sources(id) on delete set null,
  telegram_message_row_id uuid null references public.tgcloner_source_messages(id) on delete set null,
  mime_type text null,
  original_filename text null,
  bytes bigint null check (bytes is null or bytes >= 0),
  width integer null,
  height integer null,
  duration_ms bigint null,
  checksum_sha256 text null,
  thumbnail_asset_id uuid null,
  status text not null default 'pending' check (status in ('pending','uploading','processing','ready','failed','archived')),
  upload_id text null,
  upload_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_error text null,
  upload_attempts integer not null default 0,
  uploaded_at timestamptz null,
  last_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.v5_media_assets
  drop constraint if exists v5_media_assets_thumbnail_asset_id_fkey;
alter table public.v5_media_assets
  add constraint v5_media_assets_thumbnail_asset_id_fkey
  foreign key (thumbnail_asset_id) references public.v5_media_assets(id) on delete set null;

create table if not exists public.v5_post_assets (
  post_id uuid not null references public.v5_posts(id) on delete cascade,
  asset_id uuid not null references public.v5_media_assets(id) on delete restrict,
  position integer not null default 0,
  role text not null default 'attachment' check (role in ('attachment','hero','thumbnail','inline')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (post_id, asset_id)
);

create table if not exists public.v5_releases (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  version integer not null,
  status text not null default 'published' check (status in ('published','superseded','rolled_back')),
  snapshot jsonb not null,
  created_by text null,
  created_at timestamptz not null default now(),
  unique(course_id, version)
);

alter table public.v5_course_configs
  drop constraint if exists v5_course_configs_published_release_id_fkey;
alter table public.v5_course_configs
  add constraint v5_course_configs_published_release_id_fkey
  foreign key (published_release_id) references public.v5_releases(id) on delete set null;

create table if not exists public.v5_jobs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid null references public.courses(id) on delete cascade,
  asset_id uuid null references public.v5_media_assets(id) on delete cascade,
  job_type text not null check (job_type in ('upload_finalize','media_probe','thumbnail','faststart','telegram_import','telegram_mirror','asset_verify','cleanup','reconcile')),
  status text not null default 'queued' check (status in ('queued','running','success','failed','retrying','cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  progress_current bigint null,
  progress_total bigint null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v5_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  asset_id uuid not null references public.v5_media_assets(id) on delete cascade,
  admin_email text null,
  provider_upload_id text null,
  object_key text not null,
  status text not null default 'created' check (status in ('created','uploading','completed','aborted','expired','failed')),
  part_size integer null,
  expected_bytes bigint null,
  expires_at timestamptz not null,
  completed_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists v5_lessons_course_position_idx on public.v5_lessons(course_id, position);
create index if not exists v5_posts_course_position_idx on public.v5_posts(course_id, position);
create index if not exists v5_posts_lesson_position_idx on public.v5_posts(lesson_id, position);
create index if not exists v5_media_assets_status_idx on public.v5_media_assets(status);
create index if not exists v5_media_assets_telegram_idx on public.v5_media_assets(telegram_source_id, telegram_message_row_id);
create index if not exists v5_post_assets_post_position_idx on public.v5_post_assets(post_id, position);
create index if not exists v5_jobs_status_available_idx on public.v5_jobs(status, available_at);
create index if not exists v5_upload_sessions_status_expiry_idx on public.v5_upload_sessions(status, expires_at);

alter table public.v5_course_configs enable row level security;
alter table public.v5_lessons enable row level security;
alter table public.v5_posts enable row level security;
alter table public.v5_media_assets enable row level security;
alter table public.v5_post_assets enable row level security;
alter table public.v5_releases enable row level security;
alter table public.v5_jobs enable row level security;
alter table public.v5_upload_sessions enable row level security;

comment on table public.v5_course_configs is 'V5 isolated course configuration; V4 routing is not modified.';
comment on table public.v5_media_assets is 'Canonical V5 media assets for direct R2 or Telegram-origin media.';

create table if not exists public.v5_source_mappings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  source_system text not null default 'telegram' check (source_system in ('telegram')),
  source_id uuid not null references public.tgcloner_sources(id) on delete cascade,
  source_message_row_id uuid not null references public.tgcloner_source_messages(id) on delete cascade,
  source_message_id bigint not null,
  media_group_id text null,
  post_id uuid not null references public.v5_posts(id) on delete cascade,
  asset_id uuid null references public.v5_media_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, source_system, source_message_row_id)
);
create index if not exists v5_source_mappings_source_idx on public.v5_source_mappings(source_id, source_message_id);
create index if not exists v5_source_mappings_post_idx on public.v5_source_mappings(post_id);
alter table public.v5_source_mappings enable row level security;
comment on table public.v5_source_mappings is 'Idempotent mapping from legacy Telegram messages into canonical V5 posts/assets.';

alter table public.courses drop constraint if exists courses_delivery_mode_check;
alter table public.courses add constraint courses_delivery_mode_check check (delivery_mode = any (array['lms'::text,'v4'::text,'telegram'::text,'v5'::text]));
