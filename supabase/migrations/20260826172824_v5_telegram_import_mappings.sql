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
comment on table public.v5_source_mappings is 'Idempotent mapping from legacy Telegram messages into canonical V5 posts/assets.';;
