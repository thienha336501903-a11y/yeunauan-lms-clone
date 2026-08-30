-- Forward-only security hardening for the existing V5 delivery-mode trigger.
-- Behavior is unchanged; only the function execution search_path is pinned.

alter function public.enforce_v5_course_mode()
  set search_path = pg_catalog, public;
