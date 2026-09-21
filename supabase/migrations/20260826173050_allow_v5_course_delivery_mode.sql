alter table public.courses drop constraint if exists courses_delivery_mode_check;
alter table public.courses add constraint courses_delivery_mode_check check (delivery_mode = any (array['lms'::text,'v4'::text,'telegram'::text,'v5'::text]));;
