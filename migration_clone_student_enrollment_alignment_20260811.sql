-- Clone student/enrollment schema alignment
-- Applied to Supabase Clone yyiavtiwtekkocqpephr on 2026-08-11.
-- Preserves the canonical 7 courses / 39 lessons / 20 enrollments baseline.

begin;

-- Rebuild the missing student dimension from identities already present in
-- student_enrollments. Exact existing student_id/email mappings are preserved.
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
  if not exists (select 1 from pg_constraint where conname='student_enrollments_student_id_fkey' and conrelid='public.student_enrollments'::regclass) then
    alter table public.student_enrollments add constraint student_enrollments_student_id_fkey foreign key (student_id) references public.students(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='student_enrollments_course_id_fkey' and conrelid='public.student_enrollments'::regclass) then
    alter table public.student_enrollments add constraint student_enrollments_course_id_fkey foreign key (course_id) references public.courses(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='student_enrollments_source_order_id_fkey' and conrelid='public.student_enrollments'::regclass) then
    alter table public.student_enrollments add constraint student_enrollments_source_order_id_fkey foreign key (source_order_id) references public.orders(id);
  end if;
end $$;

create index if not exists idx_students_email on public.students(email);
create index if not exists idx_student_enrollments_email on public.student_enrollments(email);
create index if not exists idx_student_enrollments_course_slug on public.student_enrollments(course_slug);
create index if not exists idx_student_enrollments_course_id_status on public.student_enrollments(course_id, status);
create index if not exists idx_student_enrollments_drive_status on public.student_enrollments(drive_permission_status);
create index if not exists idx_student_enrollments_normalized_email on public.student_enrollments(normalized_email);
create index if not exists idx_student_enrollments_sync_correlation on public.student_enrollments(sync_correlation_id);

commit;
