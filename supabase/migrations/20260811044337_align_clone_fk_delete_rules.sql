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

commit;;
