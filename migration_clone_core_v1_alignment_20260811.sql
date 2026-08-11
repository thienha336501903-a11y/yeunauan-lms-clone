-- Clone core V1 schema alignment
-- Applied to Supabase Clone yyiavtiwtekkocqpephr on 2026-08-11.
-- Restores shared V1 defaults/nullability/constraints lost during Clone copy.
-- Clone-specific columns (sales_site, sales_host, idempotency_key, price_snapshot)
-- are intentionally preserved and untouched.

begin;

alter table public.courses alter column id set default gen_random_uuid();
alter table public.courses alter column slug set not null;
alter table public.courses alter column title set not null;
alter table public.courses alter column active set default true;
alter table public.courses alter column sort_order set default 0;
alter table public.courses alter column raw_data set default '{}'::jsonb;
alter table public.courses alter column created_at set default now();
alter table public.courses alter column updated_at set default now();
alter table public.courses alter column sync_lms_status set default 'PENDING';
alter table public.courses alter column sync_portal_status set default 'PENDING';
alter table public.courses alter column is_published set default false;
alter table public.courses alter column drive_permission_mode set default 'folder';

alter table public.lessons alter column id set default gen_random_uuid();
alter table public.lessons alter column course_slug set not null;
alter table public.lessons alter column lesson_no set not null;
alter table public.lessons alter column title set not null;
alter table public.lessons alter column video_provider set default 'bunny';
alter table public.lessons alter column views set default 0;
alter table public.lessons alter column is_free set default false;
alter table public.lessons alter column active set default true;
alter table public.lessons alter column status set default 'active';
alter table public.lessons alter column sort_order set default 0;
alter table public.lessons alter column raw_data set default '{}'::jsonb;
alter table public.lessons alter column created_at set default now();
alter table public.lessons alter column updated_at set default now();
alter table public.lessons alter column is_section set default false;
alter table public.lessons alter column materials set default '[]'::jsonb;

alter table public.orders alter column course_slug set not null;
alter table public.orders alter column customer_email set not null;
alter table public.orders alter column status set default 'Chờ duyệt';
alter table public.orders alter column raw_data set default '{}'::jsonb;
alter table public.orders alter column created_at set default now();
alter table public.orders alter column updated_at set default now();
alter table public.orders alter column sync_lms_status set default 'PENDING';
alter table public.orders alter column sync_portal_status set default 'PENDING';
alter table public.orders alter column sync_correlation_id set default gen_random_uuid();
alter table public.orders alter column source_system set default 'shop';

alter table public.lesson_progress alter column id set default gen_random_uuid();
alter table public.lesson_progress alter column email set not null;
alter table public.lesson_progress alter column course_slug set not null;
alter table public.lesson_progress alter column progress_percent set default 0;
alter table public.lesson_progress alter column completed set default false;
alter table public.lesson_progress alter column created_at set default now();
alter table public.lesson_progress alter column updated_at set default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname='courses_slug_key' and conrelid='public.courses'::regclass) then
    alter table public.courses add constraint courses_slug_key unique (slug);
  end if;
  if not exists (select 1 from pg_constraint where conname='lessons_course_id_fkey' and conrelid='public.lessons'::regclass) then
    alter table public.lessons add constraint lessons_course_id_fkey foreign key (course_id) references public.courses(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='lessons_course_slug_lesson_no_key' and conrelid='public.lessons'::regclass) then
    alter table public.lessons add constraint lessons_course_slug_lesson_no_key unique (course_slug, lesson_no);
  end if;
  if not exists (select 1 from pg_constraint where conname='lessons_kind_check' and conrelid='public.lessons'::regclass) then
    alter table public.lessons add constraint lessons_kind_check check (kind = any (array['section'::text, 'lesson'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conname='lessons_parent_section_id_fkey' and conrelid='public.lessons'::regclass) then
    alter table public.lessons add constraint lessons_parent_section_id_fkey foreign key (parent_section_id) references public.lessons(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_course_id_fkey' and conrelid='public.orders'::regclass) then
    alter table public.orders add constraint orders_course_id_fkey foreign key (course_id) references public.courses(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='lesson_progress_email_lesson_id_key' and conrelid='public.lesson_progress'::regclass) then
    alter table public.lesson_progress add constraint lesson_progress_email_lesson_id_key unique (email, lesson_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='lesson_progress_lesson_id_fkey' and conrelid='public.lesson_progress'::regclass) then
    alter table public.lesson_progress add constraint lesson_progress_lesson_id_fkey foreign key (lesson_id) references public.lessons(id) on delete cascade;
  end if;
end $$;

commit;
