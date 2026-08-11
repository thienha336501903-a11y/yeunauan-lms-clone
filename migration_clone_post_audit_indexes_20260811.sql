-- Clone V1 query-index alignment
-- Applied to Supabase Clone yyiavtiwtekkocqpephr on 2026-08-11.
-- Only indexes that exist in current V1 and whose columns exist in Clone are
-- added. Multi-tenant (`lms_tenant`) indexes are intentionally excluded.

begin;

create index if not exists idx_courses_slug on public.courses(slug);

create index if not exists idx_lessons_course_slug on public.lessons(course_slug);
create index if not exists idx_lessons_sort on public.lessons(course_slug, sort_order, lesson_no);
create index if not exists idx_lessons_kind_parent_position on public.lessons(course_id, kind, parent_section_id, "position");

create index if not exists idx_lesson_progress_email on public.lesson_progress(email);
create index if not exists idx_lesson_progress_lookup on public.lesson_progress(email, lesson_id);

create index if not exists idx_orders_course_id on public.orders(course_id);
create index if not exists idx_orders_course_slug on public.orders(course_slug);
create index if not exists idx_orders_normalized_customer_email on public.orders(normalized_customer_email);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_sync_correlation on public.orders(sync_correlation_id);

commit;
