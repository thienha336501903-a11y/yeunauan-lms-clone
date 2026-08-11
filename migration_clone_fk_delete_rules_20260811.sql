-- Clone FK delete-rule alignment
-- Applied to Supabase Clone yyiavtiwtekkocqpephr on 2026-08-11.
-- Aligns student_enrollments referential actions with the current system and
-- with supabase_schema.sql. No row data is changed by this migration.

begin;

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

commit;
