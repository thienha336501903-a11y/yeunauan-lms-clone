alter table public.courses
  add column if not exists telegram_connect_request_id bigint,
  add column if not exists telegram_connect_user_id bigint,
  add column if not exists telegram_connect_expires_at timestamptz;

create index if not exists idx_courses_telegram_connect_request
  on public.courses (telegram_connect_request_id)
  where telegram_connect_request_id is not null;;
