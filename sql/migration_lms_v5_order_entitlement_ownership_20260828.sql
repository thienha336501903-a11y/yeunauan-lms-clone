-- Commerce V5 entitlement ownership: one Commerce order may own at most one
-- student_enrollments row. This closes cross-email concurrent grant races while
-- keeping non-V5/legacy enrollment history untouched.

create unique index if not exists student_enrollments_commerce_v5_order_unique_idx
  on public.student_enrollments(source_order_id)
  where source_system = 'commerce_v5'
    and source_order_id is not null;
