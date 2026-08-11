-- Canonical Clone post-audit alignment migration
-- Supabase Clone: yyiavtiwtekkocqpephr
-- Applied/verified on 2026-08-11.
--
-- Purpose:
--   1) close public access to server-side site_config credentials,
--   2) rebuild missing student dimension from existing enrollment identities,
--   3) restore V1 defaults/nullability/unique/FK/index rules lost in Clone copy,
--   4) preserve all Clone-specific columns and canonical business rows.
--
-- This file is the single replayable source of truth for the post-audit DB fixes.
-- It contains no credential values.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SECURITY: site_config is backend-only.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists site_config_public_select on public.site_config;
revoke select on table public.site_config from anon, authenticated;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. STUDENT DIMENSION: preserve exact IDs/emails already referenced by
--    student_enrollments before adding referential constraints.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.students (id, email, full_name, phone, status, note, raw_data, created_at, updated_at)
select
  e.student_id,
  lower(trim(e.email)),
  null,
  null,
  'active',
  null,
  '{}'::jsonb,
  coalesce(min(e.created_at), now()),
  coalesce(max(e.updated_at), now())
from public.student_enrollments e
where e.student_id is not null
  and e.email is not null
  and trim(e.email) <> ''
group by e.student_id, lower(trim(e.email))
on conflict (id) do nothing;

alter table public.students alter column id set default gen_random_uuid();
alter table public.students alter column email set not null;
alter table public.students alter column status set default 'active';
alter table public.students alter column raw_data set default '{}'::jsonb;
alter table public.students alter column created_at set default now();
alter table public.students alter column updated_at set default now();

alter table public.student_enrollments alter column id set default gen_random_uuid();
alter table public.student_enrollments alter column course_slug set not null;
alter table public.student_enrollments alter column email set not null;
alter table public.student_enrollments alter column status set default 'active';
alter table public.student_enrollments alter column created_at set default now();
alter table public.student_enrollments alter column updated_at set default now();
alter table public.student_enrollments alter column drive_permission_retry_count set default 0;
alter table public.student_enrollments alter column sync_correlation_id set default gen_random_uuid();
alter table public.student_enrollments alter column source_system set default 'lms';

alter table public.site_config alter column key set not null;
alter table public.site_config alter column updated_at set default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname='students_email_key' and conrelid='public.students'::regclass) then
    alter table public.students add constraint students_email_key unique (email);
  end if;
  if not exists (select 1 from pg_constraint where conname='student_enrollments_email_course_slug_key' and conrelid='public.student_enrollments'::regclass) then
    alter table public.student_enrollments add constraint student_enrollments_email_course_slug_key unique (email, course_slug);
  end if;
  if not exists (select 1 from pg_constraint where conname='site_config_pkey' and conrelid='public.site_config'::regclass) then
    alter table public.site_config add constraint site_config_pkey primary key (key);
  end if;
end $$;

-- Recreate enrollment FKs with deterministic delete behavior. This is safe to
-- replay because the student dimension has already been backfilled above.
alter table public.student_enrollments drop constraint if exists student_enrollments_student_id_fkey;
alter table public.student_enrollments drop constraint if exists student_enrollments_course_id_fkey;
alter table public.student_enrollments drop constraint if exists student_enrollments_source_order_id_fkey;

alter table public.student_enrollments
  add constraint student_enrollments_student_id_fkey
  foreign key (student_id) references public.students(id) on delete cascade;
alter table public.student_enrollments
  add constraint student_enrollments_course_id_fkey
  foreign key (course_id) references public.courses(id) on delete cascade;
alter table public.student_enrollments
  add constraint student_enrollments_source_order_id_fkey
  foreign key (source_order_id) references public.orders(id) on delete set null;

create index if not exists idx_students_email on public.students(email);
create index if not exists idx_student_enrollments_email on public.student_enrollments(email);
create index if not exists idx_student_enrollments_course_slug on public.student_enrollments(course_slug);
create index if not exists idx_student_enrollments_course_id_status on public.student_enrollments(course_id, status);
create index if not exists idx_student_enrollments_drive_status on public.student_enrollments(drive_permission_status);
create index if not exists idx_student_enrollments_normalized_email on public.student_enrollments(normalized_email);
create index if not exists idx_student_enrollments_sync_correlation on public.student_enrollments(sync_correlation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CORE V1 TABLES: restore only shared V1 rules. Clone-only columns such as
--    sales_site/sales_host/idempotency_key/price_snapshot are untouched.
-- ─────────────────────────────────────────────────────────────────────────────
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
